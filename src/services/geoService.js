// ============================================================================
// 📍 geoService — Géométrie & ETA (fonctions PURES, sans Firebase)
// ============================================================================
// SOLID/KISS : aucune dépendance, 100% testable en isolation (cf. tests/).
// Utilisé par le checkout (estimation pré-paiement) ET l'app livreur (throttle
// d'écriture position + distance live). Le serveur recalcule de son côté ce qui
// est sensible (frais/total/notifs) — ici c'est de l'UX/affichage.

const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Distance "à vol d'oiseau" entre deux points {lat, lng} en kilomètres.
 * Renvoie NaN si une coordonnée est invalide (l'appelant décide du fallback).
 */
export function haversineKm(a, b) {
  if (!isLatLng(a) || !isLatLng(b)) return NaN;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isLatLng(p) {
  return (
    p &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

// ============================================================================
// ⏱️ ETA — Heuristique simple (collect ET livraison)
// ============================================================================

/**
 * Temps de préparation estimé (minutes) = base + (file d'attente × facteur).
 * queueCount : nb de commandes en cuisine (nouvelle + en_attente_client).
 */
export function etaPrepMin(prepBaseMin, queueCount = 0, queueFactorMin = 0) {
  const base = numOr(prepBaseMin, 12);
  const factor = numOr(queueFactorMin, 0);
  const queue = Math.max(0, Math.floor(numOr(queueCount, 0)));
  return Math.max(1, Math.round(base + factor * queue));
}

/**
 * Temps de trajet estimé (minutes) à partir de la distance Haversine et d'une
 * vitesse moyenne (km/h). Renvoie 0 si distance/vitesse invalides.
 */
export function etaTravelMin(distanceKm, avgSpeedKmh) {
  const d = numOr(distanceKm, 0);
  const v = numOr(avgSpeedKmh, 0);
  if (d <= 0 || v <= 0) return 0;
  return Math.max(1, Math.round((d / v) * 60));
}

/**
 * Devis complet pour l'affichage checkout.
 * @returns { distanceKm, inRange, frais, prepMin, travelMin, totalMin }
 */
export function quoteDelivery({ resto, client, delivery, queueCount = 0 }) {
  const cfg = delivery || {};
  const distanceKm = haversineKm(resto, client);
  const hasGeo = Number.isFinite(distanceKm);
  // Si la distance n'est pas mesurable (resto pas encore géocodé), on N'EMPÊCHE
  // PAS la commande — sinon toutes les livraisons seraient bloquées par défaut.
  const inRange = hasGeo ? distanceKm <= numOr(cfg.radiusKm, Infinity) : true;

  const prepMin = etaPrepMin(cfg.prepBaseMin, queueCount, cfg.queueFactorMin);
  const travelMin = hasGeo ? etaTravelMin(distanceKm, cfg.avgSpeedKmh) : 0;

  return {
    distanceKm: hasGeo ? round1(distanceKm) : null,
    inRange,
    frais: numOr(cfg.frais, 0),
    prepMin,
    travelMin,
    totalMin: prepMin + travelMin,
  };
}

// ============================================================================
// 🛰️ Géofencing — throttle d'écriture & paliers de notification
// ============================================================================

/**
 * Faut-il écrire la nouvelle position du livreur ? true si assez de temps OU
 * de distance s'est écoulé depuis la dernière écriture (limite les writes).
 * @param prev { lat, lng, t (ms) } | null
 * @param next { lat, lng }
 * @param nowMs number
 */
export function shouldWritePosition(prev, next, nowMs, { minIntervalMs = 20000, minMoveM = 100 } = {}) {
  if (!isLatLng(next)) return false;
  if (!prev || !isLatLng(prev)) return true;
  const elapsed = nowMs - (prev.t || 0);
  if (elapsed >= minIntervalMs) return true;
  const movedM = haversineKm(prev, next) * 1000;
  return movedM >= minMoveM;
}

/**
 * Palier de géofence franchi pour une distance (en mètres), parmi des seuils
 * décroissants (ex: [3000, 1000, 300]). Renvoie le plus petit seuil <= distance
 * franchi, ou null si on est encore au-dessus du plus grand seuil.
 * Sert à ne notifier qu'UNE fois par palier (comparer avec lastNotifiedBucket).
 */
export function bucketFor(distanceM, thresholds = [3000, 1000, 300]) {
  if (!Number.isFinite(distanceM)) return null;
  const sorted = [...thresholds].sort((a, b) => b - a);
  let crossed = null;
  for (const t of sorted) {
    if (distanceM <= t) crossed = t;
  }
  return crossed;
}

// ============================================================================
// 🧭 Wrappers navigator.geolocation (PWA / HTTPS requis)
// ============================================================================

export function isGeolocationSupported() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * Position unique (Promise). Rejette avec un Error portant un `.code` lisible
 * ('unsupported' | 'denied' | 'unavailable' | 'timeout').
 */
export function getCurrentPosition({ timeout = 10000, maximumAge = 0, enableHighAccuracy = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!isGeolocationSupported()) {
      return reject(geoError("unsupported", "Géolocalisation non supportée."));
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(mapGeoError(err)),
      { timeout, maximumAge, enableHighAccuracy }
    );
  });
}

/**
 * Suivi continu. Renvoie une fonction de nettoyage (clearWatch).
 */
export function watchPosition(onPos, onErr, { enableHighAccuracy = true, maximumAge = 5000, timeout = 15000 } = {}) {
  if (!isGeolocationSupported()) {
    onErr?.(geoError("unsupported", "Géolocalisation non supportée."));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => onPos?.({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, t: Date.now() }),
    (err) => onErr?.(mapGeoError(err)),
    { enableHighAccuracy, maximumAge, timeout }
  );
  return () => navigator.geolocation.clearWatch(id);
}

// ============================================================================
// 🎨 Formatage FR (UX)
// ============================================================================

/** "1,2 km" au-dessus de 1 km, sinon "300 m". */
export function formatDistance(km) {
  if (!Number.isFinite(km)) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

/** "~15 min" ou "~1 h 05". */
export function formatEta(minutes) {
  const m = Math.max(0, Math.round(numOr(minutes, 0)));
  if (m < 60) return `~${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `~${h} h${rest ? " " + String(rest).padStart(2, "0") : ""}`;
}

/** Heure cible "19:45" à partir de maintenant + minutes. */
export function readyAtLabel(minutes, from = new Date()) {
  const d = new Date(from.getTime() + Math.max(0, numOr(minutes, 0)) * 60000);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// ============================================================================
// helpers internes
// ============================================================================

function numOr(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function geoError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
function mapGeoError(err) {
  const codes = { 1: "denied", 2: "unavailable", 3: "timeout" };
  return geoError(codes[err?.code] || "unavailable", err?.message || "Erreur de géolocalisation.");
}
