// ============================================================================
// 🔐 AUTH ERRORS — Mapping codes Firebase → messages utilisateur (FR)
// ============================================================================
// Fonctions PURES (aucune dépendance DOM/Firebase) → trivialement testables.
// On ne renvoie jamais le message brut Firebase à l'UI (cf. CLAUDE.md §6.1).

const MESSAGES = {
  "auth/email-already-in-use": "Cet email a déjà un compte. Connectez-vous pour continuer.",
  "auth/credential-already-in-use": "Cet email a déjà un compte. Connectez-vous pour continuer.",
  "auth/invalid-credential": "Email ou mot de passe incorrect.",
  "auth/wrong-password": "Email ou mot de passe incorrect.",
  "auth/user-not-found": "Email ou mot de passe incorrect.",
  "auth/weak-password": "Mot de passe trop faible (6 caractères minimum).",
  "auth/invalid-email": "Adresse email invalide.",
};

const DEFAULT_MESSAGE = "Une erreur est survenue. Réessayez.";

/**
 * @param {string} code - code d'erreur Firebase (ex: "auth/wrong-password").
 * @returns {string} message clair à afficher à l'utilisateur.
 */
export function authErrorMessage(code) {
  return MESSAGES[code] || DEFAULT_MESSAGE;
}

/**
 * Collision : l'email/credential appartient déjà à un compte existant
 * (cas typique : invité anonyme qui tente de s'inscrire avec un email connu).
 * @param {string} code
 * @returns {boolean}
 */
export function isExistingAccountError(code) {
  return (
    code === "auth/email-already-in-use" ||
    code === "auth/credential-already-in-use"
  );
}

/**
 * @param {string} code
 * @returns {boolean} true si le code est explicitement mappé (sinon → message par défaut).
 */
export function isKnownAuthError(code) {
  return Object.prototype.hasOwnProperty.call(MESSAGES, code);
}
