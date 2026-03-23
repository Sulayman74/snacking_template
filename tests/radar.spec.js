import { expect, test } from '@playwright/test';

test.describe('Communication Temps Réel : Radar de Cuisine', () => {

  test('Le flux de commande traverse bien les 3 statuts (Attente -> Cuisson -> Prêt)', async ({ browser }) => {
    // Création de 2 téléphones isolés
    const clientContext = await browser.newContext();
    const adminContext = await browser.newContext();
    
    const clientPage = await clientContext.newPage();
    const adminPage = await adminContext.newPage();


     // ==========================================
    // 📱 1. LE CLIENT SE CONNECTE ET COMMANDE
    // ==========================================
    await clientPage.goto('http://localhost:5173');
    
    // Masquer le splash screen
    await expect(clientPage.locator('#splash-screen')).toBeHidden({ timeout: 10000 });

    // Connexion du client
    await clientPage.locator('#loyalty-main-btn').click();
    await expect(clientPage.locator('#auth-modal')).toBeVisible();
    await clientPage.locator('#auth-email').fill('robot@test.com'); // Mettre un vrai compte Client Firebase
    await clientPage.locator('#auth-password').fill('123456');
    await clientPage.locator('#auth-submit-btn').click();
    await expect(clientPage.locator('#auth-modal')).toBeHidden({ timeout: 10000 });

    // Ajout au panier et Validation
    await clientPage.locator('.group.cursor-pointer').first().click();
    await clientPage.locator('#modal-cta').click();
    await clientPage.locator('#floating-cart-container button').click();
    
    // 🛑 TRÈS IMPORTANT : Le robot valide la commande !
    await clientPage.locator('#checkout-btn').click(); 


    // ==========================================
    // 👨‍🍳 2. LE CHEF SE CONNECTE ET OUVRE LE RADAR
    // ==========================================
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
    await adminPage.locator('#tab-cuisine').click();

   
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

    // ACTION CLIENT : "Je suis à 5 min"
    await clientPage.locator('#tracking-action-btn').click();

    // VÉRIFICATION 3 (Admin) : Le ticket passe dans la colonne rouge
    // Le ticket contient la bordure rouge "border-red-500"
    const cookingTicket = adminPage.locator('#orders-new .border-red-500').first();
    await expect(cookingTicket).toBeVisible();

    // ACTION ADMIN : Le chef clique sur "MARQUER PRÊTE"
    await cookingTicket.locator('button', { hasText: 'MARQUER PRÊTE' }).click();

    // VÉRIFICATION 4 (Client) : Le statut passe au vert !
    await expect(clientPage.locator('#tracking-title')).toContainText("C'est prêt", { timeout: 10000 });
  });

});