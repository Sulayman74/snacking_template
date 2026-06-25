import { expect, test } from '@playwright/test';

// Pré-requis : seed-emulator.js a créé le user robot@test.com avec UNE commande
// passée (e2e_order_1) contenant une ligne valide (Menu Frites Test ×2) et une
// ligne dont le produit n'existe plus au menu (Produit Disparu).
test.describe('Re-commande express (« Commander à nouveau »)', () => {

  test('Un client connecté recommande sa dernière commande en un tap', async ({ page }) => {
    await page.goto('http://localhost:5173?lang=fr');

    // 1. Connexion via la modale d'authentification
    await page.evaluate(() => window.toggleAuthModal());
    await page.fill('#auth-email', 'robot@test.com');
    await page.fill('#auth-password', '123456');
    await page.click('#auth-submit-btn');

    // 2. Le bloc « Commander à nouveau » apparaît sur l'accueil avec le résumé
    const section = page.locator('#reorder-section');
    await expect(section).toBeVisible({ timeout: 15000 });
    await expect(section).toContainText('Menu Frites Test');

    // 3. Un tap → le panier se remplit et s'ouvre directement (chemin checkout)
    await page.click('[data-action="reorder-last"]');
    await expect(page.locator('#cart-modal')).not.toHaveClass(/translate-y-full/, { timeout: 10000 });

    // 4. La ligne valide est là (quantité de la commande rejouée), la ligne
    //    périmée est exclue, et le total est sain (pas de NaN).
    const items = page.locator('#cart-items-container');
    await expect(items).toContainText('Menu Frites Test');
    await expect(items).not.toContainText('Produit Disparu');
    await expect(page.locator('#cart-total-price')).not.toContainText('NaN');
    await expect(page.locator('#cart-total-price')).not.toHaveText('0,00 €');
  });

  test('Le bloc est masqué pour un visiteur non connecté', async ({ page }) => {
    await page.goto('http://localhost:5173?lang=fr');
    await expect(page.locator('#bestsellers')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#reorder-section')).toBeHidden();
  });

});
