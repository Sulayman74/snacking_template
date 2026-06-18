// ============================================================================
// 🎁 FIDÉLITÉ — scan points, récompenses (report+banque), roue de la fortune
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../lib/admin");
const { V, require_ } = require("../lib/validation");
const { enforceRateLimit, callerKey } = require("../lib/rateLimit");
const { sendRewardPush } = require("../lib/fcm");
const { MAX_LOYALTY_POINTS, resolveLoyaltyCooldownMs, creditLoyaltyPoints } = require("../lib/loyalty");
const { assertCallerIsSnackAdmin } = require("../lib/auth");

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

