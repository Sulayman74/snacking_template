// ============================================================================
// 🔔 NOTIFICATIONS — nouvelle commande, changement de statut, position livreur
// ============================================================================

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { getUserPushTargets, getStaffPushTargets, sendToTargets } = require("../lib/pushTargets");
const { isFiniteNum, haversineKm, bucketForServer } = require("../lib/geo");
const { getSnackOrigin } = require("../lib/tenantOrigins");
const { getKitchenQueueCount } = require("../lib/kitchen");
const { buildNewOrderAlert, buildClientArrivingAlert, isClientArrival } = require("../lib/kitchenAlerts");

/** Push à tous les appareils admin du snack, pastille = commandes en attente. */
async function alertKitchen(snackId, notification) {
  const targets = await getStaffPushTargets(snackId, "admin");
  if (targets.length === 0) return 0;
  const pending = await getKitchenQueueCount(snackId);
  await sendToTargets(targets, {
    notification,
    data: { badge: String(pending) },
    // Lien vers le site DU snack (pas celui du tenant par défaut).
    webpush: { fcm_options: { link: `${await getSnackOrigin(snackId)}/admin.html` } },
  });
  return targets.length;
}

// ============================================================================
// 🛎️ FONCTION : ALERTE ADMINS À CHAQUE NOUVELLE COMMANDE (push cuisine)
// ============================================================================
// Notifie les admins du snack même tablette en veille / arrière-plan (le bip
// in-app ne marche qu'au premier plan). Query equality-only (snackId + role)
// → pas d'index composite requis (index merging).
exports.notifyAdminsOnNewOrder = onDocumentCreated(
  "commandes/{orderId}",
  async (event) => {
    const order = event.data?.data();
    if (!order?.snackId) return;

    try {
      const sent = await alertKitchen(order.snackId, buildNewOrderAlert(order));
      if (sent) console.log(`🛎️ Alerte commande envoyée à ${sent} appareil(s) admin (snack ${order.snackId}).`);
    } catch (error) {
      console.error("❌ Erreur notifyAdminsOnNewOrder :", error);
    }
  },
);

// ============================================================================
// 🔔 FONCTION 6 : NOTIFICATION "COMMANDE PRÊTE" (V2)
// ============================================================================
exports.onOrderStatusChange = onDocumentUpdated(
  "commandes/{orderId}",
  async (event) => {
    const newData = event.data.after.data();
    const oldData = event.data.before.data();
    const orderId = event.params.orderId;

    // On ne déclenche que sur un VRAI changement de statut.
    if (oldData.statut === newData.statut) return;

    // 🏃 Click & collect : le client signale son arrivée → c'est le moment de
    // cuisiner. Push aux admins (tablette en veille / autre app), dans ce trigger
    // déjà existant : aucune exécution de fonction supplémentaire.
    if (isClientArrival(oldData, newData)) {
      try {
        const sent = await alertKitchen(newData.snackId, buildClientArrivingAlert(newData, orderId));
        console.log(`🏃 Arrivée client ${orderId} signalée à ${sent} appareil(s) admin.`);
      } catch (error) {
        console.error("❌ Erreur alerte arrivée client :", error);
      }
      return; // aucun push client pour ce statut
    }

    const shortId = orderId.slice(-4).toUpperCase();
    const isDelivery = newData.mode === "delivery";

    // Message adapté au statut + au mode (collect / livraison).
    let notif = null;
    if (newData.statut === "prete") {
      notif = isDelivery
        ? { title: "Commande prête ✅", body: `Votre commande #${shortId} est prête, un livreur va la récupérer.` }
        : { title: "C'est prêt ! 🍟", body: `Votre commande #${shortId} est prête. Bon appétit !` };
    } else if (newData.statut === "en_livraison") {
      notif = { title: "En route ! 🛵", body: `Votre commande #${shortId} est en chemin.` };
    } else if (newData.statut === "livree") {
      notif = { title: "Livré ! 🎉", body: `Bon appétit ! Merci pour votre commande #${shortId}.` };
    }
    if (!notif) return;

    try {
      const targets = await getUserPushTargets(newData.userId, newData.snackId, "client");
      if (targets.length === 0) {
        console.log(`⚠️ Aucun appareil push pour l'utilisateur ${newData.userId}.`);
        return;
      }
      const res = await sendToTargets(targets, {
        notification: notif,
        webpush: { fcm_options: { link: `${await getSnackOrigin(newData.snackId)}/` } },
      });
      console.log(`✅ Notif "${newData.statut}" commande ${orderId} : ${res.successCount}/${targets.length} appareil(s).`);
    } catch (error) {
      console.error("❌ Erreur lors de l'envoi de la notification de commande :", error);
    }
  },
);

// ============================================================================
// 🛰️ FONCTION : GÉOFENCING LIVREUR → NOTIFS DE DISTANCE AU CLIENT
// ============================================================================
// Déclenchée à chaque mise à jour de position du livreur. Recalcule la distance
// Haversine livreur→client (source de vérité SERVEUR) et notifie le client à
// chaque palier franchi (3 km / 1 km / 300 m), UNE seule fois par palier.
exports.onDriverPositionUpdate = onDocumentUpdated(
  "commandes/{orderId}",
  async (event) => {
    const after = event.data.after.data();
    const before = event.data.before.data();

    if (after.statut !== "en_livraison" || after.mode !== "delivery") return;

    const newPos = after.livreur?.position;
    const oldPos = before.livreur?.position;
    if (!newPos || !isFiniteNum(newPos.lat) || !isFiniteNum(newPos.lng)) return;
    // Position réellement modifiée (évite la boucle après update de lastNotifiedBucket).
    if (oldPos && oldPos.lat === newPos.lat && oldPos.lng === newPos.lng) return;

    const client = after.livraison;
    if (!client || !isFiniteNum(client.lat) || !isFiniteNum(client.lng)) return;

    const distM = haversineKm(newPos, client) * 1000;
    const bucket = bucketForServer(distM);
    if (bucket == null) return; // encore au-delà du plus grand palier

    const last = after.livreur?.lastNotifiedBucket ?? null;
    // On ne notifie qu'en se rapprochant (palier strictement plus petit).
    if (last != null && bucket >= last) return;

    // Marque le palier AVANT l'envoi (idempotence, pas de double notif).
    await event.data.after.ref.update({ "livreur.lastNotifiedBucket": bucket });

    try {
      const targets = await getUserPushTargets(after.userId, after.snackId, "client");
      if (targets.length === 0) return;

      const label = bucket >= 1000 ? `${bucket / 1000} km` : `${bucket} m`;
      const body = bucket <= 300 ? `Votre livreur arrive (${label}), préparez-vous !` : `Votre livreur est à ${label} environ.`;
      await sendToTargets(targets, {
        notification: { title: "🛵 Votre livreur approche", body },
        webpush: { fcm_options: { link: `${await getSnackOrigin(after.snackId)}/` } },
      });
    } catch (error) {
      console.error("❌ Erreur notif géofence :", error);
    }
  },
);
