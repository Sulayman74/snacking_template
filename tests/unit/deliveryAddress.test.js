// @vitest-environment jsdom
// 🚚 Tests unitaires — adresse de livraison (DLV-1) sur le VRAI DeliveryUI et le
// VRAI <snack-checkout>. Régression : géocodage à la ville, pas de complément ni
// de téléphone pour le livreur.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/core/firebase.js", () => ({
  auth: { currentUser: { uid: "u1", isAnonymous: false } }, functions: {},
  httpsCallable: vi.fn(() => vi.fn()), signInAnonymously: vi.fn(),
}));
vi.mock("../../src/auth.js", () => ({ ensureUserDoc: vi.fn() }));
vi.mock("../../src/ui/UpsellUI.js", () => ({ upsellUI: { show: vi.fn() } }));

const CLUSES = {
  features: [{
    geometry: { coordinates: [6.577396, 46.060051] },
    properties: { label: "18 Avenue de la libération 74300 Cluses", type: "housenumber" },
  }],
};
const PARIS = { features: [{ geometry: { coordinates: [2.347, 48.859] }, properties: { label: "Paris", type: "municipality" } }] };
const XSS = { features: [{ geometry: { coordinates: [6.57, 46.06] }, properties: { label: '<img src=x onerror="window.pwned=1">', type: "street" } }] };
const reply = (json) => Promise.resolve({ ok: true, json: async () => json });

document.body.innerHTML = '<div id="delivery-section"></div>';
const fetchMock = vi.fn(() => reply(CLUSES));
vi.stubGlobal("fetch", fetchMock);

const { store } = await import("../../src/core/Store.js");
const { deliveryUI } = await import("../../src/delivery.js");
const { telHref } = await import("../../src/utils.js");

const CFG = {
  identity: { id: "snackA", currency: "€" },
  features: { enableDelivery: true, enableClickAndCollect: true },
  geo: { lat: 46.06, lng: 6.58 },
  delivery: { radiusKm: 10, frais: 2.5, minOrder: 0, avgSpeedKmh: 22, prepBaseMin: 12, queueFactorMin: 3 },
  hours: [],
};
const section = () => document.getElementById("delivery-section");
const addressInput = () => section().querySelector('input[name="address"]');
const type = (value) => {
  const input = addressInput();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  window.showToast = vi.fn();
  fetchMock.mockReset().mockImplementation(() => reply(CLUSES));
  store.setConfig(CFG);
  store.resetDelivery();
  store.setDeliveryContact({ complement: "", telephone: "" });
  store.setDeliveryMode("delivery");
});
afterEach(() => vi.useRealTimers());

describe("Saisie d'adresse avec autocomplétion", () => {
  it("propose des adresses précises pendant la frappe, sans perdre le champ", async () => {
    const input = addressInput();
    type("18 av de la lib");
    await vi.advanceTimersByTimeAsync(300);
    expect(new URL(fetchMock.mock.calls[0][0]).hostname).toBe("data.geopf.fr");
    const options = section().querySelectorAll('#delivery-suggestions [role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("18 Avenue de la libération 74300 Cluses");
    expect(addressInput()).toBe(input); // pas de re-rendu complet : le focus reste
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("choisir une suggestion enregistre l'adresse complète et le devis", async () => {
    type("18 av de la lib");
    await vi.advanceTimersByTimeAsync(300);
    section().querySelector('[data-delivery-action="pick-suggestion"]').click();
    expect(store.state.delivery.address).toMatchObject({
      adresse: "18 Avenue de la libération 74300 Cluses", lat: 46.060051, lng: 6.577396, type: "housenumber",
    });
    expect(store.state.delivery.quote).not.toBeNull();
  });

  it("refuse une commune seule (« Paris ») et invite à préciser", async () => {
    fetchMock.mockImplementation(() => reply(PARIS));
    type("Paris");
    section().querySelector('[data-delivery-form="address"]').dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.delivery.address).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/trop vague/), "error");
  });

  it("un libellé piégé du service est affiché comme du texte", async () => {
    fetchMock.mockImplementation(() => reply(XSS));
    type("piege");
    await vi.advanceTimersByTimeAsync(300);
    expect(section().querySelector("#delivery-suggestions img")).toBeNull();
    expect(section().querySelector("#delivery-suggestions").textContent).toContain("<img");
  });

  it("service injoignable → message clair, pas d'adresse", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    type("18 av de la liberation cluses");
    section().querySelector('[data-delivery-form="address"]').dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.delivery.address).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/indisponible/), "error");
  });
});

