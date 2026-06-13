/**
 * 🌤️ WeatherService — Récupère la météo locale via Open-Meteo (gratuit, no key).
 *
 * SOLID : pas de logique UI ici. Cette couche gère uniquement le réseau et la
 * normalisation des données météo. L'UI consomme `getWeatherForCity()` puis
 * passe le résultat à weatherInsights pour générer le conseil.
 *
 * KISS : 2 appels HTTP enchaînés (geocoding → forecast). Fail-safe : tout
 * échec retourne `null` et le widget se masque silencieusement.
 *
 * Codes météo WMO (référence Open-Meteo) :
 *   https://open-meteo.com/en/docs (section Weather variable documentation)
 */

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 45 * 60 * 1000; // 45 min : la météo bouge lentement, évite de refetch à chaque onglet.

/** fetch avec timeout (AbortController) — sans ça, un upstream lent fige le widget. */
function fetchWithTimeout(url, ms = 5000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function readWxCache(key) {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const { at, data } = JSON.parse(raw);
        return Date.now() - at > CACHE_TTL_MS ? null : data;
    } catch {
        return null;
    }
}
function writeWxCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
    } catch {
        /* sessionStorage indispo (mode privé/quota) → on ignore, pas bloquant. */
    }
}

/**
 * Récupère la météo actuelle pour une ville.
 * @param {string} city — nom de la ville (ex: "Bonneville")
 * @param {string} [country="FR"] — code pays ISO-3166 alpha-2
 * @returns {Promise<null | {
 *   temperature: number, weatherCode: number, isDay: boolean,
 *   condition: "sunny"|"cloudy"|"rainy"|"snowy"|"stormy"|"foggy"|"cold"|"hot",
 *   city: string, latitude: number, longitude: number
 * }>}
 */
export async function getWeatherForCity(city, country = "FR") {
    if (!city || typeof city !== "string") return null;

    // Cache client : évite un double appel HTTP à chaque ouverture de l'onglet Marketing.
    const cacheKey = `wx:${country}:${city.trim().toLowerCase()}`;
    const cached = readWxCache(cacheKey);
    if (cached) return cached;

    try {
        // 1. Geocoding : ville → lat/lon
        const geoUrl = `${GEOCODING_URL}?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`;
        const geoResp = await fetchWithTimeout(geoUrl);
        if (!geoResp.ok) return null;
        const geoData = await geoResp.json();

        const match = (geoData?.results || []).find(
            (r) => !country || r.country_code === country
        ) || geoData?.results?.[0];

        if (!match?.latitude || !match?.longitude) return null;

        // 2. Forecast : lat/lon → météo actuelle
        const wxUrl = `${FORECAST_URL}?latitude=${match.latitude}&longitude=${match.longitude}&current=temperature_2m,weather_code,is_day&timezone=auto`;
        const wxResp = await fetchWithTimeout(wxUrl);
        if (!wxResp.ok) return null;
        const wxData = await wxResp.json();

        const current = wxData?.current;
        if (!current) return null;

        const temperature = Math.round(current.temperature_2m);
        const weatherCode = current.weather_code;
        const isDay = current.is_day === 1;

        const result = {
            temperature,
            weatherCode,
            isDay,
            condition: deriveCondition(weatherCode, temperature),
            city: match.name,
            latitude: match.latitude,
            longitude: match.longitude,
        };
        writeWxCache(cacheKey, result);
        return result;
    } catch (err) {
        console.warn("[weatherService] Météo indisponible :", err.message);
        return null;
    }
}

/**
 * Mappe le code WMO + la température à une condition haut-niveau utilisée par
 * weatherInsights. Hiérarchie : météo extrême > température, puis ciel clair.
 */
function deriveCondition(weatherCode, temperature) {
    if ([95, 96, 99].includes(weatherCode)) return "stormy";
    if ([71, 72, 73, 75, 77, 85, 86].includes(weatherCode)) return "snowy";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) return "rainy";
    if ([45, 48].includes(weatherCode)) return "foggy";
    if (temperature <= 8) return "cold";
    if (temperature >= 26) return "hot";
    if ([2, 3].includes(weatherCode)) return "cloudy";
    return "sunny";
}
