import { describe, it, expect } from "vitest";
import {
  haversineKm, isLatLng, etaPrepMin, etaTravelMin, quoteDelivery,
  bucketFor, shouldWritePosition, formatDistance, formatEta,
} from "../../src/services/geoService.js";

describe("haversineKm", () => {
  it("Paris ↔ Lyon ≈ 392 km", () => {
    const d = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 45.764, lng: 4.8357 });
    expect(d).toBeGreaterThan(390);
    expect(d).toBeLessThan(395);
  });
  it("même point → 0", () => {
    const p = { lat: 48.85, lng: 2.35 };
    expect(haversineKm(p, p)).toBe(0);
  });
  it("coordonnée invalide → NaN (l'appelant décide du fallback)", () => {
    expect(haversineKm({ lat: "x", lng: 2 }, { lat: 1, lng: 1 })).toBeNaN();
    expect(haversineKm(null, { lat: 1, lng: 1 })).toBeNaN();
  });
});

describe("isLatLng", () => {
  it("valide vs hors bornes / NaN / null", () => {
    expect(isLatLng({ lat: 45, lng: 4 })).toBe(true);
    expect(isLatLng({ lat: 91, lng: 4 })).toBe(false);
    expect(isLatLng({ lat: 45, lng: 200 })).toBe(false);
    expect(isLatLng({ lat: NaN, lng: 4 })).toBe(false);
    expect(isLatLng(null)).toBeFalsy(); // court-circuite à null (falsy = invalide)
  });
});

describe("etaPrepMin", () => {
  it("base + file × facteur, plancher 1, défaut 12", () => {
    expect(etaPrepMin(12, 0, 3)).toBe(12);
    expect(etaPrepMin(12, 4, 3)).toBe(24);
    expect(etaPrepMin(undefined, 0, 0)).toBe(12);
    expect(etaPrepMin(0, 0, 0)).toBe(1);
  });
});

describe("etaTravelMin", () => {
  it("distance/vitesse → minutes ; 0 si invalide", () => {
    expect(etaTravelMin(11, 22)).toBe(30);
    expect(etaTravelMin(0, 22)).toBe(0);
    expect(etaTravelMin(5, 0)).toBe(0);
  });
});

describe("quoteDelivery", () => {
  const resto = { lat: 46.06, lng: 6.59 };
  const near = { lat: 46.07, lng: 6.60 };
  it("dans le rayon → inRange true, frais de la config, jamais NaN", () => {
    const q = quoteDelivery({ resto, client: near, delivery: { radiusKm: 5, frais: 2.5, avgSpeedKmh: 22 } });
    expect(q.inRange).toBe(true);
    expect(q.frais).toBe(2.5);
    expect(q.distanceKm).toBeGreaterThan(0);
    expect(Number.isNaN(q.totalMin)).toBe(false);
  });
  it("hors rayon → inRange false", () => {
    const far = { lat: 45.76, lng: 4.83 };
    expect(quoteDelivery({ resto, client: far, delivery: { radiusKm: 5 } }).inRange).toBe(false);
  });
  it("resto non géocodé → ne bloque pas (inRange true, distance null)", () => {
    const q = quoteDelivery({ resto: { lat: null, lng: null }, client: near, delivery: { radiusKm: 5 } });
    expect(q.inRange).toBe(true);
    expect(q.distanceKm).toBeNull();
  });
});

describe("bucketFor", () => {
  it("palier décroissant franchi", () => {
    expect(bucketFor(2500)).toBe(3000);
    expect(bucketFor(900)).toBe(1000);
    expect(bucketFor(150)).toBe(300);
  });
  it("au-dessus du plus grand seuil ou non fini → null", () => {
    expect(bucketFor(5000)).toBeNull();
    expect(bucketFor(NaN)).toBeNull();
    expect(bucketFor(Infinity)).toBeNull();
  });
});

describe("shouldWritePosition", () => {
  it("premier point → true ; intervalle écoulé → true", () => {
    expect(shouldWritePosition(null, { lat: 1, lng: 1 }, 1000)).toBe(true);
    expect(shouldWritePosition({ lat: 1, lng: 1, t: 0 }, { lat: 1, lng: 1 }, 25000)).toBe(true);
  });
  it("trop proche ET trop tôt → false ; next invalide → false", () => {
    const prev = { lat: 46.06, lng: 6.59, t: 1000 };
    expect(shouldWritePosition(prev, { lat: 46.0601, lng: 6.5901 }, 2000)).toBe(false);
    expect(shouldWritePosition(null, { lat: "x", lng: 1 }, 1000)).toBe(false);
  });
});

describe("formatage FR", () => {
  it("formatDistance", () => {
    expect(formatDistance(0.3)).toBe("300 m");
    expect(formatDistance(1.2)).toBe("1,2 km");
    expect(formatDistance(NaN)).toBe("—");
  });
  it("formatEta", () => {
    expect(formatEta(15)).toBe("~15 min");
    expect(formatEta(65)).toBe("~1 h 05");
  });
});
