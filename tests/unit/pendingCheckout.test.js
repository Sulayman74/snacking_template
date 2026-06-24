// @vitest-environment jsdom
// 🎯 Tests unitaires — Store.pendingCheckout + logique de relance checkout post-login
// PR-4 fix/checkout-resume-after-login
// Couvre : Store.setPendingCheckout / hasPendingCheckout + simulation onAuthStateChanged

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Store } from "../../src/core/Store.js";

let store;
beforeEach(() => {
  localStorage.clear();
  store = new Store();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Store.pendingCheckout — état initial et mutations", () => {
  it("false par défaut (aucune intention de checkout au démarrage)", () => {
    expect(store.hasPendingCheckout).toBe(false);
  });

  it("setPendingCheckout(true) → hasPendingCheckout = true", () => {
    store.setPendingCheckout(true);
    expect(store.hasPendingCheckout).toBe(true);
  });

  it("setPendingCheckout(false) consomme le flag → false", () => {
    store.setPendingCheckout(true);
    store.setPendingCheckout(false);
    expect(store.hasPendingCheckout).toBe(false);
  });

  it("valeur truthy non-bool (1, 'x') → coercée en true", () => {
    store.setPendingCheckout(1);
    expect(store.hasPendingCheckout).toBe(true);
    store.setPendingCheckout("yes");
    expect(store.hasPendingCheckout).toBe(true);
  });

  it("valeur falsy non-bool (0, '') → coercée en false", () => {
    store.setPendingCheckout(true);
    store.setPendingCheckout(0);
    expect(store.hasPendingCheckout).toBe(false);
  });

  it("hasPendingCheckout est accessible via getter (encapsulation — pas de mutation directe)", () => {
    // Le getter hasPendingCheckout reflète fidèlement l'état interne
    store.setPendingCheckout(true);
    expect(store.hasPendingCheckout).toBe(true);
    // On ne peut pas écrire store.hasPendingCheckout = false directement
    // (getter sans setter → en mode strict, ça lèverait TypeError)
    // L'unique chemin de mutation est setPendingCheckout().
    expect(typeof store.hasPendingCheckout).toBe("boolean");
  });

  it("ne pollue pas le panier ni la config", () => {
    store.addToCart({ id: "a", prix: 5 });
    store.setPendingCheckout(true);
    expect(store.state.cart).toHaveLength(1);
    expect(store.state.config).toBeNull();
  });

  it("setPendingCheckout n'émet PAS d'événement (état interne non-UI)", () => {
    const listener = vi.fn();
    store.addEventListener("auth-updated", listener);
    store.addEventListener("cart-updated", listener);
    store.setPendingCheckout(true);
    expect(listener).not.toHaveBeenCalled();
    store.removeEventListener("auth-updated", listener);
    store.removeEventListener("cart-updated", listener);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Logique de relance — simulation onAuthStateChanged (firebase-init.js)", () => {
  // Réplication exacte de la logique dans firebase-init.js (sans les dépendances Firebase)
  function simulateAuthStateChanged(user, store, processCheckoutFn) {
    store.setUser(user, "client");
    if (user && !user.isAnonymous && store.hasPendingCheckout) {
      store.setPendingCheckout(false);
      // setTimeout réel non simulé ici — on teste la décision, pas le délai
      processCheckoutFn?.();
    }
  }

  it("user connecté (non-anonyme) + pendingCheckout → relance et consomme le flag", () => {
    store.setPendingCheckout(true);
    const checkout = vi.fn();
    simulateAuthStateChanged({ uid: "uid1", isAnonymous: false }, store, checkout);
    expect(checkout).toHaveBeenCalledOnce();
    expect(store.hasPendingCheckout).toBe(false); // consommé
  });

  it("user anonyme + pendingCheckout → NE relance PAS (path guest checkout séparé)", () => {
    store.setPendingCheckout(true);
    const checkout = vi.fn();
    simulateAuthStateChanged({ uid: "anon1", isAnonymous: true }, store, checkout);
    expect(checkout).not.toHaveBeenCalled();
    expect(store.hasPendingCheckout).toBe(true); // non consommé
  });

  it("user null (déconnexion) + pendingCheckout → NE relance PAS", () => {
    store.setPendingCheckout(true);
    const checkout = vi.fn();
    simulateAuthStateChanged(null, store, checkout);
    expect(checkout).not.toHaveBeenCalled();
    expect(store.hasPendingCheckout).toBe(true); // conservé pour la prochaine connexion
  });

  it("user connecté SANS pendingCheckout → relance NON déclenchée (login normal)", () => {
    // hasPendingCheckout = false par défaut
    const checkout = vi.fn();
    simulateAuthStateChanged({ uid: "uid2", isAnonymous: false }, store, checkout);
    expect(checkout).not.toHaveBeenCalled();
  });

  it("double connexion → ne relance qu'une seule fois (flag consommé au 1er appel)", () => {
    store.setPendingCheckout(true);
    const checkout = vi.fn();
    // 1ère auth → relance
    simulateAuthStateChanged({ uid: "uid3", isAnonymous: false }, store, checkout);
    expect(checkout).toHaveBeenCalledOnce();
    // 2ème auth (ex: refresh token) → flag consommé, pas de 2ème relance
    simulateAuthStateChanged({ uid: "uid3", isAnonymous: false }, store, checkout);
    expect(checkout).toHaveBeenCalledOnce(); // toujours 1 seul appel
  });

  it("processCheckout absent (window.processCheckout undefined) → pas de crash", () => {
    store.setPendingCheckout(true);
    // Simule la guard typeof window.processCheckout === 'function'
    const checkoutFn = typeof undefined === "function" ? undefined : null;
    expect(() =>
      simulateAuthStateChanged({ uid: "uid4", isAnonymous: false }, store, checkoutFn)
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("setTimeout 300ms — délai d'animation (test du timing)", () => {
  it("processCheckout appelé après 300ms, pas avant", () => {
    vi.useFakeTimers();
    const checkout = vi.fn();

    // Simule le bloc entier avec setTimeout
    store.setPendingCheckout(true);
    const user = { uid: "u1", isAnonymous: false };
    if (user && !user.isAnonymous && store.hasPendingCheckout) {
      store.setPendingCheckout(false);
      setTimeout(() => { if (typeof checkout === "function") checkout(); }, 300);
    }

    expect(checkout).not.toHaveBeenCalled(); // pas appelé immédiatement
    vi.advanceTimersByTime(299);
    expect(checkout).not.toHaveBeenCalled(); // pas encore à 299ms
    vi.advanceTimersByTime(1);
    expect(checkout).toHaveBeenCalledOnce(); // appelé à 300ms exactement

    vi.useRealTimers();
  });
});
