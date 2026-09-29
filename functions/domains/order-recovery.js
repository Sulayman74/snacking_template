// ============================================================================
// 🧾 FILET « DÉBITÉ SANS COMMANDE » — réconciliateur planifié
// ============================================================================

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getStripe, STRIPE_SECRET_KEY } = require("../lib/stripe");
const { reconcilePendingOrders } = require("../lib/orderRecovery");

// Toutes les 5 min : crée la commande des PaymentIntents payés dont finalizeOrder
// n'est jamais arrivé (réseau perdu après paiement), cf. lib/orderRecovery.
exports.reconcilePendingOrders = onSchedule(
  { schedule: "every 5 minutes", region: "europe-west1", secrets: [STRIPE_SECRET_KEY] },
  async (_event) => {
    const stats = await reconcilePendingOrders(getStripe());
    if (stats.scanned > 0) console.log("🧾 reconcilePendingOrders", stats);
  }
);
