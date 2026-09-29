// ============================================================================
// 🔔 FCM — push fidélité
// ============================================================================
// Partagé par les domaines fidélité et commande. Les destinataires et le
// nettoyage des tokens morts passent par lib/pushTargets (abonnements par
// appareil / snack). No-op silencieux si aucun appareil (le crédit reste OK).

const { getUserPushTargets, sendToTargets, isInvalidFcmTokenError } = require("./pushTargets");

/**
 * Émet le push de palier « menu offert ». À appeler APRÈS le commit de la transaction
 * (jamais dans une transaction). Ne lève jamais.
 * @param {string} userId - uid du client.
 * @param {string} snackId - Snack à l'origine de la récompense.
 * @returns {Promise<void>}
 */
async function sendRewardPush(userId, snackId) {
  try {
    const targets = await getUserPushTargets(userId, snackId, "client");
    await sendToTargets(targets, {
      notification: {
        title: "🎁 Menu offert !",
        body: "Bravo ! Tu as atteint le palier fidélité. Ton prochain menu est offert 🍟",
      },
      data: { type: "REWARD_UNLOCKED", snackId: String(snackId) },
    });
  } catch (error) {
    console.error(`❌ Push fidélité (uid ${userId}) échoué :`, error);
  }
}

module.exports = { isInvalidFcmTokenError, sendRewardPush };
