// ============================================================================
// 🍳 COMMANDES — charge cuisine (signal de capacité, autorité serveur)
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, FieldValue } = require("../lib/admin");
const { V, require_ } = require("../lib/validation");
const { enforceRateLimit, callerKey } = require("../lib/rateLimit");
const { readCapacityConfig, computeKitchenLoad } = require("../lib/kitchen");

// ============================================================================
// 🔥 FONCTION : CHARGE CUISINE (signal de capacité, autorité serveur)
// ============================================================================
// Retourne { queue, avgPrepMin, rushMode } pour un snack. `rushMode` est calculé
// UNE fois côté serveur (seuils en config snacks/{snackId}.capacity, jamais en
// dur) et consommé par l'upsell (checkout) et la console cuisine admin.
// Cache court (doc cache/kitchen_load_{snackId}) : sans lui, chaque ouverture de
// checkout déclencherait une agrégation .count() + une lecture snack.
// Auth simple requise (pas admin) : ne fuit rien de sensible (queue/eta sont déjà
// exposés via l'ETA de commande). Jamais bloquant : le client fait fail-open.
exports.getKitchenLoad = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentification requise.");
  }

  // 🛡️ Rate limit (F6) — appel légitime : 1 fois par ouverture de checkout (cache
  // serveur 30s par-dessus). Borne l'énumération de la charge cuisine de snacks
  // arbitraires et le martèlement (coût Firestore) par un client authentifié.
  await enforceRateLimit({
    key: callerKey(request, "getKitchenLoad"),
    max: 20,
    windowMs: 60_000,
  });

  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { snackId } = data;
  require_(V.isDocId(snackId), "snackId invalide.");

  const snackSnap = await db.collection("snacks").doc(snackId).get();
  if (!snackSnap.exists) throw new HttpsError("not-found", "Snack introuvable.");
  const snackData = snackSnap.data() || {};
  const ttlMs = readCapacityConfig(snackData).loadCacheTtlMs;

  // 1. Cache hit valide → return direct (borne le coût Firestore par snack).
  const cacheRef = db.collection("cache").doc(`kitchen_load_${snackId}`);
  const cacheSnap = await cacheRef.get();
  const cached = cacheSnap.exists ? cacheSnap.data() : null;
  const ageMs = Date.now() - (cached?.fetchedAt?.toMillis?.() || 0);
  if (cached && ageMs < ttlMs && typeof cached.rushMode === "boolean") {
    return { queue: cached.queue, avgPrepMin: cached.avgPrepMin, rushMode: cached.rushMode, cached: true };
  }

  // 2. Cache miss / expiré → recalcul + écriture cache.
  const load = await computeKitchenLoad(snackData, snackId);
  await cacheRef.set({
    ...load,
    fetchedAt: FieldValue.serverTimestamp(),
  });
  return { ...load, cached: false };
});

