// ============================================================================
// 🎛️ ADMIN — Point d'entrée (Auth, Router, UI, Shell)
// ============================================================================

// import "./bridge.js";
import "./firebase-init.js";
import "./snack-config.js";
import "./icons.js";
import "./admin-kitchen.js";
import "./admin-products.js";
import "./admin-marketing.js";
import "./admin-csv.js";
import "./admin-compta.js";
import "./admin-upsell.js";
import "./admin-config.js";
import "./admin-livreurs.js";
import "./ui/AdminConfigUI.js";
import "./ui/AdminProductsUI.js";
import "./ui/AdminMarketingUI.js";
import "./ui/AdminComptaUI.js";
import "./ui/AdminUpsellUI.js";
import { confirmAction } from "./utils/ModalManager.js";
import { setupSWUpdatePrompt } from "./sw-update.js";
import { setupA2HS } from "./a2hs.js";
import { initAdminNotifs } from "./admin-notifs.js";
import {
  auth,
  db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  getDoc,
  doc,
  httpsCallable,
  functions,
} from "./core/firebase.js";

// SW + bandeau de mise à jour (pattern prompt) : installable plein écran sur la
// tablette de cuisine + JAMAIS de rechargement auto en plein service.
setupSWUpdatePrompt({ context: "Admin" });

// Bouton "Installer l'app Cuisine" (A2HS) + fallback iOS.
setupA2HS({
  bannerId: "admin-install-banner",
  btnId: "admin-install-btn",
  closeId: "admin-install-close",
  hintId: "admin-install-hint",
});

// Activation guidée des alertes "nouvelle commande" (opt-in push cuisine).
initAdminNotifs();

// ============================================================================
// VARIABLES GLOBALES PARTAGÉES
// ============================================================================
window.currentAdminSnackId = null;
window.adminProducts = [];
window.currentAdminTab = "cuisine";

const bell = document.getElementById("kitchen-bell");

// ============================================================================
// 🎮 ROUTEUR D'ÉVÉNEMENTS ADMIN (Event Delegation)
// ============================================================================
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.getAttribute("data-action");
  const id = target.getAttribute("data-id");

  switch (action) {
    case "update-order": {
      const status = target.getAttribute("data-status");
      window.updateOrderStatus(id, status);
      break;
    }
    case "update-payment": {
      const paymentStatus = target.getAttribute("data-status");
      window.updatePaymentStatus(id, paymentStatus);
      break;
    }
    case "refund-order": {
      window.handleRefundOrder?.(id);
      break;
    }
    case "order-detail": {
      window.openOrderDetail?.(id);
      break;
    }
    case "close-order-detail": {
      window.closeOrderDetail?.();
      break;
    }
    case "toggle-product":
      window.handleToggleProductUI(id);
      break;
    case "toggle-product-ui":
      window.handleToggleProductUI(id);
      break;
    case "open-edit-modal":
      window.openEditModal(id);
      break;
    case "open-delete-modal":
      window.handleDeleteProductUI(id);
      break;
    case "delete-product-ui":
      window.handleDeleteProductUI(id);
      break;
    case "close-modal": {
      const modalId = target.getAttribute("data-modal-id");
      window.closeModal(modalId);
      break;
    }
  }
});

// ============================================================================
// ✅ FERMETURE UNIVERSELLE DE MODALES
// ============================================================================
window.closeModal = (modalId) => {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.classList.add("opacity-0");
  const inner = modal.querySelector(".bg-white");
  if (inner) inner.classList.add("scale-95");

  setTimeout(() => {
    modal.classList.add("hidden");
    if (typeof window.adminResetEditIds === "function")
      window.adminResetEditIds();
  }, 300);
};

// ============================================================================
// 🔄 ORCHESTRATEUR DE CYCLE DE VIE (Admin)
// ============================================================================
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (typeof window.stopKitchenRadar === "function") {
      window.stopKitchenRadar();
    }
  } else {
    // Reprise du radar cuisine uniquement si on est sur le bon onglet
    if (window.currentAdminTab === "cuisine" && window.currentAdminSnackId && typeof window.startKitchenRadar === "function") {
      // On vérifie aussi que l'overlay de démarrage est caché (shift démarré)
      const overlay = document.getElementById("startup-overlay");
      if (overlay && overlay.classList.contains("hidden")) {
        window.startKitchenRadar();
      }
    }
  }
});

