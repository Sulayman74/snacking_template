/**
 * 🕐 openingHours.js — État d'ouverture d'un snack, calculé dans SON fuseau.
 *
 * ⚠️ JUMEAU de src/core/openingHours.js (ESM, front). Les Functions sont déployées
 * depuis functions/ et ne peuvent pas importer src/.
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
const DEFAULT_TIMEZONE = "Europe/Paris";

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
function snackTimezone(snack) {
  const tz = snack?.timezone || snack?.pushTimezone;
  return isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** Jour (0 = lundi) et minutes depuis minuit, à l'heure locale de `timeZone`. */
function localClock(date, timeZone = DEFAULT_TIMEZONE) {
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

function parseHHMM(value) {
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

// Frise des plages d'ouverture, en minutes relatives à aujourd'hui 00:00 (heure
// du snack) : la veille (débordement après minuit) jusqu'à J+7, plages contiguës
// fusionnées (ex. 18h→24h + 0h→2h). null si horaires absents / mal formés.
function openingTimeline(hours, date, timeZone) {
  if (!Array.isArray(hours) || hours.length !== 7) return null;
  const perDay = hours.map(dayIntervals);
  if (perDay.some((d) => d === null)) return null;

  const { dayIndex, minutes: now } = localClock(date, timeZone);
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
  return { merged, now };
}

/**
 * @returns {{configured:boolean, open:boolean, minutesToClose:(number|null), closeTime:(string|null),
 *   minutesToOpen:(number|null), nextOpenTime:(string|null), nextOpenDayOffset:(number|null)}}
 *   minutesToOpen/nextOpenTime : PROCHAINE ouverture après le créneau en cours (ou maintenant si fermé).
 */
function getOpeningState(hours, date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const unknown = {
    configured: false, open: true, minutesToClose: null, closeTime: null,
    minutesToOpen: null, nextOpenTime: null, nextOpenDayOffset: null,
  };
  const timeline = openingTimeline(hours, date, timeZone);
  if (!timeline) return unknown;
  const { merged, now } = timeline;

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
function normalizeLastOrderMinutes(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 180 ? n : 0;
}

/**
 * Le snack PREND-IL des commandes en ligne maintenant ? = ouvert ET avant l'heure
 * limite (fermeture − lastOrderMinutes). Non configuré → accepte toujours.
 * @returns {Object} état d'ouverture + { accepting, reason:null|"closed"|"cutoff",
 *   lastOrderMinutes, minutesToCutoff, cutoffTime }
 */
function getOrderingState(hours, date = new Date(), timeZone = DEFAULT_TIMEZONE, lastOrderMinutes = 0) {
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

// ============================================================================
// 🕒 CRÉNEAUX DE RETRAIT « PLUS TARD »
// ============================================================================
const SLOT_MINUTES = 15;
// Horizon proposé : le service en cours et le suivant, pas la semaine.
const SLOT_HORIZON_MIN = 12 * 60;

/**
 * Créneaux de retrait proposables maintenant (pas de 15 min, heure du snack).
 * Un créneau t est valable si : il tombe dans une plage d'ouverture (t ≤ fin),
 * la cuisine a le temps de préparer (t ≥ maintenant + préparation) et la
 * préparation ne commence pas avant l'ouverture (t ≥ début de plage + préparation).
 * Horaires non configurés → aucun créneau (on ne devine pas).
 * @returns {Array<{atMs:number, label:string}>}
 */
function getPickupSlots(hours, date = new Date(), timeZone = DEFAULT_TIMEZONE, { prepMin = 12, maxSlots = 48 } = {}) {
  const timeline = openingTimeline(hours, date, timeZone);
  if (!timeline) return [];
  const { merged, now } = timeline;
  const prep = Math.max(1, Math.round(Number(prepMin) || 12));
  const baseMs = Math.floor(date.getTime() / 60000) * 60000; // minute pleine de « now »
  const slots = [];
  for (const [start, end] of merged) {
    if (start > now + SLOT_HORIZON_MIN) break;
    if (end <= now) continue;
    const earliest = Math.max(now + prep, start + prep);
    let t = Math.ceil(earliest / SLOT_MINUTES) * SLOT_MINUTES;
    for (; t <= end && t <= now + SLOT_HORIZON_MIN; t += SLOT_MINUTES) {
      slots.push({ atMs: baseMs + (t - now) * 60000, label: formatHHMM(t) });
      if (slots.length >= maxSlots) return slots;
    }
  }
  return slots;
}

/** Le créneau demandé fait-il partie des créneaux proposables ? (±1 min de dérive) */
function isValidPickupSlot(hours, date, timeZone, atMs, opts) {
  if (!Number.isFinite(atMs)) return false;
  return getPickupSlots(hours, date, timeZone, opts).some((s) => Math.abs(s.atMs - atMs) <= 60000);
}

module.exports = { DEFAULT_TIMEZONE, SLOT_MINUTES, snackTimezone, localClock, parseHHMM, getOpeningState, normalizeLastOrderMinutes, getOrderingState, getPickupSlots, isValidPickupSlot };
