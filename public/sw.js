const CACHE_NAME = 'snack-app-v2'; // Changé en v2 pour forcer la mise à jour
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './snack-config.js',
  './app.js'
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

// Interception réseau (Offline first)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});