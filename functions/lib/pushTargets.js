// ============================================================================
// 🎯 PUSH — abonnements par appareil / snack / app + envoi + nettoyage
// ============================================================================
// Un token FCM est lié à UNE origine (un site de snack) et à UN navigateur.
// L'ancien modèle (`users/{uid}.fcmToken`, un seul champ) écrasait le token d'un
// client qui commande chez deux snacks ou sur deux appareils. Désormais :
//   pushSubscriptions/{sha256(token)} = { uid, snackId, app, token, … }
// écrit UNIQUEMENT par le callable registerPushToken (Admin SDK, règles fermées).
//
// Transition : un utilisateur qui n'a encore AUCUN abonnement (app pas encore
// mise à jour) reste joignable via son ancien `fcmToken`. Dès qu'il en a un, le
// champ legacy est ignoré (il pouvait viser le site d'un autre snack).

const crypto = require("node:crypto");
const { getMessaging } = require("firebase-admin/messaging");
const { db, FieldValue, Timestamp } = require("./admin");

const SUBSCRIPTIONS = "pushSubscriptions";
const PUSH_APPS = Object.freeze(["client", "admin", "livreur"]);
/** Un abonnement non revu depuis 60 j expire (politique TTL Firestore sur expireAt). */
const SUBSCRIPTION_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const FCM_MULTICAST_MAX = 500;

/** Id déterministe d'un abonnement (dédoublonne un même token). */
function subscriptionId(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/** Token FCM devenu invalide (PWA désinstallée, permission retirée…). */
function isInvalidFcmTokenError(error) {
  const code = error?.code || error?.errorInfo?.code;
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  );
}

/**
 * Crée / rafraîchit l'abonnement d'un appareil. Un token déjà connu change de
 * propriétaire si un autre compte se connecte sur le même navigateur.
 * @param {{ uid: string, snackId: string, app: string, token: string }} sub
 * @param {number} [nowMs]
 */
async function upsertSubscription({ uid, snackId, app, token }, nowMs = Date.now()) {
  const ref = db.collection(SUBSCRIPTIONS).doc(subscriptionId(token));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    tx.set(ref, {
      uid,
      snackId,
      app,
      token,
      channel: "fcm",
      createdAt: snap.exists ? snap.data().createdAt : FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(nowMs + SUBSCRIPTION_TTL_MS),
    });
  });
  return ref.id;
}

async function hasAnySubscription(uid) {
  const snap = await db.collection(SUBSCRIPTIONS).where("uid", "==", uid).limit(1).get();
  return !snap.empty;
}

const fromSubscription = (doc) => ({ token: doc.data().token, uid: doc.data().uid, subRef: doc.ref });
const fromLegacy = (uid, token) => ({ token, uid, legacy: true });

/**
 * Appareils d'UN utilisateur pour un snack et une app donnés.
 * @returns {Promise<Array<{token: string, uid: string, subRef?: object, legacy?: boolean}>>}
 */
async function getUserPushTargets(uid, snackId, app) {
  if (!uid) return [];
  const snap = await db.collection(SUBSCRIPTIONS)
    .where("uid", "==", uid)
    .where("snackId", "==", snackId)
    .where("app", "==", app)
    .get();
  if (!snap.empty) return snap.docs.map(fromSubscription);

  if (await hasAnySubscription(uid)) return [];
  const userSnap = await db.collection("users").doc(uid).get();
  const token = userSnap.exists ? userSnap.data().fcmToken : null;
  return token ? [fromLegacy(uid, token)] : [];
}

/**
 * Appareils de l'équipe d'un snack (admins ou livreurs).
 * @param {string} snackId
 * @param {"admin"|"livreur"} role
 */
async function getStaffPushTargets(snackId, role) {
  const [subsSnap, staffSnap] = await Promise.all([
    db.collection(SUBSCRIPTIONS).where("snackId", "==", snackId).where("app", "==", role).get(),
    db.collection("users").where("snackId", "==", snackId).where("role", "==", role).get(),
  ]);
  const staffUids = new Set(staffSnap.docs.map((d) => d.id));
  // Un abonnement dont le compte a perdu le rôle (ex. livreur retiré) ne reçoit plus rien.
  const targets = subsSnap.docs.filter((d) => staffUids.has(d.data().uid)).map(fromSubscription);

  // Legacy : membres sans aucun abonnement (app pas encore mise à jour).
  const withSubs = new Set(subsSnap.docs.map((d) => d.data().uid));
  for (const d of staffSnap.docs) {
    const token = d.data().fcmToken;
    if (token && !withSubs.has(d.id) && !(await hasAnySubscription(d.id))) {
      targets.push(fromLegacy(d.id, token));
    }
  }
  return targets;
}

/**
 * Clients d'un snack joignables par push (un appareil au moins), groupés par uid.
 * @returns {Promise<Map<string, Array<object>>>} uid → cibles
 */
async function getClientPushTargetsBySnack(snackId) {
  const snap = await db.collection(SUBSCRIPTIONS).where("snackId", "==", snackId).where("app", "==", "client").get();
  const byUid = new Map();
  for (const doc of snap.docs) {
    const t = fromSubscription(doc);
    if (!byUid.has(t.uid)) byUid.set(t.uid, []);
    byUid.get(t.uid).push(t);
  }
  return byUid;
}

/** Supprime la cible d'un token mort (abonnement, ou champ legacy). */
async function removeTarget(target) {
  try {
    if (target.subRef) await target.subRef.delete();
    else if (target.legacy) await db.collection("users").doc(target.uid).update({ fcmToken: FieldValue.delete() });
  } catch (e) {
    console.error(`❌ Nettoyage token push (uid ${target.uid}) échoué :`, e);
  }
}

/**
 * Envoie un message FCM à des cibles (dédoublonnées), nettoie les tokens morts.
 * Ne lève jamais pour un échec d'envoi individuel.
 * @param {Array<object>} targets
 * @param {object} message - Message FCM SANS token(s).
 * @param {{ messaging?: { sendEachForMulticast: Function } }} [deps] - injectable (tests).
 * @returns {Promise<{successCount: number, failureCount: number, invalidated: number}>}
 */
async function sendToTargets(targets, message, { messaging } = {}) {
  const unique = [];
  const seen = new Set();
  for (const t of targets) {
    if (t?.token && !seen.has(t.token)) {
      seen.add(t.token);
      unique.push(t);
    }
  }
  const out = { successCount: 0, failureCount: 0, invalidated: 0 };
  if (unique.length === 0) return out;

  const client = messaging || getMessaging();
  for (let i = 0; i < unique.length; i += FCM_MULTICAST_MAX) {
    const chunk = unique.slice(i, i + FCM_MULTICAST_MAX);
    const res = await client.sendEachForMulticast({ ...message, tokens: chunk.map((t) => t.token) });
    out.successCount += res.successCount;
    out.failureCount += res.failureCount;
    await Promise.all(res.responses.map(async (r, idx) => {
      if (!r.success && isInvalidFcmTokenError(r.error)) {
        out.invalidated++;
        await removeTarget(chunk[idx]);
      }
    }));
  }
  return out;
}

module.exports = {
  SUBSCRIPTIONS,
  PUSH_APPS,
  SUBSCRIPTION_TTL_MS,
  subscriptionId,
  isInvalidFcmTokenError,
  upsertSubscription,
  getUserPushTargets,
  getStaffPushTargets,
  getClientPushTargetsBySnack,
  sendToTargets,
};
