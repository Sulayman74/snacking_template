// ============================================================================
// 🕒 RETRAIT « PLUS TARD » — validation serveur du créneau demandé
// ============================================================================
// Le client propose un créneau ; le serveur le revalide contre les horaires du
// snack (dans SON fuseau) au moment du paiement. Le créneau validé est stocké
// avec le panier en attente (pendingOrders) : la commande le relit de là, jamais
// du client (finalizeOrder comme le réconciliateur).

const { V, require_ } = require("./validation");
const { isValidPickupSlot, snackTimezone } = require("./openingHours");

/** Temps de préparation de base du snack (même source que computePrepMin). */
function basePrepMin(snackData) {
  const v = snackData?.delivery?.prepBaseMin;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 12;
}

/**
 * @param {*} input - `retrait` envoyé par le client : absent / { mode: "asap" } / { mode: "creneau", heure: ms }
 * @returns {null|{mode:"creneau", heureMs:number, lancerAMs:number}} null = « dès que possible »
 * @throws {HttpsError} créneau mal formé, hors horaires, passé, ou en livraison.
 */
function resolvePickupRequest(input, snackData, orderMode, nowMs = Date.now()) {
  if (input === undefined || input === null) return null;
  require_(V.isPlainObject(input), "Retrait invalide.");
  if (input.mode === "asap") return null;
  require_(input.mode === "creneau", "Mode de retrait invalide.");
  require_(orderMode !== "delivery", "Les créneaux sont réservés au retrait sur place.");
  require_(Number.isFinite(input.heure), "Heure de retrait invalide.");

  const prepMin = basePrepMin(snackData);
  require_(
    isValidPickupSlot(snackData?.hours, new Date(nowMs), snackTimezone(snackData), input.heure, { prepMin }),
    "Ce créneau n'est plus disponible. Choisissez-en un autre."
  );
  return { mode: "creneau", heureMs: input.heure, lancerAMs: input.heure - prepMin * 60000 };
}

module.exports = { resolvePickupRequest, basePrepMin };
