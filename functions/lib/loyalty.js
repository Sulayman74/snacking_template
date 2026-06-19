// ============================================================================
// 🎁 FIDÉLITÉ — crédit de points (report + banque) partagé scan + commande
// ============================================================================
// creditLoyaltyPoints est appelé par awardLoyaltyPoint (scan) ET finalizeOrder
// (commande payée) — le cooldown F3 unifié (loyaltyLastCredit) évite le double crédit
// pour un même achat. Logique transactionnelle ; le push de palier est émis APRÈS
// commit par l'appelant (cf. lib/fcm sendRewardPush).

const { HttpsError } = require("firebase-functions/v2/https");
const { FieldValue } = require("./admin");

// Palier fidélité partagé (scan boutique ET commande payée). À MAX → menu offert.
const MAX_LOYALTY_POINTS = 10;

// 🛡️ ANTI-DOUBLON (F3) — fenêtre pendant laquelle un client ne peut gagner qu'UN
// point par snack, TOUS CANAUX confondus (scan boutique + commande en ligne). Évite
// le double crédit pour un même achat (ex. commande en ligne puis scan du QR au
// comptoir). Configurable par snack via loyalty.creditCooldownMin (0 = désactivé).
const DEFAULT_LOYALTY_COOLDOWN_MS = 10 * 60_000; // 10 min

/**
 * Résout la fenêtre anti-doublon (ms) d'un snack : loyalty.creditCooldownMin (minutes,
 * 0 désactive) sinon le défaut. Lue UNE fois par l'appelant et passée au helper, pour
 * que scan et commande partagent EXACTEMENT le même cooldown (unification F3).
 * @param {Object} snackData - Document snacks/{snackId}.
 * @returns {number} Durée du cooldown en millisecondes (>= 0).
 */
function resolveLoyaltyCooldownMs(snackData) {
  const min = Number(snackData?.loyalty?.creditCooldownMin);
  if (Number.isFinite(min) && min >= 0) return Math.round(min * 60_000);
  return DEFAULT_LOYALTY_COOLDOWN_MS;
}

/**
 * Crédite n point(s) de fidélité (EARNING) sur pointsBySnack.{snackId}, dans une transaction.
 *
 * Modèle "report + banque" (LOT F2 — traçabilité fidélité) :
 *   - Le compteur pointsBySnack.{snackId} ne représente QUE la progression 0..MAX-1.
 *   - Au franchissement du palier, on N'écrase PAS le point gagné : le total est
 *     reporté (`total % MAX`) et chaque palier complété banque une récompense durable
 *     dans rewardsAvailable.{snackId} (`floor(total / MAX)`). Plus aucun point perdu.
 *   - La récompense est PERSISTÉE (banque) puis consommée par redeemLoyaltyReward.
 *
 * Anti-doublon (LOT F3) : si un crédit a déjà eu lieu sur la fenêtre `cooldownMs`
 * (loyaltyLastCredit.{snackId}, écrit ICI à chaque crédit → unifié scan + commande),
 * on NE crédite PAS et on renvoie `{skipped:true}` (l'appelant décide : le scan lève
 * une erreur lisible, la commande payée ignore silencieusement). N'émet PAS le push
 * (effet de bord après commit). Read-Old/Write-New : champs absents traités comme 0.
 *
 * @param {FirebaseFirestore.Transaction} tx - Transaction Firestore en cours.
 * @param {FirebaseFirestore.DocumentReference} clientRef - Réf. du doc users/{uid}.
 * @param {string} snackId - Clé de partitionnement multi-tenant.
 * @param {number} [n=1] - Nombre de points à créditer (1 en pratique : scan & commande).
 * @param {number} [cooldownMs=DEFAULT_LOYALTY_COOLDOWN_MS] - Fenêtre anti-doublon (0 = off).
 * @returns {Promise<{skipped:boolean, points:number, max:number, reward:boolean, earned:number, rewardsAvailable:number, fcmToken:(string|null)}>}
 * @throws {HttpsError} not-found si le doc client n'existe pas.
 */
async function creditLoyaltyPoints(tx, clientRef, snackId, n = 1, cooldownMs = DEFAULT_LOYALTY_COOLDOWN_MS) {
  const snap = await tx.get(clientRef);
  if (!snap.exists) throw new HttpsError("not-found", "Client introuvable.");
  const d = snap.data();
  const current = (d.pointsBySnack || {})[snackId] || 0;
  const availableBefore = (d.rewardsAvailable || {})[snackId] || 0;

  // 🛡️ Cooldown anti-doublon (F3) — tous canaux confondus via loyaltyLastCredit.
  const lastCredit = (d.loyaltyLastCredit || {})[snackId];
  const lastMs = lastCredit && lastCredit.toMillis ? lastCredit.toMillis() : 0;
  if (cooldownMs > 0 && lastMs && Date.now() - lastMs < cooldownMs) {
    return {
      skipped: true,
      points: current,
      max: MAX_LOYALTY_POINTS,
      reward: false,
      earned: 0,
      rewardsAvailable: availableBefore,
      fcmToken: d.fcmToken || null,
    };
  }

  // Report : le point gagné compte toujours, même au franchissement du palier.
  const total = current + n;
  const earned = Math.floor(total / MAX_LOYALTY_POINTS); // récompenses banquées (0 ou 1 en pratique)
  const newPoints = total % MAX_LOYALTY_POINTS;          // progression reportée 0..MAX-1
  const newAvailable = availableBefore + earned;

  const update = {
    [`pointsBySnack.${snackId}`]: newPoints,
    // Horodatage unifié du dernier crédit (anti-doublon F3, scan + commande).
    [`loyaltyLastCredit.${snackId}`]: FieldValue.serverTimestamp(),
  };
  if (earned > 0) update[`rewardsAvailable.${snackId}`] = newAvailable;
  tx.update(clientRef, update);

  return {
    skipped: false,
    points: newPoints,
    max: MAX_LOYALTY_POINTS,
    reward: earned > 0,
    earned,
    rewardsAvailable: newAvailable,
    fcmToken: d.fcmToken || null,
  };
}

module.exports = {
  MAX_LOYALTY_POINTS,
  DEFAULT_LOYALTY_COOLDOWN_MS,
  resolveLoyaltyCooldownMs,
  creditLoyaltyPoints,
};
