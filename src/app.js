// ============================================================================
// 🚀 APP — Point d'entrée principal (Import Shell)
// ============================================================================

import "./utils.js";
import "./firebase-init.js";
import "./snack-config.js";
import "./tracking.js";
import "./pwa.js";
import "./auth.js";
import "./loyalty.js";
import "./ui.js";
import "./menu.js";
import "./cart.js";
import "./product-modal.js";
import "./router.js";
import { store } from "./core/Store.js";

// ============================================================================
// 🔄 ORCHESTRATEUR DE CYCLE DE VIE (Client)
// ============================================================================
document.addEventListener("visibilitychange", () => {
  const activeOrderId = localStorage.getItem("activeOrderId");
  if (!activeOrderId) return;

  if (document.hidden) {
    if (typeof window.stopOrderTracking === "function") {
      window.stopOrderTracking();
    }
  } else {
    // Reprise du radar si on revient sur l'app et qu'une commande est en cours
    const cfg = store.state.config;
    if (cfg?.features?.enableClickAndCollect && typeof window.startOrderTracking === "function") {
      window.startOrderTracking(activeOrderId);
    }
  }
});
