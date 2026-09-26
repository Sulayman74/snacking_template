/**
 * 🕐 openingHours.js — État d'ouverture d'un snack, calculé dans SON fuseau.
 *
 * ⚠️ JUMEAU de functions/lib/openingHours.js (CommonJS, déployé séparément).
 * Toute modification doit être reportée à l'identique : tests/unit/openingHours.test.js
 * exécute les mêmes cas sur les deux implémentations.
 *
 * - Heure LOCALE DU SNACK (Intl + fuseau IANA), jamais celle du téléphone client
 *   ni celle du serveur (Cloud Functions = UTC). Heure d'été gérée par Intl.
 * - `hours` : 7 jours, index 0 = lundi → 6 = dimanche (format AdminConfigUI) :
 *   { open:"11:00", close:"22:00", closed:false, hasBreak, breakStart, breakEnd }.
 * - Fermeture après minuit (close <= open) et créneaux contigus sur 2 jours gérés.
 * - Horaires absents / mal formés → `configured:false, open:true` : on ne bloque
 *   JAMAIS une commande sur une donnée douteuse.
 * - `lastOrderMinutesBeforeClose` (réglage restaurateur) : les commandes en ligne
 *   s'arrêtent X min avant CHAQUE fermeture (fin de service midi comprise).
 */
export const DEFAULT_TIMEZONE = "Europe/Paris";

const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const DAY_MIN = 1440;

function isValidTimezone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

/** Fuseau du snack : `timezone`, sinon `pushTimezone` (gouvernance push), sinon Paris. */
export function snackTimezone(snack) {
  const tz = snack?.timezone || snack?.pushTimezone;
  return isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** Jour (0 = lundi) et minutes depuis minuit, à l'heure locale de `timeZone`. */
export function localClock(date, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: isValidTimezone(timeZone) ? timeZone : DEFAULT_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { dayIndex: WEEKDAYS[get("weekday")], minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function parseHHMM(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof value === "string" ? value.trim() : "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Créneaux [début, fin[ d'une journée, en minutes (fin > 1440 = après minuit).
// null = journée mal formée ; [] = fermé.
function dayIntervals(day) {
  if (!day || typeof day !== "object") return null;
  if (day.closed === true) return [];
  const open = parseHHMM(day.open);
  let close = parseHHMM(day.close);
  if (open === null || close === null) return null;
  if (close <= open) close += DAY_MIN;
  if (day.hasBreak) {
    const bs = parseHHMM(day.breakStart);
    const be = parseHHMM(day.breakEnd);
    if (bs !== null && be !== null && open < bs && bs < be && be < close) {
      return [[open, bs], [be, close]];
    }
  }
  return [[open, close]];
}

const formatHHMM = (minutes) => {
  const m = ((minutes % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * @returns {{configured:boolean, open:boolean, minutesToClose:(number|null), closeTime:(string|null),
 *   minutesToOpen:(number|null), nextOpenTime:(string|null), nextOpenDayOffset:(number|null)}}
 *   minutesToOpen/nextOpenTime : PROCHAINE ouverture après le créneau en cours (ou maintenant si fermé).
 */
export function getOpeningState(hours, date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const unknown = {
    configured: false, open: true, minutesToClose: null, closeTime: null,
    minutesToOpen: null, nextOpenTime: null, nextOpenDayOffset: null,
  };
  if (!Array.isArray(hours) || hours.length !== 7) return unknown;
  const perDay = hours.map(dayIntervals);
  if (perDay.some((d) => d === null)) return unknown;

  const { dayIndex, minutes: now } = localClock(date, timeZone);

  // Frise relative à aujourd'hui 00:00 (heure du snack) : la veille (débordement
  // après minuit) jusqu'à J+7, créneaux contigus fusionnés (ex. 18h→24h + 0h→2h).
  const slots = [];
  for (let off = -1; off <= 7; off++) {
    const di = (((dayIndex + off) % 7) + 7) % 7;
    for (const [s, e] of perDay[di]) slots.push([s + off * DAY_MIN, e + off * DAY_MIN]);
  }
  slots.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of slots) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const current = merged.find(([s, e]) => s <= now && now < e);
  const next = merged.find(([s]) => s > now);
  return {
    configured: true,
    open: !!current,
    minutesToClose: current ? current[1] - now : null,
    closeTime: current ? formatHHMM(current[1]) : null,
    minutesToOpen: next ? next[0] - now : null,
    nextOpenTime: next ? formatHHMM(next[0]) : null,
    nextOpenDayOffset: next ? Math.floor(next[0] / DAY_MIN) : null,
  };
}

/** Délai « dernière commande avant fermeture » : entier 1..180 min, sinon 0 (à la fermeture). */
export function normalizeLastOrderMinutes(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 180 ? n : 0;
}

/**
 * Le snack PREND-IL des commandes en ligne maintenant ? = ouvert ET avant l'heure
 * limite (fermeture − lastOrderMinutes). Non configuré → accepte toujours.
 * @returns {Object} état d'ouverture + { accepting, reason:null|"closed"|"cutoff",
 *   lastOrderMinutes, minutesToCutoff, cutoffTime }
 */
export function getOrderingState(hours, date = new Date(), timeZone = DEFAULT_TIMEZONE, lastOrderMinutes = 0) {
  const state = getOpeningState(hours, date, timeZone);
  const cutoff = normalizeLastOrderMinutes(lastOrderMinutes);
  const minutesToCutoff = state.open && state.configured ? state.minutesToClose - cutoff : null;
  let reason = null;
  if (state.configured && !state.open) reason = "closed";
  else if (minutesToCutoff !== null && minutesToCutoff <= 0) reason = "cutoff";
  return {
    ...state,
    accepting: reason === null,
    reason,
    lastOrderMinutes: cutoff,
    minutesToCutoff,
    cutoffTime: state.open && state.configured ? formatHHMM(parseHHMM(state.closeTime) - cutoff) : null,
  };
}
