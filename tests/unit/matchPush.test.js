// ⚽ Tests unitaires — push soir de match : regroupement par soirée + cadence
// (functions/lib/matchPush.js, logique pure). Régression : une soirée de Champions
// League à 9 matchs envoyait 9 notifications sur le même téléphone (14/10/2026).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  planMatchDayPush, canSendMatchPush, recordMatchPush, buildCampaignContent, matchesOfDay,
  dayKey, shortName, MATCH_PUSH_MIN_GAP_HOURS, MATCH_PUSH_MAX_PER_WEEK,
} = require("../../functions/lib/matchPush.js");

const H = 3600_000;
const D = 24 * H;
const m = (id, utcDate, home, away, extra = {}) => ({
  id, utcDate, status: "TIMED", competition: { code: "CL", name: "UEFA Champions League" },
  homeTeam: { name: home }, awayTeam: { name: away }, ...extra,
});
// La soirée du 14/10/2026 telle que vue en prod (heures UTC ; Paris = UTC+2).
const TONIGHT = [
  m(575350, "2026-10-14T16:45:00Z", "LASK Linz", "Liverpool FC"),
  m(575351, "2026-10-14T16:45:00Z", "Feyenoord Rotterdam", "Como 1907"),
  m(575352, "2026-10-14T19:00:00Z", "AS Roma", "Real Madrid CF"),
  m(575353, "2026-10-14T19:00:00Z", "Manchester City FC", "Paris Saint-Germain FC"),
  m(575354, "2026-10-14T19:00:00Z", "FK Bodø/Glimt", "Borussia Dortmund"),
  m(575355, "2026-10-14T19:00:00Z", "Aston Villa FC", "Fenerbahçe SK"),
  m(575356, "2026-10-14T19:00:00Z", "Real Betis Balompié", "FC Porto"),
  m(575357, "2026-10-14T19:00:00Z", "FK Shakhtar Donetsk", "PAE AEK"),
  m(575358, "2026-10-14T19:00:00Z", "ŠK Slovan Bratislava", "VfB Stuttgart"),
];
const TOMORROW = m(999, "2026-10-15T19:00:00Z", "Olympique Lyonnais", "FC Barcelona");
const FINISHED = m(998, "2026-10-14T12:00:00Z", "A", "B", { status: "FINISHED" });
const ALL = [...TONIGHT, TOMORROW, FINISHED];
const NOW_9H = Date.parse("2026-10-14T07:00:00Z"); // 09:00 Paris, heure du cron
const T = (iso) => Date.parse(iso);

