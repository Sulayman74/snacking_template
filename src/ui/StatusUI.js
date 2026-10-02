// ============================================================================
// 🚦 StatusUI — horloge de la boutique + bouton « Valider » selon l'état
// ============================================================================
// La config arrive en direct (snack-config.js) ; l'heure, elle, avance seule :
// toutes les 30 s on émet « clock-tick » pour que « Ouvert » devienne « Fermé »
// à 22:00 sans action du client. « Valider » est désactivé quand aucun paiement
// n'est possible, la raison étant affichée par la pastille du panier.

import { store } from "../core/Store.js";
import { getStorefrontStatus } from "../core/storefrontStatus.js";
import { statusSentence } from "./statusMessage.js";
import "../components/SnackStatusPill.js";

export const CLOCK_MS = 30_000;

/** Panier vide ou boutique qui ne peut pas encaisser → « Valider » désactivé. */
export function syncCheckoutButton(now = new Date()) {
  const btn = document.getElementById("checkout-btn");
  if (!btn) return;
  const cfg = store.state.config;
  const mode = store.state.delivery?.mode === "delivery" ? "delivery" : "collect";
  const status = cfg ? getStorefrontStatus(cfg, now, { mode }) : null;
  const closed = status ? !status.canOrder : false;
  const blocked = !store.state.cart?.length || closed;
  btn.disabled = blocked;
  btn.classList.toggle("opacity-50", blocked);
  btn.classList.toggle("cursor-not-allowed", closed);
  if (closed) btn.title = statusSentence(status);
  else btn.removeAttribute("title");
}

export function startStatusClock() {
  for (const evt of ["config-updated", "delivery-updated", "clock-tick"]) {
    store.addEventListener(evt, () => syncCheckoutButton());
  }
  syncCheckoutButton();
  return setInterval(() => store.emit("clock-tick"), CLOCK_MS);
}
