importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyBIgi4AKo5nzRTO27KuvX0D6nHKsJIDkW8",
    authDomain: "snacking-template.firebaseapp.com",
    projectId: "snacking-template",
    storageBucket: "snacking-template.firebasestorage.app",
    messagingSenderId: "472027657186",
    appId: "1:472027657186:web:7c1621680d9863aa8dffbb"
};

// Initialisation
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Écouteur pour le clic sur la notification
self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification cliquée !');

  // 1. On ferme la notification
  event.notification.close();

  // NOUVEAU : On efface la petite pastille rouge (badge) de l'icône !
  if (navigator.clearAppBadge) {
    navigator.clearAppBadge().catch((error) => {
      console.log('Erreur lors de la suppression du badge', error);
    });
  }

  // 2. On définit l'URL à ouvrir (ici, la racine de ton site)
  const urlToOpen = new URL('/', self.location.origin).href;

  // 3. Logique d'ouverture
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      
      // A. On cherche si l'application est déjà ouverte quelque part
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        // Si elle est ouverte, on la ramène juste au premier plan
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      
      // B. Si elle n'était pas ouverte, on la lance !
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});