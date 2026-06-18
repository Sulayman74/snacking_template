// ============================================================================
// 📍 GÉO & ETA — Haversine + helpers numériques (logique pure, sans I/O)
// ============================================================================
// Dupliqué côté client dans src/services/geoService.js (KISS : pas de package partagé
// entre /functions CommonJS et /src ESM). Source de vérité = serveur. Utilisé par
// pricing (distance livraison), kitchen (isFiniteNum) et le géofencing livreur.

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;
const isFiniteNum = (n) => typeof n === "number" && Number.isFinite(n);
const numberOrNull = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function haversineKm(a, b) {
  if (!a || !b || !isFiniteNum(a.lat) || !isFiniteNum(a.lng) || !isFiniteNum(b.lat) || !isFiniteNum(b.lng)) {
    return NaN;
  }
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Palier de géofence franchi (mètres) parmi des seuils décroissants.
// Renvoie le plus petit seuil >= distance, ou null si au-delà du plus grand.
function bucketForServer(distanceM, thresholds = [3000, 1000, 300]) {
  if (!Number.isFinite(distanceM)) return null;
  const sorted = [...thresholds].sort((a, b) => b - a);
  let crossed = null;
  for (const t of sorted) if (distanceM <= t) crossed = t;
  return crossed;
}

module.exports = { EARTH_RADIUS_KM, isFiniteNum, numberOrNull, haversineKm, bucketForServer };
