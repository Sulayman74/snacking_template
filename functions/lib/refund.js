// ============================================================================
// 💸 REMBOURSEMENT (LOT B) — application atomique & idempotente au bloc refund
// ============================================================================
// Partagé par refundOrder (refund initié par l'app) ET le webhook charge.refunded
// (refund depuis le dashboard Stripe) → un même refundId n'est jamais compté 2×.

const { db, Timestamp } = require("./admin");

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
          at: Timestamp.now(),
        }]),
      },
      // Statut DÉDIÉ paiement (sans toucher order.statut : machine cuisine/livreur intacte).
      "paiement.statut": fullyRefunded ? "rembourse" : "partiellement_rembourse",
    });
    return { applied: true, refundTotal: newTotal, fullyRefunded };
  });
}

module.exports = { applyRefundToOrder };
