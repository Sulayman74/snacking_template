// 🏠 Tests unitaires — recherche d'adresses (Géoplateforme IGN / BAN) et téléphone.
// Régression DLV-1 : l'ancien géocodeur ne trouvait que des villes (« Paris,
// Île-de-France ») → frais/ETA faux et livreur sans adresse exploitable.
import { describe, it, expect, vi } from "vitest";
import {
  parseAddressFeatures,
  isPreciseAddress,
  searchAddresses,
  reverseGeocode,
  isValidPhone,
} from "../../src/services/addressService.js";

// Réponse réelle du service (tronquée) pour « 18 avenue de la liberation cluses ».
const BAN_HOUSENUMBER = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [6.577396, 46.060051] },
    properties: {
      label: "18 Avenue de la libération 74300 Cluses",
      type: "housenumber", city: "Cluses", postcode: "74300",
    },
  }],
};
const BAN_MUNICIPALITY = {
  features: [{
    geometry: { coordinates: [2.347, 48.859] },
    properties: { label: "Paris", type: "municipality", city: "Paris", postcode: "75001" },
  }],
};
const okFetch = (json) => vi.fn().mockResolvedValue({ ok: true, json: async () => json });

describe("parseAddressFeatures", () => {
  it("convertit [lng, lat] GeoJSON en {lat, lng} + libellé", () => {
    expect(parseAddressFeatures(BAN_HOUSENUMBER)).toEqual([{
      label: "18 Avenue de la libération 74300 Cluses",
      lat: 46.060051, lng: 6.577396, type: "housenumber", city: "Cluses", postcode: "74300",
    }]);
  });

  it("ignore les entrées sans libellé ou sans coordonnées, et les réponses vides", () => {
    expect(parseAddressFeatures({ features: [{ properties: { label: "X" } }, { geometry: { coordinates: [1, 2] }, properties: {} }] })).toEqual([]);
    expect(parseAddressFeatures(null)).toEqual([]);
  });
});

describe("isPreciseAddress", () => {
  it("accepte numéro, rue, lieu-dit ; refuse une commune entière", () => {
    expect(isPreciseAddress({ type: "housenumber" })).toBe(true);
    expect(isPreciseAddress({ type: "street" })).toBe(true);
    expect(isPreciseAddress({ type: "locality" })).toBe(true);
    expect(isPreciseAddress({ type: "municipality" })).toBe(false);
    expect(isPreciseAddress(null)).toBe(false);
  });
});

describe("searchAddresses", () => {
  it("interroge la Géoplateforme en autocomplétion, classée près du restaurant", async () => {
    const fetchImpl = okFetch(BAN_HOUSENUMBER);
    const results = await searchAddresses("18 av liberation", { near: { lat: 46.06, lng: 6.58 }, fetchImpl });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://data.geopf.fr/geocodage/search");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: "18 av liberation", index: "address", autocomplete: "1", limit: "5", lat: "46.06", lon: "6.58",
    });
    expect(results[0].label).toBe("18 Avenue de la libération 74300 Cluses");
  });

  it("n'appelle pas le service pour moins de 3 caractères", async () => {
    const fetchImpl = okFetch(BAN_HOUSENUMBER);
    expect(await searchAddresses("18", { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sans position du restaurant, pas de biais géographique", async () => {
    const fetchImpl = okFetch(BAN_MUNICIPALITY);
    await searchAddresses("paris", { fetchImpl });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.has("lat")).toBe(false);
  });

  it("lève une erreur si le service répond en erreur (message côté UI)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(searchAddresses("18 av liberation", { fetchImpl })).rejects.toThrow("geocodage 503");
  });
});

describe("reverseGeocode", () => {
  it("renvoie l'adresse la plus proche d'une position GPS", async () => {
    const fetchImpl = okFetch(BAN_HOUSENUMBER);
    const found = await reverseGeocode({ lat: 46.0604, lng: 6.5794 }, { fetchImpl });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe("/geocodage/reverse");
    expect(url.searchParams.get("lon")).toBe("6.5794");
    expect(found.label).toContain("Cluses");
  });

  it("null si position invalide ou aucune adresse", async () => {
    const fetchImpl = okFetch({ features: [] });
    expect(await reverseGeocode({ lat: NaN, lng: 1 }, { fetchImpl })).toBeNull();
    expect(await reverseGeocode({ lat: 46, lng: 6 }, { fetchImpl })).toBeNull();
  });
});

describe("isValidPhone (même règle que V.isPhone serveur)", () => {
  it.each(["06 12 34 56 78", "0612345678", "+33 6 12 34 56 78", "06.12.34.56.78", "+262 692 12 34 56", "(0)6-12-34-56-78", "+33 (0)6 12 34 56 78"])("accepte %s", (p) => {
    expect(isValidPhone(p)).toBe(true);
  });
  it.each(["", "12345", "abc", "06 12 34 56 78 90 12 34", "javascript:alert(1)", "+", null])("refuse %s", (p) => {
    expect(isValidPhone(p)).toBe(false);
  });
});
