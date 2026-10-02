// 📦 Service worker — contenu du précache et fonctionnement hors-ligne, sur le build
// de prod : le client ne télécharge que SA coquille, qui marche hors-ligne dès la
// 1re visite ; l'admin marche hors-ligne après une 1re ouverture (cache runtime).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ORIGIN = 'http://localhost:4173';
const SW_FILE = 'dist/Ym1YiO4Ue5Fb5UXlxr06/sw.js';

/** URLs du manifeste de précache injecté par vite-plugin-pwa dans sw.js. */
function precachedUrls() {
  return [...readFileSync(SW_FILE, 'utf8').matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]);
}

/** Page contrôlée par le SW (enregistré depuis une page neutre, puis rechargement). */
async function controlledPage(context) {
  await context.route(/^(?!http:\/\/localhost:4173)/, (route) => route.abort()); // aucun appel externe
  const page = await context.newPage();
  await page.goto('/robots.txt');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  return page;
}

test('le précache ne contient que la coquille client', () => {
  const urls = precachedUrls();
  expect(urls).toContain('index.html');
  expect(urls.some((u) => /^assets\/main-.*\.js$/.test(u))).toBe(true);
  expect(urls.some((u) => /^assets\/styles-.*\.css$/.test(u))).toBe(true);
  const staff = urls.filter((u) => /^(admin|livreur|superadmin)\.html$|^assets\/(admin|livreur|superadmin)-|^sounds\/|firebase-messaging-sw/.test(u));
  expect(staff, 'fichiers back-office précachés pour les clients').toEqual([]);
  const lazyOnly = urls.filter((u) => /^assets\/(html5-qrcode|qrcode)-/.test(u));
  expect(lazyOnly, 'chunks chargés à la demande précachés pour rien').toEqual([]);
  expect(urls.some((u) => /^assets\/firebase-.*\.js$/.test(u)), 'SDK Firebase dans son chunk stable').toBe(true);
});

test('client hors-ligne dès la 1re visite : page et scripts servis par le SW', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await controlledPage(context);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);

  await context.setOffline(true);
  const mainJs = page.waitForResponse((r) => /\/assets\/main-.*\.js$/.test(r.url()));
  await page.goto('/menu', { waitUntil: 'domcontentloaded' }); // route SPA → index.html précaché
  expect((await mainJs).ok()).toBe(true);
  await expect(page.locator('#full-menu')).toHaveCount(1);
  expect(page.url()).toBe(`${ORIGIN}/menu`);
  await context.close();
});

test('admin : pas précaché, mais utilisable hors-ligne après une 1re ouverture', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await controlledPage(context);

  // 1re ouverture en ligne → page, chunk admin et sonnerie passent en cache runtime.
  const adminJs = page.waitForResponse((r) => /\/assets\/admin-.*\.js$/.test(r.url()));
  const bell = page.waitForResponse((r) => r.url().endsWith('/sounds/kitchen-bell.mp3'));
  await page.goto('/admin.html', { waitUntil: 'load' });
  expect((await adminJs).ok()).toBe(true);
  expect((await bell).ok()).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => /app-(pages|assets|media)/.test(k)).length)).toBe(3);

  // Hors-ligne : page admin (pas index.html !), chunk et sonnerie servis depuis le cache.
  await context.setOffline(true);
  const adminJsOffline = page.waitForResponse((r) => /\/assets\/admin-.*\.js$/.test(r.url()));
  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
  expect((await adminJsOffline).ok()).toBe(true);
  await expect(page.locator('#admin-login-section')).toHaveCount(1);
  await expect(page.locator('#full-menu')).toHaveCount(0);
  const bellOffline = await page.evaluate(async () => (await fetch('/sounds/kitchen-bell.mp3')).ok);
  expect(bellOffline).toBe(true);
  await context.close();
});
