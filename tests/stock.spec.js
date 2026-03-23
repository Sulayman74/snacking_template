import { expect, test } from '@playwright/test';

test.describe('Gestion des Stocks & Sécurité', () => {

  test('Un produit épuisé est grisé et affiche un toast au clic', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const clientContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const clientPage = await clientContext.newPage();

    // ==========================================
    // 👨‍🍳 1. LE CHEF SE CONNECTE ET COUPE UN PRODUIT
    // ==========================================
    await adminPage.goto('http://localhost:5173/admin.html');

    // 🚨 Le robot nous prévient si Firebase affiche une erreur (Alerte)
    adminPage.on('dialog', async dialog => {
        console.error('🚨 ALERTE FIREBASE DÉTECTÉE PAR LE ROBOT :', dialog.message());
        await dialog.accept();
    });
    
    // Remplissage du login
    const loginSection = adminPage.locator('#admin-login-section');
    await expect(loginSection).toBeVisible({ timeout: 10000 });
    
    // ⚠️ Assure-toi que "robot@test.com" a bien le rôle "admin" dans ta base de données Firebase !
    await adminPage.locator('#admin-email-input').fill('robot@test.com'); 
    await adminPage.locator('#admin-password-input').fill('123456');
    await adminPage.locator('#admin-login-btn').click();

    // Lancement du service 
    const startBtn = adminPage.locator('#start-shift-btn');
    await expect(startBtn).toBeVisible({ timeout: 10000 });
    await startBtn.click();
    await expect(adminPage.locator('#startup-overlay')).toBeHidden({ timeout: 10000 });

    // Le chef s'assure d'être sur l'onglet Menu/Stocks
    await adminPage.locator('#tab-menu').click();

    // On attend que le texte "En stock" apparaisse (preuve que les Skeletons ont disparu)
    await adminPage.waitForSelector('text="En stock"', { timeout: 10000 });

    // Le chef trouve le premier produit "En stock"
    const activeToggle = adminPage.locator('button.bg-green-500').first();
    await expect(activeToggle).toBeVisible();

    // On force le clic DIRECTEMENT dans le moteur Javascript du navigateur
    await activeToggle.evaluate(node => node.click());

    // On attend que le composant se rafraîchisse et affiche "Épuisé"
    await expect(adminPage.locator('text="Épuisé"').first()).toBeVisible({ timeout: 10000 });

    // ==========================================
    // 📱 2. LE CLIENT NAVIGUE SUR LA CARTE
    // ==========================================
    await clientPage.goto('http://localhost:5173');
    
    // Masquer le splash screen
    await expect(clientPage.locator('#splash-screen')).toBeHidden({ timeout: 10000 });
    await clientPage.evaluate(() => window.switchView('menu'));

    // On vérifie que la grande page du menu complet est bien affichée
    const fullMenu = clientPage.locator('#full-menu');
    await expect(fullMenu).toBeVisible();

    // ==========================================
    // 🛑 3. VÉRIFICATION DU GARDE-FOU
    // ==========================================
    
    // Le robot cherche spécifiquement une carte produit qui contient le texte "Épuisé"
    const outOfStockCard = clientPage.locator('#full-menu-container .group').filter({ hasText: 'Épuisé' }).first();
    await expect(outOfStockCard).toBeVisible({ timeout: 10000 });
    
    // Le client essaie de cliquer sur le produit grisé
    await outOfStockCard.click();

    // VÉRIFICATION : Le Toast d'erreur ("Produit momentanément indisponible") doit apparaître !
    const toastMessage = clientPage.locator('#snackbar-message');
    await expect(toastMessage).toBeVisible();
    await expect(toastMessage).toContainText('indisponible', { ignoreCase: true });
    
    // Et bien sûr, la modale du produit ne doit PAS s'ouvrir (elle reste en bas de l'écran avec la classe translate-y-full)
    await expect(clientPage.locator('#product-modal')).toHaveClass(/translate-y-full/);
  });

});