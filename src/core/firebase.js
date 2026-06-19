// ============================================================================
// 🛢️ BARREL FIREBASE — point d'import unique (Lot 4 PR-1)
// ============================================================================
// Remplace les globals `window.fs / window.db / window.auth / window.authTools`
// (catégorie A) par des imports ESM nommés et tree-shakeables :
//
//   import { db, getDoc, doc, signOut } from "../core/firebase.js";
//
// - Les INSTANCES (app/auth/db/storage/messaging/functions) et les namespaces
//   de compat (fs/authTools/storageTools) proviennent de firebase-init.js, qui
//   reste le hub d'initialisation (App Check, émulateurs, vigile onAuthStateChanged).
// - Les FONCTIONS du SDK sont ré-exportées directement depuis `firebase/*` pour
//   un import nommé direct sans passer par l'objet `fs`.

// --- Instances + namespaces (initialisés dans firebase-init.js) ---
export {
  app,
  auth,
  db,
  storage,
  messaging,
  functions,
  analytics,
  fs,
  authTools,
  storageTools,
} from "../firebase-init.js";

// --- Fonctions SDK Firestore ---
export {
  Timestamp,
  addDoc,
  collection,
  count,
  deleteDoc,
  doc,
  FieldPath,
  getAggregateFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  sum,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

// --- Fonctions SDK Storage ---
export { getDownloadURL, ref, uploadBytes } from "firebase/storage";

// --- Fonctions SDK Functions ---
export { httpsCallable, getFunctions } from "firebase/functions";

// --- Fonctions SDK Auth ---
export {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";

// --- Fonctions SDK Messaging ---
export { getToken, onMessage } from "firebase/messaging";