// ============================================================================
// 3. ONGLETS ET NAVIGATION
// ============================================================================
window.switchAdminTab = (tabName) => {
  window.currentAdminTab = tabName;
  const tabs = ["cuisine", "menu", "marketing", "config", "compta", "support", "livreurs"];

  tabs.forEach((t) => {
    const btnDesktop = document.getElementById(`tab-${t}-desktop`);
    const btnMobile = document.getElementById(`tab-${t}-mobile`);
    const view = document.getElementById(`view-${t}`);

    if (btnDesktop) {
      btnDesktop.className =
        "w-full flex items-center px-6 py-4 text-gray-400 hover:text-white hover:bg-gray-800 rounded-r-2xl font-bold transition";
    }
    if (btnMobile) {
      btnMobile.className =
        "flex flex-col items-center gap-1 p-2 text-gray-400 hover:text-gray-900 w-16";
    }
    if (view) view.classList.add("hidden");
  });

  const activeBtnDesktop = document.getElementById(`tab-${tabName}-desktop`);
  const activeBtnMobile = document.getElementById(`tab-${tabName}-mobile`);
  const activeView = document.getElementById(`view-${tabName}`);

  if (activeBtnDesktop)
    activeBtnDesktop.className =
      "w-full flex items-center px-6 py-4 text-white bg-gray-800 rounded-r-2xl font-bold border-l-4 border-red-500 transition";
  if (activeBtnMobile)
    activeBtnMobile.className =
      "flex flex-col items-center gap-1 p-2 text-red-600 w-16";

  if (activeView) activeView.classList.remove("hidden");

  if (tabName === "cuisine" && window.currentAdminSnackId) {
    window.startKitchenRadar();
  } else {
    window.stopKitchenRadar();
    // 🛒 Si on va sur le menu, on charge les produits depuis Firestore
    if (tabName === "menu") window.loadAdminProducts();

    if (tabName === "marketing") {
      window.loadPushHistory();
      // Si on n'a pas encore de produits en mémoire, on les charge d'abord
      if (window.adminProducts.length === 0) {
        window.loadAdminProducts().then(() => {
          window.populatePushProducts();
        });
      } else {
        window.populatePushProducts();
      }
    }

    if (tabName === "config") window.loadConfigView();

    if (tabName === "compta") {
      window.loadComptaDashboard();
      window.loadUpsellStats?.();
    }

    if (tabName === "livreurs") window.loadDriversView?.();
  }
};


// ============================================================================
// 🔐 AUTH ADMIN
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  const loginSection = document.getElementById("admin-login-section");
  const startBtn = document.getElementById("start-shift-btn");
  const startupIcon = document.getElementById("startup-icon");
  const startupTitle = document.getElementById("startup-title");
  const startupDesc = document.getElementById("startup-desc");
  const backHomeBtn = document.getElementById("back-home-btn");

  // Robustesse : si le shell admin n'est pas dans le DOM (refonte template),
  // on n'essaie pas d'y écrire → évite de planter tout le bootstrap auth.
  if (!loginSection || !startBtn || !startupIcon || !startupTitle || !startupDesc) {
    console.warn("[admin] Éléments du shell introuvables — bootstrap ignoré.");
    return;
  }

  if (user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));

    const initialsDiv = document.getElementById("admin-initials");

    if (initialsDiv) {
      initialsDiv.innerText = getInitialsFromEmail(user.email) || "?";
    }

    const emailSpan = document.getElementById("admin-email-desktop");
    if (emailSpan) {
      emailSpan.innerText = user.email;
    }

    if (
      userDoc.exists() &&
      (userDoc.data().role === "admin" || userDoc.data().role === "superadmin")
    ) {
      // 👑 Superadmin : pilote N'IMPORTE quel snack via ?s=<id> (lien depuis le
      // dashboard superadmin). Admin classique : son propre snack.
      // Les firestore.rules autorisent déjà isSuperAdmin sur toutes les collections.
      const role = userDoc.data().role;
      if (role === "superadmin") {
        const targetSnack = new URLSearchParams(window.location.search).get("s");
        if (!targetSnack) {
          // Pas de cible → on renvoie le superadmin choisir un resto dans son tableau de bord.
          window.location.href = "superadmin.html";
          return;
        }
        window.currentAdminSnackId = targetSnack;
        window.isSuperadminImpersonating = true;
        // Repère visuel : on n'est pas dans son propre back-office.
        const sb = document.createElement("div");
        sb.textContent = "👑 Mode superadmin — vous pilotez le back-office d'un resto";
        sb.className = "fixed top-0 inset-x-0 z-[400] bg-purple-700 text-white text-center text-[11px] font-bold py-1 shadow";
        document.body.appendChild(sb);
      } else {
        window.currentAdminSnackId = userDoc.data().snackId;
      }

      if (document.getElementById("admin-email"))
        document.getElementById("admin-email").innerText = user.email;

      // Propose l'activation des alertes "nouvelle commande" (ou re-sync le token).
      window.maybePromptAdminNotifs?.();

      if (window.snackConfig?.features?.enablePushNotifs) {
        document
          .getElementById("tab-marketing-desktop")
          ?.classList.remove("hidden");
        document
          .getElementById("tab-marketing-mobile")
          ?.classList.remove("hidden");
      }

      loginSection.classList.add("hidden");
      window.swapIcon?.(document.getElementById("startup-icon"), "circle-check", "text-6xl mb-6 text-green-500 animate-bounce");
      startupTitle.innerText = "Accès Autorisé";
      startupDesc.innerText =
        "Cliquez ci-dessous pour activer le radar de cuisine.";
      startBtn.classList.remove("hidden");

      // On affiche toujours le bouton retour accueil pour ne pas bloquer l'admin
      backHomeBtn?.classList.remove("hidden");
    } else {
      auth.signOut();
      refuseAccess(
        "Accès refusé. Vous n'avez pas les droits d'administration.",
      );
    }
  } else {
    window.swapIcon?.(document.getElementById("startup-icon"), "lock", "text-6xl mb-6 text-gray-300");
    startupTitle.innerText = "Espace Sécurisé";
    startupDesc.innerText =
      "Veuillez vous identifier pour accéder au terminal.";
    startBtn.classList.add("hidden");
    loginSection.classList.remove("hidden");
    loginSection.classList.add("flex");
    backHomeBtn?.classList.remove("hidden");
  }
});

