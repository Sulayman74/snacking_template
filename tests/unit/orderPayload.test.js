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
  soda_epuise: { snackId: "snackA", nom: "Soda", prix: 2, tvaRate: 5.5, isAvailable: false },
  oeuf_epuise: { snackId: "snackA", nom: "Oeuf", prix: 1, tvaRate: 10, isAvailable: false },
  pizza: { snackId: "snackA", nom: "Pizza", tailles: [{ nom: "Senior", prix: 10 }, { nom: "Mega", prix: 14 }], tvaRate: 10 },
  canette: { snackId: "snackA", nom: "Canette", prix: 2, tvaRate: 5.5 },
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
const { priceCartItems, computeAuthoritativeOrder } = createRequire(import.meta.url)("../../functions/lib/pricing.js");
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

describe("computeAuthoritativeOrder — le snack accepte-t-il la commande ?", () => {
  const cart = () => buildOrderItemsPayload([cartItem()]);
  const run = (snackData, mode = "collect") =>
    computeAuthoritativeOrder(snackData, "snackA", cart(), mode, mode === "delivery" ? { lat: 45, lng: 6 } : null);

  it("snack legacy sans aucun flag → commandable (pas de régression)", async () => {
    await expect(run({})).resolves.toMatchObject({ itemsCents: 2900 });
  });

  it("flags actifs → commandable en collect et en livraison", async () => {
    const snack = { enableOnlineOrder: true, enableClickAndCollect: true, enableDelivery: true };
    await expect(run(snack)).resolves.toBeTruthy();
    await expect(run(snack, "delivery")).resolves.toBeTruthy();
  });

  it.each([
    [{ maintenanceMode: true }, "collect", /indisponible/],
    [{ enableOnlineOrder: false }, "collect", /commande en ligne est désactivée/],
    [{ enableClickAndCollect: false }, "collect", /Click & Collect est désactivé/],
    [{ enableDelivery: false }, "delivery", /livraison est désactivée/],
  ])("REJETTE %j en %s", async (snack, mode, msg) => {
    await expect(run(snack, mode)).rejects.toThrow(msg);
  });

  it("Click & Collect coupé n'empêche pas la livraison (et inversement)", async () => {
    await expect(run({ enableClickAndCollect: false }, "delivery")).resolves.toBeTruthy();
    await expect(run({ enableDelivery: false }, "collect")).resolves.toBeTruthy();
  });
});

describe("priceCartItems — stock", () => {
  it("REJETTE un produit épuisé (panier localStorage périmé)", async () => {
    const item = { productId: "soda_epuise", nom: "Soda", prix: 2, quantity: 1 };
    await expect(priceCartItems([item], "snackA")).rejects.toThrow(/Soda.*épuisé/);
  });

  it("REJETTE un supplément épuisé", async () => {
    const item = cartItem({ prix: 13, supplements: [{ productId: "oeuf_epuise", nom: "Oeuf", prix: 1 }] });
    await expect(priceCartItems(buildOrderItemsPayload([item]), "snackA")).rejects.toThrow(/Oeuf.*épuisé/);
  });
});

describe("priceCartItems — prix lié aux options déclarées", () => {
  const pizza = (over) => ({ productId: "pizza", nom: "Pizza", type: "seul", tailleChoisie: "Mega", prix: 14, quantity: 1, ...over });

  it("ACCEPTE la taille déclarée à son prix, seule ou en menu", async () => {
    await expect(priceCartItems([pizza()], "snackA")).resolves.toMatchObject({ itemsCents: 1400 });
    await expect(priceCartItems([pizza({ type: "menu", prix: 16.5 })], "snackA")).resolves.toMatchObject({ itemsCents: 1650 });
  });

  it("REJETTE « Mega » payée au prix « Senior »", async () => {
    await expect(priceCartItems([pizza({ prix: 10 })], "snackA")).rejects.toThrow(/Prix manipulé/);
  });

  it("REJETTE un menu payé au prix « seul »", async () => {
    await expect(priceCartItems([pizza({ type: "menu", prix: 14 })], "snackA")).rejects.toThrow(/Prix manipulé/);
  });

  it("REJETTE une taille inexistante ou absente sur un produit taillé", async () => {
    await expect(priceCartItems([pizza({ tailleChoisie: "XXL" })], "snackA")).rejects.toThrow(/Taille invalide/);
    await expect(priceCartItems([pizza({ tailleChoisie: null })], "snackA")).rejects.toThrow(/Taille invalide/);
  });

  it("REJETTE une formule inconnue", async () => {
    await expect(priceCartItems([pizza({ type: "gratuit" })], "snackA")).rejects.toThrow(/Formule invalide/);
  });
});

