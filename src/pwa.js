// ============================================================================
// 📲 PWA : INSTALLATION, PULL-TO-REFRESH, SMART REVIEW, DEEP LINKING
// ============================================================================
// Dépendances : window.snackConfig, window.triggerVibration, window.chargerMenuComplet
//               window.switchView, window.auth
//               window.openClientCard, window.toggleAuthModal, window.openProductModal

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
// ⭐ SMART APP REVIEW PROMPT
// ============================================================================
function setupSmartReviewPrompt() {
  if (localStorage.getItem("hasRatedApp") === "true") return;

  const cfg = window.snackConfig;
  if (!cfg || !cfg.features || cfg.features.enableSmartReview !== true) return;

  let visits = parseInt(localStorage.getItem("appVisits") || "0");
  visits++;
  localStorage.setItem("appVisits", visits);

  if (visits === 3) {
    setTimeout(() => {
      const modal = document.getElementById("app-review-modal");
      if (modal) {
        modal.classList.remove("hidden");
        setTimeout(() => {
          modal.classList.remove("opacity-0");
          modal.querySelector(".bg-white").classList.remove("scale-95");
        }, 10);

        if (typeof window.triggerVibration === "function")
          window.triggerVibration("success");
      }
    }, 5000);
  }

  const btnGoogle = document.getElementById("btn-review-google");
  const btnContact = document.getElementById("btn-review-contact");
  const btnLater = document.getElementById("btn-review-later");
  const modal = document.getElementById("app-review-modal");

  const closeModal = () => {
    modal.classList.add("opacity-0");
    modal.querySelector(".bg-white").classList.add("scale-95");
    setTimeout(() => modal.classList.add("hidden"), 300);
  };

  if (btnGoogle) {
    btnGoogle.addEventListener("click", () => {
      localStorage.setItem("hasRatedApp", "true");
      const googleLink = cfg?.reviews?.googleMapsReviewLink || cfg?.contact?.address?.googleMapsUrl;
      if (googleLink) window.open(googleLink, "_blank");
      closeModal();
    });
  }

  if (btnContact) {
    btnContact.addEventListener("click", () => {
      localStorage.setItem("hasRatedApp", "true");
      closeModal();
      document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
      const sourceAvisInput = document.getElementById("source-avis");
      if (sourceAvisInput) sourceAvisInput.value = "Suggestion depuis le prompt PWA";
    });
  }

  if (btnLater) {
    btnLater.addEventListener("click", () => {
      localStorage.setItem("appVisits", "0");
      closeModal();
    });
  }
}

window.setupSmartReviewPrompt = setupSmartReviewPrompt;

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
        if (window.menuGlobal && window.menuGlobal.length > 0) {
          setTimeout(doOpen, 300);
        } else {
          // Sinon attendre que menu.js ait fini de charger Firestore
          window.addEventListener("snack:menu:ready", () => setTimeout(doOpen, 200), { once: true });
        }
      }
    }, 800);
  }
});
