const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { getStorage } = require("firebase-admin/storage");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const path = require("path");
const os = require("os");
const fs = require("fs");
const sharp = require("sharp");
const admin = require("firebase-admin");
const { getStripe, resolveSubscriptionId } = require("./lib/stripe");
const { normalizeTvaRate, ventilateTva } = require("./lib/tva");

// Initialisation de Firebase Admin
admin.initializeApp();

// 🚨 CORRECTION 1 : On branche la base de données !
const db = admin.firestore();

// Force toutes les fonctions à être hébergées à Paris (europe-west9)
setGlobalOptions({ region: "europe-west9" });

// ============================================================================
// 🛡️ HELPERS — VALIDATION & RATE LIMITING
// ============================================================================

// --- Validation primitives ---
const V = {
  isString: (v) => typeof v === "string",
  isNonEmptyString: (v, max = 1000) =>
    typeof v === "string" && v.length > 0 && v.length <= max,
  isInt: (v) => Number.isInteger(v),
  isPositiveInt: (v, max = Number.MAX_SAFE_INTEGER) =>
    Number.isInteger(v) && v > 0 && v <= max,
  isPlainObject: (v) =>
    v !== null && typeof v === "object" && !Array.isArray(v),
  isArray: (v) => Array.isArray(v),
  isEmail: (v) =>
    typeof v === "string" && v.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  // Firestore doc IDs : pas de "/", longueur 1..1500
  isDocId: (v) =>
    typeof v === "string" && v.length > 0 && v.length <= 1500 && !v.includes("/"),
};

function require_(cond, msg) {
  if (!cond) throw new HttpsError("invalid-argument", msg);
}

// Limite la profondeur des metadata acceptés par Stripe (clés/valeurs <=500 chars)
function sanitizeStripeMetadata(metadata) {
  if (!V.isPlainObject(metadata)) return {};
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(metadata)) {
    if (count++ >= 50) break;
    if (typeof k !== "string" || k.length > 40) continue;
    const value = v == null ? "" : String(v);
    if (value.length > 500) continue;
    out[k] = value;
  }
  return out;
}

// --- Rate limiting (sliding window via Firestore transaction) ---
// Stocke un compteur + un début de fenêtre. Atomique — pas de race condition.
async function enforceRateLimit({ key, max, windowMs }) {
  const ref = db.collection("rateLimits").doc(key);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const windowStart = data?.windowStart?.toMillis?.() ?? 0;
    const count = data?.count ?? 0;

    if (!data || now - windowStart > windowMs) {
      tx.set(ref, {
        count: 1,
        windowStart: admin.firestore.Timestamp.fromMillis(now),
      });
      return;
    }

    if (count >= max) {
      throw new HttpsError(
        "resource-exhausted",
        "Trop de tentatives. Réessayez dans quelques instants."
      );
    }

    tx.update(ref, { count: count + 1 });
  });
}

// Détecte un token FCM devenu invalide (PWA réinstallée, désinstallation, etc.)
function isInvalidFcmTokenError(error) {
  const code = error?.code || error?.errorInfo?.code;
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  );
}

// Nettoie le fcmToken Firestore si l'erreur indique un token mort.
// Retourne true si nettoyage effectué.
async function cleanupInvalidFcmToken(userId, error) {
  if (!isInvalidFcmTokenError(error)) return false;
  try {
    await db.collection("users").doc(userId).update({
      fcmToken: admin.firestore.FieldValue.delete(),
    });
    console.log(`🧹 Token FCM invalide nettoyé pour user ${userId}`);
    return true;
  } catch (e) {
    console.error(`❌ Échec cleanup token user ${userId}:`, e);
    return false;
  }
}

// Palier fidélité partagé (scan boutique ET commande payée). À MAX → menu offert.
const MAX_LOYALTY_POINTS = 10;

// 🛡️ ANTI-DOUBLON (F3) — fenêtre pendant laquelle un client ne peut gagner qu'UN
// point par snack, TOUS CANAUX confondus (scan boutique + commande en ligne). Évite
// le double crédit pour un même achat (ex. commande en ligne puis scan du QR au
// comptoir). Configurable par snack via loyalty.creditCooldownMin (0 = désactivé).
const DEFAULT_LOYALTY_COOLDOWN_MS = 10 * 60_000; // 10 min

/**
 * Résout la fenêtre anti-doublon (ms) d'un snack : loyalty.creditCooldownMin (minutes,
 * 0 désactive) sinon le défaut. Lue UNE fois par l'appelant et passée au helper, pour
 * que scan et commande partagent EXACTEMENT le même cooldown (unification F3).
 * @param {Object} snackData - Document snacks/{snackId}.
 * @returns {number} Durée du cooldown en millisecondes (>= 0).
 */
function resolveLoyaltyCooldownMs(snackData) {
  const min = Number(snackData?.loyalty?.creditCooldownMin);
  if (Number.isFinite(min) && min >= 0) return Math.round(min * 60_000);
  return DEFAULT_LOYALTY_COOLDOWN_MS;
}

/**
 * Crédite n point(s) de fidélité (EARNING) sur pointsBySnack.{snackId}, dans une transaction.
 *
 * Modèle "report + banque" (LOT F2 — traçabilité fidélité) :
 *   - Le compteur pointsBySnack.{snackId} ne représente QUE la progression 0..MAX-1.
 *   - Au franchissement du palier, on N'écrase PAS le point gagné : le total est
 *     reporté (`total % MAX`) et chaque palier complété banque une récompense durable
 *     dans rewardsAvailable.{snackId} (`floor(total / MAX)`). Plus aucun point perdu.
 *   - La récompense est PERSISTÉE (banque) puis consommée par redeemLoyaltyReward.
 *
 * Anti-doublon (LOT F3) : si un crédit a déjà eu lieu sur la fenêtre `cooldownMs`
 * (loyaltyLastCredit.{snackId}, écrit ICI à chaque crédit → unifié scan + commande),
 * on NE crédite PAS et on renvoie `{skipped:true}` (l'appelant décide : le scan lève
 * une erreur lisible, la commande payée ignore silencieusement). N'émet PAS le push
 * (effet de bord après commit). Read-Old/Write-New : champs absents traités comme 0.
 *
 * @param {FirebaseFirestore.Transaction} tx - Transaction Firestore en cours.
 * @param {FirebaseFirestore.DocumentReference} clientRef - Réf. du doc users/{uid}.
 * @param {string} snackId - Clé de partitionnement multi-tenant.
 * @param {number} [n=1] - Nombre de points à créditer (1 en pratique : scan & commande).
 * @param {number} [cooldownMs=DEFAULT_LOYALTY_COOLDOWN_MS] - Fenêtre anti-doublon (0 = off).
 * @returns {Promise<{skipped:boolean, points:number, max:number, reward:boolean, earned:number, rewardsAvailable:number, fcmToken:(string|null)}>}
 * @throws {HttpsError} not-found si le doc client n'existe pas.
 */
