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
    // La fiche monte depuis le bas (300 ms) : on mesure une fois arrivée.
    await expect.poll(async () => {
      const box = await cta.boundingBox();
      return box.y + box.height;
    }).toBeLessThanOrEqual(664);
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

test.describe('État de la boutique en direct (UX-5)', () => {
  test('le chef met la cuisine en pause : le client le voit sans recharger, puis la reprise', async ({ page, browser }) => {
    // Client : un article au panier, carte ouverte.
    const id = await burgerId(page);
    await page.evaluate((pid) => window.openProductModal(pid), id);
    await page.locator('#modal-cta').click();
    await page.evaluate(() => window.switchView('menu'));
    const pill = page.locator('snack-status-pill[context="menu"] [role="status"]');
    await expect(pill).toHaveCount(0); // ouvert : rien à signaler

    // Chef : écran cuisine, pause 20 min.
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    try {
      await admin.goto(`${APP}/admin.html`);
      await admin.locator('#admin-email-input').fill('robot@test.com');
      await admin.locator('#admin-password-input').fill('123456');
      await admin.locator('#admin-login-btn').click();
      await admin.locator('#start-shift-btn').click();
      await expect(admin.locator('#startup-overlay')).toBeHidden({ timeout: 10000 });
      await admin.evaluate(() => window.setKitchenServicePause(20));

      await expect(pill).toContainText('Cuisine en pause jusqu', { timeout: 10000 });
      await page.evaluate(() => window.openCartModal());
      await expect(page.locator('snack-status-pill[context="cart"] [role="status"]')).toContainText('Cuisine en pause');
      await expect(page.locator('#checkout-btn')).toBeDisabled();
    } finally {
      await admin.evaluate(() => window.resumeKitchenService());
      await adminContext.close();
    }

    await expect(page.locator('#checkout-btn')).toBeEnabled({ timeout: 10000 });
    await expect(page.locator('snack-status-pill[context="cart"] [role="status"]')).toHaveCount(0);
  });
});
