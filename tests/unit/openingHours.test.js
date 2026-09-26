// 🕐 Tests unitaires — état d'ouverture dans le fuseau du snack.
// Contrat : les MÊMES cas tournent sur le jumeau front (ESM) et serveur (CJS),
// qui doivent rester strictement identiques.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import * as front from "../../src/core/openingHours.js";

const server = createRequire(import.meta.url)("../../functions/lib/openingHours.js");

const day = (open, close, extra = {}) => ({ open, close, closed: false, ...extra });
const closedDay = { open: "11:00", close: "22:00", closed: true };
const week = (d) => Array.from({ length: 7 }, () => ({ ...d }));

// 2026-09-23 = mercredi (index 2). Paris = UTC+2 en septembre (heure d'été).
const paris = (iso) => new Date(`${iso}+02:00`);

describe.each([["front (src/core)", front], ["serveur (functions/lib)", server]])("openingHours — %s", (_, H) => {
  it("localClock : heure et jour du SNACK, pas du serveur (UTC)", () => {
    // 22:30 UTC samedi = 00:30 dimanche à Paris
    expect(H.localClock(new Date("2026-09-26T22:30:00Z"), "Europe/Paris")).toEqual({ dayIndex: 6, minutes: 30 });
    // même instant à La Réunion (UTC+4) = 02:30
    expect(H.localClock(new Date("2026-09-26T22:30:00Z"), "Indian/Reunion")).toEqual({ dayIndex: 6, minutes: 150 });
  });

  it("heure d'hiver gérée (Paris = UTC+1 en décembre)", () => {
    expect(H.localClock(new Date("2026-12-02T10:00:00Z"), "Europe/Paris").minutes).toBe(11 * 60);
  });

  it("snackTimezone : timezone > pushTimezone > Europe/Paris, fuseau invalide ignoré", () => {
    expect(H.snackTimezone({ timezone: "America/Martinique", pushTimezone: "Europe/Paris" })).toBe("America/Martinique");
    expect(H.snackTimezone({ pushTimezone: "Indian/Reunion" })).toBe("Indian/Reunion");
    expect(H.snackTimezone({ timezone: "Mars/Olympus" })).toBe("Europe/Paris");
    expect(H.snackTimezone(null)).toBe("Europe/Paris");
  });

  it("ouvert en journée, avec minutes avant fermeture", () => {
    const s = H.getOpeningState(week(day("11:00", "22:00")), paris("2026-09-23T21:50:00"), "Europe/Paris");
    expect(s).toMatchObject({ configured: true, open: true, minutesToClose: 10, closeTime: "22:00" });
    expect(s).toMatchObject({ nextOpenTime: "11:00", nextOpenDayOffset: 1 });
  });

  it("fermé après la fermeture → réouverture demain", () => {
    const s = H.getOpeningState(week(day("11:00", "22:00")), paris("2026-09-23T22:00:00"), "Europe/Paris");
    expect(s).toMatchObject({ open: false, nextOpenTime: "11:00", nextOpenDayOffset: 1, minutesToOpen: 13 * 60 });
  });

  it("pause déjeuner : fermé pendant la coupure, réouverture aujourd'hui", () => {
    const hours = week(day("11:00", "22:00", { hasBreak: true, breakStart: "14:30", breakEnd: "18:00" }));
    expect(H.getOpeningState(hours, paris("2026-09-23T15:00:00"), "Europe/Paris"))
      .toMatchObject({ open: false, nextOpenTime: "18:00", nextOpenDayOffset: 0, minutesToOpen: 180 });
    expect(H.getOpeningState(hours, paris("2026-09-23T14:20:00"), "Europe/Paris"))
      .toMatchObject({ open: true, minutesToClose: 10, closeTime: "14:30" });
  });

  it("fermeture après minuit : ouvert à 00:30 grâce au créneau de la veille", () => {
    const s = H.getOpeningState(week(day("18:00", "01:00")), paris("2026-09-24T00:30:00"), "Europe/Paris");
    expect(s).toMatchObject({ open: true, minutesToClose: 30, closeTime: "01:00" });
  });

  it("jour fermé (lundi) → réouverture mardi", () => {
    const hours = week(day("11:00", "22:00"));
    hours[0] = closedDay;
    // dimanche 27/09 23:00 → lundi fermé → mardi 11:00
    const s = H.getOpeningState(hours, paris("2026-09-27T23:00:00"), "Europe/Paris");
    expect(s).toMatchObject({ open: false, nextOpenTime: "11:00", nextOpenDayOffset: 2 });
  });

  it("horaires absents ou mal formés → non configuré, on NE bloque PAS", () => {
    const now = paris("2026-09-23T03:00:00");
    for (const hours of [undefined, [], week(day("11:00", "22:00")).slice(0, 6), week(day("11h", "22:00")), week(day("", ""))]) {
      expect(H.getOpeningState(hours, now, "Europe/Paris")).toMatchObject({ configured: false, open: true });
    }
  });

  it("tous les jours fermés → fermé, sans réouverture", () => {
    const s = H.getOpeningState(week(closedDay), paris("2026-09-23T12:00:00"), "Europe/Paris");
    expect(s).toMatchObject({ configured: true, open: false, nextOpenTime: null, minutesToOpen: null });
  });

  it("dernière commande 30 min avant fermeture : 21:20 accepte, 21:30 refuse (cutoff)", () => {
    const hours = week(day("11:00", "22:00"));
    expect(H.getOrderingState(hours, paris("2026-09-23T21:20:00"), "Europe/Paris", 30))
      .toMatchObject({ accepting: true, reason: null, minutesToCutoff: 10, cutoffTime: "21:30", closeTime: "22:00" });
    expect(H.getOrderingState(hours, paris("2026-09-23T21:30:00"), "Europe/Paris", 30))
      .toMatchObject({ accepting: false, reason: "cutoff", open: true, nextOpenTime: "11:00" });
  });

  it("le cutoff s'applique aussi à la fin du service de midi", () => {
    const hours = week(day("11:00", "22:00", { hasBreak: true, breakStart: "14:30", breakEnd: "18:00" }));
    expect(H.getOrderingState(hours, paris("2026-09-23T14:10:00"), "Europe/Paris", 30))
      .toMatchObject({ accepting: false, reason: "cutoff", nextOpenTime: "18:00" });
  });

  it("fermé → reason closed ; non configuré → accepte toujours", () => {
    const hours = week(day("11:00", "22:00"));
    expect(H.getOrderingState(hours, paris("2026-09-23T23:00:00"), "Europe/Paris", 30)).toMatchObject({ accepting: false, reason: "closed" });
    expect(H.getOrderingState(undefined, paris("2026-09-23T23:00:00"), "Europe/Paris", 30)).toMatchObject({ accepting: true, reason: null });
  });

  it("normalizeLastOrderMinutes : valeurs invalides → 0 (à la fermeture)", () => {
    expect([30, 60, "45", 0, -5, 1.5, 999, "abc", null].map(H.normalizeLastOrderMinutes)).toEqual([30, 60, 45, 0, 0, 0, 0, 0, 0]);
  });

  it("le fuseau change le verdict (21:30 Paris = ouvert, même instant à La Réunion = 23:30 fermé)", () => {
    const hours = week(day("11:00", "22:00"));
    const instant = paris("2026-09-23T21:30:00");
    expect(H.getOpeningState(hours, instant, "Europe/Paris").open).toBe(true);
    expect(H.getOpeningState(hours, instant, "Indian/Reunion").open).toBe(false);
  });
});