const adminLoginForm = document.getElementById("admin-login-form");
if (adminLoginForm) {
  adminLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("admin-email-input").value;
    const password = document.getElementById("admin-password-input").value;
    const btn = document.getElementById("admin-login-btn");
    const errorMsg = document.getElementById("admin-login-error");

    const originalText = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin"></i> Vérification...`;
    btn.disabled = true;
    errorMsg.classList.add("hidden");

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error("Erreur de connexion:", error);
      errorMsg.innerText = "Identifiants incorrects. Veuillez réessayer.";
      errorMsg.classList.remove("hidden");
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });
}

function refuseAccess(message) {
  window.swapIcon?.(document.getElementById("startup-icon"), "ban", "text-6xl mb-6 text-red-500");
  document.getElementById("startup-title").innerText = "Accès Refusé";
  document.getElementById("startup-desc").innerText = message;
  document.getElementById("back-home-btn").classList.remove("hidden");
}

document.getElementById("start-shift-btn")?.addEventListener("click", () => {
  bell.volume = 0;
  bell
    .play()
    .then(() => {
      bell.pause();
      bell.currentTime = 0;
      bell.volume = 1;
      document.getElementById("startup-overlay").classList.add("hidden");
      window.startKitchenRadar();
    })
    .catch((e) => console.error("Erreur Audio:", e));
});

// ============================================================================
// 🏦 STRIPE CONNECT
// ============================================================================
window.openStripeExpressDashboard = async () => {
  const btn = document.getElementById("btn-stripe-dashboard");
  const originalText = btn.innerHTML;
  btn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin"></i> Connexion Stripe...`;
  btn.disabled = true;

  try {
    const getStripeLoginLink = httpsCallable(
      functions,
      "createStripeConnectLoginLink",
    );
    const response = await getStripeLoginLink({
      snackId: window.currentAdminSnackId,
    });
    if (response.data?.url) {
      window.open(response.data.url, "_blank");
    } else {
      throw new Error("URL introuvable dans la réponse.");
    }
  } catch (error) {
    console.error("Erreur ouverture Stripe Dashboard :", error);
    window.showToast("Erreur de connexion au portail bancaire.", "error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
};

// ============================================================================
// 5. DÉCONNEXION
// ============================================================================
window.logoutAdmin = async () => {
  await signOut(auth);
  window.location.href = "index.html";
};

function getInitialsFromEmail(email) {
  if (!email) return "";

  const namePart = email.split("@")[0]; // avant le @

  // cas : prenom.nom@gmail.com
  if (namePart.includes(".")) {
    const parts = namePart.split(".");
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // cas simple : john@gmail.com → JO
  return namePart.substring(0, 2).toUpperCase();
}
