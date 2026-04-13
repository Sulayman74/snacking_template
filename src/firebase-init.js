// ============================================================================
// FIREBASE INITIALIZATION & AUTHENTICATION (LE HUB CENTRAL)
// ============================================================================

import "./scanner.js";

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
// 1. LES IMPORTS (TOUJOURS TOUT EN HAUT !)
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
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
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

import { getAnalytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";

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
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const messaging = getMessaging(app);
// Activation du cache persistant (pour le mode offline)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const storage = getStorage(app);
const functions = getFunctions(app, "europe-west1");
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
window.db = db;
window.storage = storage;
window.auth = auth;
window.messaging = messaging;

window.fs = {
  addDoc,
  app,
  collection,
  deleteDoc,
  doc,
  functions,
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
  Timestamp, 
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
};
window.storageTools = { getDownloadURL, ref, uploadBytes };
window.authTools = {
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

// ============================================================================
// 🕵️‍♂️ ÉCOUTEUR D'ÉTAT (LE VIGILE)
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  const isAdminPage = window.location.pathname.includes("admin.html") ||
                      window.location.pathname.includes("superadmin.html");

  if (isAdminPage) return;

  const urlParams = new URLSearchParams(window.location.search);
  let snackIdToLoad =
    urlParams.get("s") || window.CURRENT_SNACK_ID || "Ym1YiO4Ue5Fb5UXlxr06";

  try {
    await window.loadSnackConfig(db, snackIdToLoad);

    // 1. Récupération du rôle
    let role = "client";
    if (user) {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        role = userDoc.data().role;
      }
    }

    // 2. Mise à jour de l'UI (le rôle pilote le bouton Scanner vs Ma Carte)
    if (typeof window.updateUI === "function") window.updateUI(user, role);

    // 3. Initialisation visuelle
    if (typeof window.initAppVisuals === "function")
      await window.initAppVisuals();
      
  } catch (error) {
    console.error("❌ Erreur Initialisation :", error);
  }
});

onMessage(messaging, (payload) => {
  const titre = payload.notification?.title || "Nouvelle notification";
  const message = payload.notification?.body || "";
  window.showToast(`🔔 ${titre} : ${message}`, "success");
});
