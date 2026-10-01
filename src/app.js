// ============================================================================
// 🚀 APP — Point d'entrée principal (Import Shell)
// ============================================================================

import "./utils.js";
import "./theme-mode.js";
import "./icons.js";
import "./ui.js";
import "./menu.js";
import "./cart.js";
import "./favorites.js";
import "./reorder.js";
import "./delivery.js";
import "./product-modal.js";
import "./tracking.js";
import "./pwa.js";
import "./auth.js";
import "./loyalty.js";
import "./loyalty-wheel.js";
import "./smart-review.js";
import "./router.js";
import "./snack-config.js";
import "./firebase-init.js";
import "./logger.js";
import "./components/SnackMenuList.js";
import "./components/SnackBestsellers.js";
import "./components/SnackCheckout.js";
import { initI18n } from "./i18n/index.js";

// ============================================================================
// 🌍 INITIALISATION DE L'INTERNATIONALISATION
// ============================================================================
initI18n().catch((err) => console.error("🔥 Erreur initialisation i18n :", err));

// ============================================================================
// 🔄 ORCHESTRATEUR DE CYCLE DE VIE (Client)
// ============================================================================
// Le suivi de commande n'est plus coupé en arrière-plan (un seul document écouté :
// coût nul) ; au retour au premier plan on s'assure qu'il tourne, quel que soit
// le mode (click & collect ou livraison).
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) window.resumeOrderTracking?.();
});
