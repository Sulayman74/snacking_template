// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../../src/core/Store.js";

let store;
beforeEach(() => {
  localStorage.clear();
  store = new Store();
});

describe("Store.getUpsellSuggestions (upsell)", () => {
  const menu = [
    { id: "burger1", categorieId: "burgers", isAvailable: true },
    { id: "dessert1", categorieId: "desserts", isAvailable: true },
    { id: "drink1", categorieId: "boissons", isAvailable: true },
    { id: "side1", categorieId: "accompagnements", isAvailable: true },
    { id: "drink2", categorieId: "drinks", isAvailable: false }, // épuisé
  ];

  it("ne suggère que desserts/boissons/sides DISPO (pas les burgers ni l'épuisé)", () => {
    store.setMenu(menu);
    const ids = store.getUpsellSuggestions(10).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["dessert1", "drink1", "side1"]));
    expect(ids).not.toContain("burger1");
    expect(ids).not.toContain("drink2");
  });

  it("respecte maxItems", () => {
    store.setMenu(menu);
    expect(store.getUpsellSuggestions(2)).toHaveLength(2);
  });

  it("exclut ce qui est déjà au panier (par productId)", () => {
    store.setMenu(menu);
    store.addToCart({ id: "dessert1", productId: "dessert1", nom: "Tarte" });
    expect(store.getUpsellSuggestions(10).map((p) => p.id)).not.toContain("dessert1");
  });

  it("menu vide → []", () => {
    expect(store.getUpsellSuggestions()).toEqual([]);
  });
});

describe("Store.getDeliveryFee", () => {
  it("mode collect → 0", () => {
    expect(store.getDeliveryFee()).toBe(0);
  });
  it("livraison dans la zone → frais de la config", () => {
    store.setDeliveryMode("delivery");
    store.setDeliveryQuote({ inRange: true, frais: 2.5 });
    expect(store.getDeliveryFee()).toBe(2.5);
  });
  it("livraison hors zone → 0", () => {
    store.setDeliveryMode("delivery");
    store.setDeliveryQuote({ inRange: false, frais: 2.5 });
    expect(store.getDeliveryFee()).toBe(0);
  });
});

describe("Store.addToCart / updateQuantity (jamais de NaN)", () => {
  it("même id ajouté 2× → quantité 2", () => {
    store.addToCart({ id: "a", prix: 5 });
    store.addToCart({ id: "a", prix: 5 });
    const cart = store.state.cart;
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
  });
  it("updateQuantity jusqu'à 0 → retire l'article", () => {
    store.addToCart({ id: "a", prix: 5 });
    store.updateQuantity("a", -1);
    expect(store.state.cart).toHaveLength(0);
  });
});
