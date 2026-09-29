// ============================================================================
// 🛠️ SERVICE WORKER UNIQUE (client, admin, livreur, superadmin)
// ============================================================================
// Compilé par vite-plugin-pwa (stratégie injectManifest). Reprend À L'IDENTIQUE
// l'ancien SW généré (precache, fallback navigation, caches runtime, prompt de
// mise à jour) et ajoute ce qui manquait : l'affichage des push (FCM) et le clic.
// Sans handler `push`, Chrome affichait une notification générique et Safari iOS
// finit par révoquer l'abonnement (push sans notification visible).

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate, NetworkOnly } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { parsePushPayload, mustAlwaysShowNotification } from "./sw/push-payload.js";

// --- Mise à jour : 'prompt' → skipWaiting seulement quand l'utilisateur clique
// sur le bandeau (cf. src/sw-update.js). Jamais de rechargement automatique.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// --- App-shell précaché + nettoyage des anciens caches.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

// --- Caches runtime (CLAUDE.md §8.3).
// Polices & icônes CDN : immuables → cache-first (long TTL).
registerRoute(
  ({ url }) => ["fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com", "ka-f.fontawesome.com"].includes(url.hostname),
  new CacheFirst({
    cacheName: "cdn-assets",
    plugins: [
      new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);
// Images produits (Firebase Storage) : stale-while-revalidate (catalogue).
registerRoute(
  ({ url }) => url.hostname.includes("firebasestorage") || url.hostname.includes("storage.googleapis.com"),
  new StaleWhileRevalidate({
    cacheName: "product-images",
    plugins: [
      new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 7 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);
// ❌ Cloud Functions (paiement/commande) : JAMAIS de cache (network-only).
registerRoute(({ url }) => url.hostname.includes("cloudfunctions.net"), new NetworkOnly());

// ============================================================================
// 🔔 PUSH
// ============================================================================

async function setBadge(count) {
  if (!("setAppBadge" in self.navigator)) return;
  try {
    if (count === null) await self.navigator.setAppBadge(); // pastille sans nombre
    else if (count === 0) await self.navigator.clearAppBadge();
    else await self.navigator.setAppBadge(count);
  } catch {
    /* badge non autorisé (ex. app non installée) : sans conséquence */
  }
}

async function handlePush(event) {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = { notification: { body: event.data ? event.data.text() : "" } };
  }
  const msg = parsePushPayload(payload, self.location.origin);
  await setBadge(msg.badgeCount);

  // App au premier plan : comme l'ancien SDK FCM, on affiche un toast dans la page
  // plutôt qu'une notification système. Sauf Safari, qui l'exige toujours.
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const focused = windows.find((c) => c.focused);
  if (focused) {
    focused.postMessage({ type: "PUSH_FOREGROUND", title: msg.title, body: msg.body, url: msg.url });
    if (!mustAlwaysShowNotification(self.navigator.userAgent)) return;
  }

  await self.registration.showNotification(msg.title, {
    body: msg.body,
    icon: msg.icon,
    image: msg.image,
    data: { url: msg.url, campaignId: msg.campaignId, snackId: msg.snackId },
  });
}

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

// ============================================================================
// 👆 CLIC SUR UNE NOTIFICATION
// ============================================================================

async function handleNotificationClick(event) {
  const { url = `${self.location.origin}/`, campaignId } = event.notification.data || {};
  if ("clearAppBadge" in self.navigator) self.navigator.clearAppBadge().catch(() => {});

  // 📊 Tracking best-effort du clic campagne (stats.clics côté serveur).
  if (campaignId) {
    fetch(
      `https://europe-west9-snacking-template.cloudfunctions.net/trackPushClick?c=${encodeURIComponent(campaignId)}`,
      { method: "POST", mode: "no-cors", keepalive: true }
    ).catch(() => {});
  }

  // Fenêtre déjà ouverte sur la même surface (client / admin / livreur) → on la
  // réutilise ; sinon on en ouvre une nouvelle.
  const target = new URL(url);
  const surface = (path) => (path.startsWith("/admin") ? "admin" : path.startsWith("/livreur") ? "livreur" : path.startsWith("/superadmin") ? "superadmin" : "client");
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows.find((c) => {
    try {
      const u = new URL(c.url);
      return u.origin === target.origin && surface(u.pathname) === surface(target.pathname);
    } catch {
      return false;
    }
  });
  if (existing) {
    const client = existing.url === url || !existing.navigate ? existing : (await existing.navigate(url)) || existing;
    return client.focus();
  }
  return self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(handleNotificationClick(event));
});
