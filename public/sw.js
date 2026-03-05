// sw.js
const CACHE_NAME = 'snack-app-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './snack-config.js', //
  './app.js',          //
  // On ne cache pas Tailwind CDN en prod idéalement, mais pour la démo oui
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
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