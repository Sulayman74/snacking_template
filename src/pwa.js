// ============================================================================
// 📲 PWA : SW, INSTALLATION, PULL-TO-REFRESH, SMART REVIEW, DEEP LINKING
// ============================================================================
// Dépendances : window.snackConfig, window.triggerVibration, window.chargerMenuComplet
//               window.switchView
//               window.openClientCard, window.toggleAuthModal, window.openProductModal

import { store } from "./core/Store.js";
import { setupSWUpdatePrompt } from "./sw-update.js";
import { setupA2HS } from "./a2hs.js";
import { auth } from "./core/firebase.js";
import { t } from "./i18n/index.js";

// ============================================================================
// ⚙️ SERVICE WORKER — STRATÉGIE "PROMPT" (mise à jour non-intrusive)
// ============================================================================
// Enregistrement + bandeau de mise à jour mutualisés dans sw-update.js.
// Aucun reload automatique : l'utilisateur décide via #pwa-update-banner.
setupSWUpdatePrompt({ context: "Client" });

// ============================================================================
// 🌐 DÉTECTION CONNEXION (ONLINE / OFFLINE)
// ============================================================================
window.addEventListener("online", () => {
  document.body.classList.remove("is-offline");
  window.showToast(t("toasts.pwa.online"), "success");
});

window.addEventListener("offline", () => {
  document.body.classList.add("is-offline");
  window.showToast(t("toasts.pwa.offline"), "error");
});

// ============================================================================
// 📲 GESTION DE L'INSTALLATION PWA (A2HS) — mutualisé avec admin/livreur.
// Gère Android (beforeinstallprompt) ET iOS (instructions « Sur l'écran
// d'accueil ») + snooze de fermeture. Cf. src/a2hs.js.
// ============================================================================
setupA2HS({
  bannerId: "pwa-install-banner",
  btnId: "pwa-install-btn",
  closeId: "pwa-close-btn",
  hintId: "pwa-install-hint",
});

// ============================================================================
// 🔄 PULL-TO-REFRESH NATIF
// ============================================================================
function setupPullToRefresh() {
  const scrollArea = document.getElementById("full-menu");
  const ptrIndicator = document.getElementById("ptr-indicator");

  if (!scrollArea || !ptrIndicator) return;

  const THRESHOLD = 72;   // px tirés pour déclencher
  const MAX_PULL  = 96;   // px max affichés (résistance)

  let startY     = 0;
  let pulling    = false;
  let triggered  = false;

  function resistance(raw) {
    // Courbe logarithmique : rapide au début, ralentit en approchant MAX_PULL
    return Math.min(MAX_PULL, raw * (MAX_PULL / (MAX_PULL + raw * 0.6)));
  }

  function setIndicator(progress) {
    // progress : 0 (caché) → 1 (seuil atteint)
    const clipped = Math.min(progress, 1.15);
    ptrIndicator.style.transform = `translateX(-50%) translateY(${-100 + clipped * 100}%)`;
    // re-query : swapIcon (spinner ⟷ flèche) recrée l'élément, donc pas de réf capturée.
    const pi = document.getElementById("ptr-icon");
    if (pi) pi.style.transform = `rotate(${clipped * 180}deg)`;
    ptrIndicator.style.opacity   = Math.min(clipped * 2, 1);
  }

  scrollArea.addEventListener("touchstart", (e) => {
    if (scrollArea.scrollTop !== 0) return;
    startY   = e.touches[0].clientY;
    pulling  = true;
    triggered = false;
    ptrIndicator.style.transition = "none";
    window.swapIcon?.(document.getElementById("ptr-icon"), "arrow-down", "text-xl");
  }, { passive: true });

  // passive: false pour pouvoir bloquer le scroll natif pendant le PTR
  scrollArea.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    const raw = e.touches[0].clientY - startY;
    if (raw <= 0 || scrollArea.scrollTop > 0) { pulling = false; return; }

    e.preventDefault();   // bloque le scroll + PTR natif Chrome

    const pull     = resistance(raw);
    const progress = pull / THRESHOLD;
    setIndicator(progress);

    if (progress >= 1 && !triggered) {
      triggered = true;
      if (typeof window.triggerVibration === "function")
        window.triggerVibration("light");
    }
  }, { passive: false });

  scrollArea.addEventListener("touchend", async () => {
    if (!pulling) return;
    pulling = false;

    ptrIndicator.style.transition = "transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease";

    if (triggered) {
      // Maintenir l'indicateur visible pendant le reload
      ptrIndicator.style.transform = "translateX(-50%) translateY(-10%)";
      window.swapIcon?.(document.getElementById("ptr-icon"), "loader-circle", "animate-spin text-xl");
      if (typeof window.triggerVibration === "function")
        window.triggerVibration("success");

      await window.chargerMenuComplet();
    }

    // Masquer l'indicateur
    setIndicator(0);
    setTimeout(() => {
      window.swapIcon?.(document.getElementById("ptr-icon"), "arrow-down", "text-xl");
    }, 300);
  });
}

window.setupPullToRefresh = setupPullToRefresh;

// ============================================================================
// 🧭 ROUTEUR DE DÉMARRAGE (Deep Linking)
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const pwaAction = urlParams.get("action");
  const targetId = urlParams.get("id");

  if (pwaAction) {
    // Nettoyer l'URL immédiatement pour éviter une réouverture sur refresh
    window.history.replaceState({}, document.title, window.location.pathname);

    // 🍟 PARRAINAGE : Capture du parrain
    if (pwaAction === "referral" && targetId) {
      localStorage.setItem("referralBy", targetId);
      window.showToast(t("toasts.pwa.referralSuccess"), "success");
    }

    setTimeout(() => {
      if (pwaAction === "menu") {
        window.switchView("menu");
      } else if (pwaAction === "loyalty") {
        if (auth && auth.currentUser) {
          window.openClientCard();
        } else {
          window.toggleAuthModal();
        }
      } else if (pwaAction === "product" && targetId) {
        window.switchView("menu");

        const doOpen = () => window.openProductModal(targetId);

        // Si le menu est déjà chargé (retour dans l'app), ouvrir directement
        const menu = store.state.menu;
        if (menu && menu.length > 0) {
          setTimeout(doOpen, 300);
        } else {
          // Sinon attendre que menu.js ait fini de charger Firestore
          window.addEventListener("snack:menu:ready", () => setTimeout(doOpen, 200), { once: true });
        }
      }
    }, 800);
  }
});