async function creditLoyaltyPoints(tx, clientRef, snackId, n = 1, cooldownMs = DEFAULT_LOYALTY_COOLDOWN_MS) {
  const snap = await tx.get(clientRef);
  if (!snap.exists) throw new HttpsError("not-found", "Client introuvable.");
  const d = snap.data();
  const current = (d.pointsBySnack || {})[snackId] || 0;
  const availableBefore = (d.rewardsAvailable || {})[snackId] || 0;

  // 🛡️ Cooldown anti-doublon (F3) — tous canaux confondus via loyaltyLastCredit.
  const lastCredit = (d.loyaltyLastCredit || {})[snackId];
  const lastMs = lastCredit && lastCredit.toMillis ? lastCredit.toMillis() : 0;
  if (cooldownMs > 0 && lastMs && Date.now() - lastMs < cooldownMs) {
    return {
      skipped: true,
      points: current,
      max: MAX_LOYALTY_POINTS,
      reward: false,
      earned: 0,
      rewardsAvailable: availableBefore,
      fcmToken: d.fcmToken || null,
    };
  }

  // Report : le point gagné compte toujours, même au franchissement du palier.
  const total = current + n;
  const earned = Math.floor(total / MAX_LOYALTY_POINTS); // récompenses banquées (0 ou 1 en pratique)
  const newPoints = total % MAX_LOYALTY_POINTS;          // progression reportée 0..MAX-1
  const newAvailable = availableBefore + earned;

  const update = {
    [`pointsBySnack.${snackId}`]: newPoints,
    // Horodatage unifié du dernier crédit (anti-doublon F3, scan + commande).
    [`loyaltyLastCredit.${snackId}`]: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (earned > 0) update[`rewardsAvailable.${snackId}`] = newAvailable;
  tx.update(clientRef, update);

  return {
    skipped: false,
    points: newPoints,
    max: MAX_LOYALTY_POINTS,
    reward: earned > 0,
    earned,
    rewardsAvailable: newAvailable,
    fcmToken: d.fcmToken || null,
  };
}

/**
 * Émet le push de palier « menu offert ». À appeler APRÈS le commit de la transaction
 * (jamais dans une transaction). No-op si le client n'a pas de token. Nettoie un token mort.
 * @param {string} userId - uid du client (pour le cleanup du token).
 * @param {string|null} fcmToken - Token FCM du client.
 * @param {string} snackId - Snack à l'origine de la récompense (transmis au front).
 * @returns {Promise<void>}
 */
async function sendRewardPush(userId, fcmToken, snackId) {
  if (!fcmToken) return; // crédit OK sans token → pas de crash
  try {
    await getMessaging().send({
      notification: {
        title: "🎁 Menu offert !",
        body: "Bravo ! Tu as atteint le palier fidélité. Ton prochain menu est offert 🍟",
      },
      data: { type: "REWARD_UNLOCKED", snackId: String(snackId) },
      token: fcmToken,
    });
  } catch (error) {
    await cleanupInvalidFcmToken(userId, error);
  }
}

// Identifie un appelant : uid si auth, sinon hash IP (X-Forwarded-For)
function callerKey(request, action) {
  if (request.auth?.uid) return `${action}_uid_${request.auth.uid}`;
  const xff = request.rawRequest?.headers?.["x-forwarded-for"];
  const ip =
    (typeof xff === "string" ? xff.split(",")[0].trim() : null) ||
    request.rawRequest?.ip ||
    "unknown";
  // On normalise l'IP en clé Firestore safe
  const safeIp = ip.replace(/[^a-zA-Z0-9.:_-]/g, "_").slice(0, 60);
  return `${action}_ip_${safeIp}`;
}

// --- Géo & ETA livraison (Haversine, sans dépendance) -----------------------
// Dupliqué côté client dans src/services/geoService.js (KISS : pas de package
// partagé entre /functions CommonJS et /src ESM). Source de vérité = serveur.
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

// Vérifie que l'appelant est admin du snack (ou superadmin). Rôles en Firestore
// (cohérent avec firestore.rules : getAuthUser()), PAS en custom claims.
async function assertCallerIsSnackAdmin(request, snackId) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const c = callerDoc.exists ? callerDoc.data() : null;
  const ok = c && (c.role === "superadmin" || (c.role === "admin" && c.snackId === snackId));
  if (!ok) throw new HttpsError("permission-denied", "Réservé à l'administrateur du snack.");
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

// Nombre de commandes "en cours" pour un snack (file d'attente cuisine).
async function getKitchenQueueCount(snackId) {
  try {
    const agg = await db
      .collection("commandes")
      .where("snackId", "==", snackId)
      .where("statut", "in", ["en_attente_client", "nouvelle"])
      .count()
      .get();
    return agg.data().count || 0;
  } catch (e) {
    console.warn("[eta] queue count indisponible :", e.message);
    return 0;
  }
}

// Minutes de préparation estimées depuis la file et la config delivery.
// Source de vérité UNIQUE, consommée par finalizeOrder ET getKitchenLoad (DRY).
function computePrepMin(snackData, queueCount) {
  const d = (snackData && snackData.delivery) || {};
  const prepBaseMin = isFiniteNum(d.prepBaseMin) ? d.prepBaseMin : 12;
  const queueFactorMin = isFiniteNum(d.queueFactorMin) ? d.queueFactorMin : 3;
  return Math.max(1, Math.round(prepBaseMin + queueFactorMin * queueCount));
}

// Seuils de capacité cuisine, lus depuis snacks/{snackId}.capacity avec des
// défauts serveur sûrs (zéro migration : un snack sans `capacity` reste valide).
function readCapacityConfig(snackData) {
  const c = (snackData && snackData.capacity) || {};
  return {
    rushThreshold: isFiniteNum(c.rushThreshold) && c.rushThreshold > 0 ? c.rushThreshold : 8,
    prepCeilingMin: isFiniteNum(c.prepCeilingMin) && c.prepCeilingMin > 0 ? c.prepCeilingMin : 30,
    loadCacheTtlMs:
      (isFiniteNum(c.loadCacheTtlSec) && c.loadCacheTtlSec > 0 ? c.loadCacheTtlSec : 30) * 1000,
  };
}

// Décision de capacité (sans cache) : file + prep estimée → rushMode.
// Calculée UNE fois côté serveur, consommée par getKitchenLoad et pushFlashOffer.
async function computeKitchenLoad(snackData, snackId) {
  const cfg = readCapacityConfig(snackData);
  const queue = await getKitchenQueueCount(snackId);
  const avgPrepMin = computePrepMin(snackData, queue);
  const rushMode = queue >= cfg.rushThreshold || avgPrepMin >= cfg.prepCeilingMin;
  return { queue, avgPrepMin, rushMode };
}

// --- Anti-fraude prix : recalcul depuis la base, jamais le prix du client ------
// Ensemble des prix unitaires LÉGITIMES d'un produit (en centimes) :
//   - base : `prix` (produit simple) OU chaque `tailles[].prix` (produit taillé)
//   - +menu : base + (menuPriceAdd || 2.5), réplique exacte du calcul client
//             (src/product-modal.js : prixMenu = menuPriceAdd || 2.5).
// On inclut toujours la variante menu : elle ne fait qu'AUGMENTER le prix, donc
// l'autoriser ne peut pas baisser le plancher anti-fraude.
function allowedUnitPriceCents(product) {
  const cents = (e) => Math.round(Number(e) * 100);
  const menuAdd = product.menuPriceAdd || 2.5; // 0/undefined → 2.5 (cf. client)
  const bases =
    Array.isArray(product.tailles) && product.tailles.length > 0
      ? product.tailles.map((t) => Number(t.prix))
      : [Number(product.prix)];

  const set = new Set();
  for (const b of bases) {
    if (!Number.isFinite(b)) continue;
    set.add(cents(b));
    set.add(cents(b + menuAdd));
  }
  return set;
}

// Vérifie que CHAQUE prix unitaire facturé correspond à un prix réel du produit en
// base (anti-fraude) et calcule le sous-total articles + la ventilation TVA. La
// couverture par l'encaissement Stripe est vérifiée par l'appelant (finalizeOrder),
// car createPaymentIntent appelle ce helper AVANT tout débit (le montant n'existe
// pas encore). Lève une HttpsError si une manipulation de prix est détectée.
async function priceCartItems(cartItems, snackId) {
  const TOL = 1; // ±1 centime (arrondis flottants)

  // Lecture groupée des produits (un getAll au lieu de N getDoc).
  const ids = [...new Set(cartItems.map((i) => i.productId).filter(Boolean))];
  require_(ids.length > 0, "Aucun produit identifiable dans le panier.");
  const refs = ids.map((id) => db.collection("produits").doc(id));
  const snaps = await db.getAll(...refs);
  const products = new Map();
  snaps.forEach((s) => { if (s.exists) products.set(s.id, s.data()); });

  let expectedItemsCents = 0;
  const lines = [];
  for (const item of cartItems) {
    const product = products.get(item.productId);
    require_(!!product, `Produit introuvable : ${item.productId}.`);
    // Cloisonnement multi-tenant : le produit doit appartenir au snack commandé.
    require_(product.snackId === snackId, "Produit hors du restaurant ciblé.");

    const paidCents = Math.round(Number(item.prix) * 100);
    const allowed = allowedUnitPriceCents(product);
    const ok = [...allowed].some((a) => Math.abs(a - paidCents) <= TOL);
    require_(ok, `Prix manipulé pour « ${item.nom} » (${item.prix} € non autorisé).`);

    const ttcCents = paidCents * item.quantity;
    expectedItemsCents += ttcCents;
    // tvaRate LU EN BASE (jamais du client) → ventilation TVA fiable (LOT A).
    lines.push({ productId: item.productId, ttcCents, tvaRate: normalizeTvaRate(product.tvaRate) });
  }

  // itemsCents : sous-total articles (centimes), prix validés → réutilisable (minOrder).
  // lines : ventilation par ligne (TTC + taux) pour le calcul tvaBreakdown (LOT A).
  return { itemsCents: expectedItemsCents, lines };
}

/**
 * Recalcule et VALIDE le total d'une commande à partir de sources SERVEUR de
 * confiance (prix produits en base, config livraison du snack). Source de vérité
 * UNIQUE (DRY) consommée par createPaymentIntent (montant du PaymentIntent, fixé
 * AVANT débit → anti charge orpheline F1) ET finalizeOrder (montant de la commande).
 * Lève une HttpsError si fraude prix / adresse hors-zone / panier sous le minimum.
 * @param {Object} snackData - Document snacks/{snackId} (config livraison incluse).
 * @param {string} snackId - Clé multi-tenant.
 * @param {Array<Object>} cartItems - Articles du panier (prix recalculés en base).
 * @param {"collect"|"delivery"} orderMode - Mode de la commande.
 * @param {Object|null} livraison - Adresse client {lat,lng,adresse} (mode delivery).
 * @returns {Promise<{itemsCents:number, lines:Array, fraisCents:number, totalCents:number, livraisonData:(Object|null), distanceKm:(number|null)}>}
 * @throws {HttpsError} prix manipulé / out-of-range / minimum non atteint.
 */
async function computeAuthoritativeOrder(snackData, snackId, cartItems, orderMode, livraison) {
  const { itemsCents, lines } = await priceCartItems(cartItems, snackId);

  let livraisonData = null;
  let distanceKm = null;
  let fraisCents = 0;

  if (orderMode === "delivery") {
    const dcfg = snackData.delivery || {};
    const resto = { lat: numberOrNull(snackData.restaurantLat), lng: numberOrNull(snackData.restaurantLng) };
    const client = { lat: livraison.lat, lng: livraison.lng };
    const d = haversineKm(resto, client);
    const hasDist = Number.isFinite(d);
    distanceKm = hasDist ? d : null;

    // 🛡️ REJET HORS-ZONE — autorité serveur sur la zone. On n'enforce que si un
    // rayon est configuré et la distance calculable (resto non géocodé / rayon
    // absent → permissif, cohérent avec le quoteDelivery client). Borne <= radiusKm.
    const radiusKm = Number(dcfg.radiusKm);
    if (Number.isFinite(radiusKm) && radiusKm > 0 && hasDist && d > radiusKm) {
      throw new HttpsError("out-of-range", "Adresse hors de la zone de livraison de ce restaurant.");
    }

    // 🛡️ PANIER MINIMUM — uniquement en livraison, sur le SOUS-TOTAL articles.
    const minOrder = Number(dcfg.minOrder);
    if (Number.isFinite(minOrder) && minOrder > 0 && itemsCents < Math.round(minOrder * 100)) {
      throw new HttpsError(
        "failed-precondition",
        `Minimum de commande pour la livraison : ${minOrder.toFixed(2)} €.`
      );
    }

    livraisonData = {
      adresse: (livraison.adresse || "").toString().slice(0, 300),
      lat: client.lat,
      lng: client.lng,
      distanceKm: hasDist ? Math.round(d * 10) / 10 : null,
      frais: isFiniteNum(dcfg.frais) ? dcfg.frais : 0, // frais issus de la config (jamais du client)
    };
    fraisCents = Math.round((livraisonData.frais || 0) * 100);
  }

  return { itemsCents, lines, fraisCents, totalCents: itemsCents + fraisCents, livraisonData, distanceKm };
}

/**
 * Rembourse (best-effort) une charge devenue ORPHELINE : le PaymentIntent a réussi
 * (client débité) mais la commande est rejetée APRÈS débit (prix manipulé entre la
 * création du PI et la finalisation, panier divergent…). Évite de laisser de l'argent
 * encaissé sans contrepartie (F1). Idempotent (clé), no-op si déjà remboursé, et ne
 * masque JAMAIS l'erreur de validation d'origine (on log seulement en cas d'échec).
 * @param {import("stripe").Stripe} stripe - Client Stripe.
 * @param {Object} paymentIntent - PI récupéré (latest_charge éventuellement expandé).
 * @param {string|null} stripeAccountId - Compte connecté (charge directe) ou null.
 * @returns {Promise<void>}
 */
async function refundOrphanChargeBestEffort(stripe, paymentIntent, stripeAccountId) {
  try {
    const charge = paymentIntent.latest_charge;
    const alreadyRefunded =
      charge && typeof charge === "object" &&
      (charge.refunded === true || Number(charge.amount_refunded) > 0);
    if (alreadyRefunded) return;

    const opts = { idempotencyKey: `orphan_refund_${paymentIntent.id}` };
    if (stripeAccountId) opts.stripeAccount = stripeAccountId;
    await stripe.refunds.create({ payment_intent: paymentIntent.id }, opts);
    console.warn(`↩️ Charge orpheline remboursée (PI ${paymentIntent.id}) : commande rejetée après débit.`);
  } catch (refundErr) {
    console.error(`❌ Échec remboursement auto charge orpheline (PI ${paymentIntent.id}) :`, refundErr);
  }
}

// ============================================================================
// 🎁 FIDÉLITÉ — le push de palier « menu offert » est désormais émis À LA SOURCE
// (sendRewardPush, après crédit) par awardLoyaltyPoint (scan) ET finalizeOrder
// (commande payée). L'ancien trigger notifierMenuOffert écoutait le champ plat
// `points` (jamais écrit : les points vivent dans pointsBySnack.{snackId}) → il
// ne partait jamais. Supprimé pour éviter tout double-push et code mort.
// ============================================================================

// ============================================================================
// 🖼️ FONCTION 2 : OPTIMISATION D'IMAGES (SHARP)
// ============================================================================
exports.optimizeImage = onObjectFinalized(
  { memory: "512MiB" },
  async (event) => {
    const fileBucket = event.data.bucket;
    const filePath = event.data.name;
    const contentType = event.data.contentType;

    if (
      !contentType.startsWith("image/") ||
      !filePath.startsWith("produits/")
    ) {
      return logger.log("Fichier ignoré (Pas une image de produit).");
    }

    if (event.data.metadata && event.data.metadata.optimized === "true") {
      return logger.log("Image déjà optimisée.");
    }

    const bucket = getStorage().bucket(fileBucket);
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(os.tmpdir(), fileName);
    const tempOptimizedPath = path.join(os.tmpdir(), `opt_${fileName}`);

    try {
      logger.log(`Téléchargement de ${filePath} pour optimisation...`);
      await bucket.file(filePath).download({ destination: tempFilePath });

      logger.log("Compression en cours avec Sharp...");
      await sharp(tempFilePath)
        .resize(800, 800, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toFile(tempOptimizedPath);

      // ⚠️ On préserve le token de téléchargement existant. Le client appelle
      // getDownloadURL() (qui pose firebaseStorageDownloadTokens) puis stocke l'URL
      // dans Firestore. Réécrire l'objet sans reporter ce token l'invaliderait
      // → l'URL en base renverrait 403 (image cassée). On le lit juste avant l'upload
      // pour laisser le temps au getDownloadURL client de l'avoir posé.
      let downloadToken;
      try {
        const [existingMeta] = await bucket.file(filePath).getMetadata();
        downloadToken = existingMeta?.metadata?.firebaseStorageDownloadTokens;
      } catch (e) {
        logger.warn("Lecture du token existant impossible (conservation ignorée) :", e);
      }

      logger.log("Upload de l'image optimisée...");
      await bucket.upload(tempOptimizedPath, {
        destination: filePath,
        metadata: {
          contentType: "image/webp",
          metadata: {
            optimized: "true",
            ...(downloadToken ? { firebaseStorageDownloadTokens: downloadToken } : {}),
          },
        },
      });

      fs.unlinkSync(tempFilePath);
      fs.unlinkSync(tempOptimizedPath);

      return logger.log(`✅ Succès ! L'image ${fileName} a été compressée.`);
    } catch (error) {
      logger.error("❌ Erreur lors de l'optimisation :", error);
      return null;
    }
  },
);

// ============================================================================
// 🛠️ OUTILS : GÉNÉRATEUR DE CODE ET DÉCOUPEUR
// ============================================================================
function generateSecretCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function chunkArray(array, size) {
  const chunked = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
}

// ============================================================================
// 🚀 FONCTION 3 : LE ROBOT MARKETING PUSH (CRON JOB)
// ============================================================================
exports.processPushCampaigns = onSchedule(
  { schedule: "every 5 minutes", region: "europe-west1" },
  async (_event) => {
    const now = admin.firestore.Timestamp.now();

    const thirtyDaysAgoDate = new Date();
    thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
    const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(thirtyDaysAgoDate);

    try {
      // 🩹 Récupération des campagnes ORPHELINES : si un run a claim une campagne
      // (en_attente → en_cours) puis a crashé avant la finalisation, elle resterait
      // bloquée en "en_cours" à vie. On la remet en file si elle y traîne > 15 min
      // (claimedAt absent = orphelin d'avant ce correctif → toujours remis en file).
      const STUCK_MS = 15 * 60 * 1000;
      const stuckSnap = await db
        .collection("campagnes_push")
        .where("statut", "==", "en_cours")
        .get();
      for (const d of stuckSnap.docs) {
        const claimedMs = d.data().claimedAt?.toMillis?.() || 0;
        if (Date.now() - claimedMs > STUCK_MS) {
          await d.ref.update({ statut: "en_attente" });
          console.log(`🩹 Campagne ${d.id} orpheline (en_cours figé) → remise en file.`);
        }
      }

      const snapshot = await db
        .collection("campagnes_push")
        .where("statut", "==", "en_attente")
        .where("dateEnvoiPrevue", "<=", now)
        .get();

      if (snapshot.empty) return null;

      for (const doc of snapshot.docs) {
        // 🔒 Claim atomique : on réserve la campagne (en_attente → en_cours) AVANT
        // tout envoi. Si un autre run l'a déjà prise (le CAS échoue) → on l'ignore.
        // Anti double-envoi si deux exécutions du cron se chevauchent (run > 5 min).
        try {
          await db.runTransaction(async (tx) => {
            const fresh = await tx.get(doc.ref);
            if (!fresh.exists || fresh.data().statut !== "en_attente") {
              throw new Error("already-claimed");
            }
            // claimedAt horodate le claim → permet la récupération des orphelines.
            tx.update(doc.ref, {
              statut: "en_cours",
              claimedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          });
        } catch (claimErr) {
          console.log(`Campagne ${doc.id} déjà réservée par un autre run — ignorée.`);
          continue;
        }

        const campagne = doc.data();

        const usersSnapshot = await db
          .collection("users")
          .where("snackId", "==", campagne.snackId)
          .where("fcmToken", "!=", null)
          .get();

        // 🎯 1. On stocke des objets {token, uid} pour identifier qui nettoyer plus tard
        const targetUsers = [];

        usersSnapshot.forEach((userDoc) => {
          const user = userDoc.data();
          const lastOrder = user.lastOrderDate;

          let isMatch = false;
          if (campagne.cible === "active") {
            if (lastOrder && lastOrder.toMillis() >= thirtyDaysAgo.toMillis()) {
              isMatch = true;
            }
          } else if (campagne.cible === "inactive") {
            if (!lastOrder || lastOrder.toMillis() < thirtyDaysAgo.toMillis()) {
              isMatch = true;
            }
          } else {
            isMatch = true;
          }

          if (isMatch) {
            targetUsers.push({ token: user.fcmToken, uid: userDoc.id });
          }
        });

        if (targetUsers.length === 0) {
          await doc.ref.update({
            statut: "annulee_sans_cible",
            dateEnvoiReelle: admin.firestore.FieldValue.serverTimestamp(),
            notes: "Ciblage n'a retourné aucun client",
          });
          console.log(
            `⚠️ Campagne ${doc.id} annulée : Aucun utilisateur trouvé.`,
          );
          continue;
        }

        // 🎯 2. On découpe notre liste d'objets
        const userChunks = chunkArray(targetUsers, 500);
        let totalSuccess = 0;
        let totalErrors = 0;

        const baseUrl = "https://snacking-template.web.app/";

        const basePayload = {
          notification: {
            title: campagne.titre,
            body: campagne.message,
            ...(campagne.imageUrl && { image: campagne.imageUrl }),
          },
          data: {
            actionUrl: campagne.actionUrl || "",
            // Tracking des clics : le SW renvoie campaignId/snackId à trackPushClick.
            campaignId: doc.id,
            snackId: campagne.snackId || "",
          },
          webpush: {
            fcm_options: {
              link: campagne.actionUrl
                ? `${baseUrl}${campagne.actionUrl}`
                : baseUrl,
            },
          },
        };

        for (const chunk of userChunks) {
          // On extrait uniquement les tokens pour l'envoi FCM
          const tokens = chunk.map((u) => u.token);
          const payload = { ...basePayload, tokens };

          const response = await admin
            .messaging()
            .sendEachForMulticast(payload);

          // Mise à jour des compteurs globaux de la campagne
          totalSuccess += response.successCount;
          totalErrors += response.failureCount;

          // 🧹 3. Nettoyage intelligent des jetons obsolètes
          const batch = db.batch();
          let needsCleanup = false;

          response.responses.forEach((res, idx) => {
            if (!res.success) {
              const error = res.error.code;
              // On ne supprime que si le token est explicitement invalide ou expiré
              if (
                error === "messaging/registration-token-not-registered" ||
                error === "messaging/invalid-registration-token"
              ) {
                const userId = chunk[idx].uid; // Grâce à l'index, on retrouve le bon UID
                batch.update(db.collection("users").doc(userId), {
                  fcmToken: admin.firestore.FieldValue.delete(),
                });
                needsCleanup = true;
              }
            }
          });

          if (needsCleanup) {
            await batch.commit();
            console.log(
              `🧹 Nettoyage effectué pour un lot de jetons invalides.`,
            );
          }
        }

        // Finalisation de la campagne en base. ⚠️ Chemins POINTÉS pour ne PAS
        // écraser stats.clics (incrémenté de façon asynchrone par trackPushClick
        // quand les clients cliquent sur la notification).
        await doc.ref.update({
          statut: "envoyee",
          dateEnvoiReelle: admin.firestore.FieldValue.serverTimestamp(),
          "stats.envoye": totalSuccess,
          "stats.erreurs": totalErrors,
        });

        console.log(
          `✅ Campagne ${doc.id} terminée (${campagne.cible}). Succès: ${totalSuccess} | Erreurs: ${totalErrors}`,
        );
      }
    } catch (error) {
      console.error("❌ Erreur critique Push :", error);
    }
  },
);

// ============================================================================
// 💳 FONCTION 4 : LE TIROIR-CAISSE (STRIPE CHECKOUT)
// ============================================================================

exports.createPaymentIntent = onCall(
  { region: "europe-west1" },
  async (request) => {
    const stripe = getStripe();

    // 🛡️ Authentification obligatoire : le client est forcément loggé pour
    // commander (cf. src/checkout.js). Ferme la porte aux appels anonymes
    // (création massive d'intents / sondage des snackId).
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    // 🛡️ Rate limit AVANT toute logique : 10 tentatives / 60s par utilisateur (ou IP)
    await enforceRateLimit({
      key: callerKey(request, "createPaymentIntent"),
      max: 10,
      windowMs: 60_000,
    });

    // 🛡️ Validation stricte des entrées
    const data = request.data;
    require_(V.isPlainObject(data), "Payload invalide.");

    // 🛡️ ANTI CHARGE ORPHELINE (F1) — le montant du PaymentIntent est désormais
    // RECALCULÉ côté serveur depuis le panier + la config livraison (jamais le
    // `amount` client, conservé seulement pour compat/traçabilité). On valide donc
    // le panier AVANT de débiter : prix manipulé / hors-zone / minimum → rejet sans
    // aucune charge. Le client recalculait déjà côté UI ; ici c'est l'autorité.
    const { currency, description, metadata, snackId, cartItems, mode, livraison } = data;

    require_(V.isDocId(snackId), "snackId invalide.");
    require_(V.isArray(cartItems) && cartItems.length > 0, "cartItems vide ou invalide.");
    require_(cartItems.length <= 100, "Panier trop volumineux.");
    require_(
      currency === undefined || (V.isString(currency) && /^[a-z]{3}$/i.test(currency)),
      "Devise invalide."
    );
    require_(
      description === undefined ||
        (V.isString(description) && description.length <= 1000),
      "Description invalide."
    );
    require_(
      metadata === undefined || V.isPlainObject(metadata),
      "Metadata invalides."
    );

    // Validation détaillée de chaque item (même contrat que finalizeOrder).
    for (const item of cartItems) {
      require_(V.isPlainObject(item), "Item de panier invalide.");
      require_(V.isNonEmptyString(item.nom, 200), "Nom d'item invalide.");
      require_(
        typeof item.prix === "number" && item.prix >= 0 && item.prix < 10_000,
        "Prix d'item invalide."
      );
      require_(V.isPositiveInt(item.quantity, 100), "Quantité d'item invalide.");
    }

    // 🚚 Mode + adresse de livraison (collect par défaut → legacy inchangé).
    const orderMode = mode === "delivery" ? "delivery" : "collect";
    if (orderMode === "delivery") {
      require_(V.isPlainObject(livraison), "livraison requise pour une commande en livraison.");
      require_(isFiniteNum(livraison.lat) && Math.abs(livraison.lat) <= 90, "Latitude de livraison invalide.");
      require_(isFiniteNum(livraison.lng) && Math.abs(livraison.lng) <= 180, "Longitude de livraison invalide.");
      require_(
        livraison.adresse === undefined ||
          livraison.adresse === null ||
          (V.isString(livraison.adresse) && livraison.adresse.length <= 300),
        "Adresse de livraison invalide."
      );
    }

    try {
      // 1. Récupération du Snack (Tenant) + config Stripe Connect.
      const snackDoc = await db.collection("snacks").doc(snackId).get();
      const snackData = snackDoc.exists ? (snackDoc.data() || {}) : {};
      const stripeAccountId = snackData.stripeAccountId || null;

      // 🛡️ Garde : compte connecté créé mais onboarding NON terminé.
      if (stripeAccountId && snackData.stripeChargesEnabled === false) {
        throw new HttpsError(
          "failed-precondition",
          "Le compte Stripe du restaurant n'a pas terminé sa configuration."
        );
      }

      // 2. 🛡️ MONTANT AUTORITATIF — recalcul + validation panier/zone/minimum AVANT
      //    tout débit. Toute manipulation rejette ici, sans charge orpheline (F1).
      const { totalCents } = await computeAuthoritativeOrder(snackData, snackId, cartItems, orderMode, livraison);
      require_(totalCents >= 50, "Montant inférieur au minimum (0,50 €).");

      // Règle Métier : 0% les 6 premiers mois, puis 8% (sur le total SERVEUR).
      let applicationFeeAmount = 0;
      if (stripeAccountId) {
        const createdAt = snackData.createdAt?.toDate() || new Date();
        const now = new Date();
        const diffMonths = (now.getFullYear() - createdAt.getFullYear()) * 12 + (now.getMonth() - createdAt.getMonth());
        if (diffMonths >= 6) applicationFeeAmount = Math.round(totalCents * 0.08);
      }

      // 3. Préparation des paramètres du PaymentIntent (montant = total serveur).
      const params = {
        amount: totalCents,
        currency: currency ? currency.toLowerCase() : "eur",
        description: description || "Commande en ligne",
        // Metadata SERVEUR de confiance (traçabilité) en plus de celles du client.
        // order_id ≡ paymentIntentId (id de commande déterministe dans finalizeOrder),
        // donc déjà traçable sans le dupliquer ici.
        metadata: sanitizeStripeMetadata({
          ...(metadata || {}),
          snack_id: snackId,
          client_email: request.auth?.token?.email || metadata?.clientEmail || "",
        }),
        automatic_payment_methods: { enabled: true },
      };

      // 4. Optionnel : Routage Stripe Connect (charge directe sur le compte connecté).
      let requestOptions = undefined;
      if (stripeAccountId) {
          if (applicationFeeAmount > 0) {
              params.application_fee_amount = applicationFeeAmount;
          }
          requestOptions = { stripeAccount: stripeAccountId };
      }

      const paymentIntent = await stripe.paymentIntents.create(params, requestOptions);

      // `stripeAccountId` est renvoyé au client : en charge DIRECTE, Stripe.js doit
      // initialiser Elements avec `{ stripeAccount }` (sinon elements/sessions → 400,
      // la clé plateforme ne voit pas le PI du compte connecté). Non sensible : c'est
      // un identifiant de compte (les docs `snacks` sont déjà en lecture publique).
      return { clientSecret: paymentIntent.client_secret, stripeAccountId: stripeAccountId || null };
    } catch (error) {
      console.error("❌ Erreur Stripe PaymentIntent :", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Impossible d'initialiser le paiement.");
    }
  },
);

// ============================================================================
// 🏦 STRIPE CONNECT : ONBOARDING (Account Link) + PORTAIL (Login Link)
// ============================================================================
// Crée (idempotent) le compte Express du snack et renvoie un lien d'onboarding.
// L'écriture de `stripeAccountId` se fait via l'Admin SDK — JAMAIS par le client
// (la rule snacks/write est document-level → ne pas laisser un admin l'auto-écrire).
exports.getStripeOnboardingLink = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = getStripe();
  const { snackId, origin } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  // URL de retour construite SERVEUR depuis une origine whitelistée (anti open-redirect).
  require_(
    V.isString(origin) && (
      /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/i.test(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ),
    "origin invalide."
  );
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "getStripeOnboardingLink"), max: 5, windowMs: 60_000 });

  try {
    const ref = db.collection("snacks").doc(snackId);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    let accountId = data.stripeAccountId || null;

    // Idempotence : on ne crée le compte connecté qu'une seule fois.
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: data.country || "FR",
        email: data.email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { snack_id: snackId },
      });
      accountId = account.id;
      await ref.set({ stripeAccountId: accountId }, { merge: true });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${origin}/admin.html?stripe=refresh`,
      return_url: `${origin}/admin.html?stripe=return`,
    });
    return { url: link.url };
  } catch (error) {
    console.error("❌ Erreur getStripeOnboardingLink :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible de générer le lien d'onboarding Stripe.");
  }
});

// Lien de connexion au portail Stripe Express (compte déjà créé).
// Appelé par le bouton "Ouvrir mon portail" (src/admin.js → openStripeExpressDashboard).
exports.createStripeConnectLoginLink = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = getStripe();
  const { snackId } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "createStripeConnectLoginLink"), max: 10, windowMs: 60_000 });

  try {
    const snap = await db.collection("snacks").doc(snackId).get();
    const accountId = snap.exists ? snap.data().stripeAccountId : null;
    require_(V.isNonEmptyString(accountId), "Compte Stripe non configuré pour ce snack.");
    const link = await stripe.accounts.createLoginLink(accountId);
    return { url: link.url };
  } catch (error) {
    console.error("❌ Erreur createStripeConnectLoginLink :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible d'ouvrir le portail Stripe.");
  }
});

// Statut LIVE du compte connecté (charges_enabled / details_submitted) + sync Firestore.
// Permet à l'UI de distinguer "compte créé mais onboarding incomplet" de "actif",
// sans dépendre de la configuration du webhook account.updated.
exports.getStripeAccountStatus = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = getStripe();
  const { snackId } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "getStripeAccountStatus"), max: 20, windowMs: 60_000 });

  try {
    const ref = db.collection("snacks").doc(snackId);
    const snap = await ref.get();
    const accountId = snap.exists ? snap.data().stripeAccountId : null;
    if (!accountId) return { connected: false, chargesEnabled: false, detailsSubmitted: false };

    const account = await stripe.accounts.retrieve(accountId);
    // Synchronise le statut dans Firestore au passage (source de vérité pour createPaymentIntent).
    await ref.set({
      stripeChargesEnabled: !!account.charges_enabled,
      stripeDetailsSubmitted: !!account.details_submitted,
      stripePayoutsEnabled: !!account.payouts_enabled,
    }, { merge: true });

    return {
      connected: true,
      chargesEnabled: !!account.charges_enabled,
      detailsSubmitted: !!account.details_submitted,
      payoutsEnabled: !!account.payouts_enabled,
    };
  } catch (error) {
    console.error("❌ Erreur getStripeAccountStatus :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible de lire le statut Stripe.");
  }
});

// ============================================================================
// 💼 ABONNEMENT SaaS (Stripe Billing) : lien Checkout à envoyer au restaurateur
// ============================================================================
// SUPERADMIN uniquement. Montant mensuel choisi (ex. 20/39/49 €) → prix INLINE
// (price_data), donc aucun Price à pré-créer dans Stripe. Le snack_id voyage en
// metadata → le webhook checkout.session.completed lie l'abonnement au snack.
exports.createSubscriptionCheckout = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = getStripe();
  const { snackId, amountEur, origin } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isPositiveInt(amountEur, 1000) && amountEur >= 5, "Montant invalide (5 à 1000 €).");
  require_(
    V.isString(origin) && (
      /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/i.test(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ),
    "origin invalide."
  );

  // 🛡️ Superadmin uniquement.
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== "superadmin") {
    throw new HttpsError("permission-denied", "Réservé au superadmin.");
  }
  await enforceRateLimit({ key: callerKey(request, "createSubscriptionCheckout"), max: 30, windowMs: 3_600_000 });

  const snackSnap = await db.collection("snacks").doc(snackId).get();
  require_(snackSnap.exists, "Snack introuvable.");
  const snackName = snackSnap.data().nom || snackId;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          product_data: { name: `Abonnement SaaS — ${snackName}` },
          unit_amount: amountEur * 100, // centimes
          recurring: { interval: "month" },
        },
      }],
      metadata: { snack_id: snackId },
      subscription_data: { metadata: { snack_id: snackId } },
      allow_promotion_codes: true,
      success_url: `${origin}/admin.html?sub=success`,
      cancel_url: `${origin}/superadmin.html?sub=cancel`,
    });
    return { url: session.url };
  } catch (error) {
    console.error("❌ createSubscriptionCheckout :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible de générer le lien d'abonnement.");
  }
});

// ============================================================================
// 💳 FONCTION 5 : FINALISATION COMMANDE (vérification Stripe côté serveur)
// ============================================================================
exports.finalizeOrder = onCall(
  { region: "europe-west1" },
  async (request) => {
    const stripe = getStripe();

    // 1. Authentification obligatoire
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }
    const uid = request.auth.uid;

    // 🛡️ Rate limit : 5 finalisations / 60s par utilisateur (au-dessus = abus)
    await enforceRateLimit({
      key: callerKey(request, "finalizeOrder"),
      max: 5,
      windowMs: 60_000,
    });

    // 🛡️ Validation stricte
    const data = request.data;
    require_(V.isPlainObject(data), "Payload invalide.");

    const {
      paymentIntentId,
      snackId,
      cartItems,
      clientEmail,
      clientNom,
      totalCents,
      referrerId,
      mode,
      livraison,
    } = data;

    require_(V.isNonEmptyString(paymentIntentId, 200), "paymentIntentId invalide.");
    require_(V.isDocId(snackId), "snackId invalide.");
    require_(V.isArray(cartItems) && cartItems.length > 0, "cartItems vide ou invalide.");
    require_(cartItems.length <= 100, "Panier trop volumineux.");
    require_(V.isEmail(clientEmail), "clientEmail invalide.");
    require_(
      clientNom === undefined ||
        clientNom === null ||
        (V.isString(clientNom) && clientNom.length <= 100),
      "clientNom invalide."
    );
    require_(V.isPositiveInt(totalCents, 1_000_000), "totalCents invalide.");
    require_(
      referrerId === undefined || referrerId === null || V.isDocId(referrerId),
      "referrerId invalide."
    );

    // 🚚 Mode + adresse de livraison (collect par défaut → legacy inchangé).
    const orderMode = mode === "delivery" ? "delivery" : "collect";
    if (orderMode === "delivery") {
      require_(V.isPlainObject(livraison), "livraison requise pour une commande en livraison.");
      require_(isFiniteNum(livraison.lat) && Math.abs(livraison.lat) <= 90, "Latitude de livraison invalide.");
      require_(isFiniteNum(livraison.lng) && Math.abs(livraison.lng) <= 180, "Longitude de livraison invalide.");
      require_(
        livraison.adresse === undefined ||
          livraison.adresse === null ||
          (V.isString(livraison.adresse) && livraison.adresse.length <= 300),
        "Adresse de livraison invalide."
      );
    }

    // Validation détaillée de chaque item du panier
    for (const item of cartItems) {
      require_(V.isPlainObject(item), "Item de panier invalide.");
      require_(V.isNonEmptyString(item.nom, 200), "Nom d'item invalide.");
      require_(
        typeof item.prix === "number" && item.prix >= 0 && item.prix < 10_000,
        "Prix d'item invalide."
      );
      require_(V.isPositiveInt(item.quantity, 100), "Quantité d'item invalide.");
    }

    // 2. Vérifier le PaymentIntent côté Stripe (le client ne peut pas falsifier ça)
    let paymentIntent;
    let snackData = {};
    try {
      const snackDoc = await db.collection("snacks").doc(snackId).get();
      if (snackDoc.exists) {
          snackData = snackDoc.data() || {};
      }
      const stripeAccountId = snackData.stripeAccountId || null;

      const retrieveOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
      // Expand latest_charge.balance_transaction → frais Stripe RÉELS (fee/net),
      // lus et non estimés (LOT A). En charge directe, la BT est sur le compte connecté.
      paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ["latest_charge.balance_transaction"] },
        retrieveOptions
      );
    } catch (e) {
      throw new HttpsError("not-found", "PaymentIntent introuvable.");
    }

    if (paymentIntent.status !== "succeeded") {
      throw new HttpsError("failed-precondition", `Paiement non confirmé (statut: ${paymentIntent.status}).`);
    }

    // 3. Le contrôle du montant encaissé est fait plus bas, APRÈS recalcul serveur
    //    du total attendu (articles validés + frais de livraison config). On ne se
    //    fie PAS au `totalCents` envoyé par le client (cf. CLAUDE.md §6.1).

    // 4. Idempotence ATOMIQUE — l'ID de la commande est dérivé du PaymentIntent
    //    (unique côté Stripe). Un check rapide évite de recalculer si la commande
    //    existe déjà ; la garantie anti-race repose sur le create() atomique (§5).
    const orderId = paymentIntentId;
    const docRef = db.collection("commandes").doc(orderId);
    const existingDoc = await docRef.get();
    if (existingDoc.exists) {
      return { orderId };
    }

    // 🛡️ MONTANT AUTORITATIF + VALIDATION — recalcul serveur (prix/zone/minimum)
    // via le helper partagé avec createPaymentIntent (DRY). Le client est DÉJÀ
    // débité (PI succeeded) : si la commande est jugée invalide ICI (cas résiduel,
    // ex. prix produit modifié entre la création du PI et la finalisation, ou panier
    // divergent), on rembourse AUTOMATIQUEMENT la charge avant de propager l'erreur
    // — plus de charge orpheline (F1). Le chemin nominal est déjà validé en amont
    // par createPaymentIntent, donc ce filet ne se déclenche qu'exceptionnellement.
    let itemsCents, lines, fraisCents, livraisonData, distanceKm;
    try {
      ({ itemsCents, lines, fraisCents, livraisonData, distanceKm } =
        await computeAuthoritativeOrder(snackData, snackId, cartItems, orderMode, livraison));

      // 🛡️ TOTAL ATTENDU SERVEUR = articles + frais de livraison (config). On EXIGE
      // que l'encaissement Stripe le couvre. ±1c (arrondis flottants).
      require_(
        paymentIntent.amount + 1 >= itemsCents + fraisCents,
        "Montant encaissé inférieur au total attendu (articles + livraison)."
      );
    } catch (validationErr) {
      await refundOrphanChargeBestEffort(stripe, paymentIntent, snackData.stripeAccountId || null);
      throw validationErr;
    }
    const expectedTotalCents = itemsCents + fraisCents;

    // 🚚 ETA (heuristique simple) — file cuisine + vitesse moyenne config.
    const dcfg = snackData.delivery || {};
    const avgSpeedKmh = isFiniteNum(dcfg.avgSpeedKmh) && dcfg.avgSpeedKmh > 0 ? dcfg.avgSpeedKmh : 22;
    const queueCount = await getKitchenQueueCount(snackId);
    const prepMin = computePrepMin(snackData, queueCount);
    const deliveryMin =
      orderMode === "delivery"
        ? (Number.isFinite(distanceKm) ? Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60)) : 0)
        : null;

    const totalMin = prepMin + (deliveryMin || 0);
    const etaData = {
      prepMin,
      deliveryMin,
      totalMin,
      computedAt: admin.firestore.Timestamp.now(),
      readyAt: admin.firestore.Timestamp.fromMillis(Date.now() + totalMin * 60000),
    };

    // 💶 SOCLE COMPTA (LOT A) — montants financiers persistés depuis des sources
    // SERVEUR de confiance, en centimes. Read-Old/Write-New : les commandes
    // antérieures n'ont aucun de ces champs (traitées en legacy côté compta).
    // Commission plateforme = LUE sur le PI (jamais recalculée).
    const commissionCents = Number(paymentIntent.application_fee_amount) || 0;
    // Frais Stripe RÉELS via la balance_transaction (expand ci-dessus). Indispo
    // (BT non encore disponible / non expandée) → null + flag pending (complété
    // plus tard par le webhook/refresh, jamais bloquant pour la commande).
    const charge = paymentIntent.latest_charge;
    const bt = charge && typeof charge === "object" ? charge.balance_transaction : null;
    const stripeFeeCents = bt && typeof bt === "object" && Number.isFinite(bt.fee) ? bt.fee : null;
    const stripeNetCents = bt && typeof bt === "object" && Number.isFinite(bt.net) ? bt.net : null;

    // Ventilation TVA (module pur) : lignes articles + frais livraison (10 %).
    const tvaBreakdown = ventilateTva(lines, fraisCents);

    // 5. Créer la commande dans Firestore (uniquement si tout est vérifié)
    const newOrder = {
      snackId,
      userId: uid,
      clientNom: clientNom || clientEmail.split("@")[0],
      clientEmail,
      secretCode: generateSecretCode(6),
      date: admin.firestore.FieldValue.serverTimestamp(),
      // Collect : on attend l'arrivée du client avant de cuisiner.
      // Livraison : la cuisine démarre immédiatement (pas d'arrivée client).
      statut: orderMode === "delivery" ? "nouvelle" : "en_attente_client",
      items: cartItems,
      // Total cohérent avec livraison.frais (articles + frais config), recalculé
      // serveur — pas le brut Stripe (qui pourrait inclure un sur-paiement client).
      total: expectedTotalCents / 100,
      mode: orderMode,
      livraison: livraisonData,
      livreurId: null,
      livreur: null,
      eta: etaData,
      paiement: {
        methode: "carte_bancaire",
        statut: "paye",
        stripeSessionId: paymentIntentId,
      },
      // 💶 Socle compta (LOT A) — tout en centimes, sources serveur.
      commission: commissionCents, // application_fee plateforme (lu sur le PI)
      stripeFee: stripeFeeCents, // frais Stripe réels (null si pas encore dispo)
      stripeNet: stripeNetCents, // net après frais Stripe (null si pending)
      stripeFeePending: stripeFeeCents === null,
      tvaBreakdown, // ventilation par taux (centimes) — cf. lib/tva.js
      // Bloc remboursement initialisé (alimenté par refundOrder — LOT B).
      refund: { total: 0, commission: 0, count: 0, fullyRefunded: false, items: [] },
    };

    // create() échoue si le doc existe déjà → idempotence atomique contre la race
    // "double-clic / retry réseau" (deux appels concurrents ayant tous deux passé
    // le check ci-dessus). Le perdant retourne l'orderId existant SANS rejouer le
    // parrainage (increment) ni lastOrderDate.
    try {
      await docRef.create(newOrder);
    } catch (e) {
      if (e.code === 6 || e.code === "already-exists") {
        return { orderId };
      }
      throw e;
    }

    // 🍟 POST-CRÉATION (best-effort) — parrainage + lastOrderDate. Un échec ici
    // ne doit JAMAIS faire échouer la réponse : la commande est créée et le
    // paiement confirmé (create() déterministe = pas de double-charge au retry).
    try {
      const userRef = db.collection("users").doc(uid);
      const userDoc = await userRef.get();

      // Première commande de l'utilisateur (lastOrderDate inexistant) ?
      // NB: .exists est une PROPRIÉTÉ dans l'Admin SDK (pas une méthode).
      if (referrerId && referrerId !== uid && (!userDoc.exists || !userDoc.data().lastOrderDate)) {
        const referrerRef = db.collection("users").doc(referrerId);
        const referrerDoc = await referrerRef.get();

        if (referrerDoc.exists) {
          const fieldPath = `pointsBySnack.${snackId}`;
          await referrerRef.update({
            [fieldPath]: admin.firestore.FieldValue.increment(2)
          });

          // Notification au parrain
          const referrerData = referrerDoc.data();
          if (referrerData.fcmToken) {
            try {
              await getMessaging().send({
                notification: {
                  title: "🍟 Une frite offerte !",
                  body: "Votre filleul vient de commander ! Vous avez reçu 2 points de fidélité."
                },
                token: referrerData.fcmToken
              });
            } catch (e) {
              console.error("Erreur notif parrainage:", e);
            }
          }
        }
      }

      await userRef.update({
        lastOrderDate: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (postErr) {
      // Commande déjà créée + payée → on renvoie quand même un succès.
      console.error("finalizeOrder post-création (parrainage/lastOrderDate) échouée :", postErr);
    }

    // 🎁 FIDÉLITÉ CLIENT (best-effort) — +1 point par commande payée, collect ET
    // livraison (mode-agnostique). Ancré dans le bloc post-création idempotent
    // (les retries retournent §4/§5 avant ce point) → jamais de double crédit.
    // try/catch isolé : un échec fidélité ne casse jamais une commande déjà payée.
    // Anti-doublon F3 : le cooldown unifié (loyaltyLastCredit) peut SKIP ce crédit si
    // un point vient d'être gagné (ex. scan boutique juste avant) — skip silencieux,
    // jamais d'erreur sur une commande déjà payée.
    try {
      const clientRef = db.collection("users").doc(uid);
      const cooldownMs = resolveLoyaltyCooldownMs(snackData);
      const res = await db.runTransaction((tx) => creditLoyaltyPoints(tx, clientRef, snackId, 1, cooldownMs));
      if (res.skipped) {
        console.log(`finalizeOrder fidélité ignorée (anti-doublon F3) pour ${uid} / ${snackId}.`);
      } else if (res.reward) {
        await sendRewardPush(uid, res.fcmToken, snackId);
      }
    } catch (loyErr) {
      console.error("finalizeOrder crédit fidélité échoué :", loyErr);
    }

    // 🎡 FIDÉLITÉ : lot de roue en attente → OFFERT sur CETTE commande (redemption EN
    // COMMANDE, jamais par scan → pas de double point). Ancré dans le bloc post-création
    // idempotent (les retries retournent §4/§5 avant ce point) → jamais de double-offre.
    // Best-effort : un échec ne casse jamais une commande déjà payée. Le lot est attaché
    // à la commande (la cuisine le prépare) et pendingWheelReward est effacé (consommé).
    try {
      const wheelUserRef = db.collection("users").doc(uid);
      const wheelSnap = await wheelUserRef.get();
      const pendingWheel = wheelSnap.exists ? (wheelSnap.data().pendingWheelReward || {})[snackId] : null;
      if (pendingWheel?.productId) {
        await docRef.update({
          wheelPrize: { productId: pendingWheel.productId, nom: pendingWheel.nom || "Lot" },
        });
        await wheelUserRef.update({
          [`pendingWheelReward.${snackId}`]: admin.firestore.FieldValue.delete(),
          [`rewardsRedeemed.${snackId}`]: admin.firestore.FieldValue.increment(1),
        });
        await db.collection("loyaltyRewards").add({
          type: "wheel-redeem-order",
          snackId,
          clientUid: uid,
          productId: pendingWheel.productId,
          productNom: pendingWheel.nom || "Lot",
          orderId,
          redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (wheelErr) {
      console.error("finalizeOrder lot de roue (offert sur commande) échoué :", wheelErr);
    }

    // 📊 UPSELL ANALYTICS (best-effort) — agrège accepted/revenue depuis la
    // commande PAYÉE (source de vérité, zéro confiance client). Ne s'exécute
    // qu'à la première création (les retries retournent tôt §4/§5) → pas de
    // double comptage. Un échec ici ne fait JAMAIS échouer la commande.
    try {
      const upsellBatch = db.batch();
      let hasUpsell = false;
      for (const item of cartItems) {
        if (item.viaUpsell !== true || !V.isDocId(item.productId)) continue;
        const qty = Number(item.quantity) || 0;
        const prix = Number(item.prix) || 0;
        if (qty <= 0) continue;
        hasUpsell = true;
        const statRef = db
          .collection("snacks").doc(snackId)
          .collection("upsellStats").doc(item.productId);
        upsellBatch.set(
          statRef,
          {
            accepted: admin.firestore.FieldValue.increment(qty),
            revenue: admin.firestore.FieldValue.increment(prix * qty),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      if (hasUpsell) await upsellBatch.commit();
    } catch (upsellErr) {
      console.error("finalizeOrder upsellStats (accepted/revenue) échouée :", upsellErr);
    }

    return { orderId };
  }
);

// ============================================================================
// 💸 REMBOURSEMENT (LOT B) — refundOrder + réconciliation
// ============================================================================

/**
 * Applique un remboursement Stripe au bloc `refund` d'une commande, de façon
 * ATOMIQUE et IDEMPOTENTE (dédup sur `refundId`). Source de vérité serveur :
 * partagé par `refundOrder` (refund initié par l'app) et le webhook
 * `charge.refunded` (refund initié depuis le dashboard Stripe) → un même
 * `refundId` n'est jamais compté deux fois. Tout en centimes.
 * @param {FirebaseFirestore.DocumentReference} orderRef - Réf. de la commande.
 * @param {object} r - Détails du remboursement.
 * @param {string} r.refundId - ID du Refund Stripe (clé d'idempotence).
 * @param {number} r.amount - Montant remboursé, en centimes.
 * @param {number} r.commissionRefunded - Commission rendue (prorata), en centimes.
 * @param {string|null} r.reason - Motif Stripe.
 * @param {"app"|"stripe"} r.source - Origine du remboursement.
 * @returns {Promise<{applied:boolean, duplicate?:boolean, refundTotal:number, fullyRefunded?:boolean}>}
 */
async function applyRefundToOrder(orderRef, { refundId, amount, commissionRefunded, reason, source }) {
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(orderRef);
    if (!fresh.exists) return { applied: false, refundTotal: 0 };
    const f = fresh.data() || {};
    const block = f.refund || { total: 0, commission: 0, count: 0, fullyRefunded: false, items: [] };
    const items = Array.isArray(block.items) ? block.items : [];
    // Idempotence : ce refund.id est déjà comptabilisé (retry réseau, Idempotency-Key
    // Stripe renvoyant le même objet, ou event webhook d'un refund déjà tracé par l'app).
    if (items.some((it) => it && it.refundId === refundId)) {
      return { applied: false, duplicate: true, refundTotal: Number(block.total) || 0 };
    }
    const newTotal = (Number(block.total) || 0) + amount;
    const orderTotalCents = Math.round(Number(f.total) * 100);
    const fullyRefunded = newTotal >= orderTotalCents;
    tx.update(orderRef, {
      refund: {
        total: newTotal,
        commission: (Number(block.commission) || 0) + (Number(commissionRefunded) || 0),
        count: (Number(block.count) || 0) + 1,
        fullyRefunded,
        items: items.concat([{
          refundId,
          amount,
          commissionRefunded: Number(commissionRefunded) || 0,
          reason: reason || null,
          source: source || "app",
          at: admin.firestore.Timestamp.now(),
        }]),
      },
      // Statut DÉDIÉ paiement (sans toucher order.statut : machine cuisine/livreur intacte).
      "paiement.statut": fullyRefunded ? "rembourse" : "partiellement_rembourse",
    });
    return { applied: true, refundTotal: newTotal, fullyRefunded };
  });
}

/**
 * Rembourse une commande (total ou partiel). Charge DIRECTE : le refund passe
 * `{ stripeAccount }` + `refund_application_fee: true` (si commission Connect) →
 * Stripe rend la commission au prorata. Admin du snack propriétaire uniquement.
 * Montants en centimes, lus depuis la commande (jamais le client). Idempotent
 * (Idempotency-Key + dédup refundId).
 * @param {object} request.data - `{ orderId, amount?, reason? }`.
 */
exports.refundOrder = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = getStripe();
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");

  // 1. Validation stricte des entrées.
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { orderId, amount, reason } = data;
  require_(V.isNonEmptyString(orderId, 200), "orderId invalide.");
  require_(
    amount === undefined || amount === null || V.isPositiveInt(amount, 1_000_000),
    "amount invalide (centimes)."
  );
  const REASONS = ["duplicate", "fraudulent", "requested_by_customer"];
  const refundReason = reason === undefined || reason === null ? "requested_by_customer" : reason;
  require_(REASONS.includes(refundReason), "reason invalide.");

  // 2. Rate limit (clé par uid) — avant les lectures, pour couper l'abus tôt.
  await enforceRateLimit({ key: callerKey(request, "refundOrder"), max: 10, windowMs: 60_000 });

  // 3. Lire la commande (Admin SDK) — source de vérité serveur.
  const orderRef = db.collection("commandes").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new HttpsError("not-found", "Commande introuvable.");
  const order = orderSnap.data() || {};

  // 4. Admin du snack PROPRIÉTAIRE (snackId lu sur la commande, jamais du client).
  const snackId = order.snackId;
  require_(V.isDocId(snackId), "Commande sans snackId valide.");
  await assertCallerIsSnackAdmin(request, snackId);

  // 5. Garde-fous montant. ⚠️ order.total est en EUROS ; tout le reste en centimes.
  const refundableStatuts = ["paye", "partiellement_rembourse"];
  require_(
    refundableStatuts.includes(order.paiement?.statut),
    "Commande non remboursable (statut paiement)."
  );
  const paymentIntentId = order.paiement?.stripeSessionId;
  require_(V.isNonEmptyString(paymentIntentId, 200), "PaymentIntent introuvable sur la commande.");
  const orderTotalCents = Math.round(Number(order.total) * 100);
  require_(Number.isInteger(orderTotalCents) && orderTotalCents > 0, "Total de commande invalide.");
  const alreadyRefunded = Number(order.refund?.total) || 0;
  const remaining = orderTotalCents - alreadyRefunded;
  require_(remaining > 0, "Commande déjà intégralement remboursée.");
  const refundAmount = amount === undefined || amount === null ? remaining : amount;
  require_(refundAmount > 0 && refundAmount <= remaining, "Montant de remboursement hors limites.");

  // 6. Compte connecté (charge directe). Null = charge plateforme (legacy/sans Connect).
  const snackDoc = await db.collection("snacks").doc(snackId).get();
  const stripeAccountId = (snackDoc.exists ? snackDoc.data() : {}).stripeAccountId || null;

  // 7. Refund Stripe. `refund_application_fee` n'est valide QUE si la charge porte
  //    réellement une commission Connect (sinon Stripe rejette : "can only be used
  //    by the Connect application that created the charge"). On ne le passe donc que
  //    si compte connecté ET commission > 0 (ex. période franchise 0 % → aucune
  //    application fee à rendre). Quand présent, Stripe rend la commission au prorata.
  //    Idempotency-Key dérivée de l'état → un retry réseau renvoie le MÊME refund.id
  //    (puis dédup en base), un nouveau remboursement partiel a une clé distincte.
  const hasApplicationFee = !!stripeAccountId && (Number(order.commission) || 0) > 0;
  const refundParams = { payment_intent: paymentIntentId, amount: refundAmount, reason: refundReason };
  if (hasApplicationFee) refundParams.refund_application_fee = true;
  let refund;
  try {
    refund = await stripe.refunds.create(refundParams, {
      ...(stripeAccountId ? { stripeAccount: stripeAccountId } : {}),
      idempotencyKey: `refund_${orderId}_${refundAmount}_${alreadyRefunded}`,
    });
  } catch (e) {
    console.error("refundOrder — échec Stripe refunds.create :", e?.message || e);
    throw new HttpsError("internal", "Échec du remboursement côté Stripe.");
  }

  // 8. Commission rendue au prorata (cohérent avec Stripe ; évite un appel API
  //    supplémentaire ; réconciliable a posteriori via l'objet application_fee_refund).
  const commissionRefunded =
    orderTotalCents > 0 ? Math.round(((Number(order.commission) || 0) * refundAmount) / orderTotalCents) : 0;

  // 9. Persister (transaction idempotente, partagée avec le webhook).
  const res = await applyRefundToOrder(orderRef, {
    refundId: refund.id,
    amount: refundAmount,
    commissionRefunded,
    reason: refundReason,
    source: "app",
  });

  return {
    ok: true,
    refundId: refund.id,
    amount: refundAmount,
    commissionRefunded,
    duplicate: res.duplicate === true,
    refundTotal: res.refundTotal,
    fullyRefunded: res.fullyRefunded ?? res.refundTotal >= orderTotalCents,
  };
});

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
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ...load, cached: false };
});

// ============================================================================
// ⚡ FONCTION : OFFRE FLASH (gardée par la charge cuisine)
// ============================================================================
// Pousse une offre flash au segment "active" — MAIS refuse en rushMode (cuisine
// surchargée). Le flash DOIT passer par cette CF (role-gate + rate-limit +
// rushMode serveur) : un client ne crée jamais une campagne directement.
// Lecture de charge FRAÎCHE (pas le cache 30s) : débloquer/bloquer une offre sur
// un état périmé serait incorrect ; action admin rare → coût négligeable.
// L'envoi est délégué au cron existant `processPushCampaigns` (≤ 5 min) via un
// doc campagnes_push conforme — pas de mécanique FCM dupliquée (DRY).
exports.pushFlashOffer = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentification requise.");
  }

  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { snackId, title, body, ttlMin } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isNonEmptyString(title, 80), "Titre invalide.");
  require_(V.isNonEmptyString(body, 200), "Message invalide.");
  require_(V.isPositiveInt(ttlMin, 240), "ttlMin invalide.");

  // 🛡️ Réservé à l'admin du snack + rate limit (3 offres flash / 60s).
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({
    key: callerKey(request, "flashOffer"),
    max: 3,
    windowMs: 60_000,
  });

  // 🔥 Garde de capacité : on refuse en plein coup de feu (lecture fraîche).
  const snackSnap = await db.collection("snacks").doc(snackId).get();
  if (!snackSnap.exists) throw new HttpsError("not-found", "Snack introuvable.");
  const { rushMode } = await computeKitchenLoad(snackSnap.data() || {}, snackId);
  if (rushMode) throw new HttpsError("failed-precondition", "kitchen-busy");

  // ✅ Déléguer l'envoi au cron : doc campagnes_push immédiat, segment "active".
  await db.collection("campagnes_push").add({
    snackId,
    titre: title,
    message: body,
    cible: "active",
    actionUrl: null,
    imageUrl: null,
    statut: "en_attente",
    dateEnvoiPrevue: admin.firestore.Timestamp.now(),
    dateCreation: admin.firestore.FieldValue.serverTimestamp(),
    source: "flash_offer",
    flashTtlMin: ttlMin,
    stats: { envoye: 0, clics: 0 },
  });

  return { ok: true };
});

// ============================================================================
// 📣 FONCTION : PROGRAMMER UNE CAMPAGNE PUSH (quota + rate-limit SERVEUR)
// ============================================================================
// Remplace l'écriture client directe dans `campagnes_push` : le quota mensuel
// (2/mois/snack) et le rate-limit sont désormais ENFORCÉS côté serveur (un admin
// ne peut plus le contourner). La création directe par le client est fermée par
// firestore.rules (`campagnes_push` create:if false) — seules les CF (Admin SDK)
// écrivent. Le cron `processPushCampaigns` envoie ensuite la campagne.
exports.schedulePushCampaign = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentification requise.");
  }

  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { snackId, titre, message, cible, actionUrl, imageUrl, dateEnvoiPrevue } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isNonEmptyString(titre, 80), "Titre invalide.");
  require_(V.isNonEmptyString(message, 200), "Message invalide.");
  require_(["all", "active", "inactive"].includes(cible), "Cible invalide.");
  require_(actionUrl == null || (V.isString(actionUrl) && actionUrl.length <= 300), "actionUrl invalide.");
  require_(imageUrl == null || (V.isString(imageUrl) && imageUrl.length <= 1000), "imageUrl invalide.");

  // 🛡️ Réservé à l'admin du snack + rate limit (5 / 60s, garde anti-burst).
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({
    key: callerKey(request, "schedulePush"),
    max: 5,
    windowMs: 60_000,
  });

  // Date d'envoi : ISO string (sérialisée par httpsCallable) → Timestamp. Défaut: maintenant.
  let envoiDate = new Date(dateEnvoiPrevue);
  if (Number.isNaN(envoiDate.getTime())) envoiDate = new Date();

  // 🛡️ QUOTA SERVEUR — 2 campagnes / mois calendaire / snack (autorité serveur,
  // miroir de getPushEligibility côté client mais NON contournable).
  const now = new Date();
  const monthStart = admin.firestore.Timestamp.fromDate(
    new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const monthlyAgg = await db
    .collection("campagnes_push")
    .where("snackId", "==", snackId)
    .where("dateCreation", ">=", monthStart)
    .count()
    .get();
  const MONTHLY_LIMIT = 2;
  if (monthlyAgg.data().count >= MONTHLY_LIMIT) {
    throw new HttpsError("resource-exhausted", "Quota mensuel de campagnes atteint (2/2).");
  }

  const ref = await db.collection("campagnes_push").add({
    snackId,
    titre,
    message,
    cible,
    actionUrl: actionUrl || null,
    imageUrl: imageUrl || null,
    statut: "en_attente",
    dateEnvoiPrevue: admin.firestore.Timestamp.fromDate(envoiDate),
    dateCreation: admin.firestore.FieldValue.serverTimestamp(),
    source: "scheduled",
    stats: { envoye: 0, clics: 0 },
  });

  return { ok: true, campaignId: ref.id };
});

// ============================================================================
// 📊 FONCTION : TRACKING CLIC PUSH (compteur best-effort)
// ============================================================================
// Appelée par le Service Worker (notificationclick) pour incrémenter stats.clics
// de la campagne. Best-effort et NON authentifié (le SW n'a pas de contexte auth) :
// un échec n'a aucun impact, au pire la stat est imprécise. cors:true gère le
// préflight cross-origin. On n'incrémente que si la campagne existe.
exports.trackPushClick = onRequest({ region: "europe-west9", cors: true }, async (req, res) => {
  try {
    const campaignId = (req.query.c || (req.body && req.body.campaignId) || "").toString();
    if (V.isDocId(campaignId)) {
      const ref = db.collection("campagnes_push").doc(campaignId);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.update({ "stats.clics": admin.firestore.FieldValue.increment(1) });
      }
    }
  } catch (e) {
    console.warn("[trackPushClick] échec :", e && e.message);
  }
  // Toujours 204 : fire-and-forget, on n'expose jamais d'erreur au SW.
  res.status(204).end();
});

// ============================================================================
// 📊 FONCTION : TRACKING UPSELL "SHOWN" (instrumentation légère)
// ============================================================================
// Incrémente le compteur `shown` des produits affichés dans la bottom-sheet
// d'upsell, pour calculer le taux d'acceptation côté admin (accepted/shown).
// Écrit EXCLUSIVEMENT côté serveur dans snacks/{snackId}/upsellStats/{productId}
// (un client ne fabrique pas ses propres stats). Fire-and-forget côté client :
// un échec ici n'impacte jamais le tunnel de commande.
exports.trackUpsellShown = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentification requise.");
  }

  // 🛡️ Rate limit généreux : 1 appel par affichage upsell (≈ 1 par checkout).
  await enforceRateLimit({
    key: callerKey(request, "trackUpsellShown"),
    max: 30,
    windowMs: 60_000,
  });

  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");

  const { snackId, productIds } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isArray(productIds) && productIds.length > 0, "productIds vide ou invalide.");
  require_(productIds.length <= 10, "Trop de productIds.");

  const batch = db.batch();
  let count = 0;
  for (const productId of productIds) {
    if (!V.isDocId(productId)) continue;
    count++;
    const statRef = db
      .collection("snacks").doc(snackId)
      .collection("upsellStats").doc(productId);
    batch.set(
      statRef,
      {
        shown: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  require_(count > 0, "Aucun productId valide.");
  await batch.commit();

  return { ok: true, tracked: count };
});

// ============================================================================
// 🚚 FONCTION : CRÉER UN LIVREUR (réservé admin du snack)
// ============================================================================
// Crée le compte Auth + le doc users/{uid} avec role 'livreur' (admin SDK →
// contourne la règle 'create' qui force role:'client'). Le livreur se connecte
// ensuite sur /livreur.html.
exports.createDriver = onCall({ region: "europe-west1" }, async (request) => {
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");

  const { snackId, nom, email, password, telephone } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isNonEmptyString(nom, 100), "Nom invalide.");
  require_(V.isEmail(email), "Email invalide.");
  require_(
    V.isString(password) && password.length >= 6 && password.length <= 100,
    "Mot de passe invalide (6 à 100 caractères)."
  );
  require_(
    telephone === undefined || telephone === null || (V.isString(telephone) && telephone.length <= 30),
    "Téléphone invalide."
  );

  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "createDriver"), max: 20, windowMs: 3_600_000 });

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: nom });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email est déjà utilisé.");
    }
    if (e.code === "auth/invalid-password" || e.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Email ou mot de passe invalide.");
    }
    console.error("createDriver auth error:", e);
    throw new HttpsError("internal", "Création du compte impossible.");
  }

  await db.collection("users").doc(userRecord.uid).set({
    role: "livreur",
    snackId,
    nom,
    email,
    telephone: telephone || "",
    actif: true,
    points: 0,
    createdBy: request.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { uid: userRecord.uid };
});

// Crée le compte admin d'un snack (Auth + users/{uid} role:'admin'). SUPERADMIN
// uniquement. Mot de passe temporaire généré serveur, renvoyé UNE fois pour être
// transmis au restaurateur (qui le changera). Débloque l'accès à /admin.html.
exports.createSnackAdmin = onCall({ region: "europe-west1" }, async (request) => {
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { snackId, email, nom } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isEmail(email), "Email invalide.");
  require_(
    nom === undefined || nom === null || (V.isString(nom) && nom.length <= 100),
    "Nom invalide."
  );

  // 🛡️ Superadmin uniquement (création d'un compte admin = action sensible).
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== "superadmin") {
    throw new HttpsError("permission-denied", "Réservé au superadmin.");
  }
  await enforceRateLimit({ key: callerKey(request, "createSnackAdmin"), max: 20, windowMs: 3_600_000 });

  const snackSnap = await db.collection("snacks").doc(snackId).get();
  require_(snackSnap.exists, "Snack introuvable.");

  const tempPassword = generateSecretCode(10); // affiché 1 fois au superadmin
  const displayName = nom || email.split("@")[0];

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password: tempPassword, displayName });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email est déjà utilisé.");
    }
    if (e.code === "auth/invalid-password" || e.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Email ou mot de passe invalide.");
    }
    console.error("createSnackAdmin auth error:", e);
    throw new HttpsError("internal", "Création du compte impossible.");
  }

  await db.collection("users").doc(userRecord.uid).set({
    role: "admin",
    snackId,
    nom: displayName,
    email,
    pointsBySnack: {},
    createdBy: request.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { uid: userRecord.uid, email, tempPassword };
});

// ============================================================================
// ❤️ FIDÉLITÉ : crédit d'un point côté SERVEUR (transaction + anti double-scan)
// ============================================================================
// Remplace l'écriture client du scanner (src/scanner.js). L'admin du snack (ou
// superadmin) scanne le QR (uid client) → +1 point (report + banque au palier de 10).
// Transaction = pas de race au seuil ; cooldown anti-doublon UNIFIÉ (F3) dans le
// helper (loyaltyLastCredit) → couvre le re-scan accidentel ET le cumul avec une
// commande en ligne récente. Le snack peut régler la fenêtre (loyalty.creditCooldownMin).
exports.awardLoyaltyPoint = onCall({ region: "europe-west1" }, async (request) => {
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { clientUid, snackId } = data;
  require_(V.isDocId(clientUid), "clientUid invalide.");
  require_(V.isDocId(snackId), "snackId invalide.");

  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "awardLoyaltyPoint"), max: 60, windowMs: 60_000 });

  // Cooldown lu sur le snack (même source que finalizeOrder → fenêtre unifiée F3).
  const snackSnap = await db.collection("snacks").doc(snackId).get();
  const cooldownMs = resolveLoyaltyCooldownMs(snackSnap.exists ? snackSnap.data() : {});
  const clientRef = db.collection("users").doc(clientUid);

  const result = await db.runTransaction((tx) => creditLoyaltyPoints(tx, clientRef, snackId, 1, cooldownMs));

  // Anti-doublon : un point a déjà été gagné récemment (scan OU commande) → on
  // refuse explicitement pour informer l'admin (UX scanner), sans rien créditer.
  if (result.skipped) {
    throw new HttpsError("failed-precondition", "Point déjà crédité à l'instant (anti-doublon).");
  }

  // Push de palier émis APRÈS commit (jamais dans la transaction, qui peut rejouer).
  if (result.reward) await sendRewardPush(clientUid, result.fcmToken, snackId);

  // rewardsAvailable remonté au scanner pour proposer la consommation immédiate.
  return {
    points: result.points,
    max: result.max,
    reward: result.reward,
    rewardsAvailable: result.rewardsAvailable,
  };
});

// ============================================================================
// 🎟️ FIDÉLITÉ : CONSOMMATION D'UNE RÉCOMPENSE (menu offert) — TRACÉE (LOT F2)
// ============================================================================
// Décrémente rewardsAvailable.{snackId}, incrémente rewardsRedeemed.{snackId} et
// écrit un enregistrement d'audit dans loyaltyRewards (réconciliation compta /
// arbitrage de litige). Réservé à l'admin du snack (ou superadmin). Idempotence :
// chaque appel consomme AU PLUS une récompense (transaction). Normalise au passage
// les cartes "legacy" restées à pointsBySnack >= MAX (ancien modèle) → la récompense
// implicite (floor(points/MAX)) est convertie sans perte.
exports.redeemLoyaltyReward = onCall({ region: "europe-west1" }, async (request) => {
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { clientUid, snackId } = data;
  require_(V.isDocId(clientUid), "clientUid invalide.");
  require_(V.isDocId(snackId), "snackId invalide.");

  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "redeemLoyaltyReward"), max: 60, windowMs: 60_000 });

  const clientRef = db.collection("users").doc(clientUid);
  const auditRef = db.collection("loyaltyRewards").doc();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(clientRef);
    if (!snap.exists) throw new HttpsError("not-found", "Ce QR code n'est pas dans la base.");
    const d = snap.data();
    const points = (d.pointsBySnack || {})[snackId] || 0;
    const available = (d.rewardsAvailable || {})[snackId] || 0;

    // Récompenses réellement disponibles = banque + paliers "legacy" non reportés.
    const effective = available + Math.floor(points / MAX_LOYALTY_POINTS);
    if (effective < 1) {
      throw new HttpsError("failed-precondition", "Aucun menu offert disponible pour ce client.");
    }

    const newPoints = points % MAX_LOYALTY_POINTS; // normalise les cartes legacy
    const newAvailable = effective - 1;            // consomme une récompense
    const redeemedBefore = (d.rewardsRedeemed || {})[snackId] || 0;

    tx.update(clientRef, {
      [`pointsBySnack.${snackId}`]: newPoints,
      [`rewardsAvailable.${snackId}`]: newAvailable,
      [`rewardsRedeemed.${snackId}`]: redeemedBefore + 1,
    });

    // Trace d'audit (source serveur, Admin SDK → hors rules) : qui, quand, combien.
    tx.set(auditRef, {
      snackId,
      clientUid,
      redeemedBy: request.auth.uid,
      redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
      pointsBefore: points,
      rewardsAvailableAfter: newAvailable,
    });

    return { rewardsAvailable: newAvailable, points: newPoints };
  });

  return result;
});

// ============================================================================
// 🎡 FIDÉLITÉ : ROUE DE LA FORTUNE — tirage SERVEUR du lot (anti-triche)
// ============================================================================
// Le CLIENT déclenche le spin, mais le lot est tiré CÔTÉ SERVEUR parmi les produits
// `eligibleForWheel` du snack (liste curated par l'admin). Consomme UNE récompense
// (rewardsAvailable, banquée à 10 pts) et pose `pendingWheelReward.{snackId}` = lot
// gagné, à valider au comptoir (redeemWheelReward). 1 récompense = 1 spin ; un seul
// lot en attente à la fois. Transaction → jamais de double-consommation.
exports.spinLoyaltyWheel = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const uid = request.auth.uid;
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { snackId } = data;
  require_(V.isDocId(snackId), "snackId invalide.");

  await enforceRateLimit({ key: callerKey(request, "spinLoyaltyWheel"), max: 20, windowMs: 60_000 });

  // Pool de lots éligibles (curated) : produits du snack flaggés + disponibles. Lu HORS
  // transaction (Firestore n'autorise pas les queries dans une transaction).
  const prizesSnap = await db
    .collection("produits")
    .where("snackId", "==", snackId)
    .where("eligibleForWheel", "==", true)
    .get();
  const pool = prizesSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((p) => p.isAvailable !== false)
    .map((p) => ({ id: p.id, nom: p.nom || "Lot", image: p.image || null }));
  if (pool.length === 0) {
    throw new HttpsError("failed-precondition", "Aucun lot configuré pour la roue. Contactez le restaurant.");
  }

  // 🎲 Tirage SERVEUR (le client ne choisit JAMAIS son lot).
  const won = pool[Math.floor(Math.random() * pool.length)];

  const clientRef = db.collection("users").doc(uid);
  const auditRef = db.collection("loyaltyRewards").doc();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(clientRef);
    if (!snap.exists) throw new HttpsError("not-found", "Profil introuvable.");
    const d = snap.data();
    const points = (d.pointsBySnack || {})[snackId] || 0;
    const available = (d.rewardsAvailable || {})[snackId] || 0;
    const effective = available + Math.floor(points / MAX_LOYALTY_POINTS); // banque + legacy
    if (effective < 1) throw new HttpsError("failed-precondition", "Aucune récompense à jouer.");
    if ((d.pendingWheelReward || {})[snackId]) {
      throw new HttpsError("failed-precondition", "Tu as déjà un lot en attente de retrait.");
    }

    tx.update(clientRef, {
      [`pointsBySnack.${snackId}`]: points % MAX_LOYALTY_POINTS, // normalise les cartes legacy
      [`rewardsAvailable.${snackId}`]: effective - 1,            // consomme la récompense jouée
      [`pendingWheelReward.${snackId}`]: {
        productId: won.id,
        nom: won.nom,
        wonAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
    tx.set(auditRef, {
      type: "wheel-spin",
      snackId,
      clientUid: uid,
      productId: won.id,
      productNom: won.nom,
      spunAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  // pool = tous les segments à dessiner ; won = celui sur lequel la roue s'arrête.
  return { won, pool };
});

// ============================================================================
// 🎟️ FIDÉLITÉ : VALIDATION D'UN LOT DE ROUE AU COMPTOIR (admin) — TRACÉE
// ============================================================================
// Le staff scanne le QR du client gagnant → efface pendingWheelReward.{snackId} +
// incrémente rewardsRedeemed + trace d'audit. Réservé à l'admin du snack.
exports.redeemWheelReward = onCall({ region: "europe-west1" }, async (request) => {
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { clientUid, snackId } = data;
  require_(V.isDocId(clientUid), "clientUid invalide.");
  require_(V.isDocId(snackId), "snackId invalide.");

  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "redeemWheelReward"), max: 60, windowMs: 60_000 });

  const clientRef = db.collection("users").doc(clientUid);
  const auditRef = db.collection("loyaltyRewards").doc();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(clientRef);
    if (!snap.exists) throw new HttpsError("not-found", "Ce QR code n'est pas dans la base.");
    const d = snap.data();
    const pending = (d.pendingWheelReward || {})[snackId];
    if (!pending) throw new HttpsError("failed-precondition", "Aucun lot de roue en attente pour ce client.");

    tx.update(clientRef, {
      [`pendingWheelReward.${snackId}`]: admin.firestore.FieldValue.delete(),
      [`rewardsRedeemed.${snackId}`]: ((d.rewardsRedeemed || {})[snackId] || 0) + 1,
    });
    tx.set(auditRef, {
      type: "wheel-redeem",
      snackId,
      clientUid,
      productId: pending.productId,
      productNom: pending.nom,
      redeemedBy: request.auth.uid,
      redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { product: pending.nom };
  });

  return result;
});

// ============================================================================
// 🛎️ FONCTION : ALERTE ADMINS À CHAQUE NOUVELLE COMMANDE (push cuisine)
// ============================================================================
// Notifie les admins du snack même tablette en veille / arrière-plan (le bip
// in-app ne marche qu'au premier plan). Query equality-only (snackId + role)
// → pas d'index composite requis (index merging).
exports.notifyAdminsOnNewOrder = onDocumentCreated(
  "commandes/{orderId}",
  async (event) => {
    const order = event.data?.data();
    if (!order?.snackId) return;

    try {
      const adminsSnap = await db
        .collection("users")
        .where("snackId", "==", order.snackId)
        .where("role", "==", "admin")
        .get();

      const targets = [];
      adminsSnap.forEach((d) => {
        const token = d.data().fcmToken;
        if (token) targets.push({ uid: d.id, token });
      });
      if (targets.length === 0) return;

      const modeLabel = order.mode === "delivery" ? "Livraison" : "Sur place";
      const total = typeof order.total === "number" ? `${order.total.toFixed(2)}€` : "";
      const client = order.clientNom || "Client";

      const response = await getMessaging().sendEachForMulticast({
        notification: { title: "🛎️ Nouvelle commande", body: `${client} · ${total} · ${modeLabel}` },
        webpush: { fcm_options: { link: "https://snacking-template.web.app/admin.html" } },
        tokens: targets.map((t) => t.token),
      });

      // Nettoyage des tokens devenus invalides.
      await Promise.all(
        response.responses.map((r, i) =>
          r.success ? null : cleanupInvalidFcmToken(targets[i].uid, r.error)
        )
      );
      console.log(`🛎️ Alerte commande envoyée à ${targets.length} admin(s) (snack ${order.snackId}).`);
    } catch (error) {
      console.error("❌ Erreur notifyAdminsOnNewOrder :", error);
    }
  },
);

// ============================================================================
// 🔔 FONCTION 6 : NOTIFICATION "COMMANDE PRÊTE" (V2)
// ============================================================================
exports.onOrderStatusChange = onDocumentUpdated(
  "commandes/{orderId}",
  async (event) => {
    const newData = event.data.after.data();
    const oldData = event.data.before.data();
    const orderId = event.params.orderId;

    // On ne déclenche que sur un VRAI changement de statut.
    if (oldData.statut === newData.statut) return;

    const shortId = orderId.slice(-4).toUpperCase();
    const isDelivery = newData.mode === "delivery";

    // Message adapté au statut + au mode (collect / livraison).
    let notif = null;
    if (newData.statut === "prete") {
      notif = isDelivery
        ? { title: "Commande prête ✅", body: `Votre commande #${shortId} est prête, un livreur va la récupérer.` }
        : { title: "C'est prêt ! 🍟", body: `Votre commande #${shortId} est prête. Bon appétit !` };
    } else if (newData.statut === "en_livraison") {
      notif = { title: "En route ! 🛵", body: `Votre commande #${shortId} est en chemin.` };
    } else if (newData.statut === "livree") {
      notif = { title: "Livré ! 🎉", body: `Bon appétit ! Merci pour votre commande #${shortId}.` };
    }
    if (!notif) return;

    const userId = newData.userId;
    try {
      const userDoc = await db.collection("users").doc(userId).get();
      const fcmToken = userDoc.exists ? userDoc.data().fcmToken : null;
      if (!fcmToken) {
        console.log(`⚠️ Pas de token FCM pour l'utilisateur ${userId}.`);
        return;
      }
      const response = await getMessaging().send({
        notification: notif,
        webpush: { fcm_options: { link: "https://snacking-template.web.app/" } },
        token: fcmToken,
      });
      console.log(`✅ Notif "${newData.statut}" envoyée pour commande ${orderId} :`, response);
    } catch (error) {
      console.error("❌ Erreur lors de l'envoi de la notification de commande :", error);
      await cleanupInvalidFcmToken(userId, error);
    }
  },
);

