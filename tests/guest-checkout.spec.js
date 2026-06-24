import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

test.describe('Flux Guest Checkout et Conversion', () => {

  test('Un invité peut commander, voir la bannière et convertir son compte anonyme en permanent', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    // 1. Ouvre le site
    await page.goto('http://localhost:5173');

    // Attendre que le splash screen disparaisse
    await expect(page.locator('#splash-screen')).toBeHidden({ timeout: 10000 });

    // Forcer l'affichage du menu complet
    await page.evaluate(() => window.switchView('menu'));
    const fullMenu = page.locator('#full-menu-container');
    await expect(fullMenu).toBeVisible({ timeout: 10000 });

    // 2. Sélectionne le premier produit et l'ajoute au panier
    const firstProduct = page.locator('#full-menu-container .group.cursor-pointer').first();
    await firstProduct.click();

    await expect(page.locator('#modal-title')).toBeVisible();
    await page.evaluate(() => {
      const radio = document.querySelector('#product-modal input[value="menu"]');
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.locator('#modal-cta').click();

    // 3. Ouvre le panier
    await page.evaluate(() => window.openCartModal());
    const checkoutBtn = page.locator('#checkout-btn');
    await expect(checkoutBtn).toBeVisible();

    // 4. Clique sur "Valider ma commande" (déclenche signInAnonymously car enableGuestCheckout est activé)
    await checkoutBtn.click();

    // Attendre l'ouverture de la bottom sheet Stripe
    await expect(page.locator('#payment-bottom-sheet')).toBeVisible({ timeout: 10000 });

    // Récupérer l'UID anonyme généré pour le client
    const anonymousUid = await page.evaluate(() => {
      return window.store?.state?.user?.uid;
    });
    expect(anonymousUid).toBeDefined();

    // 5. Simuler le paiement réussi en générant un PI Stripe légitime et en finalisant côté client
    // On appelle notre script utilitaire synchrone pour éviter tout problème de require/import CJS dans Playwright
    const piId = execSync('node tests/integration/create-succeeded-pi.cjs').toString().trim();
    expect(piId).toMatch(/^pi_/);

    const guestEmail = `guest_${Date.now()}@test.com`;

    await page.evaluate(async ({ piId, email }) => {
      window.setGuestEmailForTest?.(email);
      await window.finalizeOrderInFirestore(piId);
    }, { piId, email: guestEmail });

    // 6. Attendre que la modale de suivi/tracking s'ouvre
    await expect(page.locator('#order-tracking-modal')).toBeVisible({ timeout: 12000 });

    // S'assurer que le guest registration banner est visible
    const registrationBanner = page.locator('#guest-registration-banner');
    await expect(registrationBanner).toBeVisible();

    // 7. Clique sur "Créer mon compte"
    await page.locator('#guest-register-btn').click();

    // S'assurer que la modale d'auth s'ouvre en mode inscription
    await expect(page.locator('#auth-modal')).toBeVisible();
    await expect(page.locator('#auth-title')).toHaveText('Créer un compte');

    // Remplir le formulaire
    await page.locator('#auth-email').fill(guestEmail);
    await page.locator('#auth-password').fill('123456');

    // Valider l'inscription
    await page.locator('#auth-submit-btn').click();

    // La modale d'auth doit se fermer après inscription réussie
    await expect(page.locator('#auth-modal')).toBeHidden({ timeout: 15000 });

    // 8. Vérifier dans Firestore que le doc utilisateur est converti et la commande liée
    const checkResult = execSync(`node tests/integration/check-user-converted.cjs ${anonymousUid} ${piId}`).toString().trim();
    expect(checkResult).toBe('SUCCESS');
  });

});
