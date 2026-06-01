// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { AdminStore } from "../../src/core/AdminStore.js";

let store;
beforeEach(() => { store = new AdminStore(); });

describe("AdminStore.validateProduct", () => {
  it("produit valide", () => {
    const r = store.validateProduct({ nom: "Burger", prix: 9.5, categorieId: "burgers" });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it("nom vide + prix négatif + catégorie absente → 3 erreurs", () => {
    const r = store.validateProduct({ nom: "  ", prix: -1, categorieId: "" });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBe(3);
  });
  it("taille sans nom → erreur", () => {
    const r = store.validateProduct({
      nom: "Pizza", prix: 0, categorieId: "pizzas",
      tailles: [{ nom: "", prix: 5 }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.toLowerCase().includes("taille"))).toBe(true);
  });
});

describe("AdminStore.validate (config + horaires)", () => {
  it("config absente → invalide", () => {
    expect(store.validate()).toEqual({ valid: false, errors: ["Configuration absente"] });
  });
  it("nom du snack manquant → invalide", () => {
    store.setConfig({ identity: { name: "" }, hours: [] });
    const r = store.validate();
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/nom du snack/i);
  });
  it("horaire open >= close → invalide", () => {
    store.setConfig({ identity: { name: "Test" }, hours: [{ day: "lundi", open: "22:00", close: "11:00", closed: false }] });
    expect(store.validate().valid).toBe(false);
  });
  it("config + horaires valides → valid true", () => {
    store.setConfig({ identity: { name: "Test" }, hours: [{ day: "lundi", open: "11:00", close: "22:00", closed: false }] });
    expect(store.validate().valid).toBe(true);
  });
});

describe("AdminStore.getSalesKPIs", () => {
  it("total/TVA(10%)/HT/moyenne depuis l'agrégat serveur", () => {
    store.setSalesAggregate({ count: 4, total: 100 });
    const k = store.getSalesKPIs();
    expect(k.total).toBe("100.00");
    expect(k.count).toBe(4);
    expect(k.avg).toBe("25.00");
    expect(k.tva).toBe("10.00");
    expect(k.ht).toBe("90.00");
  });
  it("aucune vente → 0 partout, jamais NaN", () => {
    const k = store.getSalesKPIs();
    expect(k.count).toBe(0);
    expect(k.avg).toBe("0.00");
    expect(k.total).toBe("0.00");
  });
});
