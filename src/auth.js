// ============================================================================
// 🔐 AUTHENTIFICATION (Modale, Formulaire, Google, Reset, Logout)
// ============================================================================
// Dépendances : window.showToast, window.triggerVibration, window.switchView,
//               window.snackConfig (catégories B/C — Lot 4 PR-2/PR-3)
import { t } from "./i18n/index.js";

// ============================================================================
// 🌐 TRADUCTION DES ERREURS FIREBASE AUTH
// ============================================================================
/**
 * Traduit un code d'erreur Firebase Auth en message utilisateur en français.
 * Pure function — testable sans Firebase, sans DOM.
 * Couvre le formulaire email/password, la connexion Google et le reset.
 * @param {string|undefined} code - error.code Firebase (ex: "auth/weak-password")
 * @returns {string} Message lisible en français.
 */
export function mapAuthError(code) {
  const map = {
    "auth/weak-password":          "weakPassword",
    "auth/email-already-in-use":   "emailAlreadyInUse",
    "auth/user-not-found":         "userNotFound",
    "auth/wrong-password":         "wrongPassword",
    "auth/invalid-email":          "invalidEmail",
    "auth/invalid-credential":     "invalidCredential",
    "auth/too-many-requests":      "tooManyRequests",
    "auth/network-request-failed": "networkRequestFailed",
    "auth/popup-closed-by-user":   "popupClosedByUser",
    "auth/popup-blocked":          "popupBlocked",
    "auth/requires-recent-login":  "requiresRecentLogin",
  };
  const key = map[code] ?? "generic";
  return t(`toasts.auth.errors.${key}`);
}
import {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  EmailAuthProvider,
  linkWithCredential,
  signInWithPopup,
  signOut,
  updatePassword,
  reauthenticateWithCredential,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "./core/firebase.js";

/**
 * Construit le document initial users/{uid} pour un nouvel utilisateur.
 * Pure function — testable sans Firebase, sans DOM (SRP).
 * Doit rester cohérente avec les champs attendus par finalizeOrder et creditLoyaltyPoints.
 * @param {object} user - L'objet User Firebase Auth (email, displayName, isAnonymous).
 * @returns {object} Données du doc Firestore à créer.
 */
export function buildUserInitDoc(user) {
  const isAnonymous = user?.isAnonymous === true;
  return {
    // Les invités anonymes n'ont pas d'email — null est explicite (à distinguer de l'absent).
    email: user?.email || null,
    // Priorité : displayName (Google) > partie locale de l'email > 'Invité' (anonyme).
    nom: user?.displayName
      || (user?.email ? user.email.split("@")[0] : null)
      || (isAnonymous ? "Invité" : "Gourmand"),
    pointsBySnack: {},
    dateCreation: serverTimestamp(),
    role: "client",
    isAnonymous,
  };
}

/**
 * Garantit l'existence du doc users/{uid} (idempotent). Crée un profil "client" par
 * défaut s'il MANQUE — couvre l'inscription email/password, la connexion Google ET
 * les invités anonymes (signInAnonymously). Sans ce doc : fidélité KO (creditLoyaltyPoints
 * lève not-found → 0 point), RFM aveugle, parrainage KO. Ne touche JAMAIS un doc
 * existant (rôle/points préservés). Utilisable côté client ET appelable dans les tests.
 * @param {object} user - L'objet User Firebase Auth.
 * @returns {Promise<void>}
 */
export async function ensureUserDoc(user) {
  if (!user?.uid) return;
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    const data = snap.data();
    if (data.isAnonymous !== false && !user.isAnonymous) {
      await updateDoc(userRef, {
        email: user.email,
        nom: user.displayName || user.email?.split("@")[0] || data.nom || "Gourmand",
        isAnonymous: false,
      });
    }
    return;
  }
  await setDoc(userRef, buildUserInitDoc(user));
}

// ============================================================================
// 🔐 LOGIQUE DU FORMULAIRE D'AUTH
// ============================================================================
let isSignUpMode = false;

function updateAuthModalUI() {
  const titleEl = document.getElementById("auth-title");
  if (titleEl) {
    titleEl.innerText = isSignUpMode ? t("auth.titleRegister") : t("auth.titleWelcome");
  }
  const submitBtn = document.getElementById("auth-submit-btn");
  if (submitBtn) {
    submitBtn.innerText = isSignUpMode ? t("auth.register") : t("auth.login");
  }
  const switchBtn = document.getElementById("auth-switch-btn");
  if (switchBtn) {
    switchBtn.innerText = isSignUpMode ? t("auth.login") : t("auth.register");
  }
  const switchText = document.getElementById("auth-switch-text");
  if (switchText) {
    switchText.innerText = isSignUpMode ? t("auth.switchTextRegister") : t("auth.switchTextLogin");
  }
  const passwordInput = document.getElementById("auth-password");
  if (passwordInput) {
    passwordInput.setAttribute("autocomplete", isSignUpMode ? "new-password" : "current-password");
  }
}

function switchAuthMode() {
  isSignUpMode = !isSignUpMode;
  updateAuthModalUI();
}

window.switchAuthMode = switchAuthMode;

// Écouter le changement de langue pour retraduire dynamiquement la modale d'authentification
window.addEventListener("snack:locale:changed", updateAuthModalUI);

