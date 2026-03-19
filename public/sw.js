const CACHE_NAME = 'snack-app-v22'; 

// 🚨 ATTENTION : Ne laisse ici QUE les fichiers qui existent encore vraiment dans ton dossier !
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './snack-config.js',
  './bridge.js',
  './app.js',
  './firebase-init.js',
  './assets/icon-192.webp',
  './assets/icon-512.webp',
  './assets/logo.webp',
  './assets/burgers.webp'
];

// Installation
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

// Activation (Nettoyage des vieux caches v11, v10...)
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
  
  // 1. 🛑 ON IGNORE UNIQUEMENT LA BASE DE DONNÉES ET L'AUTH (Firestore)
  if (event.request.url.includes('firestore.googleapis.com') || event.request.url.includes('identitytoolkit.googleapis.com')) {
      return; 
  }

  // 2. ☁️ NOUVEAU : MISE EN CACHE DYNAMIQUE POUR FIREBASE STORAGE (Les Burgers !)
  if (event.request.url.includes('firebasestorage.googleapis.com')) {
      event.respondWith(
          caches.match(event.request).then((cachedResponse) => {
              // Si l'image est déjà dans le cache (le client l'a déjà vue), on l'affiche instantanément !
              if (cachedResponse) {
                  return cachedResponse;
              }
              // Sinon, on va la chercher sur le Cloud, et on en fait une copie dans le cache pour la prochaine fois (Mode Hors-Ligne)
              return fetch(event.request).then((networkResponse) => {
                  const responseClone = networkResponse.clone();
                  caches.open('snack-images-cache').then((cache) => {
                      cache.put(event.request, responseClone);
                  });
                  return networkResponse;
              });
          })
      );
      return;
  }

  // 3. STRATÉGIE "NETWORK FIRST" POUR LA CONFIG
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

  // 4. STRATÉGIE "CACHE FIRST" POUR TOUT LE RESTE (HTML, CSS, JS local...)
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});