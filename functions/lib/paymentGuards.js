// ============================================================================
// 🛡️ Garde-fous PaymentIntent (OWASP A04)
// ============================================================================
// Tous les prix/frais du catalogue sont en EUR : c'est la seule devise encaissée.
const { HttpsError } = require("firebase-functions/v2/https");

const ORDER_CURRENCY = "eur";

/**
 * Vérifie qu'un PaymentIntent "succeeded" a bien été émis par createPaymentIntent
 * POUR ce snack et en EUR. Sans ça, un PI payé en devise sans décimales
 * (JPY/KRW…) ou destiné à un autre snack (compte plateforme) passerait le
 * contrôle de montant de finalizeOrder.
 * Pas de refund auto : le PI peut être la charge légitime d'une autre commande.
 */
function assertPaymentIntentMatchesOrder(paymentIntent, snackId) {
  if (paymentIntent?.currency !== ORDER_CURRENCY) {
    throw new HttpsError("failed-precondition", "Devise du paiement invalide.");
  }
  if (!snackId || paymentIntent?.metadata?.snack_id !== snackId) {
    throw new HttpsError("failed-precondition", "Paiement non rattaché à ce restaurant.");
  }
}

module.exports = { ORDER_CURRENCY, assertPaymentIntentMatchesOrder };
