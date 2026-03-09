const CACHE_NAME = 'snack-app-v10'; 
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './snack-config.js',
  './app.js',
  './firebase-init.js',
  './assets/icon-192.webp',
  './assets/icon-512.webp',
  './assets/logo.webp',
  './assets/heroImg.webp'
];

// Installation
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

// Activation (Nettoyage vieux caches)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    ))
  );
});

// Interception réseau
self.addEventListener('fetch', (event) => {
  
  // 🚨 RÈGLE D'OR : NE JAMAIS INTERCEPTER FIREBASE ET LES APIS GOOGLE
  if (event.request.url.includes('googleapis.com') || event.request.url.includes('gstatic.com')) {
      return; // On laisse la requête sortir normalement sur internet !
  }

  // STRATÉGIE "NETWORK FIRST" UNIQUEMENT POUR LA CONFIG
  if (event.request.url.includes('snack-config.js')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // STRATÉGIE "CACHE FIRST" POUR TOUT LE RESTE (HTML, CSS, Images...)
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});