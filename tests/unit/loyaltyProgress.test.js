// 🎁 Tests unitaires — progression vers le cadeau fidélité (src/core/loyaltyProgress.js, pur).
import { describe, it, expect } from "vitest";
import { progressSummary, LOYALTY_MAX_POINTS } from "../../src/core/loyaltyProgress.js";

describe("progressSummary", () => {
  it("palier en cours, commandes restantes, cadeaux prêts", () => {
    expect(progressSummary(7, 0)).toEqual({ progress: 7, max: 10, remaining: 3, ready: 0, ratio: 70 });
    expect(progressSummary(0, 1)).toEqual({ progress: 0, max: 10, remaining: 10, ready: 1, ratio: 0 });
    expect(LOYALTY_MAX_POINTS).toBe(10);
  });
  it("carte legacy ≥ 10 points : normalisée sans perte", () => {
    expect(progressSummary(23, 1)).toEqual({ progress: 3, max: 10, remaining: 7, ready: 3, ratio: 30 });
  });
  it("valeurs absentes ou invalides → 0", () => {
    expect(progressSummary(undefined, undefined)).toEqual({ progress: 0, max: 10, remaining: 10, ready: 0, ratio: 0 });
    expect(progressSummary("abc", -2)).toEqual({ progress: 0, max: 10, remaining: 10, ready: 0, ratio: 0 });
    expect(progressSummary(4.9, 0.9).progress).toBe(4);
  });
});