describe("planMatchDayPush — une campagne par soirée", () => {
  it("9 matchs ce soir → UNE campagne, H-2 du premier coup d'envoi, message groupé", () => {
    const { plan, reason } = planMatchDayPush({ matches: ALL, snackData: {}, nowMs: NOW_9H });
    expect(reason).toBeNull();
    expect(plan.dayKey).toBe("2026-10-14");
    expect(plan.pushAtMs).toBe(T("2026-10-14T14:45:00Z")); // 16:45 Paris
    expect(plan.matchCount).toBe(9);
    expect(plan.matchIds).toEqual(TONIGHT.map((x) => x.id));
    expect(plan.titre).toBe("⚽ Soirée Champions League : 9 matchs ce soir !");
    expect(plan.message).toBe(
      "Manchester City – Paris Saint-Germain, Roma – Real Madrid et 7 autres affiches dès 18:45. Commande ton menu avant le coup d'envoi, prêt pile pour le match 🍕",
    );
  });

  it("cron tardif : les matchs dont le H-2 est passé sortent du plan", () => {
    const now = T("2026-10-14T15:00:00Z"); // 17:00 Paris : 18:45 déjà à H-1h45
    const { plan } = planMatchDayPush({ matches: ALL, snackData: {}, nowMs: now });
    expect(plan.pushAtMs).toBe(T("2026-10-14T17:00:00Z")); // 19:00 Paris
    expect(plan.matchCount).toBe(7);
    expect(plan.message).toContain("et 5 autres affiches dès 21:00.");
  });

  it("un seul match → libellé historique inchangé", () => {
    const { plan } = planMatchDayPush({ matches: [TONIGHT[3]], snackData: {}, nowMs: NOW_9H });
    expect(plan.titre).toBe("⚽ Manchester City FC vs Paris Saint-Germain FC ce soir !");
    expect(plan.message).toBe("Commande ton menu avant le coup d'envoi, prêt pile pour le match 🍕");
    expect(plan.matchCount).toBe(1);
  });

  it("deux matchs → « A et B dès HH:MM »", () => {
    const { plan } = planMatchDayPush({ matches: [TONIGHT[0], TONIGHT[2]], snackData: {}, nowMs: NOW_9H });
    expect(plan.titre).toBe("⚽ Soirée Champions League : 2 matchs ce soir !");
    expect(plan.message.startsWith("Roma – Real Madrid et LASK Linz – Liverpool dès 18:45.")).toBe(true);
  });

  it("compétitions mêlées → « Soirée foot »", () => {
    const fl1 = m(1, "2026-10-14T19:00:00Z", "Paris Saint-Germain FC", "Olympique de Marseille", { competition: { code: "FL1" } });
    const { plan } = planMatchDayPush({ matches: [fl1, TONIGHT[2]], snackData: {}, nowMs: NOW_9H });
    expect(plan.titre).toBe("⚽ Soirée foot : 2 matchs ce soir !");
  });

  it("rien aujourd'hui / tout déjà trop tard → pas de plan, raison explicite", () => {
    expect(planMatchDayPush({ matches: [TOMORROW], snackData: {}, nowMs: NOW_9H })).toEqual({ plan: null, reason: "no-match-today" });
    expect(planMatchDayPush({ matches: TONIGHT, snackData: {}, nowMs: T("2026-10-14T18:30:00Z") })).toEqual({ plan: null, reason: "too-late" });
    expect(planMatchDayPush({ matches: [], snackData: {}, nowMs: NOW_9H }).reason).toBe("no-match-today");
  });
});

describe("journée dans le fuseau du restaurant", () => {
  it("dayKey : 22:30Z le 14 = 00:30 Paris le 15", () => {
    expect(dayKey(new Date("2026-10-14T22:30:00Z"), "Europe/Paris")).toBe("2026-10-15");
    expect(dayKey(new Date("2026-10-14T21:30:00Z"), "Europe/Paris")).toBe("2026-10-14");
  });
  it("matchesOfDay : exclut terminés, autres jours, dates invalides ; trie par coup d'envoi", () => {
    const late = m(5, "2026-10-14T22:30:00Z", "X", "Y"); // 00:30 Paris le 15 → pas « ce soir » le 14
    const bad = m(6, "n'importe quoi", "X", "Y");
    const day = matchesOfDay([late, bad, FINISHED, TONIGHT[2], TONIGHT[0]], { nowMs: NOW_9H, timeZone: "Europe/Paris" });
    expect(day.map((x) => x.id)).toEqual([575350, 575352]);
  });
  it("le fuseau du snack (timezone / pushTimezone) est respecté", () => {
    const late = m(5, "2026-10-14T22:30:00Z", "X", "Y");
    const paris = planMatchDayPush({ matches: [late], snackData: {}, nowMs: NOW_9H });
    const reunion = planMatchDayPush({ matches: [late], snackData: { timezone: "Indian/Reunion" }, nowMs: NOW_9H });
    expect(paris.reason).toBe("no-match-today");
    expect(reunion.reason).toBe("no-match-today"); // 02:30 le 15 à La Réunion aussi
    const london = planMatchDayPush({ matches: [late], snackData: { pushTimezone: "Europe/London" }, nowMs: NOW_9H });
    expect(london.plan?.matchCount).toBe(1); // 23:30 à Londres : encore le 14
  });
});