describe("priceCartItems — lignes de commande reconstruites serveur", () => {
  it("le nom vient de la base, pas du client (canette déclarée « Menu XXL »)", async () => {
    const item = { productId: "canette", nom: "Menu Tacos XXL + boisson", prix: 2, quantity: 1 };
    const { orderItems } = await priceCartItems([item], "snackA");
    expect(orderItems[0]).toMatchObject({ nom: "Canette", type: "seul", prix: 2, quantity: 1 });
  });

  it("menu : nom préfixé, boisson conservée, suppléments nommés depuis la base", async () => {
    const payload = buildOrderItemsPayload([cartItem({
      supplements: [{ productId: "cheddar", nom: "<b>Faux</b>", prix: 1 }, { productId: "bacon", nom: "Bacon", prix: 1.5 }],
    })]);
    const { orderItems } = await priceCartItems(payload, "snackA");
    expect(orderItems[0]).toMatchObject({
      productId: "burger", nom: "Menu Burger", type: "menu", boissonNom: "Coca", prix: 14.5, quantity: 2,
      supplements: [{ productId: "cheddar", nom: "Cheddar", prix: 1 }, { productId: "bacon", nom: "Bacon", prix: 1.5 }],
    });
  });

  it("formule seule : pas de boisson persistée ; options bornées", async () => {
    const item = {
      productId: "canette", prix: 2, quantity: 1, type: "seul", boissonNom: "Coca",
      sauces: Array.from({ length: 30 }, () => "x".repeat(80)), sansCrudites: [42, "Oignons"],
    };
    const { orderItems } = await priceCartItems([item], "snackA");
    expect(orderItems[0].boissonNom).toBeNull();
    expect(orderItems[0].sauces).toHaveLength(15);
    expect(orderItems[0].sauces[0]).toHaveLength(50);
    expect(orderItems[0].sansCrudites).toEqual(["Oignons"]);
  });
});

describe("computeAuthoritativeOrder — horaires d'ouverture (fuseau du snack)", () => {
  const week = Array.from({ length: 7 }, () => ({ open: "11:00", close: "22:00", closed: false }));
  const run = (snackData, iso, enforceOpeningHours = true) =>
    computeAuthoritativeOrder(snackData, "snackA", buildOrderItemsPayload([cartItem()]), "collect", null, {
      enforceOpeningHours, now: new Date(iso),
    });

  it("ouvert (21:30 à Paris) → accepté", async () => {
    await expect(run({ hours: week }, "2026-09-23T19:30:00Z")).resolves.toBeTruthy();
  });

  it("fermé (22:30 à Paris) → rejet avec heure de réouverture", async () => {
    await expect(run({ hours: week }, "2026-09-23T20:30:00Z")).rejects.toThrow("Le restaurant est fermé. Réouverture demain à 11:00.");
  });

  it("serveur en UTC : 21:30 UTC = 23:30 Paris → fermé", async () => {
    await expect(run({ hours: week }, "2026-09-23T21:30:00Z")).rejects.toThrow(/fermé/);
  });

  it("fuseau du snack respecté (pushTimezone La Réunion : 17:30 UTC = 21:30 → ouvert)", async () => {
    await expect(run({ hours: week, pushTimezone: "Indian/Reunion" }, "2026-09-23T17:30:00Z")).resolves.toBeTruthy();
    await expect(run({ hours: week, pushTimezone: "Indian/Reunion" }, "2026-09-23T18:30:00Z")).rejects.toThrow(/fermé/);
  });

  it("dernière commande 30 min avant : 21:40 Paris → rejet « commandes closes »", async () => {
    await expect(run({ hours: week, lastOrderMinutesBeforeClose: 30 }, "2026-09-23T19:40:00Z"))
      .rejects.toThrow("Les commandes en ligne sont closes pour ce service (fermeture à 22:00). Réouverture demain à 11:00.");
    await expect(run({ hours: week, lastOrderMinutesBeforeClose: 30 }, "2026-09-23T19:20:00Z")).resolves.toBeTruthy();
  });

  it("horaires absents → pas de blocage (snack legacy)", async () => {
    await expect(run({}, "2026-09-23T01:00:00Z")).resolves.toBeTruthy();
  });

  it("finalisation (enforceOpeningHours false) → un client qui a payé juste avant la fermeture n'est pas rejeté", async () => {
    await expect(run({ hours: week }, "2026-09-23T20:00:30Z", false)).resolves.toBeTruthy();
  });
});

describe("computeAuthoritativeOrder — coordonnées de livraison persistées (DLV-1)", () => {
  const run = (livraison) =>
    computeAuthoritativeOrder({}, "snackA", buildOrderItemsPayload([cartItem()]), "delivery", livraison);

  it("complément et téléphone rejoignent la commande (nettoyés)", async () => {
    const { livraisonData } = await run({
      lat: 45, lng: 6, adresse: "18 Avenue de la libération 74300 Cluses",
      complement: "  3e étage, code 4521B  ", telephone: " 06 12 34 56 78 ",
    });
    expect(livraisonData).toMatchObject({
      adresse: "18 Avenue de la libération 74300 Cluses", complement: "3e étage, code 4521B", telephone: "06 12 34 56 78",
    });
  });

  it("absents (PWA en cache) → null, pas de chaîne vide persistée", async () => {
    const { livraisonData } = await run({ lat: 45, lng: 6, adresse: "x" });
    expect(livraisonData.complement).toBeNull();
    expect(livraisonData.telephone).toBeNull();
  });
});
