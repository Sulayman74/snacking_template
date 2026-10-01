import { expect, test } from '@playwright/test';

test.describe('Communication Temps Réel : Radar de Cuisine', () => {

  test('Le flux de commande traverse bien les 3 statuts (Attente -> Cuisson -> Prêt)', async ({ browser }) => {
    // Création de 2 téléphones isolés
    // Client sur téléphone (ORD-1 : le badge de suivi était masqué sous 768 px).
    const clientContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const adminContext = await browser.newContext();
    
    const clientPage = await clientContext.newPage();
    const adminPage = await adminContext.newPage();


     // ==========================================
    // 📱 1. LE CLIENT SE CONNECTE ET COMMANDE
    // ==========================================
    await clientPage.goto('http://localhost:5173?lang=fr');
    
    // Masquer le splash screen
    await expect(clientPage.locator('#splash-screen')).toBeHidden({ timeout: 10000 });
    await clientPage.evaluate(() => window.toggleAuthModal());

    // Connexion du client
    await expect(clientPage.locator('#auth-modal')).toBeVisible();
    await clientPage.locator('#auth-email').fill('robot@test.com'); // Mettre un vrai compte Client Firebase
    await clientPage.locator('#auth-password').fill('123456');
    await clientPage.locator('#auth-submit-btn').click();
    await expect(clientPage.locator('#auth-modal')).toBeHidden({ timeout: 10000 });

    // 🛒 E2E : Pour bypasser Stripe Elements, on injecte l'activeOrderId de la commande
    // seedée ("e2e_order_1") dans le localStorage et on démarre directement le tracking.
    await clientPage.evaluate(() => {
      localStorage.setItem("activeOrderId", "e2e_order_1");
      window.startOrderTracking("e2e_order_1");
    });


    // ==========================================
    // 👨‍🍳 2. LE CHEF SE CONNECTE ET OUVRE LE RADAR
    // ==========================================
    // Compteur de sonneries (hors déblocage du son au démarrage, joué à volume 0).
    await adminPage.addInitScript(() => {
      window.__bellPlays = 0;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.id === 'kitchen-bell' && this.volume > 0) window.__bellPlays++;
        return play.call(this);
      };
    });
    await adminPage.goto('http://localhost:5173/admin.html');
    
    // Remplissage du login
    const loginSection = adminPage.locator('#admin-login-section');
    await expect(loginSection).toBeVisible({ timeout: 10000 });
    await adminPage.locator('#admin-email-input').fill('robot@test.com'); // Mettre un vrai compte Admin Firebase
    await adminPage.locator('#admin-password-input').fill('123456');
    await adminPage.locator('#admin-login-btn').click();

    // Lancement du service (Écran noir)
    const startBtn = adminPage.locator('#start-shift-btn');
    await expect(startBtn).toBeVisible({ timeout: 10000 });
    await startBtn.click();
    await expect(adminPage.locator('#startup-overlay')).toBeHidden({ timeout: 10000 });

    // 🛑 TRÈS IMPORTANT : Le chef s'assure d'être sur l'onglet Commandes !
    await adminPage.locator('#tab-cuisine-desktop').click();

   
    // ==========================================
    // 🏓 3. LE PING-PONG TEMPS RÉEL (LE TEST)
    // ==========================================
    
    // -> Le badge jaune apparaît chez le client
    const trackingBadge = clientPage.locator('#order-tracking-badge');
    await expect(trackingBadge).toBeVisible({ timeout: 15000 });
    await trackingBadge.click();

    // VÉRIFICATION 1 (Client) : Statut = en_attente_client
    await expect(clientPage.locator('#tracking-title')).toContainText('Commande reçue');

    // VÉRIFICATION 2 (Admin) : Le ticket est dans la colonne grise
    // Le ticket contient la bordure grise "border-gray-400"
    const waitingTicket = adminPage.locator('#orders-waiting .border-gray-400').first();
    await expect(waitingTicket).toBeVisible();

    // KDS-1 : le chef est parti sur l'onglet Menu (marquer un produit épuisé…).
    // L'écoute doit continuer, et l'arrivée du client doit SONNER.
    await adminPage.evaluate(() => window.switchAdminTab('menu'));
    const playsBefore = await adminPage.evaluate(() => window.__bellPlays);

    // ACTION CLIENT : "Je suis à 5 min"
    await clientPage.locator('#tracking-action-btn').click();

    // VÉRIFICATION 3 (Admin, onglet Menu) : sonnerie + message « à traiter en cuisine »
    await expect.poll(() => adminPage.evaluate(() => window.__bellPlays), { timeout: 10000 }).toBeGreaterThan(playsBefore);
    await expect(adminPage.getByText('à traiter en cuisine')).toBeVisible();

    // Retour en cuisine : le ticket est déjà passé dans la colonne rouge (bordure "border-red-500")
    await adminPage.locator('#tab-cuisine-desktop').click();
    const cookingTicket = adminPage.locator('#orders-new .border-red-500').first();
    await expect(cookingTicket).toBeVisible();

    // ORD-1 : le client ferme puis rouvre l'app pendant la cuisson → le suivi reprend tout seul.
    await clientPage.reload();
    await expect(clientPage.locator('#splash-screen')).toBeHidden({ timeout: 10000 });
    await expect(trackingBadge).toBeVisible({ timeout: 15000 });

    // ACTION ADMIN : Le chef clique sur "MARQUER PRÊTE"
    await cookingTicket.locator('button', { hasText: 'MARQUER PRÊTE' }).click();

    // VÉRIFICATION 4 (Client) : Le statut passe au vert !
    await expect(clientPage.locator('#tracking-title')).toContainText("C'est prêt", { timeout: 10000 });
  });

});