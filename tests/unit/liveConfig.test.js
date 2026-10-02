// @vitest-environment jsdom
// 📡 Tests unitaires — config du snack suivie en direct (audit UX-5), sur le VRAI
// module. Régression : config lue une seule fois → pause cuisine et horaires
// modifiés invisibles ; `servicePausedUntil` jamais copié (bandeau pause mort).
import { describe, it, expect, beforeEach, vi } from "vitest";

let onNext, onError, unsubscribe;
vi.mock("../../src/core/firebase.js", () => ({
  doc: vi.fn((db, col, id) => ({ col, id })),
  onSnapshot: vi.fn((ref, next, error) => {
    onNext = next;
    onError = error;
    unsubscribe = vi.fn();
    return unsubscribe;
  }),
}));

const { store } = await import("../../src/core/Store.js");
const { buildSnackConfig } = await import("../../src/snack-config.js");
const fb = await import("../../src/core/firebase.js");

const snap = (data) => ({ exists: () => !!data, data: () => data });

describe("buildSnackConfig", () => {
  it("copie la pause cuisine (avant : absente → bandeau et garde morts)", () => {
    const until = { toDate: () => new Date("2026-09-23T18:20:00Z") };
    expect(buildSnackConfig("s1", { nom: "A", servicePausedUntil: until }).servicePausedUntil).toBe(until);
    expect(buildSnackConfig("s1", { nom: "A" }).servicePausedUntil).toBeNull();
  });
});

describe("loadSnackConfig — écoute en direct", () => {
  let updates;
  beforeEach(() => {
    store.setConfig(null);
    fb.onSnapshot.mockClear();
    updates = 0;
    store.addEventListener("config-updated", () => updates++);
  });

  it("résout au premier snapshot puis republie quand le restaurateur change la fiche", async () => {
    const loading = window.loadSnackConfig({}, "s1");
    onNext(snap({ nom: "Snack", hours: [] }));
    const cfg = await loading;
    expect(cfg.identity.name).toBe("Snack");
    expect(window.snackConfig).toBe(cfg);

    const until = new Date("2026-09-23T18:20:00Z");
    onNext(snap({ nom: "Snack", hours: [], servicePausedUntil: until }));
    expect(store.state.config.servicePausedUntil).toBe(until);
    expect(updates).toBe(2); // premier snapshot + pause
  });

  it("snapshot identique (cache puis serveur) → pas de nouvel événement", async () => {
    const loading = window.loadSnackConfig({}, "s2");
    onNext(snap({ nom: "Snack" }));
    await loading;
    const before = updates;
    onNext(snap({ nom: "Snack" }));
    expect(updates).toBe(before);
  });

  it("déjà suivi → pas de seconde écoute ; autre snack → l'ancienne est coupée", async () => {
    const loading = window.loadSnackConfig({}, "s3");
    onNext(snap({ nom: "Snack" }));
    await loading;
    const first = unsubscribe;
    await window.loadSnackConfig({}, "s3");
    expect(fb.onSnapshot).toHaveBeenCalledTimes(1);

    const other = window.loadSnackConfig({}, "s4");
    expect(first).toHaveBeenCalled();
    onNext(snap({ nom: "Autre" }));
    expect((await other).identity.id).toBe("s4");
  });

  it("snack inexistant ou erreur → null (l'app affiche son erreur)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = window.loadSnackConfig({}, "s5");
    onNext(snap(null));
    await expect(missing).resolves.toBeNull();
    const failing = window.loadSnackConfig({}, "s6");
    onError(new Error("permission-denied"));
    await expect(failing).resolves.toBeNull();
  });
});
