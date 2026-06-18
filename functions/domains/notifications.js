// ============================================================================
// 🔔 NOTIFICATIONS — nouvelle commande, changement de statut, position livreur
// ============================================================================

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { admin, db } = require("../lib/admin");
const { cleanupInvalidFcmToken } = require("../lib/fcm");
const { isFiniteNum, haversineKm, bucketForServer } = require("../lib/geo");

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
      const adminsSnap = await db
        .collection("users")
        .where("snackId", "==", order.snackId)
        .where("role", "==", "admin")
        .get();

      const targets = [];
      adminsSnap.forEach((d) => {
        const token = d.data().fcmToken;
        if (token) targets.push({ uid: d.id, token });
      });
      if (targets.length === 0) return;

      const modeLabel = order.mode === "delivery" ? "Livraison" : "Sur place";
      const total = typeof order.total === "number" ? `${order.total.toFixed(2)}€` : "";
      const client = order.clientNom || "Client";

      const response = await getMessaging().sendEachForMulticast({
        notification: { title: "🛎️ Nouvelle commande", body: `${client} · ${total} · ${modeLabel}` },
        webpush: { fcm_options: { link: "https://snacking-template.web.app/admin.html" } },
        tokens: targets.map((t) => t.token),
      });

      // Nettoyage des tokens devenus invalides.
      await Promise.all(
        response.responses.map((r, i) =>
          r.success ? null : cleanupInvalidFcmToken(targets[i].uid, r.error)
        )
      );
      console.log(`🛎️ Alerte commande envoyée à ${targets.length} admin(s) (snack ${order.snackId}).`);
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

    const userId = newData.userId;
    try {
      const userDoc = await db.collection("users").doc(userId).get();
      const fcmToken = userDoc.exists ? userDoc.data().fcmToken : null;
      if (!fcmToken) {
        console.log(`⚠️ Pas de token FCM pour l'utilisateur ${userId}.`);
        return;
      }
      const response = await getMessaging().send({
        notification: notif,
        webpush: { fcm_options: { link: "https://snacking-template.web.app/" } },
        token: fcmToken,
      });
      console.log(`✅ Notif "${newData.statut}" envoyée pour commande ${orderId} :`, response);
    } catch (error) {
      console.error("❌ Erreur lors de l'envoi de la notification de commande :", error);
      await cleanupInvalidFcmToken(userId, error);
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

    const userId = after.userId;
    try {
      const userDoc = await db.collection("users").doc(userId).get();
      const fcmToken = userDoc.exists ? userDoc.data().fcmToken : null;
      if (!fcmToken) return;

      const label = bucket >= 1000 ? `${bucket / 1000} km` : `${bucket} m`;
      const body = bucket <= 300 ? `Votre livreur arrive (${label}), préparez-vous !` : `Votre livreur est à ${label} environ.`;
      await getMessaging().send({
        notification: { title: "🛵 Votre livreur approche", body },
        webpush: { fcm_options: { link: "https://snacking-template.web.app/" } },
        token: fcmToken,
      });
    } catch (error) {
      console.error("❌ Erreur notif géofence :", error);
      await cleanupInvalidFcmToken(userId, error);
    }
  },
);