// On attache l'événement au formulaire
const authForm = document.getElementById("auth-form");
if (authForm) {
  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = authForm.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return; // anti-double-clic
    const rawEmail = document.getElementById("auth-email")?.value || "";
    const email = rawEmail.trim();
    const password = document.getElementById("auth-password")?.value || "";
    const original = submitBtn?.innerHTML;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader-circle" class="animate-spin"></i>';
    }

    try {
      let cred;
      if (isSignUpMode) {
        if (auth.currentUser?.isAnonymous) {
          const credential = EmailAuthProvider.credential(email, password);
          cred = await linkWithCredential(auth.currentUser, credential);
        } else {
          cred = await createUserWithEmailAndPassword(auth, email, password);
        }
      } else {
        cred = await signInWithEmailAndPassword(auth, email, password);
      }
      window.showToast(
        isSignUpMode ? t("toasts.auth.signUpSuccess") : t("toasts.auth.signInSuccess"),
        "success",
      );
      // 🛡️ Crée le doc users/{uid} s'il manque (signup email/password ET backfill d'un
      // compte existant sans doc) → sinon fidélité KO. Idempotent, ne casse pas le login.
      await ensureUserDoc(cred.user);
      toggleAuthModal();
    } catch (error) {
      console.error("❌ Sign up error:", error);
      window.showToast(mapAuthError(error.code), "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = original;
      }
    }
  });
}

function toggleAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;

  const isVisible =
    !modal.classList.contains("hidden") &&
    !modal.classList.contains("opacity-0");

  if (!isVisible) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    setTimeout(() => modal.classList.remove("opacity-0"), 10);
    document.body.style.overflow = "hidden";
  } else {
    modal.classList.add("opacity-0");
    setTimeout(() => {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
      document.body.style.overflow = "";
    }, 300);
  }
}

function openGuestRegistration() {
  if (!isSignUpMode) {
    switchAuthMode();
  }
  toggleAuthModal();
}

window.toggleAuthModal = toggleAuthModal;
window.openGuestRegistration = openGuestRegistration;

// ============================================================================
// 👀 GESTION DE L'ŒIL DU MOT DE PASSE
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const togglePasswordBtn = document.getElementById("toggle-password");
  const passwordInput = document.getElementById("auth-password");
  const eyeIcon = document.getElementById("eye-icon");

  if (togglePasswordBtn && passwordInput && eyeIcon) {
    togglePasswordBtn.addEventListener("click", () => {
      const isPassword = passwordInput.getAttribute("type") === "password";
      passwordInput.setAttribute("type", isPassword ? "text" : "password");

      // Lucide : on remplace l'icône (re-query par id car swapIcon recrée l'élément).
      window.swapIcon?.(document.getElementById("eye-icon"), isPassword ? "eye-off" : "eye");
    });
  }
});

// ============================================================================
// 🆘 RÉINITIALISATION DU MOT DE PASSE
// ============================================================================
async function resetPassword() {
  const emailInput = (document.getElementById("auth-email")?.value || "").trim();

  if (!emailInput) {
    window.showToast(
      t("toasts.auth.emailRequired"),
      "error",
    );
    document.getElementById("auth-email")?.focus();
    if (typeof window.triggerVibration === "function")
      window.triggerVibration("error");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, emailInput);
    window.showToast(t("toasts.auth.resetEmailSent"), "success");
    if (typeof window.triggerVibration === "function")
      window.triggerVibration("success");
  } catch (error) {
    console.error("Erreur reset password :", error);
    // 🛡️ OWASP Anti-Énumération : Ne pas divulguer si l'email existe ou non en DB
    if (error.code === "auth/user-not-found" || error.code === "auth/invalid-email") {
      window.showToast(t("toasts.auth.resetEmailSent"), "success");
    } else {
      window.showToast(mapAuthError(error.code), "error");
    }
  }
}

/**
 * Permet à un utilisateur connecté de modifier son mot de passe avec ré-authentification.
 * @param {string} currentPassword - Ancien mot de passe requis pour ré-authentification
 * @param {string} newPassword - Nouveau mot de passe
 * @returns {Promise<void>}
 */
export async function changeUserPassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error("auth/requires-recent-login");
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error("auth/weak-password");
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

window.resetPassword = resetPassword;
window.changeUserPassword = changeUserPassword;

// ============================================================================
// 🚀 CONNEXION AVEC GOOGLE
// ============================================================================
const btnGoogleLogin = document.getElementById("btn-google-login");

if (btnGoogleLogin) {
  btnGoogleLogin.addEventListener("click", async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await ensureUserDoc(result.user);

      if (typeof window.showToast === "function") {
        window.showToast(t("toasts.auth.googleSuccess"), "success");
      }

      toggleAuthModal();
    } catch (error) {
      console.error("❌ Erreur Google Auth:", error);
      if (typeof window.showToast === "function") {
        window.showToast(mapAuthError(error.code), "error");
      }
    }
  });
}

// ============================================================================
// 🚪 DÉCONNEXION
// ============================================================================
async function logoutUser() {
  try {
    await signOut(auth);
    window.showToast(t("toasts.auth.signOutSuccess"), "success");

    window.switchView("home");
  } catch (error) {
    console.error("Erreur de déconnexion", error);
  }
}

window.logoutUser = logoutUser;
