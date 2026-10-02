// 🕒 Tests unitaires — validation serveur du créneau « plus tard » (functions/lib/pickup.js).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolvePickupRequest } = require("../../functions/lib/pickup.js");

const hours = Array.from({ length: 7 }, () => ({ open: "11:00", close: "22:00", closed: false }));
const snack = { hours, delivery: { prepBaseMin: 12 } };
const paris = (iso) => new Date(`${iso}+02:00`).getTime();
const NOW = paris("2026-09-23T12:03:00");

describe("resolvePickupRequest", () => {
  it("absent ou « asap » → dès que possible (null)", () => {
    expect(resolvePickupRequest(undefined, snack, "collect", NOW)).toBeNull();
    expect(resolvePickupRequest({ mode: "asap" }, snack, "collect", NOW)).toBeNull();
  });

  it("créneau valide → heure promise et lancement = créneau − préparation du snack", () => {
    const heure = paris("2026-09-23T12:30:00");
    expect(resolvePickupRequest({ mode: "creneau", heure }, snack, "collect", NOW))
      .toEqual({ mode: "creneau", heureMs: heure, lancerAMs: heure - 12 * 60000 });
  });

  it("préparation par défaut 12 min si le snack n'en déclare pas", () => {
    const heure = paris("2026-09-23T12:30:00");
    expect(resolvePickupRequest({ mode: "creneau", heure }, { hours }, "collect", NOW).lancerAMs).toBe(heure - 12 * 60000);
  });

  it.each([
    ["hors grille", { mode: "creneau", heure: paris("2026-09-23T12:20:00") }, "collect", /plus disponible/],
    ["dans le passé", { mode: "creneau", heure: paris("2026-09-23T11:45:00") }, "collect", /plus disponible/],
    ["après la fermeture", { mode: "creneau", heure: paris("2026-09-23T23:00:00") }, "collect", /plus disponible/],
    ["en livraison", { mode: "creneau", heure: paris("2026-09-23T12:30:00") }, "delivery", /retrait sur place/],
    ["heure non numérique", { mode: "creneau", heure: "12:30" }, "collect", /Heure de retrait invalide/],
    ["mode inconnu", { mode: "demain" }, "collect", /Mode de retrait invalide/],
    ["pas un objet", "12:30", "collect", /Retrait invalide/],
  ])("refuse un créneau %s", (_, input, mode, msg) => {
    expect(() => resolvePickupRequest(input, snack, mode, NOW)).toThrow(msg);
  });

  it("snack sans horaires : aucun créneau accepté", () => {
    expect(() => resolvePickupRequest({ mode: "creneau", heure: paris("2026-09-23T12:30:00") }, {}, "collect", NOW)).toThrow(/plus disponible/);
  });
});
