// ============================================================================
// 🚚 LIVREUR — Point d'entrée de l'app livreur (PWA)
// ============================================================================
// utils → globals (showToast/escapeHTML) ; firebase-init → db/auth/messaging
// (son bootstrap "client" est court-circuité pour livreur.html) ; LivreurUI →
// auth livreur + UI courses + géoloc + PoD.

import { setupSWUpdatePrompt } from "./sw-update.js";
import { setupA2HS } from "./a2hs.js";
import { setupAppBadgeAutoClear } from "./core/appBadge.js";
import "./utils.js";
import "./firebase-init.js";
import "./theme-mode.js";
import "./icons.js";
import "./ui/LivreurUI.js";

// 🔴 Remise à zéro automatique du badge dès l'ouverture de l'app ou retour au premier plan
setupAppBadgeAutoClear();

// SW + bandeau de mise à jour (pattern prompt mutualisé) : jamais d'auto-reload
// pendant qu'un livreur valide une photo de preuve.
setupSWUpdatePrompt({ context: "Livreur" });

// Bouton "Installer l'app" (A2HS) + fallback iOS.
setupA2HS({
  bannerId: "livreur-install-banner",
  btnId: "livreur-install-btn",
  closeId: "livreur-install-close",
  hintId: "livreur-install-hint",
});
