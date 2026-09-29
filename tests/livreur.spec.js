import { test, expect } from '@playwright/test';

// 📤 Livreur hors-ligne : la photo de preuve prise SANS réseau est gardée sur
// l'appareil, signalée « en attente », puis envoyée toute seule au retour du réseau
// (Storage + Firestore émulés). Seed : livreur@test.com + course e2e_delivery_1.
test.describe('Livreur — photo de preuve hors-ligne', () => {
  test('photo prise hors-ligne → mise en file → envoyée au retour du réseau', async ({ browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext({
      geolocation: { latitude: 45.9, longitude: 6.35 },
      permissions: ['geolocation'],
    });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.log('BROWSER ERROR:', err.message));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('BROWSER', m.type(), m.text().slice(0, 200)); });
    await page.addInitScript(() => localStorage.setItem('livreur_help_seen', '1'));

    // 1. Connexion livreur → course en cours affichée.
    await page.goto('http://localhost:5173/livreur.html');
    await page.locator('#driver-email').fill('livreur@test.com');
    await page.locator('#driver-password').fill('123456');
    await page.locator('#driver-login-btn').click();
    const pickupBtn = page.locator('[data-livreur-action="pickup"]');
    await expect(pickupBtn).toContainText('Photo de prise en charge', { timeout: 20000 });

    // 2. Plus de réseau.
    await context.setOffline(true);

    // 3. Photo de prise en charge (JPEG fabriqué dans le navigateur), confirmation.
    const jpegBase64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#c0392b'; g.fillRect(0, 0, 64, 64);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    });
    await page.setInputFiles('#pod-pickup-input', { name: 'pickup.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegBase64, 'base64') });
    await expect(page.locator('#pod-preview-modal')).toBeVisible();
    await page.locator('#pod-confirm-btn').click();

    // 4. Gardée sur l'appareil, signalée « en attente » ; la livraison n'est pas bloquée.
    await expect(pickupBtn).toContainText('envoi en attente', { timeout: 10000 });
    await expect(page.locator('#pod-preview-modal')).toBeHidden();
    await expect(page.locator('#deliver-hint')).not.toContainText("Confirmez d'abord");

    // 5. Retour du réseau → envoi automatique → la commande a sa photo (pickupUrl).
    await context.setOffline(false);
    await expect(pickupBtn).toContainText('Prise en charge confirmée', { timeout: 30000 });
    const pending = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('snack-livreur');
      req.onsuccess = () => {
        const tx = req.result.transaction('pod-queue', 'readonly');
        const c = tx.objectStore('pod-queue').count();
        c.onsuccess = () => resolve(c.result);
      };
      req.onerror = () => resolve(-1);
    }));
    expect(pending).toBe(0);
    await context.close();
  });
});
