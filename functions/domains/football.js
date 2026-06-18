// ============================================================================
// ⚽ FOOTBALL — Smart Marketing Advisor (football-data.org)
// ============================================================================
// Récupère les matchs des 7 prochains jours pour les compétitions ciblées,
// filtre selon les équipes du resto et met en cache Firestore 30 min pour
// éviter de saturer l'API football-data.org (10 req/min en free tier).
//
// Token lu via secret Firebase :
//   firebase functions:secrets:set FOOTBALL_DATA_TOKEN
//
// Throttling-aware : on log un warning si `X-Requests-Available-Minute` < 2
// (best practice demandée explicitement par l'auteur de l'API).
//
// Réponse : { matches: [...], cached: bool, stale?: bool, ageMs?: number }
//   - cached:false → fetch frais
//   - cached:true   → renvoyé du cache (TTL non expiré)
//   - stale:true    → fetch échoué, on retombe sur le vieux cache
//
// Filtres (spec utilisateur) :
//   FL1 → OL, OM, PSG
//   PL  → Man City, Man United, Arsenal
//   PD  → Real Madrid, Barcelona, Atlético
//   CL  → tous les matchs
//   WC  → équipe de France OR stages quarts/demi/finale
//   EC  → équipe de France OR stages quarts/demi/finale

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");

const FOOTBALL_API_BASE = "https://api.football-data.org/v4";
const FOOTBALL_CACHE_DOC = "football_matches";
const FOOTBALL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const FOOTBALL_HORIZON_DAYS = 7;

const FOOTBALL_FILTERS = {
  FL1: { keywords: ["lyon", "marseille", "paris"] },
  PL:  { keywords: ["manchester city", "manchester united", "arsenal"] },
  PD:  { keywords: ["real madrid", "barcelona", "atletico"] },
  CL:  { keywords: null }, // tous
  WC:  { keywords: ["france"], stages: ["QUARTER_FINALS", "SEMI_FINALS", "FINAL"] },
  EC:  { keywords: ["france"], stages: ["QUARTER_FINALS", "SEMI_FINALS", "FINAL"] },
};
const FOOTBALL_COMPETITIONS = Object.keys(FOOTBALL_FILTERS).join(",");

function normalizeName(s) {
  // Strip accents + lower : "Atlético" → "atletico", "France" → "france"
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

exports.getUpcomingFootballEvents = onCall(
  { region: "europe-west1", secrets: ["FOOTBALL_DATA_TOKEN"] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    const cacheRef = db.collection("cache").doc(FOOTBALL_CACHE_DOC);
    const cacheSnap = await cacheRef.get();
    const cached = cacheSnap.exists ? cacheSnap.data() : null;
    const fetchedAtMs = cached?.fetchedAt?.toMillis?.() || 0;
    const ageMs = Date.now() - fetchedAtMs;

    // 1. Cache hit valide → return direct
    if (cached && ageMs < FOOTBALL_CACHE_TTL_MS && Array.isArray(cached.matches)) {
      return { matches: cached.matches, cached: true, ageMs };
    }

    // 2. Cache miss / expiré → fetch upstream
    const token = process.env.FOOTBALL_DATA_TOKEN;
    if (!token) {
      logger.error("[football] FOOTBALL_DATA_TOKEN manquant en runtime.");
      if (cached) return { matches: cached.matches || [], cached: true, stale: true };
      throw new HttpsError("failed-precondition", "Secret football non configuré.");
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + FOOTBALL_HORIZON_DAYS * 24 * 60 * 60 * 1000);
    const dateFrom = now.toISOString().slice(0, 10);
    const dateTo = horizon.toISOString().slice(0, 10);
    const url = `${FOOTBALL_API_BASE}/matches?competitions=${FOOTBALL_COMPETITIONS}&dateFrom=${dateFrom}&dateTo=${dateTo}`;

    try {
      // ⏱️ Timeout 8s : sans AbortController, un upstream lent bloquerait la CF
      // jusqu'au timeout par défaut (~60s). L'abort tombe dans le catch → cache stale.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let resp;
      try {
        resp = await fetch(url, { headers: { "X-Auth-Token": token }, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }

      // Throttling awareness — l'auteur de l'API demande explicitement de
      // surveiller ce header pour ne pas saturer leur rate limiter.
      const remaining = resp.headers.get("X-Requests-Available-Minute");
      if (remaining !== null && parseInt(remaining, 10) < 2) {
        logger.warn(`[football] quota faible : ${remaining}/min restantes.`);
      }

      if (!resp.ok) throw new Error(`football-data HTTP ${resp.status}`);
      const data = await resp.json();
      const filtered = (data?.matches || [])
        .filter(isMatchInteresting)
        .map((m) => ({
          id: m.id,
          utcDate: m.utcDate,
          status: m.status,
          stage: m.stage,
          competition: { code: m.competition?.code, name: m.competition?.name },
          homeTeam: { name: m.homeTeam?.name, crest: m.homeTeam?.crest },
          awayTeam: { name: m.awayTeam?.name, crest: m.awayTeam?.crest },
        }));

      await cacheRef.set({
        matches: filtered,
        fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        upstreamRemainingMinute: remaining,
      });

      return { matches: filtered, cached: false };
    } catch (err) {
      logger.error("[football] fetch failed:", err.message);
      // Fail-safe : on retombe sur un vieux cache si dispo
      if (cached?.matches) {
        return { matches: cached.matches, cached: true, stale: true, ageMs };
      }
      throw new HttpsError("unavailable", "Données football indisponibles.");
    }
  }
);
