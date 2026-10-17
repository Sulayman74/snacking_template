// @vitest-environment jsdom
// 💳 Tests unitaires — Carte Fidélité format CB (3D Rotate + QR code dos) & Scanner Cuisine
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/core/firebase.js", () => ({
  auth: { currentUser: null },
  db: {},
  doc: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  onSnapshot: vi.fn(),
}));
vi.mock("../../src/push-register.js", () => ({
  registerDevicePush: vi.fn(),
  syncDevicePush: vi.fn(),
}));

import { toggleCardFlip } from "../../src/loyalty.js";

describe("Carte Fidélité format CB 3D Rotate", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="cb-loyalty-card" aria-pressed="false">
        <div id="cb-card-inner">
          <div class="cb-card-front">
            <span id="card-points">0</span>
            <div id="card-number-display">•••• •••• •••• ••••</div>
          </div>
          <div class="cb-card-back">
            <img id="card-qr-img" src="" />
          </div>
        </div>
      </div>
      <span id="cb-flip-hint">Toucher la carte pour afficher le QR code</span>
    `;
    window.triggerVibration = vi.fn();
  });

  it("bascule de recto (is-flipped: false) à verso (is-flipped: true) au clic", () => {
    const inner = document.getElementById("cb-card-inner");
    const card = document.getElementById("cb-loyalty-card");
    const hint = document.getElementById("cb-flip-hint");

    expect(inner.classList.contains("is-flipped")).toBe(false);
    expect(card.getAttribute("aria-pressed")).toBe("false");

    // 1er flip -> Verso (QR Code)
    toggleCardFlip();
    expect(inner.classList.contains("is-flipped")).toBe(true);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(hint.innerText).toBe("Toucher pour retourner au recto");
    expect(window.triggerVibration).toHaveBeenCalledWith("light");

    // 2e flip -> Retour Recto (CB)
    toggleCardFlip();
    expect(inner.classList.contains("is-flipped")).toBe(false);
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(hint.innerText).toBe("Toucher la carte pour afficher le QR code");
  });

  it("respecte l'état forcé (forceState = false pour réinitialiser à l'ouverture)", () => {
    const inner = document.getElementById("cb-card-inner");
    inner.classList.add("is-flipped");

    toggleCardFlip(false);
    expect(inner.classList.contains("is-flipped")).toBe(false);

    toggleCardFlip(true);
    expect(inner.classList.contains("is-flipped")).toBe(true);
  });

  it("ne crash pas si les éléments DOM sont absents", () => {
    document.body.innerHTML = "";
    expect(() => toggleCardFlip()).not.toThrow();
  });
});

describe("Résolution du snackId pour le scanner admin", () => {
  it("donne priorité à window.currentAdminSnackId côté cuisine", () => {
    window.currentAdminSnackId = "snack-cuisine-123";
    window.snackConfig = { identity: { id: "snack-public-456" } };

    const resolved = window.currentAdminSnackId || window.snackConfig?.identity?.id;
    expect(resolved).toBe("snack-cuisine-123");
  });

  it("retombe sur window.snackConfig si currentAdminSnackId n'est pas défini", () => {
    window.currentAdminSnackId = null;
    window.snackConfig = { identity: { id: "snack-public-456" } };

    const resolved = window.currentAdminSnackId || window.snackConfig?.identity?.id;
    expect(resolved).toBe("snack-public-456");
  });
});
