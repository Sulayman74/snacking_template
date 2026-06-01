// @vitest-environment jsdom
// (utils.js fait window.favoriteKey=… au top-level → besoin du DOM à l'import)
import { describe, it, expect } from "vitest";
import { favoriteKey } from "../../src/utils.js";

describe("favoriteKey (dédup des favoris / panier)", () => {
  it("ordre des sauces/crudités indifférent → même clé", () => {
    const a = { id: "burger", sauces: ["ketchup", "mayo"], sansCrudites: ["oignon"] };
    const b = { id: "burger", sauces: ["mayo", "ketchup"], sansCrudites: ["oignon"] };
    expect(favoriteKey(a)).toBe(favoriteKey(b));
  });
  it("formule / taille / boisson différentes → clés différentes", () => {
    const base = { id: "burger" };
    expect(favoriteKey({ ...base, formule: "menu" })).not.toBe(favoriteKey({ ...base, formule: "seul" }));
    expect(favoriteKey({ ...base, taille: "L" })).not.toBe(favoriteKey({ ...base, taille: "M" }));
    expect(favoriteKey({ ...base, boisson: "Coca" })).not.toBe(favoriteKey({ ...base, boisson: "Fanta" }));
  });
  it("productId prioritaire sur id", () => {
    expect(favoriteKey({ productId: "p1", id: "p1-abc" })).toBe(favoriteKey({ productId: "p1", id: "p1-xyz" }));
  });
  it("item null → chaîne vide", () => {
    expect(favoriteKey(null)).toBe("");
  });
});
