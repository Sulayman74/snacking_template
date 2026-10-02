// @vitest-environment jsdom
// 🕒 Tests unitaires — choix « Dès que possible / Plus tard » dans le panier (VRAI
// pickup.js) et son effet sur le checkout (VRAI <snack-checkout>). Heure simulée.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/core/firebase.js", () => ({
  auth: { currentUser: { uid: "u1", isAnonymous: false } }, functions: {},
  httpsCallable: vi.fn(() => vi.fn()), signInAnonymously: vi.fn(),
}));
vi.mock("../../src/auth.js", () => ({ ensureUserDoc: vi.fn() }));
vi.mock("../../src/ui/UpsellUI.js", () => ({ upsellUI: { show: vi.fn() } }));

document.body.innerHTML = '<div id="pickup-section"></div>';
const { store } = await import("../../src/core/Store.js");
const { pickupUI } = await import("../../src/pickup.js");
const { SnackCheckout } = await import("../../src/components/SnackCheckout.js");

const paris = (hhmm) => new Date(`2026-09-23T${hhmm}:00+02:00`);
const CFG = {
  identity: { id: "snackA", name: "Team Fusion", currency: "€" },
  features: { enableClickAndCollect: true, enableDelivery: false },
  hours: Array.from({ length: 7 }, () => ({ open: "11:00", close: "22:00", closed: false })),
  timezone: "Europe/Paris",
  lastOrderMinutesBeforeClose: 0,
  delivery: { prepBaseMin: 12 },
};
const section = () => document.getElementById("pickup-section");
const radio = (v) => section().querySelector(`input[name="pickup-mode"][value="${v}"]`);
const select = () => section().querySelector('select[name="pickup-slot"]');
const change = (el) => el.dispatchEvent(new Event("change", { bubbles: true }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(paris("12:03"));
  window.showToast = vi.fn();
  window.snackConfig = CFG;
  store.clearCart();
  store.resetPickup();
  store.setDeliveryMode("collect");
  store.setConfig(CFG);
  store.addToCart({ id: "b", productId: "b", nom: "Burger", prix: 12, quantity: 1 });
});
afterEach(() => vi.useRealTimers());

describe("Panier — restaurant ouvert", () => {
  it("« Dès que possible · prête vers 12:15 » par défaut, et l'heure limite affichée", () => {
    expect(radio("asap").checked).toBe(true);
    expect(radio("asap").disabled).toBe(false);
    expect(section().textContent).toContain("Dès que possible · prête vers 12:15");
    expect(section().textContent).toContain("Ouvert · dernière commande 22:00");
    expect(pickupUI.currentRequest()).toBeNull();
  });

  it("« Plus tard » + choix d'une heure → créneau envoyé au serveur", () => {
    radio("slot").checked = true;
    change(radio("slot"));
    expect(select().options[0].textContent).toBe("12:15");
    select().value = String(paris("12:45").getTime());
    change(select());
    expect(pickupUI.currentRequest()).toEqual({ mode: "creneau", heure: paris("12:45").getTime() });
  });

  it("créneau choisi devenu trop proche : on passe au premier encore faisable", () => {
    store.setPickup({ mode: "slot", atMs: paris("12:15").getTime() });
    vi.setSystemTime(paris("12:20"));
    expect(pickupUI.currentRequest()).toEqual({ mode: "creneau", heure: paris("12:45").getTime() });
  });
});

describe("Panier — restaurant fermé", () => {
  it("avant l'ouverture : « Plus tard » présélectionné sur 11:15, « Dès que possible » grisé", () => {
    vi.setSystemTime(paris("09:30"));
    store.setConfig(CFG); // re-rendu à l'heure simulée
    expect(radio("asap").disabled).toBe(true);
    expect(radio("slot").checked).toBe(true);
    expect(section().textContent).toContain("Fermé · réouvre à 11:00");
    expect(pickupUI.currentRequest()).toEqual({ mode: "creneau", heure: paris("11:15").getTime() });
  });

  it("aucun créneau possible (23:00) : message de fermeture, pas de choix", () => {
    vi.setSystemTime(paris("23:00"));
    store.setConfig(CFG);
    expect(radio("asap")).toBeNull();
    expect(section().textContent).toContain("Fermé");
    expect(pickupUI.currentRequest()).toBeNull();
  });
});

describe("Visibilité", () => {
  it("masqué en livraison et quand le panier est vide", () => {
    store.setDeliveryMode("delivery");
    expect(section().innerHTML).toBe("");
    store.setDeliveryMode("collect");
    store.clearCart();
    expect(section().innerHTML).toBe("");
  });
});

describe("Checkout", () => {
  it("fermé mais créneau disponible : le paiement s'ouvre avec le créneau (pas de refus « fermé »)", async () => {
    vi.setSystemTime(paris("09:30"));
    store.setConfig(CFG);
    const el = new SnackCheckout();
    const mount = vi.spyOn(el, "_mountStripeElement").mockResolvedValue();
    await el.processCheckout();
    expect(mount).toHaveBeenCalled();
    expect(el._pickupRequest).toEqual({ mode: "creneau", heure: paris("11:15").getTime() });
    expect(window.showToast).not.toHaveBeenCalledWith(expect.stringMatching(/fermé/), "error");
  });

  it("ouvert, « dès que possible » : pas de créneau envoyé", async () => {
    const el = new SnackCheckout();
    vi.spyOn(el, "_mountStripeElement").mockResolvedValue();
    await el.processCheckout();
    expect(el._pickupRequest).toBeNull();
  });

  it("fermé sans aucun créneau : refus avec l'heure de réouverture", async () => {
    vi.setSystemTime(paris("23:00"));
    store.setConfig(CFG);
    const el = new SnackCheckout();
    const mount = vi.spyOn(el, "_mountStripeElement").mockResolvedValue();
    await el.processCheckout();
    expect(mount).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith("Fermé · réouvre demain à 11:00", "error");
  });
});
