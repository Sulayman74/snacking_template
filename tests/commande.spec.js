import { expect, test } from '@playwright/test';

test.describe('Flux de Commande Click & Collect', () => {
  
  test('Le client peut ajouter un Menu au panier et valider', async ({ page }) => {
// 1. Ouvre le site
    await page.goto('http://localhost:5173');

    // 🛑 LE HACK CTO : On force l'ouverture du menu complet !
    await page.evaluate(() => window.switchView('menu'));
    
    // On attend que le grand menu apparaisse
    const fullMenu = page.locator('#full-menu-container');
    await expect(fullMenu).toBeVisible({ timeout: 10000 });

    // 2. On sélectionne le premier produit du MENU COMPLET (qui a sûrement l'option Menu)
    const firstProduct = page.locator('#full-menu-container .group.cursor-pointer').first();
    await firstProduct.click();

    // 3. On attend que la modale s'ouvre, on coche "Menu" et on ajoute au panier
    await expect(page.locator('#modal-title')).toBeVisible();
    await page.locator('input[value="menu"]').check({ force: true }); // force: true aide sur Firefox
    await page.locator('#modal-cta').click();

    // 7. Il clique sur le panier rouge flottant en bas de l'écran
    await page.locator('#floating-cart-container button').click();

    // 8. VÉRIFICATION FINALE : Le panier s'ouvre et le bouton est prêt !
    const checkoutBtn = page.locator('#checkout-btn');
    await expect(checkoutBtn).toBeVisible();
    await expect(checkoutBtn).not.toBeDisabled();
    
    // Le robot vérifie que le prix n'est pas "0,00 €" ou "NaN" !
    const totalPrice = page.locator('#cart-total-price');
    await expect(totalPrice).not.toHaveText('0,00 €');
    await expect(totalPrice).not.toContainText('NaN');
  });

});