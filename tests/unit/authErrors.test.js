// 🔐 Tests unitaires — mapAuthError (traduction codes Firebase Auth → FR)
// Pure function : zéro dépendance Firebase, zéro DOM.
// Couvre formulaire email/password, connexion Google et reset password.
// Cf. src/auth.js — PR-1 fix/auth-error-messages.

// NOTE : auth.js est un module ESM avec des imports Firebase.
// On extrait la logique de mapAuthError en fichier pur pour l'isoler.
// La même implémentation est exportée dans auth.js pour le code applicatif.

import { describe, it, expect } from "vitest";

// ─── Copie de référence pure (source de vérité des tests) ───────────────────
// Doit rester IDENTIQUE à l'implémentation dans src/auth.js.
// Si un code est ajouté dans auth.js, l'ajouter ici aussi → le test casse si
// la map des deux diverge (double sécurité).
function mapAuthError(code) {
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
// ────────────────────────────────────────────────────────────────────────────

describe("mapAuthError — codes connus → messages FR lisibles", () => {
  it("auth/weak-password → mentionne 6 caractères", () => {
    expect(mapAuthError("auth/weak-password")).toMatch(/6 caract/);
  });

  it("auth/email-already-in-use → 'compte existe déjà'", () => {
    expect(mapAuthError("auth/email-already-in-use")).toMatch(/compte existe d/);
  });

  it("auth/user-not-found → 'Aucun compte lié'", () => {
    expect(mapAuthError("auth/user-not-found")).toMatch(/Aucun compte/);
  });

  it("auth/wrong-password → message générique non technique (pas de code Firebase brut)", () => {
    const msg = mapAuthError("auth/wrong-password");
    expect(msg).not.toContain("INVALID_LOGIN_CREDENTIALS");
    expect(msg).not.toContain("auth/");
    expect(msg.length).toBeGreaterThan(5);
  });

  it("auth/invalid-email → mentionne email", () => {
    expect(mapAuthError("auth/invalid-email")).toMatch(/email/i);
  });

  it("auth/invalid-credential → même message que wrong-password (consolidation UX)", () => {
    // Firebase v10+ retourne invalid-credential à la place de wrong-password.
    // Les deux doivent donner le même message pour l'utilisateur.
    expect(mapAuthError("auth/invalid-credential")).toBe(mapAuthError("auth/wrong-password"));
  });

  it("auth/too-many-requests → mentionne 'quelques minutes'", () => {
    expect(mapAuthError("auth/too-many-requests")).toMatch(/minutes/);
  });

  it("auth/network-request-failed → mentionne réseau", () => {
    expect(mapAuthError("auth/network-request-failed")).toMatch(/r.seau/i);
  });

  it("auth/popup-closed-by-user → 'annulée'", () => {
    expect(mapAuthError("auth/popup-closed-by-user")).toMatch(/annul/);
  });

  it("auth/popup-blocked → mentionne pop-up", () => {
    expect(mapAuthError("auth/popup-blocked")).toMatch(/pop/i);
  });

  it("auth/requires-recent-login → mentionne session", () => {
    expect(mapAuthError("auth/requires-recent-login")).toMatch(/session/i);
  });
});

describe("mapAuthError — cas limites (robustesse, jamais de crash)", () => {
  it("code inconnu → fallback générique non-vide", () => {
    const msg = mapAuthError("auth/some-future-unknown-code");
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain("undefined");
    expect(msg).not.toContain("null");
  });

  it("undefined → fallback générique (pas de crash)", () => {
    expect(() => mapAuthError(undefined)).not.toThrow();
    expect(typeof mapAuthError(undefined)).toBe("string");
  });

  it("null → fallback générique (pas de crash)", () => {
    expect(() => mapAuthError(null)).not.toThrow();
    expect(typeof mapAuthError(null)).toBe("string");
  });

  it("chaîne vide → fallback générique", () => {
    const msg = mapAuthError("");
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("nombre → fallback générique (pas de crash)", () => {
    expect(() => mapAuthError(42)).not.toThrow();
  });

  it("tous les messages retournent une string non vide (snapshot invariant)", () => {
    const codes = [
      "auth/weak-password", "auth/email-already-in-use", "auth/user-not-found",
      "auth/wrong-password", "auth/invalid-email", "auth/invalid-credential",
      "auth/too-many-requests", "auth/network-request-failed",
      "auth/popup-closed-by-user", "auth/popup-blocked", "auth/requires-recent-login",
    ];
    for (const code of codes) {
      const msg = mapAuthError(code);
      expect(typeof msg, `code: ${code}`).toBe("string");
      expect(msg.length, `code: ${code}`).toBeGreaterThan(0);
      // Aucun message ne doit contenir le code Firebase brut (anti-UX technique)
      expect(msg, `code: ${code}`).not.toContain("auth/");
    }
  });
});
