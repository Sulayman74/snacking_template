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

  // Premier résultat (ou échec) : retire le splash et débloque les liens directs
  // « ?action=product » (index.html, pwa.js), qui attendent cet événement.
  let announced = false;
  const announceReady = () => {
    if (announced) return;
    announced = true;
    window.dispatchEvent(new CustomEvent("snack:menu:ready"));
  };

  const unsub = onSnapshot(q, (snapshot) => {
    let tousLesProduits = [];
    snapshot.forEach((doc) => {
      tousLesProduits.push({ id: doc.id, ...doc.data() });
    });

    store.setMenu(tousLesProduits);
    announceReady();
  }, (err) => {
    console.error("Erreur temps réel menu :", err);
    announceReady();
  });

  window.__menuUnsub = unsub;
  return unsub;
};
