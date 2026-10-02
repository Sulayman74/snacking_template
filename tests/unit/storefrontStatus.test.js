// @vitest-environment jsdom
// 🚦 Tests unitaires — état de la boutique (audit UX-5) : ce que la pastille
// affiche et ce que le paiement accepte, sur le VRAI module.
import { describe, it, expect } from "vitest";
import { getStorefrontStatus, pauseStatus, CLOSING_SOON_MIN } from "../../src/core/storefrontStatus.js";
import { statusMessage, statusSentence } from "../../src/ui/statusMessage.js";

const week = Array.from({ length: 7 }, () => ({ open: "11:00", close: "22:00", closed: false }));
const cfg = ({ features, ...over } = {}) => ({
  hours: week,
  timezone: "Europe/Paris",
  delivery: { prepBaseMin: 12 },
  ...over,
  features: { enableClickAndCollect: true, enableDelivery: true, ...features },
});
const at = (iso) => new Date(iso);
const PARIS_20H = "2026-09-23T18:00:00Z"; // mercredi 20:00 à Paris

describe("getStorefrontStatus", () => {
  it("ouvert en plein service → rien à signaler", () => {
    const s = getStorefrontStatus(cfg(), at(PARIS_20H));
    expect(s).toMatchObject({ kind: "open", canOrder: true, canOrderNow: true });
    expect(statusMessage(s)).toBeNull();
  });

  it(`dans les ${CLOSING_SOON_MIN} min avant l'heure limite → « Dernières commandes à 21:30 »`, () => {
    const s = getStorefrontStatus(cfg({ lastOrderMinutesBeforeClose: 30 }), at("2026-09-23T19:20:00Z")); // 21:20
    expect(s).toMatchObject({ kind: "closing_soon", canOrder: true, canOrderNow: true });
    expect(statusMessage(s).title).toBe("Dernières commandes à 21:30");
  });

  it("fermé le matin, retrait : commande programmable pour la réouverture", () => {
    const s = getStorefrontStatus(cfg(), at("2026-09-23T06:00:00Z")); // 08:00
    expect(s).toMatchObject({ kind: "closed_schedule", canOrder: true, canOrderNow: false });
    expect(statusMessage(s)).toEqual({
      title: "Fermé · réouvre à 11:00",
      detail: "Commandez maintenant pour un retrait dès 11:15.",
    });
  });

  it("fermé tard le soir, retrait : pas de créneau dans l'horizon → bloqué, réouverture affichée", () => {
    const s = getStorefrontStatus(cfg(), at("2026-09-23T21:00:00Z")); // 23:00
    expect(s).toMatchObject({ kind: "closed", canOrder: false });
    expect(statusSentence(s)).toBe("Fermé · réouvre demain à 11:00");
  });

  it("fermé, livraison : bloqué (pas de livraison programmée)", () => {
    const s = getStorefrontStatus(cfg(), at("2026-09-23T21:00:00Z"), { mode: "delivery" });
    expect(s).toMatchObject({ kind: "closed", canOrder: false });
    expect(statusSentence(s)).toBe("Fermé · réouvre demain à 11:00");
  });

  it("heure limite passée → « Commandes closes pour ce service »", () => {
    const s = getStorefrontStatus(cfg({ lastOrderMinutesBeforeClose: 30 }), at("2026-09-23T19:45:00Z"), { mode: "delivery" });
    expect(statusMessage(s).title).toMatch(/^Commandes closes pour ce service/);
  });

  it("cuisine en pause → bloqué même si un créneau existe, heure du snack", () => {
    const s = getStorefrontStatus(cfg({ servicePausedUntil: { toDate: () => at("2026-09-23T18:20:00Z") } }), at(PARIS_20H));
    expect(s).toMatchObject({ kind: "paused", canOrder: false });
    expect(statusSentence(s)).toBe("Cuisine en pause jusqu'à 20:20. Forte affluence : les commandes reprennent à 20:20.");
  });

  it("pause expirée → ouvert", () => {
    const s = getStorefrontStatus(cfg({ servicePausedUntil: at("2026-09-23T17:00:00Z") }), at(PARIS_20H));
    expect(s.kind).toBe("open");
    expect(pauseStatus(cfg({ servicePausedUntil: at("2026-09-23T17:00:00Z") }), at(PARIS_20H))).toBeNull();
  });

  it.each([
    [{ features: { maintenanceMode: true, enableClickAndCollect: true } }, "maintenance"],
    [{ features: { enableOnlineOrder: false, enableClickAndCollect: true } }, "offline"],
    [{ features: { enableClickAndCollect: false } }, "mode_disabled"],
  ])("%j → %s, bloqué", (over, kind) => {
    expect(getStorefrontStatus(cfg(over), at(PARIS_20H))).toMatchObject({ kind, canOrder: false });
  });

  it("horaires non configurés → ouvert (comme le serveur)", () => {
    expect(getStorefrontStatus(cfg({ hours: [] }), at(PARIS_20H)).kind).toBe("open");
  });
});
