// 🛎️ Tests unitaires — textes des push cuisine (functions/lib/kitchenAlerts.js). Module PUR.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildNewOrderAlert, buildClientArrivingAlert, buildAutoReleaseAlert, buildPreparingNotification,
  buildPickupReminderNotification, buildKitchenOfflineAlert,
  isClientArrival, isScheduledLaunch,
} = require("../../functions/lib/kitchenAlerts.js");

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

describe("buildPreparingNotification (créneau lancé en cuisine)", () => {
  const order = { secretCode: "K7Q2", eta: { readyAt: { toDate: () => new Date("2026-09-23T10:30:00Z") } } };
  it("heure affichée dans le fuseau du snack (Functions en UTC)", () => {
    expect(buildPreparingNotification(order, "x", "Europe/Paris"))
      .toEqual({ title: "👨‍🍳 Votre commande est en préparation", body: "Code K7Q2 · prête vers 12:30" });
    expect(buildPreparingNotification(order, "x", "Indian/Reunion").body).toBe("Code K7Q2 · prête vers 14:30");
  });
  it("sans heure : seulement le code", () => {
    expect(buildPreparingNotification({ secretCode: "K7Q2" }, "x").body).toBe("Code K7Q2");
  });
});

describe("isScheduledLaunch", () => {
  it("programmée → à cuisiner uniquement", () => {
    expect(isScheduledLaunch({ statut: "programmee" }, { statut: "nouvelle" })).toBe(true);
    expect(isScheduledLaunch({ statut: "en_attente_client" }, { statut: "nouvelle" })).toBe(false);
    expect(isScheduledLaunch({ statut: "programmee" }, { statut: "terminee" })).toBe(false);
  });
});

describe("buildPickupReminderNotification", () => {
  it("rappelle où et avec quel code", () => {
    expect(buildPickupReminderNotification({ secretCode: "K7Q2" }, "x"))
      .toEqual({ title: "🍟 Votre commande vous attend", body: "Au comptoir · code K7Q2" });
  });
});

describe("buildKitchenOfflineAlert (gérant)", () => {
  it("dit combien de clients attendent et depuis quand l'écran est muet", () => {
    expect(buildKitchenOfflineAlert(2, 14)).toEqual({
      title: "📵 Écran cuisine hors ligne",
      body: "2 commandes à cuisiner en attente · dernier signe il y a 14 min",
    });
    expect(buildKitchenOfflineAlert(1, null).body).toBe("1 commande à cuisiner en attente · écran pas ouvert aujourd'hui");
  });
});
