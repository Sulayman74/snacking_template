// ============================================================================
// 🍔 MENU — Récupération Firestore et Proxy (Refactored to Web Component)
// ============================================================================

import { store } from "./core/Store.js";
import { db, collection, onSnapshot, query, where } from "./core/firebase.js";

window.chargerMenuComplet = () => {
  const cfg = window.snackConfig;
  const snackId = cfg?.identity?.id;
  if (!snackId) return;

  if (typeof window.__menuUnsub === "function") {
    window.__menuUnsub();
    window.__menuUnsub = null;
  }

  const q = query(collection(db, "produits"), where("snackId", "==", snackId));

  const unsub = onSnapshot(q, (snapshot) => {
    let tousLesProduits = [];
    snapshot.forEach((doc) => {
      tousLesProduits.push({ id: doc.id, ...doc.data() });
    });

    store.setMenu(tousLesProduits);

  }, (err) => {
    console.error("Erreur temps réel menu :", err);
  });

  window.__menuUnsub = unsub;
  return unsub;
};
