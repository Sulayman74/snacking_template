// 🧀 Tests unitaires — Moteur de suppléments / extras payants
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { allowedUnitPriceCents } = require("../../functions/lib/pricing.js");

describe("Moteur de Suppléments / Extras (pricing autoritatif)", () => {
  const burger = {
    nom: "Burger Classic",
    prix: 9.5,
    menuPriceAdd: 2.5,
  };

  const cheddar = { id: "supp_1", nom: "Cheddar Fondu", prix: 1.0 };
  const bacon = { id: "supp_2", nom: "Bacon de Bœuf", prix: 1.5 };
  const doubleSteak = { id: "supp_3", nom: "Double Steak", prix: 2.5 };

  it("produit seul sans supplément → prix de base et formule menu autorisés", () => {
    const set = allowedUnitPriceCents(burger, []);
    // 9.50 € = 950c, 9.50 + 2.50 = 1200c
    expect([...set].sort((a, b) => a - b)).toEqual([950, 1200]);
  });

  it("produit avec 1 supplément (Cheddar +1.00 €) → prix augmentés exactement de 1.00 €", () => {
    const set = allowedUnitPriceCents(burger, [cheddar]);
    // 9.50 + 1.00 = 10.50 € (1050c), 9.50 + 2.50 + 1.00 = 13.00 € (1300c)
    expect([...set].sort((a, b) => a - b)).toEqual([1050, 1300]);
  });

  it("produit avec suppléments multiples cumulés (Cheddar 1€ + Bacon 1.50€) → somme exacte", () => {
    const set = allowedUnitPriceCents(burger, [cheddar, bacon]);
    // Total suppléments = 2.50 €
    // Seul : 9.50 + 2.50 = 12.00 € (1200c)
    // Menu : 9.50 + 2.50 + 2.50 = 14.50 € (1450c)
    expect([...set].sort((a, b) => a - b)).toEqual([1200, 1450]);
  });

  it("pizza avec tailles multiples et suppléments → chaque taille augmentée du supplément", () => {
    const pizza = {
      nom: "Pizza Margherita",
      tailles: [
        { nom: "Senior", prix: 10.0 },
        { nom: "Mega", prix: 15.0 },
      ],
      menuPriceAdd: 2.5,
    };

    const set = allowedUnitPriceCents(pizza, [cheddar, doubleSteak]);
    // Total suppléments = 1.00 + 2.50 = 3.50 € (350c)
    // Senior : 1000 + 350 = 1350, Menu : 1000 + 250 + 350 = 1600
    // Mega : 1500 + 350 = 1850, Menu : 1500 + 250 + 350 = 2100
    expect([...set].sort((a, b) => a - b)).toEqual([1350, 1600, 1850, 2100]);
  });

  it("supplément avec prix personnalisé (ex: 0.80 €) → calcul en centimes exact sans erreur d'arrondi", () => {
    const customSupp = { id: "supp_custom", nom: "Sauce Truffe", prix: 0.8 };
    const set = allowedUnitPriceCents(burger, [customSupp]);
    // 9.50 + 0.80 = 10.30 € (1030c), 9.50 + 2.50 + 0.80 = 12.80 € (1280c)
    expect([...set].sort((a, b) => a - b)).toEqual([1030, 1280]);
  });

  it("tableau de suppléments invalide ou vide → fallback sécurisé sans crash", () => {
    const setNull = allowedUnitPriceCents(burger, null);
    const setUndef = allowedUnitPriceCents(burger, undefined);
    expect([...setNull].sort((a, b) => a - b)).toEqual([950, 1200]);
    expect([...setUndef].sort((a, b) => a - b)).toEqual([950, 1200]);
  });
});
