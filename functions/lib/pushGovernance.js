// ============================================================================
// 🛡️ GOUVERNANCE PUSH — anti-fatigue (LOT 5 roadmap)
// ============================================================================
// Empêche la sur-sollicitation qui ferait perdre DÉFINITIVEMENT le canal push.
// Séparation des familles :
//   • TRANSACTIONNEL (commande prête, livreur, palier) → JAMAIS capé (notifications.js
//     n'importe pas cette lib).
//   • BROADCAST (campagnes) → opt-out (toujours) + quiet hours + circuit breaker.
//   • 1:1 DÉCLENCHÉ (win-back, panier abandonné — LOT 7) → frequency cap par user
//     via canSendToUser/pruneRecentPushes (primitive fournie ici, volume faible).
//
// Métrique-reine du circuit breaker = taux de jetons invalidés (cf. LOT 1,
// campagnes_push.stats.tokensInvalidated). RGPD : on ne stocke que des timestamps.

const DEFAULT_QUIET_START = 22; // 22:00 (heure locale tenant)
const DEFAULT_QUIET_END = 8;    //  8:00
const DEFAULT_TIMEZONE = "Europe/Paris";
const DEFAULT_BREAKER_THRESHOLD = 0.5; // 50 % de jetons invalides…
const DEFAULT_BREAKER_MIN_SAMPLE = 50; // …sur un échantillon significatif.

/**
 * Heure locale (0-23) d'une date dans le fuseau d'un tenant, DST géré par Intl.
 * @param {Date} date
 * @param {string} timeZone - ex. "Europe/Paris".
 * @returns {number} Heure locale entière.
 */
function localHour(date, timeZone) {
  try {
    const h = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(date);
    // "24" possible selon impl. → ramené à 0.
    return parseInt(h, 10) % 24;
  } catch (_e) {
    return date.getUTCHours();
  }
}

/**
 * Indique si l'on est dans la fenêtre de silence d'un tenant (pas d'envoi push).
 * Gère le wrap nuit (ex. 22→8). Bornes configurables côté snack.
 * @param {object} snackData - Document snack (pushQuietStart/End/Timezone).
 * @param {Date} [now=new Date()]
 * @returns {boolean}
 */
function isQuietHours(snackData = {}, now = new Date()) {
  const start = Number.isInteger(snackData.pushQuietStart) ? snackData.pushQuietStart : DEFAULT_QUIET_START;
  const end = Number.isInteger(snackData.pushQuietEnd) ? snackData.pushQuietEnd : DEFAULT_QUIET_END;
  const tz = snackData.pushTimezone || DEFAULT_TIMEZONE;
  if (start === end) return false; // fenêtre nulle = jamais silencieux
  const h = localHour(now, tz);
  // Fenêtre normale (ex. 1→6) vs wrap nuit (ex. 22→8).
  return start < end ? h >= start && h < end : h >= start || h < end;
}

/**
 * Utilisateur ayant explicitement refusé les pushs marketing.
 * @param {object} userData
 * @returns {boolean}
 */
function isOptedOut(userData = {}) {
  return userData.pushOptOut === true;
}

/**
 * Circuit breaker : faut-il stopper une campagne dont trop de jetons sont invalides ?
 * Évite de continuer à « cramer » le canal quand la base de tokens est pourrie.
 * @param {number} invalidated - Jetons invalidés cumulés.
 * @param {number} processed - Destinataires traités cumulés.
 * @param {object} [snackData] - pushBreakerThreshold optionnel.
 * @returns {boolean} true → interrompre les envois restants.
 */
function breakerTripped(invalidated, processed, snackData = {}) {
  const threshold = typeof snackData.pushBreakerThreshold === "number"
    ? snackData.pushBreakerThreshold
    : DEFAULT_BREAKER_THRESHOLD;
  if (processed < DEFAULT_BREAKER_MIN_SAMPLE) return false; // pas assez d'échantillon
  return invalidated / processed >= threshold;
}

/**
 * Gouvernance avancée (quiet hours + circuit breaker) active pour ce tenant ?
 * Défaut OFF → comportement legacy strictement inchangé. L'opt-out, lui, est
 * TOUJOURS respecté (droit utilisateur), indépendamment de ce flag.
 * @param {object} snackData
 * @returns {boolean}
 */
function isGovernanceEnabled(snackData = {}) {
  return snackData.pushGovernance === true;
}

// ---------------------------------------------------------------------------
// Primitive frequency-cap par user (pour les envois 1:1 déclenchés — LOT 7).
// Stockée sous users.pushLog = [ms, …] (élagué). Non utilisée par les broadcasts
// (gouvernés par quota mensuel + opt-out + quiet hours + breaker).
// ---------------------------------------------------------------------------

/**
 * L'utilisateur peut-il recevoir un push 1:1 sans dépasser le cap glissant ?
 * @param {object} userData - doit porter pushLog (array de ms) optionnel.
 * @param {{cap:number, windowDays:number}} opts
 * @param {number} [nowMs=Date.now()]
 * @returns {boolean}
 */
function canSendToUser(userData = {}, { cap, windowDays }, nowMs = Date.now()) {
  const since = nowMs - windowDays * 86_400_000;
  const log = Array.isArray(userData.pushLog) ? userData.pushLog : [];
  const recent = log.filter((t) => typeof t === "number" && t >= since);
  return recent.length < cap;
}

/**
 * Renvoie un pushLog élagué à la fenêtre, avec le nouvel envoi ajouté (à écrire
 * par l'appelant). Borne la taille pour éviter une croissance non maîtrisée.
 * @param {object} userData
 * @param {{windowDays:number, maxLen?:number}} opts
 * @param {number} [nowMs=Date.now()]
 * @returns {number[]}
 */
function pruneRecentPushes(userData = {}, { windowDays, maxLen = 50 }, nowMs = Date.now()) {
  const since = nowMs - windowDays * 86_400_000;
  const log = Array.isArray(userData.pushLog) ? userData.pushLog : [];
  const recent = log.filter((t) => typeof t === "number" && t >= since);
  recent.push(nowMs);
  return recent.slice(-maxLen);
}

module.exports = {
  isQuietHours,
  isOptedOut,
  breakerTripped,
  isGovernanceEnabled,
  canSendToUser,
  pruneRecentPushes,
  localHour,
};
