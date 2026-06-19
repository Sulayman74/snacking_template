// 🛡️ Tests unitaires — gouvernance push anti-fatigue (LOT 5). Module PUR.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isQuietHours,
  isOptedOut,
  breakerTripped,
  isGovernanceEnabled,
  canSendToUser,
  pruneRecentPushes,
  localHour,
} = require("../../functions/lib/pushGovernance.js");

// Date à une heure UTC précise (tz "UTC" → localHour == heure UTC, déterministe).
const atUtc = (h) => new Date(Date.UTC(2026, 0, 15, h, 0, 0));

describe("isQuietHours (fenêtre wrap nuit 22→8)", () => {
  const snack = { pushQuietStart: 22, pushQuietEnd: 8, pushTimezone: "UTC" };
  it("silencieux à 23h et à 7h", () => {
    expect(isQuietHours(snack, atUtc(23))).toBe(true);
    expect(isQuietHours(snack, atUtc(7))).toBe(true);
  });
  it("bruyant à 12h et à 8h pile (borne exclue)", () => {
    expect(isQuietHours(snack, atUtc(12))).toBe(false);
    expect(isQuietHours(snack, atUtc(8))).toBe(false);
  });
  it("fenêtre normale (1→6)", () => {
    const s = { pushQuietStart: 1, pushQuietEnd: 6, pushTimezone: "UTC" };
    expect(isQuietHours(s, atUtc(3))).toBe(true);
    expect(isQuietHours(s, atUtc(6))).toBe(false);
    expect(isQuietHours(s, atUtc(23))).toBe(false);
  });
  it("fenêtre nulle (start===end) → jamais silencieux", () => {
    expect(isQuietHours({ pushQuietStart: 9, pushQuietEnd: 9, pushTimezone: "UTC" }, atUtc(9))).toBe(false);
  });
});

describe("localHour", () => {
  it("retourne l'heure UTC en tz UTC", () => {
    expect(localHour(atUtc(15), "UTC")).toBe(15);
  });
});

describe("isOptedOut", () => {
  it("true seulement si pushOptOut === true", () => {
    expect(isOptedOut({ pushOptOut: true })).toBe(true);
    expect(isOptedOut({ pushOptOut: false })).toBe(false);
    expect(isOptedOut({})).toBe(false);
  });
});

describe("isGovernanceEnabled", () => {
  it("OFF par défaut (non-régression)", () => {
    expect(isGovernanceEnabled({})).toBe(false);
    expect(isGovernanceEnabled({ pushGovernance: true })).toBe(true);
  });
});

describe("breakerTripped", () => {
  it("inactif sous l'échantillon minimum (50)", () => {
    expect(breakerTripped(40, 40, {})).toBe(false); // 100% mais < 50 traités
  });
  it("déclenche au-dessus du seuil par défaut (0.5)", () => {
    expect(breakerTripped(60, 100, {})).toBe(true);
    expect(breakerTripped(10, 100, {})).toBe(false);
  });
  it("respecte un seuil custom", () => {
    expect(breakerTripped(25, 100, { pushBreakerThreshold: 0.2 })).toBe(true);
    expect(breakerTripped(25, 100, { pushBreakerThreshold: 0.3 })).toBe(false);
  });
});

describe("canSendToUser (cap glissant)", () => {
  const now = 1_000_000_000_000;
  const day = 86_400_000;
  it("autorise sous le cap, refuse au cap", () => {
    const u = { pushLog: [now - day, now - 2 * day] }; // 2 dans les 7j
    expect(canSendToUser(u, { cap: 3, windowDays: 7 }, now)).toBe(true);
    expect(canSendToUser(u, { cap: 2, windowDays: 7 }, now)).toBe(false);
  });
  it("ignore les envois hors fenêtre", () => {
    const u = { pushLog: [now - 10 * day, now - 9 * day] }; // tous > 7j
    expect(canSendToUser(u, { cap: 1, windowDays: 7 }, now)).toBe(true);
  });
});

describe("pruneRecentPushes", () => {
  const now = 1_000_000_000_000;
  const day = 86_400_000;
  it("élague le hors-fenêtre et ajoute l'envoi courant", () => {
    const out = pruneRecentPushes({ pushLog: [now - 10 * day, now - day] }, { windowDays: 7 }, now);
    expect(out).toEqual([now - day, now]);
  });
  it("borne la longueur (maxLen)", () => {
    const log = Array.from({ length: 60 }, (_, i) => now - i * 1000);
    const out = pruneRecentPushes({ pushLog: log }, { windowDays: 7, maxLen: 10 }, now);
    expect(out.length).toBe(10);
    expect(out[out.length - 1]).toBe(now); // l'envoi courant est conservé
  });
});
