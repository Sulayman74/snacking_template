// ============================================================================
// ⏱️ HORLOGE DES COMMANDES — ce qu'une app native ferait en arrière-plan
// ============================================================================
// Une PWA ne tourne pas en arrière-plan : c'est le serveur qui « porte le temps ».
// Appelée chaque minute par functions/domains/order-clock.js. Chaque tâche est
// isolée (une erreur n'empêche pas les autres) et idempotente (transaction qui
// revérifie le statut attendu avant d'écrire).

const { db, FieldValue, Timestamp } = require("./admin");
const { getUserPushTargets, sendToTargets } = require("./pushTargets");
const { getSnackOrigin } = require("./tenantOrigins");
const { buildPickupReminderNotification } = require("./kitchenAlerts");

/** Ancien parcours « Je suis à 5 min » : au-delà, la cuisine lance d'elle-même. */
const LEGACY_RELEASE_MS = 20 * 60 * 1000;
/** Commande prête jamais retirée, 3 h après l'heure de retrait annoncée : clôturée. */
const STALE_READY_MS = 3 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
/** Rappel « votre commande vous attend » : 5 min après « prête » ET après l'heure annoncée. */
const REMINDER_DELAY_MS = 5 * 60 * 1000;

/**
 * Passe une commande d'un statut à un autre si elle y est TOUJOURS (le chef ou
 * le client a pu agir entre la requête et l'écriture).
 * @returns {Promise<boolean>} true si la commande a été modifiée.
 */
async function transition(ref, fromStatut, patch) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().statut !== fromStatut) return false;
    tx.update(ref, patch);
    return true;
  });
}

// Commandes d'un statut dont le champ horaire `field` est passé de `olderThanMs`.
async function dueOrders(statut, field, olderThanMs, nowMs, direction = "asc") {
  const cutoff = Timestamp.fromMillis(nowMs - olderThanMs);
  return db.collection("commandes")
    .where("statut", "==", statut)
    .where(field, "<=", cutoff)
    .orderBy(field, direction)
    .limit(BATCH_SIZE)
    .get();
}

/**
 * Commande à emporter prête et pas encore récupérée : UN rappel push au client,
 * 5 min après « prête » et 5 min après l'heure de retrait annoncée (un client sur
 * créneau n'est pas relancé avant l'heure qu'il a choisie). Marque posée en
 * transaction AVANT l'envoi : jamais deux rappels. Plus récentes d'abord : les
 * commandes déjà rappelées (toujours « prêtes ») ne bloquent pas les nouvelles.
 */
async function remindUncollectedOrders(nowMs) {
  const snap = await dueOrders("prete", "datePrete", REMINDER_DELAY_MS, nowMs, "desc");
  let reminded = 0;
  for (const doc of snap.docs) {
    const order = doc.data();
    if (order.mode === "delivery" || order.rappelEnvoyeAt) continue;
    const promisedMs = order.eta?.readyAt?.toMillis?.();
    if (Number.isFinite(promisedMs) && promisedMs + REMINDER_DELAY_MS > nowMs) continue;

    const marked = await db.runTransaction(async (tx) => {
      const snapNow = await tx.get(doc.ref);
      const d = snapNow.exists ? snapNow.data() : null;
      if (!d || d.statut !== "prete" || d.rappelEnvoyeAt) return false;
      tx.update(doc.ref, { rappelEnvoyeAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!marked) continue;

    try {
      const targets = await getUserPushTargets(order.userId, order.snackId, "client");
      if (targets.length > 0) {
        await sendToTargets(targets, {
          notification: buildPickupReminderNotification(order, doc.id),
          webpush: { fcm_options: { link: `${await getSnackOrigin(order.snackId)}/` } },
        });
      }
    } catch (error) {
      console.error(`⏱️ Rappel retrait ${doc.id} non envoyé :`, error);
    }
    reminded++;
  }
  return reminded;
}

/**
 * Créneau « plus tard » : la commande programmée part en cuisine à l'heure du
 * créneau moins le temps de préparation (`retrait.lancerA`). Sonnerie + push
 * cuisine, push « en préparation » au client (functions/domains/notifications).
 */
async function releaseScheduledOrders(nowMs) {
  const snap = await dueOrders("programmee", "retrait.lancerA", 0, nowMs);
  let launched = 0;
  for (const doc of snap.docs) {
    const done = await transition(doc.ref, "programmee", {
      statut: "nouvelle",
      lancementAuto: "creneau",
      dateLancement: FieldValue.serverTimestamp(),
    });
    if (done) launched++;
  }
  return launched;
}

/**
 * Transition : commandes passées avec l'ancien parcours, restées « en attente du
 * client » (il n'a pas cliqué) → lancées en cuisine (sonnerie + push cuisine).
 */
async function releaseLegacyWaitingOrders(nowMs) {
  const snap = await dueOrders("en_attente_client", "date", LEGACY_RELEASE_MS, nowMs);
  let released = 0;
  for (const doc of snap.docs) {
    const done = await transition(doc.ref, "en_attente_client", {
      statut: "nouvelle",
      lancementAuto: "transition",
      dateLancement: FieldValue.serverTimestamp(),
    });
    if (done) released++;
  }
  return released;
}

/**
 * Commandes à emporter prêtes, 3 h après l'heure de retrait annoncée
 * (`eta.readyAt` = créneau choisi ou estimation) : jamais récupérées. Clôturées
 * (marquées pour la compta) pour ne pas encombrer l'écran cuisine. Les livraisons
 * ne sont pas concernées (un livreur peut encore être en route). Se baser sur
 * l'heure de COMMANDE clôturerait à tort un créneau du soir commandé le matin.
 */
async function closeStaleReadyOrders(nowMs) {
  const snap = await dueOrders("prete", "eta.readyAt", STALE_READY_MS, nowMs);
  let closed = 0;
  for (const doc of snap.docs) {
    if (doc.data().mode === "delivery") continue;
    const done = await transition(doc.ref, "prete", {
      statut: "terminee",
      nonRecuperee: true,
      clotureAutoAt: FieldValue.serverTimestamp(),
    });
    if (done) closed++;
  }
  return closed;
}

const TASKS = {
  launched: releaseScheduledOrders,
  released: releaseLegacyWaitingOrders,
  reminded: remindUncollectedOrders,
  closed: closeStaleReadyOrders,
};

/**
 * Un tour d'horloge. `nowMs` injectable pour les tests.
 * @returns {Promise<Object>} nombre de commandes traitées par tâche (+ erreurs).
 */
async function runOrderClock({ nowMs = Date.now() } = {}) {
  const stats = { errors: 0 };
  for (const [name, task] of Object.entries(TASKS)) {
    try {
      stats[name] = await task(nowMs);
    } catch (error) {
      stats[name] = 0;
      stats.errors++;
      console.error(`⏱️ Horloge des commandes — tâche « ${name} » en échec :`, error);
    }
  }
  return stats;
}

module.exports = { runOrderClock, LEGACY_RELEASE_MS, STALE_READY_MS, REMINDER_DELAY_MS };