// ============================================================================
// 🛰️ FONCTION : GÉOFENCING LIVREUR → NOTIFS DE DISTANCE AU CLIENT
// ============================================================================
// Déclenchée à chaque mise à jour de position du livreur. Recalcule la distance
// Haversine livreur→client (source de vérité SERVEUR) et notifie le client à
// chaque palier franchi (3 km / 1 km / 300 m), UNE seule fois par palier.
exports.onDriverPositionUpdate = onDocumentUpdated(
  "commandes/{orderId}",
  async (event) => {
    const after = event.data.after.data();
    const before = event.data.before.data();

    if (after.statut !== "en_livraison" || after.mode !== "delivery") return;

    const newPos = after.livreur?.position;
    const oldPos = before.livreur?.position;
    if (!newPos || !isFiniteNum(newPos.lat) || !isFiniteNum(newPos.lng)) return;
    // Position réellement modifiée (évite la boucle après update de lastNotifiedBucket).
    if (oldPos && oldPos.lat === newPos.lat && oldPos.lng === newPos.lng) return;

    const client = after.livraison;
    if (!client || !isFiniteNum(client.lat) || !isFiniteNum(client.lng)) return;

    const distM = haversineKm(newPos, client) * 1000;
    const bucket = bucketForServer(distM);
    if (bucket == null) return; // encore au-delà du plus grand palier

    const last = after.livreur?.lastNotifiedBucket ?? null;
    // On ne notifie qu'en se rapprochant (palier strictement plus petit).
    if (last != null && bucket >= last) return;

    // Marque le palier AVANT l'envoi (idempotence, pas de double notif).
    await event.data.after.ref.update({ "livreur.lastNotifiedBucket": bucket });

    const userId = after.userId;
    try {
      const userDoc = await db.collection("users").doc(userId).get();
      const fcmToken = userDoc.exists ? userDoc.data().fcmToken : null;
      if (!fcmToken) return;

      const label = bucket >= 1000 ? `${bucket / 1000} km` : `${bucket} m`;
      const body = bucket <= 300 ? `Votre livreur arrive (${label}), préparez-vous !` : `Votre livreur est à ${label} environ.`;
      await getMessaging().send({
        notification: { title: "🛵 Votre livreur approche", body },
        webpush: { fcm_options: { link: "https://snacking-template.web.app/" } },
        token: fcmToken,
      });
    } catch (error) {
      console.error("❌ Erreur notif géofence :", error);
      await cleanupInvalidFcmToken(userId, error);
    }
  },
);

