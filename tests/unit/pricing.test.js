// 💰 Tests unitaires — prix unitaires autorisés (anti-fraude F1). PUR.
// Couvre lib/pricing.js → allowedUnitPriceCents : l'ensemble des prix (en CENTIMES)
// qu'un article peut légitimement coûter (base + base+menu, par taille). Le reste de
// pricing (priceCartItems / computeAuthoritativeOrder) lit Firestore → harness intégration.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { allowedUnitPriceCents } = require("../../functions/lib/pricing.js");

describe("allowedUnitPriceCents", () => {
  it("prix simple → {base, base+menu(2.5€ défaut)} en centimes", () => {
    const set = allowedUnitPriceCents({ prix: 10 });
    expect(set instanceof Set).toBe(true);
    expect([...set].sort((a, b) => a - b)).toEqual([1000, 1250]);
  });

  it("menuPriceAdd personnalisé remplace le défaut", () => {
    const set = allowedUnitPriceCents({ prix: 10, menuPriceAdd: 3 });
    expect([...set].sort((a, b) => a - b)).toEqual([1000, 1300]);
  });

  it("plusieurs tailles → base + base+menu pour chacune", () => {
    const set = allowedUnitPriceCents({ tailles: [{ prix: 8 }, { prix: 12 }] });
    expect([...set].sort((a, b) => a - b)).toEqual([800, 1050, 1200, 1450]);
  });

  it("les tailles priment sur le prix simple quand présentes", () => {
    const set = allowedUnitPriceCents({ prix: 99, tailles: [{ prix: 5 }] });
    expect([...set].sort((a, b) => a - b)).toEqual([500, 750]);
  });

  it("arrondi correct des centimes (pas de flottant qui fuit)", () => {
    // menuPriceAdd:0 est falsy → retombe sur le défaut 2.5 € (|| 2.5).
    const set = allowedUnitPriceCents({ prix: 9.99, menuPriceAdd: 0 });
    expect([...set].sort((a, b) => a - b)).toEqual([999, 1249]);
  });

  it("base non numérique → ignorée (ensemble vide)", () => {
    const set = allowedUnitPriceCents({ prix: "gratuit" });
    expect(set.size).toBe(0);
  });
});
