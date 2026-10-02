// @vitest-environment jsdom
// 🛎️ Tests unitaires — radar de l'écran cuisine (KDS-1), sur le VRAI module.
// Régressions : sonnerie muette pour une livraison et pour l'arrivée du client
// (« Je suis à 5 min »), écoute coupée au changement d'onglet, relance du radar
// qui rechargeait tous les tickets.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const listeners = { commandes: null };
vi.mock("../../src/core/firebase.js", () => ({
  db: {},
  doc: vi.fn((db, col, id) => ({ col, id })),
  updateDoc: vi.fn().mockResolvedValue(),
  writeBatch: vi.fn(),
  getDoc: vi.fn(),
  increment: vi.fn(),
  collection: vi.fn((db, name) => ({ name })),
  query: vi.fn((col) => ({ query: col?.name })),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn((ref, next) => {
    if (ref?.query === "commandes") listeners.commandes = next;
    return vi.fn();
  }),
  functions: {},
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: {} })),
}));

const fb = await import("../../src/core/firebase.js");
const { kitchenAlertFor } = await import("../../src/admin-kitchen.js");

const order = (statut, over = {}) => ({ statut, snackId: "snackA", clientNom: "Léa", items: [], total: 12, ...over });
const change = (type, id, data, { own = false } = {}) => ({
  type, doc: { id, data: () => data, metadata: { hasPendingWrites: own } },
});
const push = (...changes) => listeners.commandes({ docChanges: () => changes });
let bell;

describe("kitchenAlertFor (règle pure)", () => {
  it.each([
    ["added", undefined, "en_attente_client", false, "nouvelle"],
    ["added", undefined, "nouvelle", false, "a-cuisiner"],        // livraison payée
    ["modified", "en_attente_client", "nouvelle", false, "a-cuisiner"], // client dans 5 min
    ["modified", "nouvelle", "nouvelle", false, null],             // autre champ modifié
    ["modified", "nouvelle", "prete", false, null],
    ["added", undefined, "prete", false, null],
    ["added", undefined, "nouvelle", true, null],                  // chargement initial
    ["removed", "nouvelle", "nouvelle", false, null],
  ])("%s %s → %s (initial=%s) : %s", (type, prev, next, initial, expected) => {
    expect(kitchenAlertFor(type, prev && order(prev), order(next), initial)).toBe(expected);
  });
});

describe("radar cuisine (startKitchenRadar)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <audio id="kitchen-bell"></audio>
      <div id="orders-waiting"></div><div id="orders-new"></div><div id="orders-ready"></div>`;
    bell = document.getElementById("kitchen-bell");
    bell.play = vi.fn().mockResolvedValue();
    window.currentAdminSnackId = "snackA";
    window.currentAdminTab = "cuisine";
    window.showToast = vi.fn();
    fb.onSnapshot.mockClear();
    window.startKitchenRadar();
    push(change("added", "o1", order("en_attente_client"))); // chargement initial : silence
  });
  afterEach(() => window.stopKitchenRadar());

  it("le chargement initial ne sonne pas", () => {
    expect(bell.play).not.toHaveBeenCalled();
  });

  it("sonne pour une livraison payée et pour l'arrivée du client", () => {
    push(change("added", "o2", order("nouvelle", { mode: "delivery" })));
    expect(bell.play).toHaveBeenCalledTimes(1);
    push(change("modified", "o1", order("nouvelle")));
    expect(bell.play).toHaveBeenCalledTimes(2);
    expect(document.querySelector("#orders-new #ticket-o1")).not.toBeNull();
  });

  it("ne sonne pas pour une action faite sur cette tablette (« Forcer cuisson »)", () => {
    push(change("modified", "o1", order("nouvelle"), { own: true }));
    expect(bell.play).not.toHaveBeenCalled();
  });

  it("hors de l'onglet Cuisine : sonnerie + message qui dit où regarder", () => {
    window.currentAdminTab = "menu";
    push(change("modified", "o1", order("nouvelle")), change("added", "o3", order("nouvelle")));
    expect(bell.play).toHaveBeenCalledTimes(1);
    expect(window.showToast).toHaveBeenCalledWith("🛎️ 2 commandes à traiter en cuisine", "info");
  });

  it("relancer le radar (retour d'onglet, reprise) ne recrée pas l'écoute ni les tickets", () => {
    const listenersBefore = fb.onSnapshot.mock.calls.filter(([ref]) => ref?.query === "commandes").length;
    window.startKitchenRadar();
    window.startKitchenRadar();
    const listenersAfter = fb.onSnapshot.mock.calls.filter(([ref]) => ref?.query === "commandes").length;
    expect(listenersAfter).toBe(listenersBefore);
    expect(document.querySelector("#orders-waiting #ticket-o1")).not.toBeNull();
  });

  it("après arrêt puis redémarrage, le nouveau chargement initial est de nouveau silencieux", () => {
    window.stopKitchenRadar();
    window.startKitchenRadar();
    push(change("added", "o1", order("en_attente_client")), change("added", "o9", order("nouvelle")));
    expect(bell.play).not.toHaveBeenCalled();
  });
});
