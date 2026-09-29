// ============================================================================
// 🧯 SERVICE WORKER D'URGENCE (kill-switch) — NE PAS importer dans l'app
// ============================================================================
// Déployé À LA PLACE de sw.js (npm run deploy:sw-kill) si un service worker publié
// casse l'app. Le navigateur vérifie sw.js à chaque navigation (servi en no-cache,
// cf. firebase.json) : cette version s'installe tout de suite, vide TOUS les caches
// et se désinstalle. Les pages qu'elle contrôlait sont rechargées une fois, depuis le
// réseau. Une page chargée APRÈS n'est jamais contrôlée (pas de clients.claim) →
// jamais rechargée → aucune boucle, même si l'app ré-enregistre ce fichier.
// Pour revenir à la normale : redéployer un build standard (npm run deploy:all).

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const controlled = await self.clients.matchAll({ type: "window" }); // contrôlés uniquement
    await Promise.all(controlled.map((c) => c.navigate(c.url).catch(() => {})));
  })());
});
