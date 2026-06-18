// 🎁 Tests unitaires — résolution du cooldown anti-doublon fidélité (F3). PUR.
// Couvre lib/loyalty.js (resolveLoyaltyCooldownMs + constantes). creditLoyaltyPoints
// est transactionnel (Firestore) → couvert par les harness d'intégration, pas ici.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MAX_LOYALTY_POINTS, DEFAULT_LOYALTY_COOLDOWN_MS, resolveLoyaltyCooldownMs } =
  require("../../functions/lib/loyalty.js");

describe("constantes fidélité", () => {
  it("palier menu offert à 10 points", () => {
    expect(MAX_LOYALTY_POINTS).toBe(10);
  });
  it("cooldown anti-doublon par défaut = 10 min", () => {
    expect(DEFAULT_LOYALTY_COOLDOWN_MS).toBe(10 * 60_000);
  });
});

describe("resolveLoyaltyCooldownMs", () => {
  it("défaut si pas de config snack", () => {
    expect(resolveLoyaltyCooldownMs(undefined)).toBe(DEFAULT_LOYALTY_COOLDOWN_MS);
    expect(resolveLoyaltyCooldownMs({})).toBe(DEFAULT_LOYALTY_COOLDOWN_MS);
    expect(resolveLoyaltyCooldownMs({ loyalty: {} })).toBe(DEFAULT_LOYALTY_COOLDOWN_MS);
  });

  it("convertit creditCooldownMin (minutes) en ms", () => {
    expect(resolveLoyaltyCooldownMs({ loyalty: { creditCooldownMin: 5 } })).toBe(300_000);
    expect(resolveLoyaltyCooldownMs({ loyalty: { creditCooldownMin: 1.5 } })).toBe(90_000);
  });

  it("0 désactive explicitement le cooldown", () => {
    expect(resolveLoyaltyCooldownMs({ loyalty: { creditCooldownMin: 0 } })).toBe(0);
  });

  it("valeur non numérique (NaN) ou négative → défaut", () => {
    expect(resolveLoyaltyCooldownMs({ loyalty: { creditCooldownMin: -3 } })).toBe(DEFAULT_LOYALTY_COOLDOWN_MS);
    expect(resolveLoyaltyCooldownMs({ loyalty: { creditCooldownMin: "abc" } })).toBe(DEFAULT_LOYALTY_COOLDOWN_MS);
  });

  it("null/chaîne vide coercent à 0 (Number()) → cooldown désactivé, PAS le défaut", () => {
    // Subtilité Number() : Number(null)===0, Number("")===0 → traités comme 0 (off).
    // Seuls undefined/NaN/négatif retombent sur le défaut. Documenté ici à dessein.
    expect(resolveLoyaltyCooldownMs({ loyalty: { creditCooldownMin: null } })).toBe(0);
    expect(resolveLoyaltyCooldownMs({ loyalty: { creditCooldownMin: "" } })).toBe(0);
  });
});
