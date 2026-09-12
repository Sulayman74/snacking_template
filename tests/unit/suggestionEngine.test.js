// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { calculateUpsellScoring } from "../../src/core/suggestionEngine.js";

describe("Moteur de Suggestion (calculateUpsellScoring)", () => {
  const menuMock = [
    { id: "burger1", nom: "Burger Classic", categorieId: "burgers", prix: 9.5, isAvailable: true, requiresCooking: true },
    { id: "drink_coca", nom: "Coca 33cl", categorieId: "boissons", prix: 2.0, isAvailable: true, requiresCooking: false },
    { id: "drink_hot_coffee", nom: "Café Espresso", categorieId: "boisson-chaude", prix: 1.5, isAvailable: true, requiresCooking: false },
    { id: "ice_cream", nom: "Glace Vanille", categorieId: "glace", prix: 3.5, isAvailable: true, requiresCooking: false },
    { id: "side_fries", nom: "Frites Maison", categorieId: "accompagnements", prix: 3.0, isAvailable: true, requiresCooking: true },
    { id: "tiramisu", nom: "Tiramisu", categorieId: "dessert", prix: 4.0, isAvailable: true, requiresCooking: false },
    { id: "out_of_stock", nom: "Donut", categorieId: "dessert", prix: 2.5, isAvailable: false, requiresCooking: false },
  ];

  it("exclut les produits indisponibles et ceux déjà au panier", () => {
    const cart = [{ productId: "drink_coca" }];
    const suggestions = calculateUpsellScoring(cart, menuMock);

    const ids = suggestions.map((p) => p.id);
    expect(ids).not.toContain("drink_coca"); // Déjà au panier
    expect(ids).not.toContain("out_of_stock"); // Épuisé
  });

  it("rushMode: exclut les produits demandant de la cuisson (requiresCooking ou sides)", () => {
    const suggestions = calculateUpsellScoring([], menuMock, { isRushMode: true });
    const ids = suggestions.map((p) => p.id);

    expect(ids).not.toContain("side_fries");
    expect(ids).not.toContain("burger1");
    expect(ids).toContain("drink_coca");
  });

  it("boost météo forte chaleur : privilégie boissons et glaces", () => {
    const suggestions = calculateUpsellScoring([], menuMock, {
      weatherCondition: "hot",
      currentHour: 15
    });

    const topIds = suggestions.slice(0, 2).map((p) => p.id);
    expect(topIds).toEqual(expect.arrayContaining(["ice_cream", "drink_coca"]));
  });

  it("boost météo hiver / froid : privilégie les boissons chaudes", () => {
    const suggestions = calculateUpsellScoring([], menuMock, {
      weatherCondition: "cold",
      currentHour: 8
    });

    expect(suggestions[0].id).toBe("drink_hot_coffee");
  });

  it("prend en compte la matrice d'association (Lift)", () => {
    const cart = [{ productId: "burger1" }];
    const associationsMatrix = {
      burger1: {
        tiramisu: 0.95,
        ice_cream: 0.1
      }
    };

    const suggestions = calculateUpsellScoring(cart, menuMock, {
      associationsMatrix,
      currentHour: 12
    });

    expect(suggestions[0].id).toBe("tiramisu");
  });

  it("ne retourne jamais plus de maxItems et gère un menu vide", () => {
    expect(calculateUpsellScoring([], [])).toEqual([]);
    const suggestions = calculateUpsellScoring([], menuMock, { maxItems: 2 });
    expect(suggestions).toHaveLength(2);
  });
});
