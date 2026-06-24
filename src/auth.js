// ============================================================================
// 🔐 AUTHENTIFICATION (Modale, Formulaire, Google, Reset, Logout)
// ============================================================================
// Dépendances : window.showToast, window.triggerVibration, window.switchView,
//               window.snackConfig (catégories B/C — Lot 4 PR-2/PR-3)
import {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  EmailAuthProvider,
  linkWithCredential,
  linkWithPopup,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "./core/firebase.js";
import {
  authErrorMessage,
  isExistingAccountError,
  isKnownAuthError,
} from "./utils/authErrors.js";

/**
 * Garantit l'existence du doc users/{uid} (idempotent). Crée un profil "client" par
 * défaut s'il MANQUE — couvre l'inscription email/password (qui ne le créait pas) ET
 * backfille les comptes existants sans doc. Sans ce doc : fidélité KO (creditLoyaltyPoints
 * lève not-found → 0 point), carte vide. Ne touche JAMAIS un doc existant (rôle/points préservés).
 * @param {object} user - L'objet User Firebase Auth.
 * @returns {Promise<void>}
 */
async function ensureUserDoc(user) {
  if (!user?.uid) return;
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) return;
  await setDoc(userRef, {
    email: user.email,
    nom: user.displayName || user.email?.split("@")[0] || "Gourmand",
    pointsBySnack: {},
    dateCreation: serverTimestamp(),
    role: "client",
  });
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
        const current = auth.currentUser;
        // 🛒 Guest checkout (LOT 2) : un invité ANONYME qui crée son compte est
        // LIÉ (linkWithCredential) au lieu d'en créer un nouveau → le uid est
        // conservé, donc points/RFM/historique de commande restent rattachés.
        if (current?.isAnonymous) {
          cred = await linkWithCredential(
            current,
            EmailAuthProvider.credential(email, password),
          );
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
      // Mapping pur (codes → messages clairs, sans fuite du message brut — §6.1).
      const code = error?.code || "";
      if (isExistingAccountError(code)) {
        // L'email a déjà un compte (ex: invité anonyme qui tente de s'inscrire
        // avec un email existant) → on bascule en mode connexion, email conservé.
        if (isSignUpMode) switchAuthMode();
        document.getElementById("auth-password")?.focus();
      } else if (!isKnownAuthError(code)) {
        console.error("Auth error:", error); // erreur inattendue → log (pas en UI)
      }
      window.showToast(authErrorMessage(code), "error");
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

window.toggleAuthModal = toggleAuthModal;

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
    if (error.code === "auth/user-not-found") {
      window.showToast("Aucun compte n'est lié à cette adresse email.", "error");
    } else if (error.code === "auth/invalid-email") {
      window.showToast("L'adresse email n'est pas valide.", "error");
    } else {
      window.showToast("Une erreur est survenue.", "error");
    }
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
      // 🛒 Invité anonyme → on LIE le compte Google (uid conservé) au lieu d'en
      // ouvrir un nouveau ; sinon connexion Google classique.
      const current = auth.currentUser;
      const result = current?.isAnonymous
        ? await linkWithPopup(current, provider)
        : await signInWithPopup(auth, provider);
      await ensureUserDoc(result.user);

      if (typeof window.showToast === "function") {
        window.showToast("Connexion Google réussie ! 🍔", "success");
      }

      toggleAuthModal();
    } catch (error) {
      console.error("❌ Erreur Google Auth:", error);
      if (typeof window.showToast === "function") {
        window.showToast("Erreur lors de la connexion Google.", "error");
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
