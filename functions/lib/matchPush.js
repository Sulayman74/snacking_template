// ============================================================================
// ⚽ PUSH SOIR DE MATCH — regroupement + cadence (logique PURE, sans Firebase)
// ============================================================================
// Avant : le cron créait UNE campagne par match du jour et par restaurant → une
// soirée de Champions League (9 matchs) = 9 notifications sur le même téléphone.
// Règles désormais appliquées (domains/growth.js planifie, domains/marketing.js
// envoie) :
//   1. UNE campagne par restaurant et par soirée (clé = jour dans le fuseau du
//      snack), envoyée H-2 du premier coup d'envoi restant, message groupé qui cite
//      les deux affiches « vedettes » (équipes des filtres : PSG, Real, Man City…).
//   2. Cadence par restaurant : au plus un push soir de match par fenêtre de
//      MATCH_PUSH_MIN_GAP_HOURS, et au plus MATCH_PUSH_MAX_PER_WEEK sur 7 jours
//      glissants. Surcharge par snack : pushMatchMinGapHours, pushMatchMaxPerWeek
//      (0 = famille désactivée).
//   3. L'historique des envois vit sur le doc snack : matchPushLog = [ms, …]
//      (élagué à 7 jours, écrit par l'Admin SDK après un envoi réussi). Vérifié à
//      la planification ET au moment de l'envoi (le cache football peut changer
//      entre 9h et le soir).

const { isHeadlineTeam } = require("./football");
const { canSendToUser, pruneRecentPushes } = require("./pushGovernance");
const { snackTimezone } = require("./openingHours");

const MATCH_PUSH_SOURCE = "match_auto";
const MATCH_PUSH_LEAD_MS = 2 * 60 * 60 * 1000; // H-2 du coup d'envoi
const MATCH_PUSH_MIN_GAP_HOURS = 20;           // un push soir de match par jour, au plus
const MATCH_PUSH_MAX_PER_WEEK = 2;             // mardi + mercredi de C1, pas plus
const MATCH_PUSH_WINDOW_DAYS = 7;
const MATCH_PUSH_LOG_MAX = 20;

const COMPETITION_LABELS = {
  CL: "Champions League", FL1: "Ligue 1", PL: "Premier League", PD: "Liga", WC: "Coupe du Monde", EC: "Euro",
};
// Sigles de clubs retirés dans les messages groupés ("AS Roma" → "Roma", "VfB Stuttgart" → "Stuttgart").
const CLUB_TOKENS = /^(FC|CF|SC|AC|SK|FK|AS|SS|BK|IF|KV|VfB|PAE|ŠK|KAA|RSC|RC|US|UD|CD|SD|SL|SV|TSG|1\.)$/u;

/**
 * Politique de cadence d'un restaurant (valeurs par défaut surchargées sur le doc snack).
 * @param {object} [snackData]
 * @returns {{ minGapMs: number, maxPerWeek: number, timeZone: string }}
 */
function matchPushPolicy(snackData = {}) {
  const gap = Number(snackData.pushMatchMinGapHours);
  const cap = Number(snackData.pushMatchMaxPerWeek);
  return {
    minGapMs: (Number.isFinite(gap) && gap >= 0 ? gap : MATCH_PUSH_MIN_GAP_HOURS) * 60 * 60 * 1000,
    maxPerWeek: Number.isInteger(cap) && cap >= 0 ? cap : MATCH_PUSH_MAX_PER_WEEK,
    timeZone: snackTimezone(snackData),
  };
}

/** "YYYY-MM-DD" d'un instant dans un fuseau (en-CA = format ISO). */
function dayKey(date, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch (_e) {
    return date.toISOString().slice(0, 10);
  }
}

