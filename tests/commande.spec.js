import { expect, test } from '@playwright/test';

test.describe('Flux de Commande Click & Collect', () => {
  
  test('Le client peut ajouter un Menu au panier et valider', async ({ page }) => {
    // 1. Le robot ouvre ton site (Assure-toi que ton serveur Vite tourne !)
    await page.goto('http://localhost:5173');

    // 2. On attend que Firebase charge les produits (On cherche tes cartes produits)
    const productCard = page.locator('.group.cursor-pointer').first();
    await expect(productCard).toBeVisible({ timeout: 10000 }); 

    // 3. Le robot clique sur le premier Tacos/Burger qu'il voit
    await productCard.click();

    // 4. On vérifie que la modale du produit s'ouvre bien
    const modalTitle = page.locator('#modal-title');
    await expect(modalTitle).toBeVisible();

    // 5. Le robot choisit la formule "En Menu"
    await page.locator('input[name="formule"][value="menu"]').check();

    // 6. Il clique sur le gros bouton noir "Ajouter"
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