describe("cadence par restaurant", () => {
  const at = T("2026-10-14T17:00:00Z");

  it(`espacement minimal ${MATCH_PUSH_MIN_GAP_HOURS}h : un envoi 10h avant bloque, 21h avant laisse passer`, () => {
    expect(canSendMatchPush({ matchPushLog: [at - 10 * H] }, at)).toEqual({ allowed: false, reason: "min-gap" });
    expect(canSendMatchPush({ matchPushLog: [at - 21 * H] }, at)).toEqual({ allowed: true, reason: null });
    expect(canSendMatchPush({}, at).allowed).toBe(true);
  });

  it(`plafond ${MATCH_PUSH_MAX_PER_WEEK} par 7 jours glissants`, () => {
    expect(canSendMatchPush({ matchPushLog: [at - 3 * D, at - 5 * D] }, at)).toEqual({ allowed: false, reason: "weekly-cap" });
    expect(canSendMatchPush({ matchPushLog: [at - 3 * D, at - 8 * D] }, at).allowed).toBe(true); // le plus vieux est sorti de la fenêtre
  });

  it("surcharges par snack : pushMatchMaxPerWeek / pushMatchMinGapHours, 0 = désactivé", () => {
    expect(canSendMatchPush({ matchPushLog: [at - 3 * D, at - 5 * D], pushMatchMaxPerWeek: 3 }, at).allowed).toBe(true);
    expect(canSendMatchPush({ matchPushLog: [at - 1 * H], pushMatchMinGapHours: 0 }, at).allowed).toBe(true);
    expect(canSendMatchPush({ pushMatchMaxPerWeek: 0 }, at)).toEqual({ allowed: false, reason: "weekly-cap" });
    expect(canSendMatchPush({ matchPushLog: ["x", null, at - 10 * H] }, at).reason).toBe("min-gap"); // entrées invalides ignorées
  });

  it("le plan du matin applique la cadence (mercredi après mardi : OK ; 2e push le même jour : non)", () => {
    const hier = T("2026-10-13T17:00:00Z");
    expect(planMatchDayPush({ matches: ALL, snackData: { matchPushLog: [hier] }, nowMs: NOW_9H }).plan).not.toBeNull();
    expect(planMatchDayPush({ matches: ALL, snackData: { matchPushLog: [T("2026-10-14T06:00:00Z")] }, nowMs: NOW_9H }).reason).toBe("min-gap");
    expect(planMatchDayPush({ matches: ALL, snackData: { matchPushLog: [hier, hier - D] }, nowMs: NOW_9H }).reason).toBe("weekly-cap");
  });

  it("recordMatchPush : ajoute l'envoi, élague au-delà de 7 jours", () => {
    const log = recordMatchPush({ matchPushLog: [at - 10 * D, at - 2 * D] }, at);
    expect(log).toEqual([at - 2 * D, at]);
    expect(recordMatchPush({}, at)).toEqual([at]);
  });
});

describe("contenu", () => {
  it("shortName retire les sigles de club", () => {
    expect(shortName("Manchester City FC")).toBe("Manchester City");
    expect(shortName("AS Roma")).toBe("Roma");
    expect(shortName("VfB Stuttgart")).toBe("Stuttgart");
    expect(shortName("FK Bodø/Glimt")).toBe("Bodø/Glimt");
    expect(shortName("Real Betis Balompié")).toBe("Real Betis Balompié");
    expect(shortName("FC")).toBe("FC"); // jamais vide
  });
  it("les affiches vedettes passent devant quelle que soit l'heure", () => {
    const day = matchesOfDay([TONIGHT[0], TONIGHT[3]], { nowMs: NOW_9H, timeZone: "Europe/Paris" });
    const { message } = buildCampaignContent(day, { timeZone: "Europe/Paris" });
    expect(message.startsWith("Manchester City – Paris Saint-Germain et LASK Linz – Liverpool dès 18:45.")).toBe(true);
  });
});
