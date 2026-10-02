// ============================================================================
// ⏱️ HORLOGE DES COMMANDES — ce qu'une app native ferait en arrière-plan
// ============================================================================
// Une PWA ne tourne pas en arrière-plan : c'est le serveur qui « porte le temps ».
// Appelée chaque minute par functions/domains/order-clock.js. Chaque tâche est
// isolée (une erreur n'empêche pas les autres) et idempotente (transaction qui
// revérifie le statut attendu avant d'écrire).

const { db, FieldValue, Timestamp } = require("./admin");

/** Ancien parcours « Je suis à 5 min » : au-delà, la cuisine lance d'elle-même. */
const LEGACY_RELEASE_MS = 20 * 60 * 1000;
/** Commande prête jamais retirée : clôturée pour libérer l'écran cuisine. */
const STALE_READY_MS = 3 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

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

async function staleOrders(statut, olderThanMs, nowMs) {
  const cutoff = Timestamp.fromMillis(nowMs - olderThanMs);
  return db.collection("commandes")
    .where("statut", "==", statut)
    .where("date", "<=", cutoff)
    .orderBy("date", "asc")
    .limit(BATCH_SIZE)
    .get();
}

/**
 * Transition : commandes passées avec l'ancien parcours, restées « en attente du
 * client » (il n'a pas cliqué) → lancées en cuisine (sonnerie + push cuisine).
 */
async function releaseLegacyWaitingOrders(nowMs) {
  const snap = await staleOrders("en_attente_client", LEGACY_RELEASE_MS, nowMs);
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
 * Commandes à emporter prêtes depuis des heures : jamais récupérées. Clôturées
 * (marquées pour la compta) pour ne pas encombrer l'écran cuisine. Les livraisons
 * ne sont pas concernées (un livreur peut encore être en route).
 */
async function closeStaleReadyOrders(nowMs) {
  const snap = await staleOrders("prete", STALE_READY_MS, nowMs);
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

const TASKS = { released: releaseLegacyWaitingOrders, closed: closeStaleReadyOrders };

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

module.exports = { runOrderClock, LEGACY_RELEASE_MS, STALE_READY_MS };
