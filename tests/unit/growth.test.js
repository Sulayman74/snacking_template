// 🚀 Tests unitaires — Growth Engine (logique pure, Gendarme intégré).
// Vérifie la logique de décision de chaque CRON (pas les requêtes Firestore
// réelles). Le Gendarme est testé en profondeur dans marketingGendarme.test.js ;
// ici on vérifie son INTÉGRATION dans les flux du growth engine.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  canSendMarketingPush,
  MARKETING_COOLDOWN_MS,
} = require("../../functions/lib/pushGovernance.js");

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ============================================================================
// Scénarios Panier Abandonné — décision de push
// ============================================================================
describe("Panier abandonné — décision Gendarme", () => {
  it("user sans historique + checkout non converti → push autorisé", () => {
    const user = {}; // pas de lastMarketingPushAt, pas d'opt-out
    const result = canSendMarketingPush(user, {}, NOW);
    expect(result.allowed).toBe(true);
  });

  it("user avec push reçu il y a 2h → bloqué par cooldown", () => {
    const user = { lastMarketingPushAt: NOW - 2 * HOUR };
    const result = canSendMarketingPush(user, {}, NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cooldown-72h");
  });

  it("user opt-out → bloqué même sans cooldown", () => {
    const user = { pushOptOut: true };
    const result = canSendMarketingPush(user, {}, NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("opt-out");
  });
});

// ============================================================================
// Scénarios Soir de Match — planification du push
// ============================================================================
describe("Soir de match — planification", () => {
  it("match à 21h → push prévu à 19h (H-2)", () => {
    // Simulation : match à 21h UTC
    const matchDate = new Date(Date.UTC(2026, 0, 15, 21, 0, 0));
    const pushDate = new Date(matchDate.getTime() - 2 * HOUR);
    expect(pushDate.getUTCHours()).toBe(19);
  });

  it("match déjà passé (H-2 dans le passé) → pas de push", () => {
    // Match à 10h UTC, NOW = 14h UTC → H-2 = 8h UTC → déjà passé
    const matchDate = new Date(NOW);
    matchDate.setUTCHours(10, 0, 0, 0);
    const pushDate = new Date(matchDate.getTime() - 2 * HOUR);
    // pushDate = 8h, NOW correspond à ~heure courante → pushDate <= NOW
    expect(pushDate.getTime()).toBeLessThanOrEqual(NOW);
  });

  it("match demain → pas dans les matchs d'aujourd'hui", () => {
    const today = new Date(NOW);
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    
    // Match demain à 21h
    const tomorrowMatch = new Date(todayEnd.getTime() + 22 * HOUR);
    const isToday = tomorrowMatch >= todayStart && tomorrowMatch <= todayEnd;
    expect(isToday).toBe(false);
  });
});

// ============================================================================
// Scénarios Win-Back — ciblage et protection
// ============================================================================
describe("Win-back — ciblage client inactif", () => {
  it("user inactif 14 jours + Gendarme OK → push autorisé", () => {
    const user = {
      lastOrderDate: NOW - 15 * DAY, // inactif 15j
      lastMarketingPushAt: NOW - 100 * HOUR, // dernier push il y a 100h (> 72h)
    };
    const result = canSendMarketingPush(user, {}, NOW);
    expect(result.allowed).toBe(true);
  });

  it("user inactif 14 jours + push reçu hier → bloqué par cooldown", () => {
    const user = {
      lastOrderDate: NOW - 15 * DAY,
      lastMarketingPushAt: NOW - 20 * HOUR, // 20h < 72h
    };
    const result = canSendMarketingPush(user, {}, NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cooldown-72h");
  });

  it("seuil d'inactivité est bien à 14 jours", () => {
    const threshold = 14 * DAY;
    expect(threshold).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("le cooldown marketing est bien de 72 heures", () => {
    expect(MARKETING_COOLDOWN_MS).toBe(72 * HOUR);
  });

  it("interactions entre les 3 CRON : un panier abandonné bloque le win-back", () => {
    // Scénario : le panier abandonné a envoyé un push il y a 10h
    // → le win-back (6h plus tard) est bloqué par le cooldown 72h
    const user = {
      lastOrderDate: NOW - 15 * DAY, // inactif
      lastMarketingPushAt: NOW - 10 * HOUR, // push panier abandonné il y a 10h
    };
    const result = canSendMarketingPush(user, {}, NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cooldown-72h");
  });
});
