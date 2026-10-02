import { expect, test } from '@playwright/test';

// 📱 Parcours d'achat sur téléphone (audit UX 2026-09-29) : écran de 390×664,
// celui des captures de l'audit.
test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

const APP = 'http://localhost:5173';

async function burgerId(page) {
  await page.goto(`${APP}?lang=fr`);
  await page.waitForFunction(() => (window.store?.state?.menu || []).some((p) => p.nom === 'Burger Robot'));
  return page.evaluate(() => window.store.state.menu.find((p) => p.nom === 'Burger Robot').id);
}

async function openProductAsMenu(page, id) {
  await page.evaluate((pid) => window.openProductModal(pid), id);
  await expect(page.locator('#modal-title')).toBeVisible();
  await page.evaluate(() => {
    const radio = document.querySelector('#product-modal input[value="menu"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test.describe('Parcours d\'achat mobile (UX)', () => {
  test('UX-4 : prix et « Ajouter » visibles sans défiler dans la fiche produit', async ({ page }) => {
    const id = await burgerId(page);
    await openProductAsMenu(page, id);
    const cta = page.locator('#modal-cta');
    await expect(cta).toContainText('Ajouter');
    await expect(cta).toBeInViewport();
    const box = await cta.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(664);
  });

  test('UX-1 : un tap au centre de « Valider la commande » atteint le bouton', async ({ page }) => {
    const id = await burgerId(page);
    await openProductAsMenu(page, id);
    await page.locator('#modal-cta').click();
    await page.evaluate(() => window.openCartModal());
    const btn = page.locator('#checkout-btn');
    await expect(btn).toBeVisible();
    await page.waitForTimeout(400); // fin de l'animation du panier
    const hit = await btn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === el || el.contains(top);
    });
    expect(hit).toBe(true);
  });

  test('UX-6 : lien direct vers un produit → fiche ouverte, splash retiré vite', async ({ page }) => {
    const id = await burgerId(page);
    const started = Date.now();
    await page.goto(`${APP}?lang=fr&action=product&id=${id}`);
    await expect(page.locator('#boot-splash')).toHaveCount(0, { timeout: 3500 });
    expect(Date.now() - started).toBeLessThan(3500); // filet de sécurité du splash : 4 s
    await expect(page.locator('#modal-title')).toHaveText('Burger Robot', { timeout: 5000 });
  });
});
