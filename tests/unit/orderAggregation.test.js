import { describe, it, expect } from "vitest";
import { computeOrderAggregation } from "../../functions/domains/order-aggregations.js";

describe("Agrégation Journalière & Métriques Upsell (computeOrderAggregation)", () => {
  it("calcule correctement une commande sans aucun article d'upsell", () => {
    const order = {
      total: 18.5,
      items: [
        { id: "tacos_xl", prix: 12.0, quantite: 1, viaUpsell: false },
        { id: "frites", prix: 6.5, quantite: 1 }
      ]
    };

    const res = computeOrderAggregation(order);
    expect(res.orderTotal).toBe(18.5);
    expect(res.upsellTotal).toBe(0);
    expect(res.hasUpsell).toBe(false);
    expect(res.upsellProductsSold).toEqual({});
  });

  it("isole le CA et les quantités vendues pour les articles viaUpsell", () => {
    const order = {
      total: 27.0,
      items: [
        { id: "burger_menu", productId: "burger_menu", prix: 15.0, quantite: 1, viaUpsell: false },
        { id: "tiramisu", productId: "tiramisu", prix: 4.0, quantite: 2, viaUpsell: true }, // +8.0€
        { id: "coca", productId: "coca", prix: 2.0, quantite: 2, viaUpsell: true }          // +4.0€
      ]
    };

    const res = computeOrderAggregation(order);
    expect(res.orderTotal).toBe(27.0);
    expect(res.upsellTotal).toBe(12.0);
    expect(res.hasUpsell).toBe(true);
    expect(res.upsellProductsSold).toEqual({
      tiramisu: { qty: 2, revenue: 8.0 },
      coca: { qty: 2, revenue: 4.0 }
    });
  });

  it("gère les commandes avec champs manquants ou panier vide sans crasher", () => {
    const res = computeOrderAggregation({});
    expect(res.orderTotal).toBe(0);
    expect(res.upsellTotal).toBe(0);
    expect(res.hasUpsell).toBe(false);
    expect(res.upsellProductsSold).toEqual({});
  });
});