// ============================================================================
// ⚽ FONCTION : FOOTBALL EVENTS (Smart Marketing Advisor)
// ============================================================================
// Récupère les matchs des 7 prochains jours pour les compétitions ciblées,
// filtre selon les équipes du resto et met en cache Firestore 30 min pour
// éviter de saturer l'API football-data.org (10 req/min en free tier).
//
// Token lu via secret Firebase :
//   firebase functions:secrets:set FOOTBALL_DATA_TOKEN
//
// Throttling-aware : on log un warning si `X-Requests-Available-Minute` < 2
// (best practice demandée explicitement par l'auteur de l'API).
//
// Réponse : { matches: [...], cached: bool, stale?: bool, ageMs?: number }
//   - cached:false → fetch frais
//   - cached:true   → renvoyé du cache (TTL non expiré)
//   - stale:true    → fetch échoué, on retombe sur le vieux cache
//
// Filtres (spec utilisateur) :
//   FL1 → OL, OM, PSG
//   PL  → Man City, Man United, Arsenal
//   PD  → Real Madrid, Barcelona, Atlético
//   CL  → tous les matchs
//   WC  → équipe de France OR stages quarts/demi/finale
//   EC  → équipe de France OR stages quarts/demi/finale

const FOOTBALL_API_BASE = "https://api.football-data.org/v4";
const FOOTBALL_CACHE_DOC = "football_matches";
const FOOTBALL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const FOOTBALL_HORIZON_DAYS = 7;

