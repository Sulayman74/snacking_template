// ============================================================================
// 🚦 ÉTAT DE LA BOUTIQUE — peut-on commander, et sinon pourquoi ?
// ============================================================================
// Pur (aucun DOM) : partagé par la pastille d'état (StatusUI) et le paiement
// (SnackCheckout) pour que le client lise AVANT le panier ce que le paiement
// refuserait. Le serveur reste juge (createPaymentIntent).

import { getOrderingState, getPickupSlots } from "./openingHours.js";

/** Pastille « dernières commandes » affichée dans les N minutes avant l'heure limite. */
export const CLOSING_SOON_MIN = 15;

const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

const formatTime = (date, timeZone) =>
  date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: timeZone || "Europe/Paris" });

/** Fin de la pause cuisine si elle est en cours, sinon null. */
export function activePauseEnd(cfg, now = new Date()) {
  const until = toDate(cfg?.servicePausedUntil);
  return until && !Number.isNaN(until.getTime()) && until > now ? until : null;
}

/** État « cuisine en pause » si elle l'est (bandeau d'accueil), sinon null. */
export function pauseStatus(cfg, now = new Date()) {
  const end = activePauseEnd(cfg, now);
  return end
    ? { kind: "paused", canOrder: false, canOrderNow: false, tone: "danger", params: { time: formatTime(end, cfg?.timezone) } }
    : null;
}

/**
 * @param {Object} cfg - config client (snack-config.js)
 * @param {Date} [now]
 * @param {{mode?: "collect"|"delivery"}} [opts]
 * @returns {{
 *   kind: "open"|"closing_soon"|"closed_schedule"|"closed"|"paused"|"mode_disabled"|"offline"|"maintenance",
 *   canOrder: boolean,      // un paiement est possible (maintenant ou sur créneau)
 *   canOrderNow: boolean,   // « dès que possible » possible
 *   tone: "info"|"warn"|"danger"|null,
 *   params: Object          // valeurs pour le texte (heures déjà formatées)
 * }}
 */
export function getStorefrontStatus(cfg, now = new Date(), { mode = "collect" } = {}) {
  const isDelivery = mode === "delivery";
  const tz = cfg?.timezone;
  const blocked = (kind, params = {}) => ({ kind, canOrder: false, canOrderNow: false, tone: "danger", params });

  if (cfg?.features?.maintenanceMode) return blocked("maintenance");
  if (cfg?.features?.enableOnlineOrder === false) return blocked("offline");
  // Même règle que le paiement : le mode doit être explicitement activé.
  if (!(isDelivery ? cfg?.features?.enableDelivery : cfg?.features?.enableClickAndCollect)) {
    return blocked("mode_disabled", { delivery: isDelivery });
  }

  const paused = pauseStatus(cfg, now);
  if (paused) return paused;

  const ordering = getOrderingState(cfg?.hours, now, tz, cfg?.lastOrderMinutesBeforeClose);
  if (ordering.accepting) {
    if (Number.isFinite(ordering.minutesToCutoff) && ordering.minutesToCutoff <= CLOSING_SOON_MIN) {
      return { kind: "closing_soon", canOrder: true, canOrderNow: true, tone: "info", params: { time: ordering.cutoffTime } };
    }
    return { kind: "open", canOrder: true, canOrderNow: true, tone: null, params: {} };
  }

  const reopen = {
    reason: ordering.reason,
    time: ordering.nextOpenTime || null,
    dayOffset: ordering.nextOpenDayOffset ?? null,
  };
  // Retrait « plus tard » : fermé maintenant n'empêche pas de programmer.
  if (!isDelivery) {
    const prepMin = Number(cfg?.delivery?.prepBaseMin) > 0 ? Number(cfg.delivery.prepBaseMin) : 12;
    const [first] = getPickupSlots(cfg?.hours, now, tz, { prepMin, maxSlots: 1 });
    if (first) {
      return { kind: "closed_schedule", canOrder: true, canOrderNow: false, tone: "warn", params: { ...reopen, firstSlot: first.label } };
    }
  }
  return blocked("closed", reopen);
}
