// ============================================================================
// 🎛️ ADMIN — Point d'entrée (Auth, Router, UI, Shell)
// ============================================================================

// import "./bridge.js";
import "./firebase-init.js";
import "./snack-config.js";
import "./admin-kitchen.js";
import "./admin-products.js";
import "./admin-marketing.js";
import "./admin-csv.js";
import "./admin-compta.js";

import { escapeHTML } from "./utils.js";

const { onAuthStateChanged, signInWithEmailAndPassword, signOut } =
  window.authTools;

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
    case "toggle-product": {
      const currentStatus =
        target.getAttribute("data-current-status") === "true";
      window.toggleProductStatus(id, currentStatus);
      break;
    }
    case "open-edit-modal":
      window.openEditModal(id);
      break;
    case "open-delete-modal":
      window.openDeleteModal(id);
      break;
    case "save-product":
      window.saveProduct(event);
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
  modal.querySelector(".bg-white").classList.add("scale-95");

  setTimeout(() => {
    modal.classList.add("hidden");
    if (typeof window.adminResetEditIds === "function")
      window.adminResetEditIds();
  }, 300);
};

// ============================================================================
// 🍞 NOTIFICATIONS TOAST
// ============================================================================
window.showToast = function (message, type = "success") {
  const snackbar = document.getElementById("admin-snackbar");
  if (!snackbar) {
    alert(message);
    return;
  }
  const msgEl = document.getElementById("admin-snackbar-message");
  const iconEl = document.getElementById("admin-snackbar-icon");

  msgEl.innerText = message;
  iconEl.className =
    type === "error"
      ? "fas fa-exclamation-circle text-red-500 text-xl"
      : "fas fa-check-circle text-green-400 text-xl";

  snackbar.classList.remove("translate-y-24", "opacity-0");
  setTimeout(() => snackbar.classList.add("translate-y-24", "opacity-0"), 3000);
};

// ============================================================================
// 3. ONGLETS ET NAVIGATION
// ============================================================================
window.switchAdminTab = (tabName) => {
  window.currentAdminTab = tabName;
  const tabs = ["cuisine", "menu", "marketing", "compta"];

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
        "flex flex-col items-center gap-1 px-4 py-2 text-gray-400 font-bold text-xs transition";
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
      "flex flex-col items-center gap-1 px-4 py-2 text-red-500 font-bold text-xs transition";

  if (activeView) activeView.classList.remove("hidden");

  if (tabName === "cuisine" && window.currentAdminSnackId) {
    window.startKitchenRadar();
  } else {
    window.stopKitchenRadar();
    // 🛒 Si on va sur le menu, on charge les produits depuis Firestore
    if (tabName === "menu") window.loadAdminProducts();

    if (tabName === "marketing") {
      // Si on n'a pas encore de produits en mémoire, on les charge d'abord
      if (window.adminProducts.length === 0) {
        window.loadAdminProducts().then(() => {
          window.populatePushProducts();
        });
      } else {
        window.populatePushProducts();
      }
    }

    if (tabName === "compta") window.loadComptaDashboard();
  }
};

// ============================================================================
// 🔐 AUTH ADMIN
// ============================================================================
onAuthStateChanged(window.auth, async (user) => {
  const loginSection = document.getElementById("admin-login-section");
  const startBtn = document.getElementById("start-shift-btn");
  const startupIcon = document.getElementById("startup-icon");
  const startupTitle = document.getElementById("startup-title");
  const startupDesc = document.getElementById("startup-desc");
  const backHomeBtn = document.getElementById("back-home-btn");

  if (user) {
    const { getDoc, doc } = window.fs;
    const userDoc = await getDoc(doc(window.db, "users", user.uid));

    if (
      userDoc.exists() &&
      (userDoc.data().role === "admin" ||
        userDoc.data().role === "superadmin")
    ) {
      window.currentAdminSnackId = userDoc.data().snackId;
      if (document.getElementById("admin-email"))
        document.getElementById("admin-email").innerText = user.email;

      if (window.snackConfig?.features?.enablePushNotifs) {
        document
          .getElementById("tab-marketing-desktop")
          ?.classList.remove("hidden");
        document
          .getElementById("tab-marketing-mobile")
          ?.classList.remove("hidden");
      }

      loginSection.classList.add("hidden");
      startupIcon.className =
        "fas fa-check-circle text-6xl mb-6 text-green-500 animate-bounce";
      startupTitle.innerText = "Accès Autorisé";
      startupDesc.innerText =
        "Cliquez ci-dessous pour activer le radar de cuisine.";
      startBtn.classList.remove("hidden");
      
      // On affiche toujours le bouton retour accueil pour ne pas bloquer l'admin
      backHomeBtn?.classList.remove("hidden");
    } else {
      window.auth.signOut();
      refuseAccess(
        "Accès refusé. Vous n'avez pas les droits d'administration.",
      );
    }
  } else {
    startupIcon.className = "fas fa-lock text-6xl mb-6 text-gray-300";
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
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Vérification...`;
    btn.disabled = true;
    errorMsg.classList.add("hidden");

    try {
      await signInWithEmailAndPassword(window.auth, email, password);
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
  document.getElementById("startup-icon").className =
    "fas fa-ban text-6xl mb-6 text-red-500";
  document.getElementById("startup-title").innerText = "Accès Refusé";
  document.getElementById("startup-desc").innerText = message;
  document.getElementById("back-home-btn").classList.remove("hidden");
}

document.getElementById("start-shift-btn").addEventListener("click", () => {
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
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Connexion Stripe...`;
  btn.disabled = true;

  try {
    const { httpsCallable, functions } = window.fs;
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
  await signOut(window.auth);
  window.location.href = "index.html";
};
