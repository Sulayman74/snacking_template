// ============================================================================
// 📊 COMMANDES — Agrégations journalières temps réel (Mission 3)
// ============================================================================
// Déclenchée lors de la création d'une commande (onDocumentCreated).
// Met à jour de façon atomique (FieldValue.increment) les statistiques journalières :
// /snacks/{snackId}/dailyStats/{YYYY-MM-DD}
// Permet à la console admin et à la compta d'obtenir les métriques en 1 seule lecture.

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { db, FieldValue } = require("../lib/admin");

/**
 * Extrait et agrège les métriques financières et d'upsell d'une commande.
 * Fonction pure exportée pour permettre les tests unitaires.
 *
 * @param {Object} order - Document de commande Firestore.
 * @returns {Object} Détail des métriques à incrémenter.
 */
function computeOrderAggregation(order = {}) {
  const orderTotal = Number(order.total) || 0;
  const items = Array.isArray(order.items) ? order.items : [];

  let upsellTotal = 0;
  let hasUpsell = false;
  const upsellProductsSold = {};

  items.forEach((item) => {
    if (item.viaUpsell === true) {
      hasUpsell = true;
      const qty = Number(item.quantite) || 1;
      const price = Number(item.prix) || 0;
      const itemTotal = price * qty;
      upsellTotal += itemTotal;

      const pId = item.productId || item.id;
      if (pId) {
        if (!upsellProductsSold[pId]) {
          upsellProductsSold[pId] = { qty: 0, revenue: 0 };
        }
        upsellProductsSold[pId].qty += qty;
        upsellProductsSold[pId].revenue += itemTotal;
      }
    }
  });

  return {
    orderTotal,
    upsellTotal,
    hasUpsell,
    upsellProductsSold,
  };
}

exports.computeOrderAggregation = computeOrderAggregation;

exports.aggregateDailyStatsOnOrder = onDocumentCreated(
  {
    document: "commandes/{commandeId}",
    region: "europe-west1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const order = snap.data() || {};
    const snackId = order.snackId;
    if (!snackId) {
      logger.warn(`[aggregateDailyStats] Commande ${event.params.commandeId} ignorée : snackId manquant.`);
      return;
    }

    // Date YYYY-MM-DD en fuseau horaire Paris
    const dateObj = order.dateCommande?.toDate?.() || new Date();
    const dateStr = new Intl.DateTimeFormat("fr-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dateObj); // Produit "YYYY-MM-DD"

    const { orderTotal, upsellTotal, hasUpsell, upsellProductsSold } = computeOrderAggregation(order);

    const dailyStatsRef = db
      .collection("snacks")
      .doc(snackId)
      .collection("dailyStats")
      .doc(dateStr);

    const updatePayload = {
      date: dateStr,
      ordersCount: FieldValue.increment(1),
      totalRevenue: FieldValue.increment(orderTotal),
      upsellRevenue: FieldValue.increment(upsellTotal),
      upsellOrdersCount: FieldValue.increment(hasUpsell ? 1 : 0),
      lastUpdated: FieldValue.serverTimestamp(),
    };

    // Compteurs par produit pour l'analyse des meilleures ventes d'upsell
    for (const [productId, stats] of Object.entries(upsellProductsSold)) {
      updatePayload[`productsBreakdown.${productId}.accepted`] = FieldValue.increment(stats.qty);
      updatePayload[`productsBreakdown.${productId}.revenue`] = FieldValue.increment(stats.revenue);
    }

    try {
      await dailyStatsRef.set(updatePayload, { merge: true });
      logger.info(
        `[aggregateDailyStats] Snack ${snackId} (${dateStr}) : +${orderTotal}€ (Upsell: +${upsellTotal}€)`
      );
    } catch (err) {
      logger.error(`[aggregateDailyStats] Erreur mise à jour dailyStats pour snack ${snackId}:`, err);
    }
  }
);
