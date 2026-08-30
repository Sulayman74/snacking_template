// 🛡️ Tests unitaires — Gendarme Marketing (canSendMarketingPush). Module PUR.
// Vérifie l'arbitrage : opt-out > cooldown 72h > quiet hours. Aucune dépendance
// Firestore (le Gendarme est une logique pure, testable sans émulateur).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  canSendMarketingPush,
  MARKETING_COOLDOWN_MS,
} = require("../../functions/lib/pushGovernance.js");

const NOW = 1_700_000_000_000; // timestamp fixe pour la reproductibilité
const HOUR = 60 * 60 * 1000;

describe("canSendMarketingPush (Gendarme)", () => {
  it("autorise un user sans historique de push", () => {
    const result = canSendMarketingPush({}, {}, NOW);
    expect(result).toEqual({ allowed: true, reason: null });
  });

  it("bloque un user opt-out (priorité 1, toujours respecté)", () => {
    const result = canSendMarketingPush({ pushOptOut: true }, {}, NOW);
    expect(result).toEqual({ allowed: false, reason: "opt-out" });
  });

  it("bloque si lastMarketingPushAt < 72h (nombre brut)", () => {
    const user = { lastMarketingPushAt: NOW - 2 * HOUR }; // il y a 2h
    const result = canSendMarketingPush(user, {}, NOW);
    expect(result).toEqual({ allowed: false, reason: "cooldown-72h" });
  });

  it("autorise si lastMarketingPushAt > 72h (nombre brut)", () => {
    const user = { lastMarketingPushAt: NOW - 73 * HOUR }; // il y a 73h
    const result = canSendMarketingPush(user, {}, NOW);
    expect(result).toEqual({ allowed: true, reason: null });
  });

  it("supporte lastMarketingPushAt en Timestamp Firestore (toMillis)", () => {
    // Simule un Timestamp Firestore avec toMillis()
    const fakeTimestamp = { toMillis: () => NOW - 1 * HOUR };
    const user = { lastMarketingPushAt: fakeTimestamp };
    const result = canSendMarketingPush(user, {}, NOW);
    expect(result).toEqual({ allowed: false, reason: "cooldown-72h" });
  });

  it("bloque en quiet hours si gouvernance activée", () => {
    // NOW converti en Date → on calcule l'heure UTC pour configurer les bornes
    const nowDate = new Date(NOW);
    const h = nowDate.getUTCHours();
    // Fenêtre de silence qui couvre l'heure courante (h-1 → h+1 en UTC)
    const snack = {
      pushGovernance: true,
      pushQuietStart: (h - 1 + 24) % 24,
      pushQuietEnd: (h + 1) % 24,
      pushTimezone: "UTC",
    };
    // User sans cooldown ni opt-out
    const user = { lastMarketingPushAt: NOW - 100 * HOUR };
    const result = canSendMarketingPush(user, snack, NOW);
    expect(result).toEqual({ allowed: false, reason: "quiet-hours" });
  });

  it("autorise en quiet hours si gouvernance DÉSACTIVÉE (non-régression)", () => {
    const nowDate = new Date(NOW);
    const h = nowDate.getUTCHours();
    const snack = {
      pushGovernance: false, // gouvernance OFF → quiet hours ignorées
      pushQuietStart: (h - 1 + 24) % 24,
      pushQuietEnd: (h + 1) % 24,
      pushTimezone: "UTC",
    };
    const user = { lastMarketingPushAt: NOW - 100 * HOUR };
    const result = canSendMarketingPush(user, snack, NOW);
    expect(result).toEqual({ allowed: true, reason: null });
  });

  it("opt-out prime sur le cooldown (ordre de vérification)", () => {
    // Un user opt-out ET avec un cooldown dépassé → quand même bloqué
    const user = { pushOptOut: true, lastMarketingPushAt: NOW - 200 * HOUR };
    const result = canSendMarketingPush(user, {}, NOW);
    expect(result).toEqual({ allowed: false, reason: "opt-out" });
  });

  it("la constante MARKETING_COOLDOWN_MS vaut 72 heures", () => {
    expect(MARKETING_COOLDOWN_MS).toBe(72 * 60 * 60 * 1000);
  });
});
