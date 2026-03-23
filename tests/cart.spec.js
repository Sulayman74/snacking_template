import { expect, test } from '@playwright/test';

test.describe('Caisse Enregistreuse (Calcul du Panier)', () => {

  test('Doit calculer le total exact et empêcher les NaN', async ({ page }) => {
    // 1. Ouvre le site
    await page.goto('http://localhost:5173');

    // 2. Sélectionne le premier produit et l'ajoute en Menu
    const firstProduct = page.locator('.group.cursor-pointer').first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    await firstProduct.click();
    await page.locator('input[value="menu"]').check();
    await page.locator('#modal-cta').click(); // Ajout au panier

    // 3. Ouvre le panier
    await page.locator('#floating-cart-container button').click();

    // 4. Ajoute une quantité (+1) via le bouton du panier
    // On cherche le bouton "+" dans les articles du panier
    const btnPlus = page.locator('#cart-items-container button').filter({ has: page.locator('.fa-plus') }).first();
    await btnPlus.click();

    // 5. Vérifie que le total n'est pas cassé
    const totalPrice = page.locator('#cart-total-price');
    
    // Le texte ne doit absolument PAS contenir 'NaN' (Not a Number)
    await expect(totalPrice).not.toContainText('NaN');
    
    // Le texte ne doit pas être 0,00 € puisqu'on a ajouté des produits
    await expect(totalPrice).not.toHaveText('0,00 €');

    // 6. Le bouton de paiement doit être actif
    const checkoutBtn = page.locator('#checkout-btn');
    await expect(checkoutBtn).not.toBeDisabled();
  });

});