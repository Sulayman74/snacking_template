const CACHE_NAME = "snacking-pwa-v1";
const OFFLINE_URL = "/index.html";

// Fichiers à mettre en cache immédiatement au démarrage
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/admin.html",
  "/src/styles.css",
  "/src/app.js",
  "/src/utils.js",
  "/public/assets/logo.webp",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
];

// Installation : Mise en cache des fichiers de base
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activation : Nettoyage des anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log("🧹 SW: Nettoyage ancien cache", cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Stratégie : Stale-While-Revalidate
// 1. Sert le cache immédiatement
// 2. Met à jour le cache en arrière-plan
self.addEventListener("fetch", (event) => {
  // On ignore les requêtes vers Firebase (gérées par le SDK Firestore) et Stripe
  if (
    event.request.url.includes("firestore.googleapis.com") ||
    event.request.url.includes("firebasestorage.googleapis.com") ||
    event.request.url.includes("stripe.com")
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Si la réponse est valide, on la met en cache
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // En cas d'erreur réseau, on peut renvoyer une page offline si c'est une navigation
        if (event.request.mode === 'navigate') {
          return caches.match(OFFLINE_URL);
        }
      });

      return cachedResponse || fetchPromise;
    })
  );
});
