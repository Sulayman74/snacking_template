// ============================================================================
// ⚽ FOOTBALL — filtres de matchs (logique PURE, sans Firebase)
// ============================================================================
// Partagé par domains/football.js (fetch + cache) et lib/matchPush.js (push soir
// de match). Filtres (spec utilisateur) :
//   FL1 → OL, OM, PSG · PL → Man City, Man United, Arsenal · PD → Real, Barça, Atlético
//   CL  → tous les matchs · WC / EC → équipe de France OU quarts / demi / finale

const FOOTBALL_FILTERS = {
  FL1: { keywords: ["lyon", "marseille", "paris"] },
  PL:  { keywords: ["manchester city", "manchester united", "arsenal"] },
  PD:  { keywords: ["real madrid", "barcelona", "atletico"] },
  CL:  { keywords: null }, // tous
  WC:  { keywords: ["france"], stages: ["QUARTER_FINALS", "SEMI_FINALS", "FINAL"] },
  EC:  { keywords: ["france"], stages: ["QUARTER_FINALS", "SEMI_FINALS", "FINAL"] },
};
const FOOTBALL_COMPETITIONS = Object.keys(FOOTBALL_FILTERS).join(",");

/** Équipes « vedettes » = celles des filtres : hiérarchisent les affiches d'une soirée. */
const HEADLINE_KEYWORDS = [...new Set(Object.values(FOOTBALL_FILTERS).flatMap((f) => f.keywords || []))];

/** Strip accents + lower : "Atlético" → "atletico", "France" → "france". */
function normalizeName(s) {
  return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function isMatchInteresting(match) {
  const filter = FOOTBALL_FILTERS[match.competition?.code];
  if (!filter) return false;

  // CL : tous
  if (filter.keywords === null && !filter.stages) return true;

  const home = normalizeName(match.homeTeam?.name);
  const away = normalizeName(match.awayTeam?.name);
  const teamMatch = filter.keywords?.some((kw) => {
    const k = normalizeName(kw);
    return home.includes(k) || away.includes(k);
  });

  // WC/EC : OR entre équipe (France) et stage (quarts/demi/finale)
  if (filter.stages) {
    const stageMatch = filter.stages.includes(match.stage);
    return Boolean(teamMatch || stageMatch);
  }

  return Boolean(teamMatch);
}

/** Une équipe vedette (PSG, Real, Man City…) ? Sert au classement des affiches. */
function isHeadlineTeam(name) {
  const n = normalizeName(name);
  return n.length > 0 && HEADLINE_KEYWORDS.some((k) => n.includes(normalizeName(k)));
}

module.exports = { FOOTBALL_FILTERS, FOOTBALL_COMPETITIONS, normalizeName, isMatchInteresting, isHeadlineTeam };
