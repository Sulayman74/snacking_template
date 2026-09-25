// 🧾 Tests unitaires — payload panier client → validation prix serveur.
// Régression : SnackCheckout n'envoyait pas `supplements` alors que `prix` les
// incluait → priceCartItems rejetait « Prix manipulé » pour tout article avec
// supplément. On branche ici le VRAI payload client sur le VRAI priceCartItems.
import { describe, it, expect } from "vitest";
import Module, { createRequire } from "node:module";
import { buildOrderItemsPayload } from "../../src/core/orderPayload.js";

const PRODUITS = {
  burger: { snackId: "snackA", nom: "Burger", prix: 9.5, menuPriceAdd: 2.5, tvaRate: 10 },
  cheddar: { snackId: "snackA", nom: "Cheddar", prix: 1.0, tvaRate: 10 },
  bacon: { snackId: "snackA", nom: "Bacon", prix: 1.5, tvaRate: 10 },
  supp_autre_snack: { snackId: "snackB", nom: "Truffe", prix: 0.1, tvaRate: 10 },
};

const mockDb = {
  collection: () => ({ doc: (id) => ({ id }) }),
  getAll: async (...refs) =>
    refs.map(({ id }) => ({ id, exists: !!PRODUITS[id], data: () => PRODUITS[id] })),
};

// Interception ciblée de require("./admin") depuis functions/lib/pricing.js
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "./admin" && this.filename?.endsWith("functions/lib/pricing.js")) {
    return { db: mockDb };
  }
  return originalRequire.apply(this, arguments);
};
const { priceCartItems } = createRequire(import.meta.url)("../../functions/lib/pricing.js");
Module.prototype.require = originalRequire;

// Article tel que produit par product-modal.js#buildCartItem
const cartItem = (over = {}) => ({
  id: "burger-menu----",
  productId: "burger",
  nom: "Menu Burger",
  prix: 9.5 + 2.5 + 1.0 + 1.5,
  formule: "menu",
  boisson: "Coca",
  sauces: [],
  sansCrudites: [],
  taille: null,
  supplements: [
    { productId: "cheddar", nom: "Cheddar", prix: 1.0 },
    { productId: "bacon", nom: "Bacon", prix: 1.5 },
  ],
  quantity: 2,
  ...over,
});

describe("buildOrderItemsPayload", () => {
  it("transmet les suppléments (productId, nom, prix)", () => {
    const [p] = buildOrderItemsPayload([cartItem()]);
    expect(p.supplements).toEqual([
      { productId: "cheddar", nom: "Cheddar", prix: 1.0 },
      { productId: "bacon", nom: "Bacon", prix: 1.5 },
    ]);
    expect(p).toMatchObject({ productId: "burger", type: "menu", boissonNom: "Coca", quantity: 2, prix: 14.5 });
  });

  it("article sans supplément → tableau vide (legacy / reorder)", () => {
    const [p] = buildOrderItemsPayload([cartItem({ supplements: undefined, prix: 12 })]);
    expect(p.supplements).toEqual([]);
  });
});

describe("payload client → priceCartItems (serveur)", () => {
  it("ACCEPTE un menu avec 2 suppléments au prix exact", async () => {
    const { itemsCents } = await priceCartItems(buildOrderItemsPayload([cartItem()]), "snackA");
    expect(itemsCents).toBe(1450 * 2);
  });

  it("REJETTE si le prix client omet un supplément déclaré", async () => {
    await expect(priceCartItems(buildOrderItemsPayload([cartItem({ prix: 13 })]), "snackA"))
      .rejects.toThrow(/Prix manipulé/);
  });

  it("REJETTE un supplément d'un autre snack", async () => {
    const item = cartItem({
      prix: 12.1,
      supplements: [{ productId: "supp_autre_snack", nom: "Truffe", prix: 0.1 }],
    });
    await expect(priceCartItems(buildOrderItemsPayload([item]), "snackA"))
      .rejects.toThrow(/hors du restaurant/);
  });

  it("REJETTE plus de 20 suppléments sur un article", async () => {
    const supplements = Array.from({ length: 21 }, () => ({ productId: "cheddar", nom: "Cheddar", prix: 1 }));
    await expect(priceCartItems([{ ...buildOrderItemsPayload([cartItem()])[0], supplements }], "snackA"))
      .rejects.toThrow(/Trop de suppléments/);
  });
});
