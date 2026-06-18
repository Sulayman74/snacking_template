// ============================================================================
// 🍳 CAPACITÉ CUISINE — file d'attente, ETA prep, rushMode
// ============================================================================
// Source de vérité UNIQUE consommée par getKitchenLoad, finalizeOrder (ETA) et
// pushFlashOffer (rushMode). Calculée côté serveur.

const { db } = require("./admin");
const { isFiniteNum } = require("./geo");

// Nombre de commandes "en cours" pour un snack (file d'attente cuisine).
async function getKitchenQueueCount(snackId) {
  try {
    const agg = await db
      .collection("commandes")
      .where("snackId", "==", snackId)
      .where("statut", "in", ["en_attente_client", "nouvelle"])
      .count()
      .get();
    return agg.data().count || 0;
  } catch (e) {
    console.warn("[eta] queue count indisponible :", e.message);
    return 0;
  }
}

// Minutes de préparation estimées depuis la file et la config delivery.
// Source de vérité UNIQUE, consommée par finalizeOrder ET getKitchenLoad (DRY).
function computePrepMin(snackData, queueCount) {
  const d = (snackData && snackData.delivery) || {};
  const prepBaseMin = isFiniteNum(d.prepBaseMin) ? d.prepBaseMin : 12;
  const queueFactorMin = isFiniteNum(d.queueFactorMin) ? d.queueFactorMin : 3;
  return Math.max(1, Math.round(prepBaseMin + queueFactorMin * queueCount));
}

// Seuils de capacité cuisine, lus depuis snacks/{snackId}.capacity avec des
// défauts serveur sûrs (zéro migration : un snack sans `capacity` reste valide).
function readCapacityConfig(snackData) {
  const c = (snackData && snackData.capacity) || {};
  return {
    rushThreshold: isFiniteNum(c.rushThreshold) && c.rushThreshold > 0 ? c.rushThreshold : 8,
    prepCeilingMin: isFiniteNum(c.prepCeilingMin) && c.prepCeilingMin > 0 ? c.prepCeilingMin : 30,
    loadCacheTtlMs:
      (isFiniteNum(c.loadCacheTtlSec) && c.loadCacheTtlSec > 0 ? c.loadCacheTtlSec : 30) * 1000,
  };
}

// Décision de capacité (sans cache) : file + prep estimée → rushMode.
// Calculée UNE fois côté serveur, consommée par getKitchenLoad et pushFlashOffer.
async function computeKitchenLoad(snackData, snackId) {
  const cfg = readCapacityConfig(snackData);
  const queue = await getKitchenQueueCount(snackId);
  const avgPrepMin = computePrepMin(snackData, queue);
  const rushMode = queue >= cfg.rushThreshold || avgPrepMin >= cfg.prepCeilingMin;
  return { queue, avgPrepMin, rushMode };
}

module.exports = { getKitchenQueueCount, computePrepMin, readCapacityConfig, computeKitchenLoad };
