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

// --- FORCE LE BADGE (Événement natif) ---
// Cet événement s'exécute pour TOUS les messages entrants, garantissant le badge
self.addEventListener('push', (event) => {
  if ('setAppBadge' in self.navigator) {
    event.waitUntil(self.navigator.setAppBadge(1));
  }
});

// Gérer les messages quand l'app est en arrière-plan (Optionnel si push natif est là)
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Message reçu en background ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/assets/icon-192.png'
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Écouteur pour le clic sur la notification
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  // On efface le badge au clic
  if ('clearAppBadge' in self.navigator) {
    self.navigator.clearAppBadge();
  }

  const urlToOpen = new URL('/', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});