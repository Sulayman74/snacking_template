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

// 1. ALLUMER LE BADGE : Gérer les messages quand l'app est en arrière-plan
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Message reçu en background ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/assets/icon-192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);

  // Allumer la pastille rouge
  if (navigator.setAppBadge) {
    navigator.setAppBadge(1).catch((error) => console.log('Badges non supportés'));
  }
});

// 2. ÉTEINDRE LE BADGE : Écouteur pour le clic sur la notification
self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification cliquée !');

  // On ferme la notification
  event.notification.close();

  // On efface la petite pastille rouge (badge) de l'icône !
  if (navigator.clearAppBadge) {
    navigator.clearAppBadge().catch((error) => {
      console.log('Erreur lors de la suppression du badge', error);
    });
  }

  // On définit l'URL à ouvrir
  const urlToOpen = new URL('/', self.location.origin).href;

  // Logique d'ouverture
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