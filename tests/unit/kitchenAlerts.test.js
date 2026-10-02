// 🛎️ Tests unitaires — textes des push cuisine (functions/lib/kitchenAlerts.js). Module PUR.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildNewOrderAlert, buildClientArrivingAlert, buildAutoReleaseAlert, isClientArrival } = require("../../functions/lib/kitchenAlerts.js");

describe("buildNewOrderAlert", () => {
  it("client, total et mode lisibles (« À emporter », plus « Sur place »)", () => {
    expect(buildNewOrderAlert({ clientNom: "Léa", total: 12.4, mode: "collect" }))
      .toEqual({ title: "🛎️ Nouvelle commande", body: "Léa · 12.40 € · À emporter" });
    expect(buildNewOrderAlert({ clientNom: "Tom", total: 20, mode: "delivery" }).body).toBe("Tom · 20.00 € · Livraison");
  });

  it("champs manquants : pas de « undefined » ni de séparateur vide", () => {
    expect(buildNewOrderAlert({}).body).toBe("Client · À emporter");
  });
});

describe("buildClientArrivingAlert", () => {
  it("dit quoi faire et donne le code du ticket", () => {
    expect(buildClientArrivingAlert({ clientNom: "Léa", secretCode: "K7Q2" }, "abcdEFGH"))
      .toEqual({ title: "🏃 Client dans 5 min — lancez la cuisson", body: "Léa · code K7Q2" });
  });

  it("sans code : les 4 derniers caractères de la commande", () => {
    expect(buildClientArrivingAlert({}, "abcdefgh").body).toBe("Client · code EFGH");
  });
});

describe("isClientArrival", () => {
  it("seulement en_attente_client → nouvelle", () => {
    expect(isClientArrival({ statut: "en_attente_client" }, { statut: "nouvelle" })).toBe(true);
    expect(isClientArrival({ statut: "nouvelle" }, { statut: "prete" })).toBe(false);
    expect(isClientArrival({ statut: "en_attente_client" }, { statut: "annulee" })).toBe(false);
    expect(isClientArrival(undefined, { statut: "nouvelle" })).toBe(false);
  });
});

describe("buildAutoReleaseAlert (horloge des commandes)", () => {
  it("ne prétend pas que le client arrive : demande de lancer la commande", () => {
    expect(buildAutoReleaseAlert({ clientNom: "Léa", secretCode: "K7Q2" }, "x"))
      .toEqual({ title: "⏱️ Commande à lancer maintenant", body: "Léa · code K7Q2" });
  });
});
