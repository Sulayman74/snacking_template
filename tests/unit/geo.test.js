// 📍 Tests unitaires — géo & helpers numériques (Haversine, géofence). Module PUR.
// Couvre lib/geo.js : source de vérité SERVEUR pour la distance livraison (pricing)
// et les paliers de notification livreur (géofencing).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { EARTH_RADIUS_KM, isFiniteNum, numberOrNull, haversineKm, bucketForServer } =
  require("../../functions/lib/geo.js");

describe("isFiniteNum", () => {
  it("ne valide que les nombres finis", () => {
    expect(isFiniteNum(5)).toBe(true);
    expect(isFiniteNum(0)).toBe(true);
    expect(isFiniteNum(-3.2)).toBe(true);
    expect(isFiniteNum(NaN)).toBe(false);
    expect(isFiniteNum(Infinity)).toBe(false);
    expect(isFiniteNum("5")).toBe(false);
    expect(isFiniteNum(null)).toBe(false);
  });
});

describe("numberOrNull", () => {
  it("convertit ce qui est numérique, sinon null", () => {
    expect(numberOrNull(5)).toBe(5);
    expect(numberOrNull("3.14")).toBe(3.14);
    expect(numberOrNull("42")).toBe(42);
    expect(numberOrNull("abc")).toBeNull();
    expect(numberOrNull(NaN)).toBeNull();
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
  });
});

describe("haversineKm", () => {
  it("≈ 0 pour deux points identiques", () => {
    const p = { lat: 48.8566, lng: 2.3522 };
    expect(haversineKm(p, p)).toBeCloseTo(0, 5);
  });

  it("Paris → Lyon ≈ 392 km (±5)", () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    const lyon = { lat: 45.764, lng: 4.8357 };
    expect(haversineKm(paris, lyon)).toBeGreaterThan(387);
    expect(haversineKm(paris, lyon)).toBeLessThan(397);
  });

  it("symétrique (A→B == B→A)", () => {
    const a = { lat: 48.85, lng: 2.35 };
    const b = { lat: 43.6, lng: 1.43 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it("NaN si une coordonnée est invalide ou absente", () => {
    expect(haversineKm(null, { lat: 1, lng: 2 })).toBeNaN();
    expect(haversineKm({ lat: 1, lng: 2 }, {})).toBeNaN();
    expect(haversineKm({ lat: "x", lng: 2 }, { lat: 1, lng: 2 })).toBeNaN();
  });

  it("EARTH_RADIUS_KM est la constante attendue", () => {
    expect(EARTH_RADIUS_KM).toBe(6371);
  });
});

describe("bucketForServer", () => {
  it("renvoie le plus petit palier >= distance", () => {
    expect(bucketForServer(250)).toBe(300);
    expect(bucketForServer(900)).toBe(1000);
    expect(bucketForServer(2500)).toBe(3000);
    expect(bucketForServer(0)).toBe(300);
  });

  it("bornes exactes incluses", () => {
    expect(bucketForServer(300)).toBe(300);
    expect(bucketForServer(1000)).toBe(1000);
    expect(bucketForServer(3000)).toBe(3000);
  });

  it("null au-delà du plus grand palier ou si non-fini", () => {
    expect(bucketForServer(3001)).toBeNull();
    expect(bucketForServer(99999)).toBeNull();
    expect(bucketForServer(NaN)).toBeNull();
    expect(bucketForServer(Infinity)).toBeNull();
  });

  it("respecte des seuils custom", () => {
    expect(bucketForServer(150, [500, 200])).toBe(200);
    expect(bucketForServer(600, [500, 200])).toBeNull();
  });
});
