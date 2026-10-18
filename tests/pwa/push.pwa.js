// 🔔 Service worker — affichage des push (régression : le SW actif n'avait
// AUCUN handler push). Push simulé via le protocole DevTools de Chromium.
import { test, expect } from '@playwright/test';

const ORIGIN = 'http://localhost:4173';

/** Page neutre (robots.txt) + blocage réseau externe, SW enregistré et actif. */
async function setup(context, page) {
  await context.route(/^(?!http:\/\/localhost:4173)/, (route) => route.abort());
  await context.grantPermissions(['notifications'], { origin: ORIGIN });
  const cdp = await context.newCDPSession(page);
  const registrations = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => registrations.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');

  await page.goto('/robots.txt');
  const swEvent = context.waitForEvent('serviceworker').catch(() => null);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => registrations.find((r) => r.scopeURL === `${ORIGIN}/`)).toBeTruthy();
  const registrationId = registrations.find((r) => r.scopeURL === `${ORIGIN}/`).registrationId;
  const sw = context.serviceWorkers()[0] ?? (await swEvent);
  const push = (payload) => cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId, data: JSON.stringify(payload) });
  const notifications = () => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.getNotifications()).map((n) => ({ title: n.title, body: n.body, data: n.data }));
  });

  /**
   * Met l'app en arrière-plan : un autre onglet prend le focus, puis on attend que le SW
   * voie `page` comme NON focalisée. C'est `WindowClient.focused` que `handlePush` consulte,
   * et il bascule bien dans Chromium headless. `document.hasFocus()` est inutilisable ici :
   * Playwright active `Emulation.setFocusEmulationEnabled` sur chaque page, il reste donc
   * à `true` quel que soit l'onglet devant (échec déterministe en CI, pas seulement flaky).
   */
  const sendToBackground = async () => {
    const other = await context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await expect.poll(() => sw.evaluate(async (url) => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const me = clients.find((c) => c.url === url);
      return me ? me.focused : null;
    }, page.url())).toBe(false);
    return other;
  };
  return { push, notifications, sendToBackground };
}

test('push FCM en arrière-plan → notification affichée, lien ramené sur le site', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { push, notifications, sendToBackground } = await setup(context, page);
  await sendToBackground();

  await push({
    notification: { title: '🛎️ Nouvelle commande', body: 'Alice · 12.00€ · Livraison' },
    fcmOptions: { link: 'https://snacking-template.web.app/admin.html' },
  });

  await expect.poll(notifications).toEqual([
    expect.objectContaining({
      title: '🛎️ Nouvelle commande',
      body: 'Alice · 12.00€ · Livraison',
      data: expect.objectContaining({ url: `${ORIGIN}/admin.html` }),
    }),
  ]);
  await context.close();
});

test('push avec app au premier plan → toast dans la page, pas de notification système', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { push, notifications } = await setup(context, page);
  await page.bringToFront();
  await page.evaluate(() => {
    window.__pushMessages = [];
    navigator.serviceWorker.addEventListener('message', (e) => window.__pushMessages.push(e.data));
  });

  await push({ notification: { title: 'Commande prête', body: 'Votre commande #AB12 est prête' } });

  await expect.poll(() => page.evaluate(() => window.__pushMessages)).toEqual([
    expect.objectContaining({ type: 'PUSH_FOREGROUND', title: 'Commande prête', body: 'Votre commande #AB12 est prête' }),
  ]);
  expect(await notifications()).toEqual([]);
  await context.close();
});

test('deux pushs avec le même tag (soir de match) → une seule notification, la dernière', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { push, notifications, sendToBackground } = await setup(context, page);
  // Le SW ne montre une notification que si l'app n'a PAS le focus : on attend que
  // le changement d'onglet soit effectif côté SW (sinon : toast en page, 0 notification).
  await sendToBackground();

  await push({ notification: { title: '⚽ LASK Linz vs Liverpool FC ce soir !', body: 'Commande ton menu' }, data: { tag: 'match-2026-10-14', campaignId: 'c1' } });
  await expect.poll(notifications).toHaveLength(1);
  await push({ notification: { title: '⚽ Soirée Champions League : 7 matchs ce soir !', body: 'Man City – PSG…' }, data: { tag: 'match-2026-10-14', campaignId: 'c2' } });

  await expect.poll(notifications).toEqual([
    expect.objectContaining({ title: '⚽ Soirée Champions League : 7 matchs ce soir !', data: expect.objectContaining({ campaignId: 'c2' }) }),
  ]);
  await context.close();
});
