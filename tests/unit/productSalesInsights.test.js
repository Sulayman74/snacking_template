import { describe, it, expect } from "vitest";
import {
  isCoreProduct,
  getOrderItems,
  analyzeProductSales,
  EXCLUDED_CATEGORIES,
} from "../../src/services/productSalesInsights.js";

describe("productSalesInsights — Règles Métier et Détection", () => {
  it("exclut formellement les boissons, desserts, suppléments et sauces de la sélection", () => {
    expect(isCoreProduct({ categorieId: "burgers", isAvailable: true })).toBe(true);
    expect(isCoreProduct({ categorieId: "tacos", isAvailable: true })).toBe(true);
    expect(isCoreProduct({ categorieId: "pizzas", isAvailable: true })).toBe(true);
    expect(isCoreProduct({ categorieId: "plats", isAvailable: true })).toBe(true);

    // Exclusions
    expect(isCoreProduct({ categorieId: "drinks", isAvailable: true })).toBe(false);
    expect(isCoreProduct({ categorieId: "boissons", isAvailable: true })).toBe(false);
    expect(isCoreProduct({ categorieId: "desserts", isAvailable: true })).toBe(false);
    expect(isCoreProduct({ categorieId: "supplements", isAvailable: true })).toBe(false);
    expect(isCoreProduct({ categorieId: "extras", isAvailable: true })).toBe(false);
    expect(isCoreProduct({ categorieId: "sauces", isAvailable: true })).toBe(false);
    expect(isCoreProduct({ categorieId: "sides", isAvailable: true })).toBe(false);

    // Produits épuisés
    expect(isCoreProduct({ categorieId: "burgers", isAvailable: false })).toBe(false);
  });

  it("extrait correctement les items de commande (items ou cartItems)", () => {
    const o1 = {
      items: [
        { productId: "b1", nom: "Burger Classic", quantity: 2, prix: 10 },
        { id: "t1-item", nom: "Tacos L", quantity: 1, prix: 9 },
      ],
    };
    const items1 = getOrderItems(o1);
    expect(items1.length).toBe(2);
    expect(items1[0].productId).toBe("b1");
    expect(items1[0].quantity).toBe(2);
    expect(items1[1].productId).toBe("t1"); // split '-'

    const o2 = {
      cartItems: [
        { id: "p1", nom: "Pizza 4F", quantity: 3, prix: 12 },
      ],
    };
    const items2 = getOrderItems(o2);
    expect(items2[0].productId).toBe("p1");
    expect(items2[0].quantity).toBe(3);
  });

  it("analyse les ventes et non-ventes en isolant les stars et les pépites dormantes", () => {
    const products = [
      { id: "b1", nom: "Burger Truffe", categorieId: "burgers", prix: 13.50, isAvailable: true },
      { id: "b2", nom: "Burger Bacon", categorieId: "burgers", prix: 11.00, isAvailable: true },
      { id: "t1", nom: "Tacos Maxi", categorieId: "tacos", prix: 9.50, isAvailable: true },
      // Hors catégorie (ne doivent pas être pris en compte)
      { id: "d1", nom: "Coca Cola", categorieId: "drinks", prix: 2.50, isAvailable: true },
      { id: "s1", nom: "Tiramisu", categorieId: "desserts", prix: 4.00, isAvailable: true },
      { id: "sup1", nom: "Cheddar Fondu", categorieId: "supplements", prix: 1.50, isAvailable: true },
    ];

    const orders = [
      {
        id: "ord-1",
        date: new Date(),
        items: [
          { productId: "b1", nom: "Burger Truffe", quantity: 4, prix: 13.50 },
          { productId: "d1", nom: "Coca Cola", quantity: 4, prix: 2.50 },
        ],
      },
      {
        id: "ord-2",
        date: new Date(),
        items: [
          { productId: "b1", nom: "Burger Truffe", quantity: 2, prix: 13.50 },
          { productId: "t1", nom: "Tacos Maxi", quantity: 1, prix: 9.50 },
        ],
      },
    ];

    const result = analyzeProductSales(products, orders);

    expect(result.totalCoreProducts).toBe(3); // b1, b2, t1 (hors boissons, desserts, suppléments)

    // Stars : b1 (6 ventes) et t1 (1 vente)
    expect(result.stars.length).toBe(2);
    expect(result.stars[0].id).toBe("b1");
    expect(result.stars[0].unitsSold).toBe(6);
    expect(result.stars[0].revenue).toBe(81);

    // Non-ventes : b2 (0 vente)
    expect(result.nonVentes.length).toBe(1);
    expect(result.nonVentes[0].id).toBe("b2");
    expect(result.nonVentes[0].unitsSold).toBe(0);

    // Suggestions générées
    expect(result.suggestions.length).toBeGreaterThanOrEqual(2);

    // Suggestion de relance sur la non-vente b2
    const sleeperSuggestion = result.suggestions.find((s) => s.type === "sleeper");
    expect(sleeperSuggestion).toBeDefined();
    expect(sleeperSuggestion.productId).toBe("b2");
    expect(sleeperSuggestion.push.title).toContain("Burger Bacon");
    expect(sleeperSuggestion.push.target).toBe("inactive");

    // Suggestion star sur b1
    const starSuggestion = result.suggestions.find((s) => s.type === "star");
    expect(starSuggestion).toBeDefined();
    expect(starSuggestion.productId).toBe("b1");
    expect(starSuggestion.push.title).toContain("Burger Truffe");
    expect(starSuggestion.push.target).toBe("all");
  });

  it("gère gracieusement le cas d'une carte vide ou sans commandes", () => {
    const emptyResult = analyzeProductSales([], []);
    expect(emptyResult.totalCoreProducts).toBe(0);
    expect(emptyResult.stars).toEqual([]);
    expect(emptyResult.nonVentes).toEqual([]);
    expect(emptyResult.suggestions).toEqual([]);

    const noOrdersResult = analyzeProductSales(
      [{ id: "b1", nom: "Burger Solo", categorieId: "burgers", isAvailable: true }],
      []
    );
    expect(noOrdersResult.totalCoreProducts).toBe(1);
    expect(noOrdersResult.stars).toEqual([]);
    expect(noOrdersResult.nonVentes.length).toBe(1);
    expect(noOrdersResult.suggestions.length).toBe(1);
    expect(noOrdersResult.suggestions[0].type).toBe("sleeper");
  });
});
