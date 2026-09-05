// ⏸️ Tests unitaires — Gestion de la pause cuisine (Coup de feu)
import { describe, it, expect } from "vitest";

function isServicePaused(servicePausedUntil, now = new Date()) {
  if (!servicePausedUntil) return false;
  const pausedUntil = servicePausedUntil.toDate ? servicePausedUntil.toDate() : new Date(servicePausedUntil);
  return pausedUntil instanceof Date && !isNaN(pausedUntil.getTime()) && pausedUntil > now;
}

function formatPauseRemainingMin(servicePausedUntil, now = new Date()) {
  if (!isServicePaused(servicePausedUntil, now)) return 0;
  const pausedUntil = servicePausedUntil.toDate ? servicePausedUntil.toDate() : new Date(servicePausedUntil);
  return Math.max(1, Math.round((pausedUntil.getTime() - now.getTime()) / 60000));
}

describe("Service Pause (Gestion Coup de Feu)", () => {
  const baseTime = new Date("2026-06-15T19:30:00.000Z");

  it("sans servicePausedUntil → non en pause", () => {
    expect(isServicePaused(null, baseTime)).toBe(false);
    expect(isServicePaused(undefined, baseTime)).toBe(false);
  });

  it("pause expirée dans le passé → non en pause", () => {
    const past = new Date("2026-06-15T19:00:00.000Z");
    expect(isServicePaused(past, baseTime)).toBe(false);
    expect(formatPauseRemainingMin(past, baseTime)).toBe(0);
  });

  it("pause active dans le futur (+30 min) → en pause et calcul du temps restant", () => {
    const future = new Date("2026-06-15T20:00:00.000Z"); // +30 min
    expect(isServicePaused(future, baseTime)).toBe(true);
    expect(formatPauseRemainingMin(future, baseTime)).toBe(30);
  });

  it("gère les objets Timestamp Firestore (toDate)", () => {
    const futureTimestamp = {
      toDate: () => new Date("2026-06-15T19:45:00.000Z"), // +15 min
    };
    expect(isServicePaused(futureTimestamp, baseTime)).toBe(true);
    expect(formatPauseRemainingMin(futureTimestamp, baseTime)).toBe(15);
  });

  it("arrondi au minimum à 1 min quand la pause est active", () => {
    const almostDone = new Date(baseTime.getTime() + 10_000); // +10 secondes
    expect(isServicePaused(almostDone, baseTime)).toBe(true);
    expect(formatPauseRemainingMin(almostDone, baseTime)).toBe(1);
  });
});
