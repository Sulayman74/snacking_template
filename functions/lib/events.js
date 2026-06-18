// ============================================================================
// 📊 EVENTS — instrumentation analytique (write-time, fire-and-forget)
// ============================================================================
// Socle commun "funnel + attribution + win-back" (LOT 1 roadmap). Écrit des
// événements dans la collection top-level `events` (partition `snackId`, comme
// `commandes`/`produits`). Deux familles :
//   • transactionnels SERVEUR (purchase, push_sent, push_clicked) → émis ici via
//     l'Admin SDK : bas volume, non falsifiables, TOUJOURS émis.
//   • UI CLIENT (view_product, add_to_cart, begin_checkout) → émis côté front,
//     gardés par le flag tenant `features.enableAnalyticsEvents` (volume + coût).
//
// RGPD : pas de PII brute (on stocke `uid`, jamais l'email). Rétention bornée
// via `ttlAt` (à brancher sur une TTL policy Firestore sur le champ `ttlAt`).
// Fire-and-forget STRICT : emitEvent n'échoue JAMAIS vers l'appelant — une
// panne d'analytique ne doit pas casser une commande/un envoi push.

const { db, FieldValue, Timestamp } = require("./admin");

const EVENT_TTL_DAYS = 90;

// Types autorisés (garde-fou : un type hors liste est ignoré silencieusement).
const EVENT_TYPES = new Set([
  "view_product",
  "add_to_cart",
  "begin_checkout",
  "purchase",
  "cart_abandoned",
  "push_sent",
  "push_clicked",
]);

/**
 * Émet un événement analytique (write-time). Ne jette jamais.
 * @param {object} evt
 * @param {string} evt.snackId - clé de partition multi-tenant (obligatoire).
 * @param {string} evt.type - cf. EVENT_TYPES (obligatoire).
 * @param {string|null} [evt.uid] - auteur (uid Firebase) ou null si inconnu.
 * @param {object} [evt.props] - payload contextuel minimal et SANS PII
 *   (productId, amountCents, orderId, campaignId, qty…).
 * @returns {Promise<void>}
 */
async function emitEvent({ snackId, type, uid = null, props = {} } = {}) {
  try {
    if (!snackId || !EVENT_TYPES.has(type)) return;
    const ttlAt = Timestamp.fromMillis(Date.now() + EVENT_TTL_DAYS * 86_400_000);
    await db.collection("events").add({
      snackId,
      type,
      uid: uid || null,
      ...props,
      ts: FieldValue.serverTimestamp(),
      ttlAt,
    });
  } catch (e) {
    // Avalé volontairement (fire-and-forget) : l'analytique ne casse pas le métier.
    console.warn(`[events] emit ${type} ignoré:`, e?.message || e);
  }
}

module.exports = { emitEvent, EVENT_TYPES, EVENT_TTL_DAYS };