const FOOTBALL_FILTERS = {
  FL1: { keywords: ["lyon", "marseille", "paris"] },
  PL:  { keywords: ["manchester city", "manchester united", "arsenal"] },
  PD:  { keywords: ["real madrid", "barcelona", "atletico"] },
  CL:  { keywords: null }, // tous
  WC:  { keywords: ["france"], stages: ["QUARTER_FINALS", "SEMI_FINALS", "FINAL"] },
  EC:  { keywords: ["france"], stages: ["QUARTER_FINALS", "SEMI_FINALS", "FINAL"] },
};
const FOOTBALL_COMPETITIONS = Object.keys(FOOTBALL_FILTERS).join(",");

function normalizeName(s) {
  // Strip accents + lower : "Atlético" → "atletico", "France" → "france"
  return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function isMatchInteresting(match) {
  const filter = FOOTBALL_FILTERS[match.competition?.code];
  if (!filter) return false;

  // CL : tous
  if (filter.keywords === null && !filter.stages) return true;

  const home = normalizeName(match.homeTeam?.name);
  const away = normalizeName(match.awayTeam?.name);
  const teamMatch = filter.keywords?.some((kw) => {
    const k = normalizeName(kw);
    return home.includes(k) || away.includes(k);
  });

  // WC/EC : OR entre équipe (France) et stage (quarts/demi/finale)
  if (filter.stages) {
    const stageMatch = filter.stages.includes(match.stage);
    return Boolean(teamMatch || stageMatch);
  }

  return Boolean(teamMatch);
}

exports.getUpcomingFootballEvents = onCall(
  { region: "europe-west1", secrets: ["FOOTBALL_DATA_TOKEN"] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    const cacheRef = db.collection("cache").doc(FOOTBALL_CACHE_DOC);
    const cacheSnap = await cacheRef.get();
    const cached = cacheSnap.exists ? cacheSnap.data() : null;
    const fetchedAtMs = cached?.fetchedAt?.toMillis?.() || 0;
    const ageMs = Date.now() - fetchedAtMs;

    // 1. Cache hit valide → return direct
    if (cached && ageMs < FOOTBALL_CACHE_TTL_MS && Array.isArray(cached.matches)) {
      return { matches: cached.matches, cached: true, ageMs };
    }

    // 2. Cache miss / expiré → fetch upstream
    const token = process.env.FOOTBALL_DATA_TOKEN;
    if (!token) {
      logger.error("[football] FOOTBALL_DATA_TOKEN manquant en runtime.");
      if (cached) return { matches: cached.matches || [], cached: true, stale: true };
      throw new HttpsError("failed-precondition", "Secret football non configuré.");
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + FOOTBALL_HORIZON_DAYS * 24 * 60 * 60 * 1000);
    const dateFrom = now.toISOString().slice(0, 10);
    const dateTo = horizon.toISOString().slice(0, 10);
    const url = `${FOOTBALL_API_BASE}/matches?competitions=${FOOTBALL_COMPETITIONS}&dateFrom=${dateFrom}&dateTo=${dateTo}`;

    try {
      // ⏱️ Timeout 8s : sans AbortController, un upstream lent bloquerait la CF
      // jusqu'au timeout par défaut (~60s). L'abort tombe dans le catch → cache stale.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let resp;
      try {
        resp = await fetch(url, { headers: { "X-Auth-Token": token }, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }

      // Throttling awareness — l'auteur de l'API demande explicitement de
      // surveiller ce header pour ne pas saturer leur rate limiter.
      const remaining = resp.headers.get("X-Requests-Available-Minute");
      if (remaining !== null && parseInt(remaining, 10) < 2) {
        logger.warn(`[football] quota faible : ${remaining}/min restantes.`);
      }

      if (!resp.ok) throw new Error(`football-data HTTP ${resp.status}`);
      const data = await resp.json();
      const filtered = (data?.matches || [])
        .filter(isMatchInteresting)
        .map((m) => ({
          id: m.id,
          utcDate: m.utcDate,
          status: m.status,
          stage: m.stage,
          competition: { code: m.competition?.code, name: m.competition?.name },
          homeTeam: { name: m.homeTeam?.name, crest: m.homeTeam?.crest },
          awayTeam: { name: m.awayTeam?.name, crest: m.awayTeam?.crest },
        }));

      await cacheRef.set({
        matches: filtered,
        fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        upstreamRemainingMinute: remaining,
      });

      return { matches: filtered, cached: false };
    } catch (err) {
      logger.error("[football] fetch failed:", err.message);
      // Fail-safe : on retombe sur un vieux cache si dispo
      if (cached?.matches) {
        return { matches: cached.matches, cached: true, stale: true, ageMs };
      }
      throw new HttpsError("unavailable", "Données football indisponibles.");
    }
  }
);

// ============================================================================
// 🤖 FONCTION 7 : STRIPE WEBHOOK (SAAS BILLING B2B)
// ============================================================================
// Écoute les événements Stripe (ex: invoice.payment_failed) pour couper
// automatiquement l'accès (maintenance) en cas de non-paiement de l'abonnement.

/**
 * Bascule le `maintenanceMode` du snack associé à un abonnement Stripe.
 * Centralise la logique partagée par les events de suspension/réactivation SaaS.
 * @param {string|null} subscriptionId - ID d'abonnement Stripe (no-op si falsy).
 * @param {boolean} maintenanceMode - true = suspendre, false = réactiver.
 * @param {string} reason - Raison loggée (sans PII).
 * @returns {Promise<void>}
 */
async function setSnackMaintenanceBySubscription(subscriptionId, maintenanceMode, reason) {
    if (!subscriptionId) return;
    const snap = await db.collection("snacks")
        .where("stripeSubscriptionId", "==", subscriptionId).limit(1).get();
    if (snap.empty) return;
    const snackDoc = snap.docs[0];
    await snackDoc.ref.update({ maintenanceMode });
    const icon = maintenanceMode ? "🔒 LOCATAIRE SUSPENDU" : "✅ LOCATAIRE RÉACTIVÉ";
    console.log(`${icon}: snack ${snackDoc.id} — ${reason} (Sub: ${subscriptionId}).`);
}

exports.stripeWebhook = onRequest({ region: "europe-west9" }, async (request, response) => {
    const stripe = getStripe();
    const sig = request.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        // Stripe SDK requires the raw body buffer for signature verification
        event = stripe.webhooks.constructEvent(request.rawBody, sig, endpointSecret);
    } catch (err) {
        console.error(`⚠️ Webhook signature verification failed.`, err.message);
        return response.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 🛡️ Idempotence — Stripe garantit une livraison "at-least-once" (retries).
    // create() est atomique : si l'event a déjà été traité, on ACK (200) sans rejouer.
    const eventRef = db.collection("stripeEvents").doc(event.id);
    try {
        await eventRef.create({
            type: event.type,
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        if (e.code === 6 || e.code === "already-exists") {
            return response.json({ received: true, duplicate: true });
        }
        console.error("❌ Erreur garde idempotence Webhook :", e);
        return response.status(500).send("Internal Server Error");
    }

    try {
        if (event.type === 'invoice.payment_failed') {
            // Objet = Invoice → l'ID d'abonnement se lit via resolveSubscriptionId
            // (legacy `invoice.subscription` OU Basil `invoice.parent…`).
            await setSnackMaintenanceBySubscription(
                resolveSubscriptionId(event.data.object), true, "échec de paiement");
        }
        else if (event.type === 'customer.subscription.deleted') {
            // ⚠️ Pour cet event, l'objet EST une Subscription : l'ID est
            // directement `object.id` (et NON `invoice.subscription` — c'était
            // le bug de regroupement initial, masqué par `|| invoice.id`).
            await setSnackMaintenanceBySubscription(
                event.data.object.id, true, "abonnement annulé");
        }
        else if (event.type === 'invoice.payment_succeeded') {
            // Réactivation automatique : un snack suspendu pour impayé qui règle
            // son abonnement doit être remis en ligne (sinon bloqué malgré le paiement).
            await setSnackMaintenanceBySubscription(
                resolveSubscriptionId(event.data.object), false, "paiement reçu");
        }
        else if (event.type === 'checkout.session.completed') {
            // 💼 Abonnement SaaS souscrit par un resto → on lie l'abonnement au snack
            // (via metadata.snack_id) et on l'active. Les invoices récurrentes suivantes
            // sont gérées par invoice.payment_failed/succeeded (réf. stripeSubscriptionId).
            const session = event.data.object;
            const snackId = session.metadata && session.metadata.snack_id;
            if (snackId && session.subscription && session.mode === 'subscription') {
                await db.collection("snacks").doc(snackId).set({
                    stripeSubscriptionId: session.subscription,
                    maintenanceMode: false,
                }, { merge: true });
                console.log(`✅ Abonnement activé: snack ${snackId} (sub ${session.subscription}).`);
            }
        }
        else if (event.type === 'account.updated') {
            // 🏦 CONNECT : synchronise le statut d'onboarding du compte connecté.
            // (Nécessite d'activer l'écoute des events "sur les comptes connectés"
            // dans la config du webhook Stripe.)
            const account = event.data.object;
            const snap = await db.collection("snacks").where("stripeAccountId", "==", account.id).limit(1).get();
            if (!snap.empty) {
                await snap.docs[0].ref.update({
                    stripeChargesEnabled: !!account.charges_enabled,
                    stripeDetailsSubmitted: !!account.details_submitted,
                    stripePayoutsEnabled: !!account.payouts_enabled,
                });
                console.log(`🔄 account.updated: snack ${snap.docs[0].id} charges_enabled=${account.charges_enabled}`);
            }
        }
        else if (event.type === 'charge.refunded') {
            // 💸 FILET (LOT B) : un remboursement initié HORS app (dashboard Stripe)
            // doit être réconcilié dans le bloc refund de la commande. La dédup par
            // refund.id (applyRefundToOrder) garantit qu'un refund déjà tracé par
            // refundOrder n'est PAS recompté. orderId = paymentIntent (= id commande).
            // NB: charge.refunds.data est borné (~10 derniers) — suffisant ici ; pour
            // un historique long, retrieve la charge avec expand refunds.
            const charge = event.data.object;
            const orderId = typeof charge.payment_intent === 'string'
                ? charge.payment_intent
                : charge.payment_intent?.id;
            if (orderId) {
                const orderRef = db.collection("commandes").doc(orderId);
                const orderSnap = await orderRef.get();
                if (orderSnap.exists) {
                    const order = orderSnap.data() || {};
                    const orderTotalCents = Math.round(Number(order.total) * 100);
                    for (const r of (charge.refunds?.data || [])) {
                        const commissionRefunded = orderTotalCents > 0
                            ? Math.round(((Number(order.commission) || 0) * r.amount) / orderTotalCents)
                            : 0;
                        await applyRefundToOrder(orderRef, {
                            refundId: r.id, amount: r.amount, commissionRefunded,
                            reason: r.reason || null, source: "stripe",
                        });
                    }
                }
            }
        }

        response.json({ received: true });
    } catch (error) {
        console.error("❌ Erreur traitement Webhook :", error);
        // On retire le marqueur d'idempotence pour autoriser le retry Stripe
        // (sinon l'event serait considéré "déjà traité" et l'effet jamais appliqué).
        await eventRef.delete().catch(() => {});
        response.status(500).send("Internal Server Error");
    }
});
