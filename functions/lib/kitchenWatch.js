// ============================================================================
// 📵 SURVEILLANCE DE L'ÉCRAN CUISINE — appelée par l'horloge des commandes
// ============================================================================
// Une PWA en arrière-plan ne donne plus signe de vie (iPad, tablette en veille)
// alors que le restaurateur peut rester joignable par push : « écran silencieux »
// seul ne veut PAS dire « personne ». On n'agit donc que si un client attend :
//   A. commande à cuisiner + écran silencieux ≥ 10 min → push au gérant (1 fois/panne)
//   B. … et commande en attente depuis préparation + 10 min → « pause simulée »
//      journalisée (MODE OBSERVATION : rien n'est coupé, on mesure d'abord).
// Une panne = une valeur de `lastSeenAt` : un nouveau battement clôt la panne.

const { db, FieldValue, Timestamp } = require("./admin");
const { getStaffPushTargets, sendToTargets } = require("./pushTargets");
const { getSnackOrigin } = require("./tenantOrigins");
const { buildKitchenOfflineAlert } = require("./kitchenAlerts");
const { basePrepMin } = require("./pickup");

const WAITING_GRACE_MS = 5 * 60 * 1000;   // le radar / le push ont le temps d'agir
const SILENT_ALERT_MS = 10 * 60 * 1000;   // écran sans battement depuis
const PAUSE_EXTRA_MS = 10 * 60 * 1000;    // au-delà de la préparation normale
const INCIDENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ORDERS = 500;

const millis = (ts) => (ts?.toMillis ? ts.toMillis() : null);

/** Depuis quand une commande « à cuisiner » attend (lancement si programmée/transition). */
function toCookSinceMs(order) {
  return millis(order.dateLancement) ?? millis(order.date);
}

/**
 * Pose une marque de panne si elle n'y est pas déjà (transaction : jamais deux fois).
 * @param {import("firebase-admin/firestore").DocumentReference} ref
 * @param {string} field
 * @param {string} incidentKey
 */
async function markOnce(ref, field, incidentKey) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()[field] === incidentKey) return false;
    tx.set(ref, { [field]: incidentKey }, { merge: true });
    return true;
  });
}

function logIncident(type, snackId, nowMs, detail) {
  return db.collection("kitchenIncidents").add({
    type,
    snackId,
    at: FieldValue.serverTimestamp(),
    ttlAt: Timestamp.fromMillis(nowMs + INCIDENT_TTL_MS),
    ...detail,
  });
}

/**
 * @returns {Promise<number>} nombre d'incidents (alertes + pauses simulées) ce tour-ci.
 */
async function watchKitchens(nowMs) {
  const snap = await db.collection("commandes").where("statut", "==", "nouvelle").limit(MAX_ORDERS).get();

  // Par snack : nombre de commandes en attente et la plus ancienne.
  const bySnack = new Map();
  for (const doc of snap.docs) {
    const order = doc.data();
    const since = toCookSinceMs(order);
    if (!order.snackId || !Number.isFinite(since)) continue;
    const cur = bySnack.get(order.snackId) || { count: 0, oldestMs: Infinity };
    cur.count++;
    cur.oldestMs = Math.min(cur.oldestMs, since);
    bySnack.set(order.snackId, cur);
  }

  let incidents = 0;
  for (const [snackId, { count, oldestMs }] of bySnack) {
    const waitingMs = nowMs - oldestMs;
    if (waitingMs < WAITING_GRACE_MS) continue;

    const statusRef = db.collection("kitchenStatus").doc(snackId);
    const status = (await statusRef.get()).data() || {};
    const lastSeenMs = millis(status.lastSeenAt);
    const silentMs = lastSeenMs === null ? Infinity : nowMs - lastSeenMs;
    if (silentMs < SILENT_ALERT_MS) continue;

    const incidentKey = lastSeenMs ?? 0; // 0 = écran jamais ouvert
    const detail = {
      ordersWaiting: count,
      oldestWaitingMin: Math.floor(waitingMs / 60000),
      silentMin: Number.isFinite(silentMs) ? Math.floor(silentMs / 60000) : null,
    };

    // A. Alerte au gérant, une fois par panne.
    if (await markOnce(statusRef, "offlineAlertFor", incidentKey)) {
      try {
        const targets = await getStaffPushTargets(snackId, "admin");
        if (targets.length > 0) {
          await sendToTargets(targets, {
            notification: buildKitchenOfflineAlert(count, detail.silentMin),
            webpush: { fcm_options: { link: `${await getSnackOrigin(snackId)}/admin.html` } },
          });
        }
      } catch (error) {
        console.error(`📵 Alerte écran cuisine ${snackId} non envoyée :`, error);
      }
      await logIncident("alerte_hors_ligne", snackId, nowMs, detail);
      incidents++;
    }

    // B. Pause qui AURAIT été déclenchée : on l'enregistre seulement.
    const snackSnap = await db.collection("snacks").doc(snackId).get();
    const pauseAfterMs = basePrepMin(snackSnap.data()) * 60000 + PAUSE_EXTRA_MS;
    if (waitingMs >= pauseAfterMs && await markOnce(statusRef, "pauseObservedFor", incidentKey)) {
      await logIncident("pause_simulee", snackId, nowMs, detail);
      console.warn(`📵 Pause automatique SIMULÉE pour ${snackId} (observation) :`, detail);
      incidents++;
    }
  }
  return incidents;
}

module.exports = { watchKitchens, toCookSinceMs, SILENT_ALERT_MS, WAITING_GRACE_MS, PAUSE_EXTRA_MS };
