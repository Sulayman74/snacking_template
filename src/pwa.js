// ============================================================================
// 📲 PWA : SW, INSTALLATION, PULL-TO-REFRESH, SMART REVIEW, DEEP LINKING
// ============================================================================
// Dépendances : window.snackConfig, window.triggerVibration, window.chargerMenuComplet
//               window.switchView, window.auth
//               window.openClientCard, window.toggleAuthModal, window.openProductModal

import { store } from "./core/Store.js";

// ============================================================================
// ⚙️ SERVICE WORKER (OFFLINE ASSETS)
// ============================================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("🚀 PWA: Service Worker prêt !", reg.scope))
      .catch((err) => console.error("❌ PWA: Échec SW", err));
  });
}

// ============================================================================
// 🌐 DÉTECTION CONNEXION (ONLINE / OFFLINE)
// ============================================================================
window.addEventListener("online", () => {
  document.body.classList.remove("is-offline");
  window.showToast("Vous êtes de nouveau en ligne ! 🟢", "success");
});

window.addEventListener("offline", () => {
  document.body.classList.add("is-offline");
  window.showToast("Mode hors-ligne activé. 🟠", "error");
});

// ============================================================================
// 📲 GESTION DE L'INSTALLATION PWA (A2HS)
// ============================================================================
let deferredPrompt;
const installBanner = document.getElementById("pwa-install-banner");
const installBtn = document.getElementById("pwa-install-btn");
const closeBtn = document.getElementById("pwa-close-btn");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;

  setTimeout(() => {
    if (installBanner) {
      installBanner.classList.remove("translate-y-32", "pointer-events-none", "opacity-0");
      if (typeof window.triggerVibration === "function")
        window.triggerVibration("light");
    }
  }, 3000);
});

if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (deferredPrompt) {
      installBanner.classList.add("translate-y-32", "opacity-0");
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`Résultat de l'installation : ${outcome}`);
      deferredPrompt = null;
      if (outcome === "accepted" && typeof window.triggerVibration === "function") {
        window.triggerVibration("success");
      }
    }
  });
}

if (closeBtn) {
  closeBtn.addEventListener("click", () => {
    installBanner.classList.add("translate-y-32", "pointer-events-none", "opacity-0");
  });
}

// ============================================================================
// 🔄 PULL-TO-REFRESH NATIF
// ============================================================================
function setupPullToRefresh() {
  const scrollArea = document.getElementById("full-menu");
  const ptrIndicator = document.getElementById("ptr-indicator");
  const ptrIcon = document.getElementById("ptr-icon");

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
    ptrIcon.style.transform      = `rotate(${clipped * 180}deg)`;
    ptrIndicator.style.opacity   = Math.min(clipped * 2, 1);
  }

  scrollArea.addEventListener("touchstart", (e) => {
    if (scrollArea.scrollTop !== 0) return;
    startY   = e.touches[0].clientY;
    pulling  = true;
    triggered = false;
    ptrIndicator.style.transition = "none";
    ptrIcon.className = "fas fa-arrow-down text-xl";
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
      ptrIcon.className = "fas fa-spinner fa-spin text-xl";
      if (typeof window.triggerVibration === "function")
        window.triggerVibration("success");

      await window.chargerMenuComplet();
    }

    // Masquer l'indicateur
    setIndicator(0);
    setTimeout(() => {
      ptrIcon.className = "fas fa-arrow-down text-xl";
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
      window.showToast("Cadeau activé ! Votre première commande offrira une frite à votre parrain. 🍟", "success");
    }

    setTimeout(() => {
      if (pwaAction === "menu") {
        window.switchView("menu");
      } else if (pwaAction === "loyalty") {
        if (window.auth && window.auth.currentUser) {
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
