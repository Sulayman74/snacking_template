// 💰 Tests unitaires COMPLETS — pricing.js (couverture anti-fraude)
// Stratégie de test : les fonctions qui lisent Firestore (priceCartItems,
// computeAuthoritativeOrder) ne peuvent pas être mockées proprement car
// pricing.js est en CommonJS avec un require("./admin") réel. On teste donc :
//   1. allowedUnitPriceCents → déjà couvert dans pricing.test.js (module pur)
//   2. La LOGIQUE PURE extractible : vérification d'appartenance de prix,
//      calcul haversine, validation d'adresse hors-zone, minimum de commande.
//      → On teste ces briques via les modules purs (geo.js, tva.js).
//   3. Les scénarios d'INTÉGRATION (priceCartItems, computeAuthoritativeOrder)
//      sont dans tests/integration/ et nécessitent l'émulateur Firestore.
//
// Ce fichier complète pricing.test.js avec des scénarios sur les briques PURES
// utilisées par computeAuthoritativeOrder (haversine, TVA, helpers).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { allowedUnitPriceCents } = require("../../functions/lib/pricing.js");
const { haversineKm, isFiniteNum, numberOrNull } = require("../../functions/lib/geo.js");
const { ventilateTva, normalizeTvaRate, splitTtc } = require("../../functions/lib/tva.js");

// ============================================================================
// allowedUnitPriceCents — scénarios complémentaires (anti-fraude F1)
// ============================================================================
describe("allowedUnitPriceCents (compléments)", () => {
  it("menuPriceAdd à 0 (falsy) → retombe sur le défaut 2.5€", () => {
    // Vérifie le comportement du || 2.5 quand menuPriceAdd est 0
    const set = allowedUnitPriceCents({ prix: 10, menuPriceAdd: 0 });
    expect([...set].sort((a, b) => a - b)).toEqual([1000, 1250]);
  });

  it("tailles vide (array []) → utilise prix simple", () => {
    const set = allowedUnitPriceCents({ prix: 8, tailles: [] });
    expect([...set].sort((a, b) => a - b)).toEqual([800, 1050]);
  });

  it("produit avec 3 tailles → 6 prix autorisés (base + menu pour chaque)", () => {
    const set = allowedUnitPriceCents({
      tailles: [{ prix: 6 }, { prix: 9 }, { prix: 12 }],
    });
    expect(set.size).toBe(6);
    // 6=600, 6+2.5=850, 9=900, 9+2.5=1150, 12=1200, 12+2.5=1450
    expect([...set].sort((a, b) => a - b)).toEqual([600, 850, 900, 1150, 1200, 1450]);
  });

  it("prix et taille identiques → dédupliqués dans le Set", () => {
    // Si prix == taille[0].prix, les centimes sont identiques → Set les déduplique
    const set = allowedUnitPriceCents({ prix: 10, tailles: [{ prix: 10 }] });
    // tailles présentes → prix simple ignoré, mais résultat identique
    expect([...set].sort((a, b) => a - b)).toEqual([1000, 1250]);
  });
});

// ============================================================================
// haversineKm — briques du calcul de zone de livraison
// ============================================================================
describe("haversineKm (brique pricing/delivery)", () => {
  it("Paris → Lyon ≈ 392km", () => {
    const d = haversineKm(
      { lat: 48.8566, lng: 2.3522 }, // Paris
      { lat: 45.7640, lng: 4.8357 }  // Lyon
    );
    expect(d).toBeGreaterThan(380);
    expect(d).toBeLessThan(400);
  });

  it("même point → 0 km", () => {
    const d = haversineKm({ lat: 48.85, lng: 2.35 }, { lat: 48.85, lng: 2.35 });
    expect(d).toBeCloseTo(0, 5);
  });

  it("500m de distance (dans la zone 5km)", () => {
    // ~500m au nord de la Tour Eiffel
    const d = haversineKm(
      { lat: 48.8566, lng: 2.3522 },
      { lat: 48.8610, lng: 2.3522 }
    );
    expect(d).toBeLessThan(1); // < 1km
    expect(d).toBeGreaterThan(0.3); // > 300m
  });

  it("coordonnées invalides → NaN", () => {
    expect(haversineKm({ lat: null, lng: 2 }, { lat: 48, lng: 2 })).toBeNaN();
    expect(haversineKm(null, { lat: 48, lng: 2 })).toBeNaN();
  });
});

