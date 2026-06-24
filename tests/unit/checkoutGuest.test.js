// @vitest-environment jsdom
// 🛒 Tests unitaires — guard email invité anonyme (PR-2 fix/guest-email-focus-ux)
// Isole la logique DOM du guard : message d'erreur, highlight, timer.
// N'importe pas checkout.js (dépendances Firebase) — on teste la logique extraite.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Helpers de setup DOM ─────────────────────────────────────────────────────
function setupDom() {
  document.body.innerHTML = `
    <div id="payment-message" class="hidden"></div>
    <div id="link-authentication-element"></div>
    <button id="submit-payment-btn">Payer</button>
  `;
  return {
    messageEl: document.getElementById("payment-message"),
    linkEl:    document.getElementById("link-authentication-element"),
    submitBtn: document.getElementById("submit-payment-btn"),
  };
}

// ─── Logique extraite du guard (miroir de checkout.js) ───────────────────────
// Doit rester IDENTIQUE à la section guard dans src/checkout.js.
function runGuestEmailGuard({ isAnonymous, guestEmail }) {
  if (!isAnonymous || guestEmail) return false; // guard non déclenché

  const messageContainer = document.getElementById("payment-message");
  messageContainer.textContent = "Renseignez votre email pour recevoir le reçu.";
  messageContainer.classList.remove("hidden");

  const linkEl = document.getElementById("link-authentication-element");
  if (linkEl) {
    linkEl.scrollIntoView?.({ behavior: "smooth", block: "center" });
    linkEl.style.outline = "2px solid var(--color-error, #ef4444)";
    linkEl.style.borderRadius = "6px";
    linkEl.style.transition = "outline 0.2s";
    setTimeout(() => {
      linkEl.style.outline = "";
      linkEl.style.borderRadius = "";
    }, 2000);
  }
  return true; // guard déclenché (équivaut au `return` de checkout.js)
}
// ─────────────────────────────────────────────────────────────────────────────

describe("Guard email invité anonyme — message d'erreur", () => {
  beforeEach(() => { vi.useFakeTimers(); setupDom(); });
  afterEach(() => { vi.useRealTimers(); });

  it("invité sans email → message visible", () => {
    const { messageEl } = setupDom();
    runGuestEmailGuard({ isAnonymous: true, guestEmail: "" });
    expect(messageEl.textContent).toMatch(/email/i);
    expect(messageEl.classList.contains("hidden")).toBe(false);
  });

  it("invité avec email → guard ne se déclenche pas", () => {
    const { messageEl } = setupDom();
    const triggered = runGuestEmailGuard({ isAnonymous: true, guestEmail: "x@x.fr" });
    expect(triggered).toBe(false);
    expect(messageEl.classList.contains("hidden")).toBe(true); // inchangé
  });

  it("utilisateur connecté (non-anonyme) sans email → guard ne se déclenche pas", () => {
    const triggered = runGuestEmailGuard({ isAnonymous: false, guestEmail: "" });
    expect(triggered).toBe(false);
  });

  it("retourne true si le guard bloque (permet au caller de `return`)", () => {
    expect(runGuestEmailGuard({ isAnonymous: true, guestEmail: "" })).toBe(true);
  });
});

describe("Guard email invité — highlight visuel du champ Stripe", () => {
  beforeEach(() => { vi.useFakeTimers(); setupDom(); });
  afterEach(() => { vi.useRealTimers(); });

  it("outline rouge appliqué immédiatement", () => {
    const { linkEl } = setupDom();
    runGuestEmailGuard({ isAnonymous: true, guestEmail: "" });
    expect(linkEl.style.outline).toContain("#ef4444");
  });

  it("borderRadius appliqué (arrondi du cadre highlight)", () => {
    const { linkEl } = setupDom();
    runGuestEmailGuard({ isAnonymous: true, guestEmail: "" });
    expect(linkEl.style.borderRadius).toBe("6px");
  });

  it("highlight retiré après 2 000 ms", () => {
    const { linkEl } = setupDom();
    runGuestEmailGuard({ isAnonymous: true, guestEmail: "" });
    expect(linkEl.style.outline).not.toBe(""); // présent avant
    vi.advanceTimersByTime(2001);
    expect(linkEl.style.outline).toBe("");      // effacé après
    expect(linkEl.style.borderRadius).toBe(""); // effacé après
  });

  it("highlight toujours présent à 1 999 ms (pas d'early clear)", () => {
    const { linkEl } = setupDom();
    runGuestEmailGuard({ isAnonymous: true, guestEmail: "" });
    vi.advanceTimersByTime(1999);
    expect(linkEl.style.outline).not.toBe("");
  });

  it("si #link-authentication-element absent → pas de crash", () => {
    document.body.innerHTML = `<div id="payment-message" class="hidden"></div>`;
    expect(() =>
      runGuestEmailGuard({ isAnonymous: true, guestEmail: "" })
    ).not.toThrow();
  });
});
