// 🛠️ Tests unitaires — outils purs (génération de code, découpage). Module PUR.
// Couvre lib/util.js : generateSecretCode (mot de passe temporaire admin, code
// livreur) et chunkArray (batchs FCM ≤ 500 tokens dans le marketing push).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { generateSecretCode, chunkArray } = require("../../functions/lib/util.js");

describe("generateSecretCode", () => {
  it("longueur par défaut 6", () => {
    expect(generateSecretCode()).toHaveLength(6);
  });

  it("respecte la longueur demandée", () => {
    expect(generateSecretCode(10)).toHaveLength(10);
    expect(generateSecretCode(1)).toHaveLength(1);
    expect(generateSecretCode(0)).toHaveLength(0);
  });

  it("n'utilise que des caractères alphanumériques", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSecretCode(12)).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("génère des valeurs différentes (aléatoire)", () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateSecretCode(8)));
    // Collision quasi-impossible sur 100 tirages de 8 chars (62^8 d'espace).
    expect(codes.size).toBeGreaterThan(95);
  });
});

describe("chunkArray", () => {
  it("découpe en lots de la taille demandée", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("lot unique si size >= longueur", () => {
    expect(chunkArray([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
    expect(chunkArray([1], 5)).toEqual([[1]]);
  });

  it("tableau vide → []", () => {
    expect(chunkArray([], 3)).toEqual([]);
  });

  it("préserve l'ordre et tous les éléments", () => {
    const src = Array.from({ length: 1001 }, (_, i) => i); // > 2 batchs FCM (500)
    const chunks = chunkArray(src, 500);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(500);
    expect(chunks[2]).toEqual([1000]);
    expect(chunks.flat()).toEqual(src);
  });
});