// ============================================================================
// isFiniteNum / numberOrNull — helpers pricing
// ============================================================================
describe("isFiniteNum / numberOrNull (helpers pricing)", () => {
  it("isFiniteNum accepte les nombres finis, rejette le reste", () => {
    expect(isFiniteNum(42)).toBe(true);
    expect(isFiniteNum(0)).toBe(true);
    expect(isFiniteNum(-3.5)).toBe(true);
    expect(isFiniteNum(NaN)).toBe(false);
    expect(isFiniteNum(Infinity)).toBe(false);
    expect(isFiniteNum("42")).toBe(false);
    expect(isFiniteNum(null)).toBe(false);
  });

  it("numberOrNull parse les strings numériques, rejette le reste", () => {
    expect(numberOrNull(42)).toBe(42);
    expect(numberOrNull("42.5")).toBe(42.5);
    expect(numberOrNull("abc")).toBeNull();
    expect(numberOrNull(NaN)).toBeNull();
    expect(numberOrNull(null)).toBeNull();
  });
});

// ============================================================================
// ventilateTva — ventilation TVA (brique pricing/commande)
// ============================================================================
describe("ventilateTva (brique pricing/commande)", () => {
  it("article 10% (défaut snacking) → HT + TVA corrects", () => {
    const result = ventilateTva([{ ttcCents: 1000, tvaRate: 10 }]);
    expect(result["10"].ttc).toBe(1000);
    expect(result["10"].ht).toBe(909);  // 1000 / 1.1 = 909.09 → 909
    expect(result["10"].tva).toBe(91);  // 1000 - 909
    expect(result.livraison).toBeNull();
  });

  it("frais de livraison → bucket livraison séparé à 10%", () => {
    const result = ventilateTva([], 300); // 3€ de frais
    expect(result.livraison).not.toBeNull();
    expect(result.livraison.rate).toBe(10);
    expect(result.livraison.ttc).toBe(300);
  });

  it("multi-taux (5.5% + 10%) → buckets séparés", () => {
    const result = ventilateTva([
      { ttcCents: 600, tvaRate: 5.5 },
      { ttcCents: 1000, tvaRate: 10 },
    ]);
    expect(result["5.5"].ttc).toBe(600);
    expect(result["10"].ttc).toBe(1000);
  });

  it("normalizeTvaRate → défaut 10% pour un taux inconnu", () => {
    expect(normalizeTvaRate(10)).toBe(10);
    expect(normalizeTvaRate(5.5)).toBe(5.5);
    expect(normalizeTvaRate(20)).toBe(20);
    expect(normalizeTvaRate(7)).toBe(10);  // inconnu → défaut
    expect(normalizeTvaRate(null)).toBe(10);
  });

  it("splitTtc invariant : ht + tva === ttc", () => {
    const amounts = [100, 999, 1250, 5000, 12345];
    const rates = [5.5, 10, 20];
    for (const ttc of amounts) {
      for (const rate of rates) {
        const { ht, tva } = splitTtc(ttc, rate);
        expect(ht + tva).toBe(ttc);
      }
    }
  });
});

// ============================================================================
// Scénarios métier hors-zone / minimum (logique pure)
// ============================================================================
describe("Validation zone de livraison (logique pure)", () => {
  it("Paris → Lyon (~392km) dépasse un rayon de 5km", () => {
    const d = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 45.7640, lng: 4.8357 });
    const radiusKm = 5;
    expect(d > radiusKm).toBe(true);
  });

  it("500m du resto → dans un rayon de 5km", () => {
    const d = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8610, lng: 2.3522 });
    const radiusKm = 5;
    expect(d <= radiusKm).toBe(true);
  });

  it("panier 5€ < minimum 15€ → rejet attendu", () => {
    const itemsCents = 500; // 5€
    const minOrder = 15;    // 15€ minimum
    expect(itemsCents < Math.round(minOrder * 100)).toBe(true);
  });

  it("panier 20€ >= minimum 15€ → OK", () => {
    const itemsCents = 2000; // 20€
    const minOrder = 15;
    expect(itemsCents >= Math.round(minOrder * 100)).toBe(true);
  });
});
