// ============================================================================
// 🔐 AUTHENTIFICATION (Modale, Formulaire, Google, Reset, Logout)
// ============================================================================
// Dépendances : window.showToast, window.triggerVibration, window.switchView,
//               window.snackConfig (catégories B/C — Lot 4 PR-2/PR-3)

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
    "auth/weak-password":          "Mot de passe trop court (6 caractères minimum).",
    "auth/email-already-in-use":   "Un compte existe déjà avec cet email.",
    "auth/user-not-found":         "Aucun compte lié à cet email.",
    "auth/wrong-password":         "Email ou mot de passe incorrect.",
    "auth/invalid-email":          "L'adresse email n'est pas valide.",
    "auth/invalid-credential":     "Email ou mot de passe incorrect.",
    "auth/too-many-requests":      "Trop de tentatives. Réessayez dans quelques minutes.",
    "auth/network-request-failed": "Pas de connexion. Vérifiez votre réseau.",
    "auth/popup-closed-by-user":   "Connexion annulée.",
    "auth/popup-blocked":          "La fenêtre de connexion a été bloquée. Autorisez les pop-ups.",
    "auth/requires-recent-login":  "Session expirée. Reconnectez-vous.",
  };
  return map[code] ?? "Une erreur est survenue. Réessayez.";
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
    if (data.isAnonymous && !user.isAnonymous) {
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

function switchAuthMode() {
  isSignUpMode = !isSignUpMode;
  document.getElementById("auth-title").innerText = isSignUpMode
    ? "Créer un compte"
    : "Bienvenue !";
  document.getElementById("auth-submit-btn").innerText = isSignUpMode
    ? "S'inscrire"
    : "Se connecter";
  document.getElementById("auth-switch-btn").innerText = isSignUpMode
    ? "Se connecter"
    : "S'inscrire";
}

window.switchAuthMode = switchAuthMode;

// On attache l'événement au formulaire
const authForm = document.getElementById("auth-form");
if (authForm) {
  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = authForm.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return; // anti-double-clic
    const email = document.getElementById("auth-email").value;
    const password = document.getElementById("auth-password").value;
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
        isSignUpMode ? "Compte créé ! 🎉" : "Ravi de vous revoir ! 👋",
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
  const emailInput = document.getElementById("auth-email").value.trim();

  if (!emailInput) {
    window.showToast(
      "Veuillez d'abord taper votre adresse email dans le champ.",
      "error",
    );
    document.getElementById("auth-email").focus();
    if (typeof window.triggerVibration === "function")
      window.triggerVibration("error");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, emailInput);
    window.showToast("Un email de réinitialisation vous a été envoyé ! 📧", "success");
    if (typeof window.triggerVibration === "function")
      window.triggerVibration("success");
  } catch (error) {
    console.error("Erreur reset password :", error);
    window.showToast(mapAuthError(error.code), "error");
  }
}

window.resetPassword = resetPassword;

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
        window.showToast("Connexion Google réussie ! 🍔", "success");
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
    window.showToast("Vous êtes déconnecté. À bientôt !", "success");

    window.switchView("home");
  } catch (error) {
    console.error("Erreur de déconnexion", error);
  }
}

window.logoutUser = logoutUser;
