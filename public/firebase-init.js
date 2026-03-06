// ============================================================================
// FIREBASE INITIALIZATION & AUTHENTICATION
// ============================================================================

import { createUserWithEmailAndPassword, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { doc, getDoc, getFirestore, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-messaging.js";

import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";
// 1. IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";

// 2. CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyBIgi4AKo5nzRTO27KuvX0D6nHKsJIDkW8",
  authDomain: "snacking-template.firebaseapp.com",
  projectId: "snacking-template",
  storageBucket: "snacking-template.firebasestorage.app",
  messagingSenderId: "472027657186",
  appId: "1:472027657186:web:7c1621680d9863aa8dffbb",
  measurementId: "G-XT2YH4NE9Q"
};

// 3. INITIALISATION
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const messaging = getMessaging(app);
const auth = getAuth(app);
const db = getFirestore(app);

// ============================================================================
// GESTION DE L'INTERFACE UTILISATEUR (MODALS)
// ============================================================================
let isSignUpMode = false;

// On attache à 'window' pour que le HTML puisse déclencher ces fonctions
window.toggleAuthModal = () => {
  document.getElementById('auth-modal').classList.toggle('hidden');
};

window.switchAuthMode = () => {
  isSignUpMode = !isSignUpMode;
  document.getElementById('auth-title').innerText = isSignUpMode ? "Créer un compte" : "Bienvenue !";
  document.getElementById('auth-submit-btn').innerText = isSignUpMode ? "S'inscrire" : "Se connecter";
  document.getElementById('auth-switch-btn').innerText = isSignUpMode ? "Se connecter" : "S'inscrire";
  document.getElementById('auth-switch-text').innerText = isSignUpMode ? "Déjà un compte ?" : "Pas encore de compte ?";
};

// ============================================================================
// LOGIQUE D'AUTHENTIFICATION & FIRESTORE
// ============================================================================

// Écouteur de soumission du formulaire de connexion/inscription
document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;

  try {
    if (isSignUpMode) {
      // Inscription
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // Création du profil par défaut (Client)
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        role: "client",
        points: 0,
        createdAt: new Date().toISOString()
      });
      alert("Compte créé avec succès !");
    } else {
      // Connexion
      await signInWithEmailAndPassword(auth, email, password);
    }
    window.toggleAuthModal(); // On cache la fenêtre
  } catch (error) {
    alert("Erreur : " + error.message);
  }
});

// Écouteur des changements d'état (Connecté / Déconnecté)
// onAuthStateChanged(auth, async (user) => {
//   const loyaltyBtn = document.querySelector('#loyalty-card button'); 
  
//   if (user) {
//     console.log("Connecté :", user.email);
    
//     // Vérification du rôle dans Firestore
//     const docRef = doc(db, "users", user.uid);
//     const docSnap = await getDoc(docRef);
    
//     if (docSnap.exists()) {
//       const userData = docSnap.data();
      
//       if (userData.role === "admin") {
//           // MODE ADMIN
//           if (loyaltyBtn) {
//               loyaltyBtn.innerText = "Scanner un client (Admin)";
//               loyaltyBtn.onclick = () => alert("La caméra s'ouvrira ici !");
//               loyaltyBtn.classList.add("bg-red-600", "text-white");
//               loyaltyBtn.classList.remove("bg-white", "text-black");
//           }
//       } else {
//           // MODE CLIENT
//           if (loyaltyBtn) {
//               loyaltyBtn.innerText = "Afficher mon QR Code";
//               loyaltyBtn.onclick = () => alert("Le QR Code s'affichera ici !");
//           }
//       }
//     }
//   } else {
//     // DÉCONNECTÉ
//     if (loyaltyBtn) {
//       loyaltyBtn.innerText = "Connexion";
//       loyaltyBtn.onclick = window.toggleAuthModal;
//       loyaltyBtn.classList.add("bg-white", "text-black");
//       loyaltyBtn.classList.remove("bg-red-600", "text-white");
//     }
//   }
// });   

// ============================================================================
// GESTION DES NOTIFICATIONS PUSH (MESSAGING)
// ============================================================================

window.demanderPermissionNotifs = function() {
  console.log("Demande de permission au navigateur...");
  
  Notification.requestPermission().then((permission) => {
    if (permission === 'granted') {
      console.log("Permission accordée !");
      
      getToken(messaging, { vapidKey: 'BGsq0EjCQPNq2_r5LC-41oxktxZtCfBCD0GvYjiKV7n2HgEOwKWnFGwgddQfPl9ZoFi6z8AvSM1rQUJkxa1-098' }).then((currentToken) => {
        if (currentToken) {
          prompt("Super ! Voici votre jeton pour tester (Copiez-le) :", currentToken);
        } else {
          console.log("Aucun jeton disponible.");
        }
      }).catch((err) => {
        console.error("Erreur lors de la récupération du jeton : ", err);
      });
      
    } else {
      console.log("Permission refusée par l'utilisateur.");
    }
  });
};

// Écouter les notifications quand l'app est ouverte (Foreground)
onMessage(messaging, (payload) => {
  console.log("Message reçu au premier plan :", payload);
  alert(`Nouveau message : ${payload.notification.title}\n${payload.notification.body}`);
});