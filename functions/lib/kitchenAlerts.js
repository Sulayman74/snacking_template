// ============================================================================
// 🛎️ ALERTES CUISINE — textes des push envoyés aux admins du snack (purs, testables)
// ============================================================================
// Deux moments où la cuisine doit agir : une commande arrive (préparer / lancer une
// livraison), et le client de click & collect signale qu'il arrive (lancer la
// cuisson). Consommé par functions/domains/notifications.js.

const MODE_LABEL = Object.freeze({ delivery: "Livraison", collect: "À emporter" });

const formatTotal = (total) => (typeof total === "number" ? `${total.toFixed(2)} €` : "");
// Code affiché en gros sur le ticket cuisine et donné au comptoir.
const pickupCode = (order, orderId) =>
  (typeof order?.secretCode === "string" && order.secretCode) || String(orderId || "").slice(-4).toUpperCase();

/** Nouvelle commande payée (création du document). */
function buildNewOrderAlert(order) {
  const parts = [order?.clientNom || "Client", formatTotal(order?.total), MODE_LABEL[order?.mode] || MODE_LABEL.collect];
  return { title: "🛎️ Nouvelle commande", body: parts.filter(Boolean).join(" · ") };
}

/** Le client a cliqué « Je suis à 5 min / Sur place » : c'est le moment de cuisiner. */
function buildClientArrivingAlert(order, orderId) {
  return {
    title: "🏃 Client dans 5 min — lancez la cuisson",
    body: `${order?.clientNom || "Client"} · code ${pickupCode(order, orderId)}`,
  };
}

/** Lancée par l'horloge des commandes (le client n'a pas signalé son arrivée). */
function buildAutoReleaseAlert(order, orderId) {
  return {
    title: "⏱️ Commande à lancer maintenant",
    body: `${order?.clientNom || "Client"} · code ${pickupCode(order, orderId)}`,
  };
}

/** Transition qui déclenche l'alerte « client dans 5 min ». */
function isClientArrival(before, after) {
  return before?.statut === "en_attente_client" && after?.statut === "nouvelle";
}

module.exports = { buildNewOrderAlert, buildClientArrivingAlert, buildAutoReleaseAlert, isClientArrival };
