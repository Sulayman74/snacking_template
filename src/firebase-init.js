// ============================================================================
// FIREBASE INITIALIZATION & AUTHENTICATION (LE HUB CENTRAL)
// ============================================================================

import "./scanner.js";

import {
  GoogleAuthProvider,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { store } from "./core/Store.js";
// 1. LES IMPORTS (TOUJOURS TOUT EN HAUT !)
import {
  Timestamp,
  addDoc,
  collection,
  connectFirestoreEmulator,
  count,
  deleteDoc,
  doc,
  getAggregateFromServer,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  sum,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";
import { connectStorageEmulator, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

import { getAnalytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// 2. CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyBIgi4AKo5nzRTO27KuvX0D6nHKsJIDkW8",
  authDomain: "snacking-template.firebaseapp.com",
  projectId: "snacking-template",
  storageBucket: "snacking-template.firebasestorage.app",
  messagingSenderId: "472027657186",
  appId: "1:472027657186:web:7c1621680d9863aa8dffbb",
  measurementId: "G-XT2YH4NE9Q",
};

// 3. INITIALISATION
export const app = initializeApp(firebaseConfig);

// 🛡️ FIREBASE APP CHECK (reCAPTCHA v3)
// Protège Firestore, Functions et Storage contre les appels depuis des origines non autorisées.
// 1. Crée une clé reCAPTCHA v3 sur https://www.google.com/recaptcha/admin
// 2. Enregistre-la dans la console Firebase > App Check
// 3. Mets la clé publique dans .env.local : VITE_APPCHECK_SITE_KEY=...
// 4. (Dev) En local, ouvre la console et copie le debug token affiché par
//    self.FIREBASE_APPCHECK_DEBUG_TOKEN=true (avant initializeAppCheck), puis ajoute-le
//    dans Firebase Console > App Check > Apps > Manage debug tokens.
const APPCHECK_SITE_KEY = import.meta.env.VITE_APPCHECK_SITE_KEY;
if (APPCHECK_SITE_KEY) {
  if (import.meta.env.DEV) {
    // Active le mode debug en développement (pour les emulateurs/localhost)
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APPCHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.error("❌ Erreur init App Check :", e);
  }
} else if (!import.meta.env.DEV) {
  console.warn(
    "⚠️ VITE_APPCHECK_SITE_KEY non configurée — Firestore/Functions ne sont pas protégés par App Check."
  );
}

export const auth = getAuth(app);
// Firebase Cloud Messaging n'est pas supporté partout (Safari iOS ancien,
// environnements de test/SSR sans Notification/ServiceWorker API). Init défensive
// pour ne PAS casser le chargement du module si l'API est absente. Les consommateurs
// (onMessage, getToken) doivent vérifier que `messaging` n'est pas null.
let _messaging = null;
try {
  _messaging = getMessaging(app);
} catch (e) {
  console.warn("⚠️ Firebase Messaging indisponible :", e?.code || e?.message);
}
export const messaging = _messaging;
// Activation du cache persistant (pour le mode offline)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const storage = getStorage(app);
export const functions = getFunctions(app, "europe-west1");

// 🤖 MODE TEST E2E (Playwright) : on branche TOUT le SDK sur les émulateurs
// locaux au lieu de la prod. Garde-fou strict : ne s'active QUE si le flag est
// posé (jamais dans un build de prod). Cf. CLAUDE.md « Interdiction de Test en Prod ».
if (import.meta.env.VITE_E2E_TESTING === "true") {
  try {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    console.warn("🤖 E2E : Firebase branché sur les ÉMULATEURS locaux (auth/firestore/functions/storage).");
  } catch (e) {
    console.error("❌ Échec connexion émulateurs E2E :", e);
  }
}
// ============================================================================
// 🚀 OPTIMISATION : CHARGEMENT DIFFÉRÉ DE FIREBASE ANALYTICS
// ============================================================================

// On déclare la variable vide au départ
export let analytics = null;

function initAnalytics() {
  if (analytics) return;

  if (import.meta.env.VITE_E2E_TESTING === "true") {
    console.warn("🤖 Test E2E Playwright détecté : Google Analytics est DÉSACTIVÉ.");
    return;
  }

  analytics = getAnalytics(app);

  ["scroll", "mousemove", "touchstart", "click"].forEach((event) => {
    window.removeEventListener(event, initAnalytics);
  });
}

["scroll", "mousemove", "touchstart", "click"].forEach((event) => {
  window.addEventListener(event, initAnalytics, { once: true, passive: true });
});

setTimeout(initAnalytics, 3500);

// ============================================================================
// 4. EXPORTATION SÉCURISÉE (LE HUB POUR VITE)
// ============================================================================
// 🧰 Namespaces SDK exportés en ESM (Lot 4 PR-1). Restent aussi exposés en
// window.* (dual-access) tant que les lecteurs catégorie A ne sont pas tous
// migrés vers les imports `src/core/firebase.js`.
export const fs = {
  addDoc,
  app,
  collection,
  count,
  deleteDoc,
  doc,
  functions,
  getAggregateFromServer,
  getDoc,
  getDocs,
  getFunctions,
  getStorage,
  httpsCallable,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  sum,
  Timestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
};
export const storageTools = { getDownloadURL, ref, uploadBytes };
export const authTools = {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  getToken,
  onMessage,
};

// ⚠️ Catégorie A (db/auth/storage/fs/authTools/storageTools) retirée de window.*
// (Lot 4 PR-1) : ces dépendances passent désormais EXCLUSIVEMENT par les imports
// ESM `src/core/firebase.js`. Seul window.messaging subsiste (lu par loyalty.js,
// catégorie B — sera migré en PR-2).
window.messaging = messaging;

// ============================================================================
// 🕵️‍♂️ ÉCOUTEUR D'ÉTAT (LE VIGILE)
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  const isAdminPage = window.location.pathname.includes("admin.html") ||
                      window.location.pathname.includes("superadmin.html") ||
                      window.location.pathname.includes("livreur.html");

  // L'app livreur et l'admin gèrent leur propre auth/cycle de vie (pas de
  // bootstrap du menu client ici).
  if (isAdminPage) return;

  const urlParams = new URLSearchParams(window.location.search);
  let snackIdToLoad =
    urlParams.get("s") || window.CURRENT_SNACK_ID || "Ym1YiO4Ue5Fb5UXlxr06";

  try {
    // 1. Chargement de la config SaaS
    const config = await window.loadSnackConfig(db, snackIdToLoad);
    if (!config) throw new Error("Config SaaS introuvable");
    
    // Le store émettra "config-updated" -> AppUI mettra à jour l'identité/thème
    store.setConfig(config);

    // 2. Chargement du menu en temps réel
    if (typeof window.chargerMenuComplet === "function") {
      window.chargerMenuComplet();
    }

    // 3. Récupération du rôle
    let role = "client";
    if (user) {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        role = userDoc.data().role;
      }
    }

    // 3. Mise à jour de l'utilisateur dans le Store
    // Le store émettra "auth-updated" -> AppUI mettra à jour les boutons nav/fidélité
    store.setUser(user, role);

    // 🎯 RELANCE CHECKOUT POST-LOGIN (mode auth classique — LOT 4 PR-4)
    // Si un utilisateur non-connecté a cliqué "Commander" et ouvert la modale auth,
    // checkout.js a posé store.setPendingCheckout(true). On consomme ce flag ici,
    // APRÈS que l'auth soit stabilisée et le Store mis à jour.
    // Guards : user non-null, non-anonyme (le guest checkout LOT-2 n'utilise PAS
    // ce path), panier contrôlé par processCheckout lui-même.
    if (user && !user.isAnonymous && store.hasPendingCheckout) {
      store.setPendingCheckout(false); // consommé → une seule relance
      // Délai 300ms : laisse l'animation de fermeture de la modale auth se terminer
      // avant d'ouvrir le tunnel Stripe (évite les conflits overflow:hidden/z-index).
      setTimeout(() => {
        if (typeof window.processCheckout === "function") {
          window.processCheckout();
        }
      }, 300);
    }

    // 4. Re-sync silencieux du FCM token (cas token stale après réinstall PWA)
    if (user && typeof window.syncFcmToken === "function") {
      window.syncFcmToken();
    }

    // Cacher la bannière d'inscription d'invité si l'utilisateur est maintenant connecté et non-anonyme
    const guestBanner = document.getElementById("guest-registration-banner");
    if (guestBanner && (!user || !user.isAnonymous)) {
      guestBanner.classList.add("hidden");
    }

  } catch (error) {
    console.error("❌ Erreur Initialisation :", error);
  }
});

if (messaging) {
  onMessage(messaging, (payload) => {
    const titre = payload.notification?.title || "Nouvelle notification";
    const message = payload.notification?.body || "";
    window.showToast(`🔔 ${titre} : ${message}`, "success");
  });
}
