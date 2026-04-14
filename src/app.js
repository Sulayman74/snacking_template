// ============================================================================
// 🚀 APP — Point d'entrée principal (Import Shell)
// ============================================================================

import "./utils.js";
import "./firebase-init.js";
import "./snack-config.js";
import "./state.js";
import "./tracking.js";
import "./pwa.js";
import "./auth.js";
import "./loyalty.js";
import "./ui.js";
import "./menu.js";
import "./cart.js";
import "./product-modal.js";
import "./router.js";

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
    if (window.snackConfig?.features?.enableClickAndCollect && typeof window.startOrderTracking === "function") {
      window.startOrderTracking(activeOrderId);
    }
  }
});