/** "21:00" dans le fuseau du snack. */
function formatKickoff(ms, timeZone) {
  try {
    return new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
  } catch (_e) {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

/** Nom court d'un club pour un message groupé. */
function shortName(name) {
  const kept = String(name || "").split(/\s+/).filter((tok) => tok && !CLUB_TOKENS.test(tok));
  return kept.length ? kept.join(" ") : String(name || "");
}

/**
 * Matchs de la journée (fuseau du snack), non terminés, avec kickoffMs, triés.
 * @param {Array<object>} matches - Cache football (utcDate, status, …).
 * @param {{ nowMs: number, timeZone: string }} opts
 */
function matchesOfDay(matches, { nowMs, timeZone }) {
  const today = dayKey(new Date(nowMs), timeZone);
  return (Array.isArray(matches) ? matches : [])
    .filter((m) => m && m.utcDate && m.status !== "FINISHED")
    .map((m) => ({ ...m, kickoffMs: Date.parse(m.utcDate) }))
    .filter((m) => Number.isFinite(m.kickoffMs) && dayKey(new Date(m.kickoffMs), timeZone) === today)
    .sort((a, b) => a.kickoffMs - b.kickoffMs);
}

/** Affiches « vedettes » d'abord (2 équipes vedettes > 1 > 0), puis par coup d'envoi. */
function rankHeadlines(matches) {
  const score = (m) => (isHeadlineTeam(m.homeTeam?.name) ? 1 : 0) + (isHeadlineTeam(m.awayTeam?.name) ? 1 : 0);
  return [...matches].sort((a, b) => score(b) - score(a) || a.kickoffMs - b.kickoffMs);
}

/**
 * Titre + message de la campagne d'une soirée. Un seul match : libellé historique
 * inchangé ; plusieurs : message groupé.
 * @param {Array<object>} dayMatches - Matchs restants de la soirée (triés par coup d'envoi).
 * @param {{ timeZone: string }} opts
 * @returns {{ titre: string, message: string }}
 */
function buildCampaignContent(dayMatches, { timeZone }) {
  const label = (m) => `${shortName(m.homeTeam?.name) || "Équipe A"} – ${shortName(m.awayTeam?.name) || "Équipe B"}`;
  const n = dayMatches.length;
  if (n === 1) {
    const m = dayMatches[0];
    return {
      titre: `⚽ ${m.homeTeam?.name || "Équipe A"} vs ${m.awayTeam?.name || "Équipe B"} ce soir !`,
      message: "Commande ton menu avant le coup d'envoi, prêt pile pour le match 🍕",
    };
  }
  const codes = new Set(dayMatches.map((m) => m.competition?.code));
  const compLabel = codes.size === 1 ? COMPETITION_LABELS[[...codes][0]] || "foot" : "foot";
  const [a, b] = rankHeadlines(dayMatches);
  const others = n - 2;
  const lead = others > 0
    ? `${label(a)}, ${label(b)} et ${others} autre${others > 1 ? "s" : ""} affiche${others > 1 ? "s" : ""}`
    : `${label(a)} et ${label(b)}`;
  return {
    titre: `⚽ Soirée ${compLabel} : ${n} matchs ce soir !`,
    message: `${lead} dès ${formatKickoff(dayMatches[0].kickoffMs, timeZone)}. Commande ton menu avant le coup d'envoi, prêt pile pour le match 🍕`,
  };
}

/**
 * Cadence : ce restaurant peut-il recevoir un push soir de match à `atMs` ?
 * @param {object} snackData - doc snack (matchPushLog, pushMatchMinGapHours, pushMatchMaxPerWeek).
 * @param {number} atMs - Instant de l'envoi envisagé.
 * @param {ReturnType<typeof matchPushPolicy>} [policy]
 * @returns {{ allowed: boolean, reason: string|null }}
 */
function canSendMatchPush(snackData = {}, atMs, policy = matchPushPolicy(snackData)) {
  const log = Array.isArray(snackData.matchPushLog) ? snackData.matchPushLog.filter(Number.isFinite) : [];
  const last = log.length ? Math.max(...log) : 0;
  if (last && atMs - last < policy.minGapMs) return { allowed: false, reason: "min-gap" };
  if (!canSendToUser({ pushLog: log }, { cap: policy.maxPerWeek, windowDays: MATCH_PUSH_WINDOW_DAYS }, atMs)) {
    return { allowed: false, reason: "weekly-cap" };
  }
  return { allowed: true, reason: null };
}

/**
 * matchPushLog à écrire sur le doc snack après un envoi réussi (élagué à 7 jours).
 * @param {object} snackData
 * @param {number} [atMs=Date.now()]
 * @returns {number[]}
 */
function recordMatchPush(snackData = {}, atMs = Date.now()) {
  return pruneRecentPushes({ pushLog: snackData.matchPushLog }, { windowDays: MATCH_PUSH_WINDOW_DAYS, maxLen: MATCH_PUSH_LOG_MAX }, atMs);
}

/**
 * Plan du jour pour UN restaurant. `plan` null si rien à envoyer (reason explique).
 * Les matchs dont le H-2 est déjà passé sont ignorés (cron tardif) : le message
 * ne cite que ce qu'il est encore possible de commander à temps.
 * @param {{ matches: Array<object>, snackData: object, nowMs?: number }} args
 * @returns {{ plan: null|{ dayKey: string, pushAtMs: number, matchIds: Array, matchCount: number, titre: string, message: string }, reason: string|null }}
 */
function planMatchDayPush({ matches, snackData = {}, nowMs = Date.now() }) {
  const policy = matchPushPolicy(snackData);
  const day = matchesOfDay(matches, { nowMs, timeZone: policy.timeZone });
  if (day.length === 0) return { plan: null, reason: "no-match-today" };
  const upcoming = day.filter((m) => m.kickoffMs - MATCH_PUSH_LEAD_MS > nowMs);
  if (upcoming.length === 0) return { plan: null, reason: "too-late" };
  const pushAtMs = upcoming[0].kickoffMs - MATCH_PUSH_LEAD_MS;
  const cadence = canSendMatchPush(snackData, pushAtMs, policy);
  if (!cadence.allowed) return { plan: null, reason: cadence.reason };
  return {
    plan: {
      dayKey: dayKey(new Date(nowMs), policy.timeZone),
      pushAtMs,
      matchIds: upcoming.map((m) => m.id),
      matchCount: upcoming.length,
      ...buildCampaignContent(upcoming, { timeZone: policy.timeZone }),
    },
    reason: null,
  };
}

module.exports = {
  MATCH_PUSH_SOURCE,
  MATCH_PUSH_LEAD_MS,
  MATCH_PUSH_MIN_GAP_HOURS,
  MATCH_PUSH_MAX_PER_WEEK,
  MATCH_PUSH_WINDOW_DAYS,
  matchPushPolicy,
  dayKey,
  formatKickoff,
  shortName,
  matchesOfDay,
  rankHeadlines,
  buildCampaignContent,
  canSendMatchPush,
  recordMatchPush,
  planMatchDayPush,
};
