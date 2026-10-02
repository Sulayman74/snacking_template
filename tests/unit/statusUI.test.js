// @vitest-environment jsdom
// 🚦 Tests unitaires — « Valider la commande » selon l'état de la boutique
// (audit UX-5) et message de correction du panier (UX-7), sur les VRAIS modules.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const { store } = await import("../../src/core/Store.js");
const { syncCheckoutButton, startStatusClock, CLOCK_MS } = await import("../../src/ui/StatusUI.js");
const { cartSyncMessage } = await import("../../src/ui/statusMessage.js");

const week = Array.from({ length: 7 }, () => ({ open: "11:00", close: "22:00", closed: false }));
const config = (over = {}) => ({ features: { enableClickAndCollect: true }, hours: week, timezone: "Europe/Paris", ...over });
const btn = () => document.getElementById("checkout-btn");

describe("syncCheckoutButton", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<button id="checkout-btn"></button>';
    store.clearCart();
    store.setConfig(config());
  });

  it("panier vide → désactivé, sans raison affichée", () => {
    syncCheckoutButton(new Date("2026-09-23T18:00:00Z"));
    expect(btn().disabled).toBe(true);
    expect(btn().hasAttribute("title")).toBe(false);
  });

  it("ouvert avec un article → actif", () => {
    store.addToCart({ id: "a", productId: "a", nom: "A", prix: 5 });
    syncCheckoutButton(new Date("2026-09-23T18:00:00Z"));
    expect(btn().disabled).toBe(false);
  });

  it("cuisine en pause → désactivé avec la raison", () => {
    store.addToCart({ id: "a", productId: "a", nom: "A", prix: 5 });
    store.setConfig(config({ servicePausedUntil: new Date("2026-09-23T18:20:00Z") }));
    syncCheckoutButton(new Date("2026-09-23T18:00:00Z"));
    expect(btn().disabled).toBe(true);
    expect(btn().title).toMatch(/^Cuisine en pause jusqu'à 20:20/);
  });

  it("fermé le matin mais créneau possible → actif (commande programmée)", () => {
    store.addToCart({ id: "a", productId: "a", nom: "A", prix: 5 });
    syncCheckoutButton(new Date("2026-09-23T06:00:00Z"));
    expect(btn().disabled).toBe(false);
  });
});

describe("horloge de la boutique", () => {
  afterEach(() => vi.useRealTimers());

  it("toutes les 30 s : 22:00 passe, « Valider » se désactive sans action du client", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T19:59:50Z")); // 21:59:50 à Paris
    document.body.innerHTML = '<button id="checkout-btn"></button>';
    store.clearCart();
    store.setConfig(config({ features: { enableDelivery: true } }));
    store.setDeliveryMode("delivery"); // pas de créneau « plus tard » en livraison
    store.addToCart({ id: "a", productId: "a", nom: "A", prix: 5 });
    const timer = startStatusClock();
    expect(btn().disabled).toBe(false);
    vi.advanceTimersByTime(CLOCK_MS);
    clearInterval(timer);
    expect(btn().disabled).toBe(true);
    expect(btn().title).toBe("Fermé · réouvre demain à 11:00");
  });
});

describe("cartSyncMessage", () => {
  it.each([
    [{ removed: ["Frites"] }, "« Frites » n'est plus disponible : retiré du panier."],
    [{ removed: ["Frites", "Coca"] }, "« Frites », « Coca » ne sont plus disponibles : retirés du panier."],
    [{ repriced: [{ nom: "Burger", prix: 10.5 }] }, "Le prix de « Burger » a changé : 10.50 €."],
    [{ repriced: [{ nom: "A", prix: 1 }, { nom: "B", prix: 2 }] }, "Les prix ont changé, votre panier a été mis à jour."],
    [{}, ""],
  ])("%j", (detail, expected) => {
    expect(cartSyncMessage(detail)).toBe(expected);
  });
});
