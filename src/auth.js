// ============================================================================
// 🔐 AUTHENTIFICATION (Modale, Formulaire, Google, Reset, Logout)
// ============================================================================
// Dépendances : window.auth, window.authTools, window.fs, window.db
//               window.showToast, window.triggerVibration, window.switchView
//               window.snackConfig

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
    const email = document.getElementById("auth-email").value;
    const password = document.getElementById("auth-password").value;

    try {
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } =
        window.authTools;
      if (isSignUpMode) {
        await createUserWithEmailAndPassword(window.auth, email, password);
        window.showToast("Compte créé ! 🎉", "success");
      } else {
        await signInWithEmailAndPassword(window.auth, email, password);
        window.showToast("Ravi de vous revoir ! 👋", "success");
      }
      toggleAuthModal();
    } catch (error) {
      window.showToast("Erreur : " + error.message, "error");
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

      if (isPassword) {
        eyeIcon.classList.remove("fa-eye");
        eyeIcon.classList.add("fa-eye-slash");
      } else {
        eyeIcon.classList.remove("fa-eye-slash");
        eyeIcon.classList.add("fa-eye");
      }
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
    const { sendPasswordResetEmail } = window.authTools;
    await sendPasswordResetEmail(window.auth, emailInput);
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
      const provider = new window.authTools.GoogleAuthProvider();
      const result = await window.authTools.signInWithPopup(window.auth, provider);
      const user = result.user;

      const { doc, getDoc, setDoc, serverTimestamp } = window.fs;
      const userRef = doc(window.db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          email: user.email,
          nom: user.displayName || "Gourmand",
          points: 0,
          snackId: window.snackConfig?.identity?.id || "Ym1YiO4Ue5Fb5UXlxr06",
          dateCreation: serverTimestamp(),
          role: "client",
        });
      }

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
    const { signOut } = window.authTools;
    const auth = window.auth;

    await signOut(auth);
    window.showToast("Vous êtes déconnecté. À bientôt !", "success");

    window.switchView("home");
  } catch (error) {
    console.error("Erreur de déconnexion", error);
  }
}

window.logoutUser = logoutUser;
