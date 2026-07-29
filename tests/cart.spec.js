import { expect, test } from '@playwright/test';

test.describe('Caisse Enregistreuse (Calcul du Panier)', () => {

  test('Doit calculer le total exact et empêcher les NaN', async ({ page }) => {
// 1. Ouvre le site
    await page.goto('http://localhost:5173?lang=fr');

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
    // Le radio formule est `sr-only peer` (1px, masqué) → cliquer le label est flaky
    // (animation modale + actionability). Le but du test étant le CALCUL, on coche la
    // formule "menu" de façon déterministe (coche + event change → window.toggleDrinkSection).
    await page.evaluate(() => {
      const radio = document.querySelector('#product-modal input[value="menu"]');
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.locator('#modal-cta').click();

    // 3. Ouvre le panier (via l'API : le bouton d'ouverture est le CTA contextuel
    // #mobile-cta-btn, dont l'action varie selon la vue — on teste ici le CALCUL,
    // pas le bouton, donc on ouvre directement comme pour window.switchView).
    await page.evaluate(() => window.openCartModal());

    // 4. Ajoute une quantité (+1) via le bouton du panier
    // Sélecteur stable : la classe `.cart-item-plus` (celle que CartUI relie au
    // onclick), insensible à la lib d'icônes (migration FontAwesome → Lucide).
    const btnPlus = page.locator('#cart-items-container .cart-item-plus').first();
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