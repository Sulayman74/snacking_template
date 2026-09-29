// ============================================================================
// 🧾 RÉCONCILIATION « DÉBITÉ SANS COMMANDE »
// ============================================================================
// createPaymentIntent mémorise le panier validé dans `pendingOrders/{piId}`.
// Normalement finalizeOrder crée la commande quelques secondes après le paiement
// et supprime ce document. S'il existe encore après GRACE_MS, le client a pu
// perdre le réseau entre le paiement et finalizeOrder : on relit le PI chez
// Stripe et, s'il est payé, on crée la commande par le MÊME chemin idempotent.
// Ne dépend pas de la config du webhook Stripe (facultatif dans ce projet).

const { HttpsError } = require("firebase-functions/v2/https");
const { db, Timestamp } = require("./admin");
const { assertPaymentIntentMatchesOrder } = require("./paymentGuards");
const { PENDING_ORDERS, clearPendingOrder, createOrderFromPaymentIntent } = require("./orderCreation");

/** Délai laissé à finalizeOrder (chemin nominal) avant de prendre le relais. */
const GRACE_MS = 3 * 60 * 1000;
/** Au-delà, un PI jamais payé est considéré abandonné (annulé + nettoyé). */
const ABANDON_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
const ABANDONABLE = ["requires_payment_method", "requires_confirmation", "requires_action"];

/**
 * Traite un lot de paniers en attente.
 * @param {import("stripe").Stripe} stripe
 * @param {{ nowMs?: number }} [opts] - `nowMs` injectable pour les tests.
 * @returns {Promise<{scanned: number, recovered: number, cleared: number, failed: number}>}
 */
async function reconcilePendingOrders(stripe, { nowMs = Date.now() } = {}) {
  const stats = { scanned: 0, recovered: 0, cleared: 0, failed: 0 };
  const snap = await db.collection(PENDING_ORDERS)
    .where("createdAt", "<=", Timestamp.fromMillis(nowMs - GRACE_MS))
    .orderBy("createdAt")
    .limit(BATCH_SIZE)
    .get();

  for (const doc of snap.docs) {
    stats.scanned++;
    const piId = doc.id;
    const p = doc.data() || {};
    try {
      // Commande déjà créée (finalizeOrder est passé) → simple ménage.
      if ((await db.collection("commandes").doc(piId).get()).exists) {
        await clearPendingOrder(piId);
        stats.cleared++;
        continue;
      }

      const reqOpts = p.stripeAccountId ? { stripeAccount: p.stripeAccountId } : undefined;
      const pi = await stripe.paymentIntents.retrieve(
        piId,
        { expand: ["latest_charge.balance_transaction"] },
        reqOpts
      );

      if (pi.status === "succeeded") {
        assertPaymentIntentMatchesOrder(pi, p.snackId);
        const snackDoc = await db.collection("snacks").doc(p.snackId).get();
        const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
        const { created } = await createOrderFromPaymentIntent({
          stripe,
          paymentIntent: pi,
          snackId: p.snackId,
          snackData: snackDoc.exists ? (snackDoc.data() || {}) : {},
          uid: p.uid,
          isGuest: p.isGuest === true,
          cartItems: p.cartItems,
          orderMode: p.mode === "delivery" ? "delivery" : "collect",
          livraison: p.livraison || null,
          // Invité : l'email n'est connu qu'au paiement (Link) → lu sur la charge.
          clientEmail: p.clientEmail || charge?.billing_details?.email || pi.receipt_email || "",
          clientNom: p.clientNom || charge?.billing_details?.name || null,
          referrerId: null,
        });
        if (created) {
          stats.recovered++;
          console.warn(`🧾 Commande récupérée (PI ${piId}, snack ${p.snackId}) : payée sans finalizeOrder.`);
        } else {
          stats.cleared++;
        }
      } else if (pi.status === "canceled") {
        await clearPendingOrder(piId);
        stats.cleared++;
      } else if (ABANDONABLE.includes(pi.status) && nowMs - p.createdAt.toMillis() > ABANDON_MS) {
        // Jamais payé depuis 24 h : on annule le PI (plus aucun débit possible)
        // puis on nettoie. Si l'annulation échoue (payé entre-temps), le document
        // reste et sera traité au passage suivant.
        await stripe.paymentIntents.cancel(piId, {}, reqOpts);
        await clearPendingOrder(piId);
        stats.cleared++;
      }
      // processing / requires_capture / < 24 h : on laisse pour un prochain passage.
    } catch (e) {
      if (e instanceof HttpsError) {
        // Rejet MÉTIER déterministe (panier invalide → la charge a été remboursée
        // par createOrderFromPaymentIntent, ou PI non rattaché) : inutile de réessayer.
        console.error(`🧾 PI ${piId} : commande non récupérable (${e.message}).`);
        await clearPendingOrder(piId);
        stats.cleared++;
      } else {
        // Erreur transitoire (Stripe/Firestore) : on garde pour le prochain passage.
        console.error(`🧾 PI ${piId} : échec réconciliation, réessai au prochain passage.`, e);
        stats.failed++;
      }
    }
  }
  return stats;
}

module.exports = { GRACE_MS, ABANDON_MS, reconcilePendingOrders };
