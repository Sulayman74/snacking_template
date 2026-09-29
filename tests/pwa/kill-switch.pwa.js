// 🧯 Kill-switch du service worker (scripts/sw-kill-switch.js) : sur une app déjà
// contrôlée par le SW normal, la version d'urgence doit vider les caches, se
// désinstaller et recharger la page UNE seule fois (pas de boucle).
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

// Fichier servi par `vite preview` (cf. playwright.pwa.config.js) : on le remplace
// comme le ferait un déploiement, puis on le restaure.
const SERVED_SW = 'dist/Ym1YiO4Ue5Fb5UXlxr06/sw.js';
const KILL = readFileSync('scripts/sw-kill-switch.js', 'utf8');

test('le SW d\'urgence vide les caches, se désinstalle, sans boucle de rechargement', async ({ browser }) => {
  const context = await browser.newContext();
  await context.route(/^(?!http:\/\/localhost:4173)/, (route) => route.abort());
  const page = await context.newPage();

  // 1. App contrôlée par le SW normal, precache rempli.
  await page.goto('/robots.txt');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);

  // 2. « Déploiement » du SW d'urgence à la même URL, puis vérification de mise à jour.
  const original = readFileSync(SERVED_SW, 'utf8');
  writeFileSync(SERVED_SW, KILL);
  try {
    let navigations = 0;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());

    // 3. Caches vidés, plus aucun SW, une seule navigation (rechargement).
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { timeout: 10000 }).toBe(0);
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBe(0);
    await page.waitForTimeout(2000);
    expect(navigations).toBe(1);

    // 4. Même si l'app ré-enregistre sw.js (toujours la version d'urgence) : pas de rechargement.
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); });
    await page.waitForTimeout(2500);
    expect(navigations).toBe(1);
  } finally {
    writeFileSync(SERVED_SW, original);
    await context.close();
  }
});
