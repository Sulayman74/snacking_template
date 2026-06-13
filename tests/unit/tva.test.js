// 🧾 Tests unitaires — ventilation TVA (LOT A). Module PUR, sans émulateur.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ventilateTva, splitTtc, normalizeTvaRate, sumBreakdownTtc } = require("../../functions/lib/tva.js");

describe("normalizeTvaRate", () => {
  it("garde les presets 5.5 / 10 / 20", () => {
    expect(normalizeTvaRate(5.5)).toBe(5.5);
    expect(normalizeTvaRate(10)).toBe(10);
    expect(normalizeTvaRate(20)).toBe(20);
  });
  it("défaut 10 pour tout taux hors preset / absent", () => {
    expect(normalizeTvaRate(undefined)).toBe(10);
    expect(normalizeTvaRate(7)).toBe(10);
    expect(normalizeTvaRate("abc")).toBe(10);
  });
});

describe("splitTtc — HT + TVA depuis le TTC (centimes)", () => {
  it("10% : 1100 TTC → 1000 HT + 100 TVA", () => {
    expect(splitTtc(1100, 10)).toEqual({ ttc: 1100, ht: 1000, tva: 100 });
  });
  it("20% : 1200 TTC → 1000 HT + 200 TVA", () => {
    expect(splitTtc(1200, 20)).toEqual({ ttc: 1200, ht: 1000, tva: 200 });
  });
  it("invariant ht + tva === ttc (arrondi)", () => {
    const r = splitTtc(999, 5.5);
    expect(r.ht + r.tva).toBe(999);
  });
});

describe("ventilateTva — panier mixte + livraison", () => {
  it("panier 100% à 10% (collect)", () => {
    const b = ventilateTva([{ ttcCents: 2200, tvaRate: 10 }], 0);
    expect(b["10"]).toEqual({ ttc: 2200, ht: 2000, tva: 200 });
    expect(b["20"]).toBeUndefined();
    expect(b.livraison).toBeNull();
  });

  it("panier mixte 10% (plat) + 20% (bière) + livraison 10%", () => {
    const b = ventilateTva(
      [
        { ttcCents: 1100, tvaRate: 10 }, // plat
        { ttcCents: 600, tvaRate: 20 },  // bière
      ],
      350 // frais livraison
    );
    expect(b["10"].ttc).toBe(1100);
    expect(b["20"]).toEqual({ ttc: 600, ht: 500, tva: 100 });
    expect(b.livraison).toEqual({ rate: 10, ttc: 350, ht: 318, tva: 32 });
  });

  it("agrège plusieurs lignes du même taux", () => {
    const b = ventilateTva(
      [
        { ttcCents: 1100, tvaRate: 10 },
        { ttcCents: 550, tvaRate: 10 },
      ],
      0
    );
    expect(b["10"].ttc).toBe(1650);
  });

  it("taux absent/invalide → bucket 10 par défaut", () => {
    const b = ventilateTva([{ ttcCents: 1000, tvaRate: 7 }], 0);
    expect(b["10"].ttc).toBe(1000);
  });

  it("INVARIANT : Σ buckets TTC === total commande (articles + livraison)", () => {
    const lines = [
      { ttcCents: 1234, tvaRate: 10 },
      { ttcCents: 777, tvaRate: 20 },
      { ttcCents: 305, tvaRate: 5.5 },
    ];
    const fraisCents = 290;
    const total = 1234 + 777 + 305 + fraisCents;
    const b = ventilateTva(lines, fraisCents);
    expect(sumBreakdownTtc(b)).toBe(total);
  });

  it("ignore les lignes à TTC nul/négatif", () => {
    const b = ventilateTva([{ ttcCents: 0, tvaRate: 10 }, { ttcCents: -5, tvaRate: 20 }], 0);
    expect(Object.keys(b).filter((k) => k !== "livraison")).toHaveLength(0);
  });
});
