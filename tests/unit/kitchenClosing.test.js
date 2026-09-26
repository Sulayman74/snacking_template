// @vitest-environment jsdom
// ⏰ Tests unitaires — écran cuisine : bandeau « arrêt des commandes » et coupure
// « jusqu'à la réouverture », sur le VRAI module admin-kitchen (Firestore mocké).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let snackListener = null;
vi.mock("../../src/core/firebase.js", () => ({
  db: {},
  doc: vi.fn((db, col, id) => ({ col, id })),
  updateDoc: vi.fn().mockResolvedValue(),
  writeBatch: vi.fn(),
  getDoc: vi.fn(),
  increment: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn((ref, next) => {
    if (ref?.col === "snacks") snackListener = next;
    return vi.fn();
  }),
  functions: {},
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: {} })),
}));

const fb = await import("../../src/core/firebase.js");
await import("../../src/admin-kitchen.js");

const week = Array.from({ length: 7 }, () => ({ open: "11:00", close: "22:00", closed: false }));
const pushSnack = (data) => snackListener({ exists: () => true, data: () => data });
const banner = () => document.getElementById("kitchen-closing-banner");

describe("écran cuisine — fin de service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="orders-waiting"></div><div id="orders-new"></div><div id="orders-ready"></div>
      <div id="kitchen-pause-banner" class="hidden"><p id="kitchen-pause-timer-text"></p></div>
      <div id="kitchen-closing-banner" class="hidden">
        <p id="kitchen-closing-title"></p><p id="kitchen-closing-detail"></p>
      </div>`;
    window.currentAdminSnackId = "snackA";
    window.showToast = vi.fn();
    fb.updateDoc.mockClear();
    window.startKitchenRadar();
  });
  afterEach(() => {
    window.stopKitchenRadar();
    vi.useRealTimers();
  });

  it("pas de bandeau en plein service (20:00 Paris)", () => {
    vi.setSystemTime(new Date("2026-09-23T18:00:00Z"));
    pushSnack({ hours: week });
    expect(banner().classList.contains("hidden")).toBe(true);
  });

  it("bandeau à T-15 avant l'heure limite (dernière commande 30 min avant 22:00)", () => {
    vi.setSystemTime(new Date("2026-09-23T19:20:00Z")); // 21:20 Paris
    pushSnack({ hours: week, lastOrderMinutesBeforeClose: 30 });
    expect(banner().classList.contains("hidden")).toBe(false);
    expect(document.getElementById("kitchen-closing-title").innerText).toBe("Arrêt des commandes en ligne à 21:30");
    expect(window.showToast).toHaveBeenCalledOnce();
  });

  it("le bandeau apparaît tout seul quand l'heure avance (réévaluation 30 s)", () => {
    vi.setSystemTime(new Date("2026-09-23T19:40:00Z")); // 21:40, fermeture 22:00 sans délai
    pushSnack({ hours: week });
    expect(banner().classList.contains("hidden")).toBe(true);
    vi.advanceTimersByTime(6 * 60_000); // 21:46
    expect(banner().classList.contains("hidden")).toBe(false);
  });

  it("« Jusqu'à la réouverture » coupe les commandes jusqu'au lendemain 11:00 (heure de Paris)", async () => {
    vi.setSystemTime(new Date("2026-09-23T17:00:00Z")); // 19:00 Paris
    pushSnack({ hours: week });
    await window.stopOrdersUntilReopening();
    const [, payload] = fb.updateDoc.mock.calls.at(-1);
    expect(payload.servicePausedUntil.toISOString()).toBe("2026-09-24T09:00:00.000Z");
  });

  it("« Jusqu'à la réouverture » sans horaires → message, aucune écriture", async () => {
    vi.setSystemTime(new Date("2026-09-23T17:00:00Z"));
    pushSnack({ hours: [] });
    await window.stopOrdersUntilReopening();
    expect(fb.updateDoc).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/horaires/), "error");
  });
});
