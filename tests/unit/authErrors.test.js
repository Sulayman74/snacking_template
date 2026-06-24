import { describe, it, expect } from "vitest";
import {
  authErrorMessage,
  isExistingAccountError,
  isKnownAuthError,
} from "../../src/utils/authErrors.js";

describe("authErrorMessage", () => {
  it("email/credential déjà utilisé → message 'déjà un compte'", () => {
    expect(authErrorMessage("auth/email-already-in-use")).toMatch(/déjà un compte/i);
    expect(authErrorMessage("auth/credential-already-in-use")).toMatch(/déjà un compte/i);
  });

  it("identifiants invalides → message 'incorrect'", () => {
    for (const c of ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"]) {
      expect(authErrorMessage(c)).toMatch(/incorrect/i);
    }
  });

  it("mot de passe faible / email invalide", () => {
    expect(authErrorMessage("auth/weak-password")).toMatch(/faible/i);
    expect(authErrorMessage("auth/invalid-email")).toMatch(/invalide/i);
  });

  it("code inconnu ou vide → message par défaut (jamais le code brut)", () => {
    const def = "Une erreur est survenue. Réessayez.";
    expect(authErrorMessage("auth/internal-error")).toBe(def);
    expect(authErrorMessage("")).toBe(def);
    expect(authErrorMessage(undefined)).toBe(def);
  });
});

describe("isExistingAccountError", () => {
  it("true pour les collisions de compte", () => {
    expect(isExistingAccountError("auth/email-already-in-use")).toBe(true);
    expect(isExistingAccountError("auth/credential-already-in-use")).toBe(true);
  });
  it("false sinon", () => {
    expect(isExistingAccountError("auth/wrong-password")).toBe(false);
    expect(isExistingAccountError("")).toBe(false);
  });
});

describe("isKnownAuthError", () => {
  it("distingue code mappé vs inconnu", () => {
    expect(isKnownAuthError("auth/weak-password")).toBe(true);
    expect(isKnownAuthError("auth/zzz-unknown")).toBe(false);
  });
});
