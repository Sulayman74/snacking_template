// 🔥 Tests unitaires — charge cuisine (helpers purs). PUR.
// Couvre lib/kitchen.js → computePrepMin & readCapacityConfig (défauts serveur sûrs,
// zéro migration). computeKitchenLoad/getKitchenQueueCount lisent Firestore → intégration.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { computePrepMin, readCapacityConfig } = require("../../functions/lib/kitchen.js");

describe("computePrepMin", () => {
  it("défauts serveur (base 12 + 3/commande en file)", () => {
    expect(computePrepMin({}, 0)).toBe(12);
    expect(computePrepMin({}, 3)).toBe(21);
    expect(computePrepMin(undefined, 0)).toBe(12);
  });

  it("utilise la config delivery quand fournie", () => {
    const snack = { delivery: { prepBaseMin: 10, queueFactorMin: 2 } };
    expect(computePrepMin(snack, 0)).toBe(10);
    expect(computePrepMin(snack, 5)).toBe(20);
  });

  it("plancher à 1 minute", () => {
    expect(computePrepMin({ delivery: { prepBaseMin: 0, queueFactorMin: 0 } }, 0)).toBe(1);
  });

  it("arrondit le résultat", () => {
    expect(computePrepMin({ delivery: { prepBaseMin: 12.4, queueFactorMin: 0 } }, 0)).toBe(12);
  });
});

describe("readCapacityConfig", () => {
  it("défauts sûrs si pas de capacity (zéro migration)", () => {
    expect(readCapacityConfig({})).toEqual({
      rushThreshold: 8,
      prepCeilingMin: 30,
      loadCacheTtlMs: 30_000,
    });
    expect(readCapacityConfig(undefined)).toEqual({
      rushThreshold: 8,
      prepCeilingMin: 30,
      loadCacheTtlMs: 30_000,
    });
  });

  it("lit la config snack et convertit le TTL en ms", () => {
    const cfg = readCapacityConfig({
      capacity: { rushThreshold: 5, prepCeilingMin: 20, loadCacheTtlSec: 60 },
    });
    expect(cfg).toEqual({ rushThreshold: 5, prepCeilingMin: 20, loadCacheTtlMs: 60_000 });
  });

  it("valeurs <= 0 ou non finies → défauts", () => {
    const cfg = readCapacityConfig({
      capacity: { rushThreshold: 0, prepCeilingMin: -5, loadCacheTtlSec: "x" },
    });
    expect(cfg).toEqual({ rushThreshold: 8, prepCeilingMin: 30, loadCacheTtlMs: 30_000 });
  });
});