describe("« Me localiser » : adresse lisible pour le livreur", () => {
  it("la position GPS est convertie en adresse (géocodage inverse)", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 46.0604, longitude: 6.5794, accuracy: 10 } }) },
    });
    await deliveryUI.locate(section().querySelector('[data-delivery-action="locate"]'));
    expect(new URL(fetchMock.mock.calls.at(-1)[0]).pathname).toBe("/geocodage/reverse");
    expect(store.state.delivery.address).toMatchObject({
      adresse: "18 Avenue de la libération 74300 Cluses", lat: 46.0604, lng: 6.5794,
    });
  });
});

describe("Complément et téléphone", () => {
  beforeEach(() => {
    store.setDeliveryAddress({ adresse: "18 Avenue de la libération 74300 Cluses", lat: 46.060051, lng: 6.577396, type: "housenumber" });
  });

  it("les champs apparaissent une fois l'adresse choisie, pré-remplis", () => {
    store.setDeliveryContact({ telephone: "06 12 34 56 78" });
    store.setDeliveryAddress({ ...store.state.delivery.address });
    expect(section().querySelector('[data-delivery-contact="telephone"]').value).toBe("06 12 34 56 78");
    expect(section().querySelector('[data-delivery-contact="complement"]')).not.toBeNull();
  });

  it("la saisie met à jour le Store sans re-rendre le formulaire", () => {
    const field = section().querySelector('[data-delivery-contact="complement"]');
    field.value = "3e étage, code 4521B";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(store.state.delivery.contact.complement).toBe("3e étage, code 4521B");
    expect(section().querySelector('[data-delivery-contact="complement"]')).toBe(field);
  });
});

describe("Checkout livraison : téléphone obligatoire", () => {
  it("sans téléphone valide, le paiement ne s'ouvre pas", async () => {
    const { SnackCheckout } = await import("../../src/components/SnackCheckout.js");
    const el = new SnackCheckout();
    const mount = vi.spyOn(el, "_mountStripeElement").mockResolvedValue();
    window.snackConfig = CFG;
    store.addToCart({ id: "b", productId: "b", nom: "Burger", prix: 12, quantity: 1 });
    store.setDeliveryAddress({ adresse: "18 Avenue de la libération 74300 Cluses", lat: 46.060051, lng: 6.577396, type: "housenumber" });
    store.setDeliveryContact({ telephone: "12" });

    await el.processCheckout();

    expect(mount).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/téléphone/), "error");
  });

  it("le payload envoie complément et téléphone au serveur", async () => {
    const { SnackCheckout } = await import("../../src/components/SnackCheckout.js");
    const el = new SnackCheckout();
    store.setDeliveryAddress({ adresse: "18 Avenue de la libération 74300 Cluses", lat: 46.060051, lng: 6.577396, type: "housenumber" });
    store.setDeliveryContact({ complement: " code 4521B ", telephone: "06 12 34 56 78" });
    expect(el._getDeliveryPayload()).toEqual({
      mode: "delivery",
      livraison: {
        adresse: "18 Avenue de la libération 74300 Cluses", lat: 46.060051, lng: 6.577396,
        complement: "code 4521B", telephone: "06 12 34 56 78",
      },
    });
  });
});

describe("telHref (lien d'appel livreur / cuisine)", () => {
  it("ne garde que chiffres et + initial ; vide si inexploitable", () => {
    expect(telHref("06 12 34 56 78")).toBe("tel:0612345678");
    expect(telHref("+33 (0)6 12 34 56 78")).toBe("tel:+330612345678");
    expect(telHref('0612345678" onclick="x')).toBe("tel:0612345678");
    expect(telHref("12")).toBe("");
    expect(telHref(null)).toBe("");
  });
});
