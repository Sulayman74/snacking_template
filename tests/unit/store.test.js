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

  it("rushMode: exclut les sides/accompagnements (cuisson), garde boissons/desserts", () => {
    store.setMenu(menu);
    const ids = store.getUpsellSuggestions(10, { rushMode: true }).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["dessert1", "drink1"]));
    expect(ids).not.toContain("side1");
  });

  it("rushMode false (et défaut) garde les sides → non-régression", () => {
    store.setMenu(menu);
    expect(store.getUpsellSuggestions(10, { rushMode: false }).map((p) => p.id)).toContain("side1");
    // Signature rétrocompatible : appel sans 2e argument inchangé.
    expect(store.getUpsellSuggestions(10).map((p) => p.id)).toContain("side1");
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

describe("Store.validateAgainstMenu (revalidation re-commande — LOT A)", () => {
  const menu = [
    { id: "tacos1", prix: 8, menuPriceAdd: 2.5, isAvailable: true, image: "tacos.webp" },
    { id: "burger1", prix: 7, isAvailable: false },
    {
      id: "pizza1",
      prix: 10,
      isAvailable: true,
      tailles: [
        { nom: "M", prix: 10 },
        { nom: "XL", prix: 14 },
      ],
    },
  ];
  beforeEach(() => store.setMenu(menu));

  it("produit retiré de la carte → missing, pas d'item", () => {
    const r = store.validateAgainstMenu({ productId: "fantome", prix: 5 });
    expect(r).toEqual({ ok: false, reason: "missing", currentItem: null });
  });

  it("produit épuisé (isAvailable === false) → unavailable", () => {
    const r = store.validateAgainstMenu({ productId: "burger1", prix: 7 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unavailable");
  });

  it("favori valide au même prix → ok sans reason", () => {
    const r = store.validateAgainstMenu({ productId: "tacos1", prix: 8, formule: "seul" });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.currentItem.prix).toBe(8);
  });

  it("prix changé → reprice avec le PRIX COURANT (jamais le snapshot)", () => {
    const r = store.validateAgainstMenu({ productId: "tacos1", prix: 6.5, formule: "seul" });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("reprice");
    expect(r.currentItem.prix).toBe(8);
  });

  it("formule menu → base + menuPriceAdd (réplique product-modal)", () => {
    const r = store.validateAgainstMenu({ productId: "tacos1", prix: 10.5, formule: "menu" });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.currentItem.prix).toBe(10.5);
  });

  it("taille choisie → prix de la taille courante", () => {
    const r = store.validateAgainstMenu({ productId: "pizza1", prix: 14, taille: "XL" });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.currentItem.prix).toBe(14);
  });

  it("taille disparue du produit → missing", () => {
    const r = store.validateAgainstMenu({ productId: "pizza1", prix: 18, taille: "XXL" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing");
  });

  it("retrouve le produit via l'id panier composé quand productId absent", () => {
    const r = store.validateAgainstMenu({ id: "tacos1-seul--", prix: 8 });
    expect(r.ok).toBe(true);
  });

  it("rafraîchit l'image depuis le menu courant", () => {
    const r = store.validateAgainstMenu({ productId: "tacos1", prix: 8, image: "vieille.jpg" });
    expect(r.currentItem.image).toBe("tacos.webp");
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
