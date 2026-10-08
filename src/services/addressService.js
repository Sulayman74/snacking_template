// ============================================================================
// 🏠 addressService — Recherche d'adresses postales (Géoplateforme IGN / BAN)
// ============================================================================
// Service officiel de géocodage de l'IGN (successeur d'api-adresse.data.gouv.fr),
// adossé à la Base Adresse Nationale : précis au numéro de rue, France entière
// (DROM compris), CORS ouvert, sans clé. Fonctions sans état ; `fetchImpl`
// injectable pour les tests. Le serveur recalcule distance et frais depuis lat/lng.

const BASE_URL = "https://data.geopf.fr/geocodage";
const MIN_QUERY_LENGTH = 3;

// Types BAN assez précis pour livrer. « municipality » (une commune entière) ne
// l'est pas : c'était le défaut du géocodeur précédent (« Paris, Île-de-France »).
const PRECISE_TYPES = new Set(["housenumber", "street", "locality"]);

/** Normalise une FeatureCollection BAN en suggestions {label, lat, lng, type…}. */
export function parseAddressFeatures(json) {
  const features = Array.isArray(json?.features) ? json.features : [];
  return features
    .map((f) => {
      const [lng, lat] = Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates : [];
      const p = f?.properties || {};
      return {
        label: typeof p.label === "string" ? p.label : "",
        lat: Number(lat),
        lng: Number(lng),
        type: p.type || "",
        city: p.city || "",
        postcode: p.postcode || "",
      };
    })
    .filter((a) => a.label && Number.isFinite(a.lat) && Number.isFinite(a.lng));
}

/** Une suggestion permet-elle de trouver la porte (rue ou numéro) ? */
export function isPreciseAddress(address) {
  return PRECISE_TYPES.has(address?.type);
}

/**
 * Suggestions d'adresses pour une saisie partielle (autocomplétion).
 * @param {string} query
 * @param {{near?: {lat:number,lng:number}, limit?: number, fetchImpl?: Function, signal?: AbortSignal}} [opts]
 *   `near` : position du restaurant, pour classer d'abord les adresses proches.
 * @returns {Promise<Array>} [] si la saisie est trop courte.
 * @throws si le service est injoignable (l'appelant affiche un message).
 */
export async function searchAddresses(query, { near, limit = 5, fetchImpl = fetch, signal } = {}) {
  const q = String(query || "").trim();
  if (q.length < MIN_QUERY_LENGTH) return [];
  const params = new URLSearchParams({ q, index: "address", autocomplete: "1", limit: String(limit) });
  if (Number.isFinite(near?.lat) && Number.isFinite(near?.lng)) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lng));
  }
  const resp = await fetchImpl(`${BASE_URL}/search?${params}`, { signal });
  if (!resp.ok) throw new Error(`geocodage ${resp.status}`);
  return parseAddressFeatures(await resp.json());
}

/**
 * Adresse la plus proche d'une position GPS (géocodage inverse).
 * @returns {Promise<Object|null>} null si aucune adresse dans le rayon du service.
 */
export async function reverseGeocode({ lat, lng }, { fetchImpl = fetch, signal } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), index: "address", limit: "1" });
  const resp = await fetchImpl(`${BASE_URL}/reverse?${params}`, { signal });
  if (!resp.ok) throw new Error(`geocodage ${resp.status}`);
  return parseAddressFeatures(await resp.json())[0] || null;
}

// Même règle que le serveur : définition UNIQUE dans functions/shared/orderSchemas.mjs
// (V.isPhone côté Cloud Functions pointe sur la même fonction).
export { isPhone as isValidPhone } from "../../functions/shared/orderSchemas.mjs";
