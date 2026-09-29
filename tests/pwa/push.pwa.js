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
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => registrations.find((r) => r.scopeURL === `${ORIGIN}/`)).toBeTruthy();
  const registrationId = registrations.find((r) => r.scopeURL === `${ORIGIN}/`).registrationId;
  const push = (payload) => cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId, data: JSON.stringify(payload) });
  const notifications = () => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.getNotifications()).map((n) => ({ title: n.title, body: n.body, data: n.data }));
  });
  return { push, notifications };
}

test('push FCM en arrière-plan → notification affichée, lien ramené sur le site', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { push, notifications } = await setup(context, page);

  // Onglet en arrière-plan : une autre page prend le focus.
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();

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
