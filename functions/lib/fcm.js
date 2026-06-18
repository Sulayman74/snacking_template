// ============================================================================
// 🔔 FCM — push fidélité + nettoyage des tokens morts
// ============================================================================
// Partagé par les domaines fidélité (sendRewardPush) et notifications/marketing
// (cleanupInvalidFcmToken). No-op silencieux si pas de token (le crédit reste OK).

const { getMessaging } = require("firebase-admin/messaging");
const { admin, db } = require("./admin");

// Détecte un token FCM devenu invalide (PWA réinstallée, désinstallation, etc.)
function isInvalidFcmTokenError(error) {
  const code = error?.code || error?.errorInfo?.code;
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  );
}

// Nettoie le fcmToken Firestore si l'erreur indique un token mort.
// Retourne true si nettoyage effectué.
async function cleanupInvalidFcmToken(userId, error) {
  if (!isInvalidFcmTokenError(error)) return false;
  try {
    await db.collection("users").doc(userId).update({
      fcmToken: admin.firestore.FieldValue.delete(),
    });
    console.log(`🧹 Token FCM invalide nettoyé pour user ${userId}`);
    return true;
  } catch (e) {
    console.error(`❌ Échec cleanup token user ${userId}:`, e);
    return false;
  }
}

/**
 * Émet le push de palier « menu offert ». À appeler APRÈS le commit de la transaction
 * (jamais dans une transaction). No-op si le client n'a pas de token. Nettoie un token mort.
 * @param {string} userId - uid du client (pour le cleanup du token).
 * @param {string|null} fcmToken - Token FCM du client.
 * @param {string} snackId - Snack à l'origine de la récompense (transmis au front).
 * @returns {Promise<void>}
 */
async function sendRewardPush(userId, fcmToken, snackId) {
  if (!fcmToken) return; // crédit OK sans token → pas de crash
  try {
    await getMessaging().send({
      notification: {
        title: "🎁 Menu offert !",
        body: "Bravo ! Tu as atteint le palier fidélité. Ton prochain menu est offert 🍟",
      },
      data: { type: "REWARD_UNLOCKED", snackId: String(snackId) },
      token: fcmToken,
    });
  } catch (error) {
    await cleanupInvalidFcmToken(userId, error);
  }
}

module.exports = { isInvalidFcmTokenError, cleanupInvalidFcmToken, sendRewardPush };
