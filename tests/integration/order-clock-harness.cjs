// ⏱️ Harness — horloge des commandes (lib/orderClock + tâche planifiée orderClock).
// Émulateur Firestore, dates simulées (pas d'appel Stripe). Vérifie que :
//   C1. ancienne commande « en attente du client » depuis 25 min → lancée en cuisine (marquée « transition »)
//   C2. ancienne commande en attente depuis 5 min                 → intacte (le client a encore le temps)
//   C3. commande à emporter prête depuis 4 h                      → terminée, marquée « non récupérée »
//   C4. livraison prête depuis 4 h                                → intacte (un livreur peut être en route)
//   C5. commande prête depuis 1 h                                 → intacte
//   C6. commande « à cuisiner » ancienne                          → intacte (seules les prêtes sont closes)
//   C7. second tour d'horloge                                     → aucune action (idempotent)
//   C8. commande passée « prête » par le chef entre-temps         → l'horloge ne l'écrase pas
//   C9. la tâche planifiée exportée tourne sans erreur
//   C10. commande programmée dont l'heure de lancement est passée → « à cuisiner » (marquée « creneau »)
//   C11. commande programmée pour plus tard                       → intacte
//   C12. créneau du soir commandé le matin, prête depuis 1 h        → PAS clôturée (référence = heure de retrait)
//   C13. prête depuis 6 min, heure annoncée passée                  → UN rappel push au client (+ marque)
//   C14. prête depuis 2 min                                         → pas encore de rappel
//   C15. créneau : prête en avance, heure choisie pas encore atteinte → pas de rappel
//   C16. livraison prête depuis 6 min                               → pas de rappel (le livreur vient)
//   C17. tours suivants                                             → jamais un second rappel
// Lancé via `npm run test:clock`.
const path = require("node:path");
const FUNC_DIR = path.join(__dirname, "..", "..", "functions");

process.env.GCLOUD_PROJECT = "snacking-template";
process.env.GOOGLE_CLOUD_PROJECT = "snacking-template";

const funcRequire = require("module").createRequire(path.join(FUNC_DIR, "index.js"));
const admin = funcRequire("firebase-admin");
const { runOrderClock } = funcRequire("./lib/orderClock");
const { Timestamp } = funcRequire("firebase-admin/firestore");

const db = admin.firestore();
// FCM simulé : on compte les envois, rien ne part réellement.
const sentPush = [];
funcRequire("firebase-admin/messaging").getMessaging().sendEachForMulticast = async (msg) => {
  sentPush.push(msg);
  return { responses: msg.tokens.map(() => ({ success: true })), successCount: msg.tokens.length, failureCount: 0 };
};
const results = [];
const ok = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

const MIN = 60 * 1000;
const NOW = Date.now();
const orders = db.collection("commandes");
const at = (agoMs) => Timestamp.fromMillis(NOW - agoMs);
// Par défaut l'heure de retrait annoncée = l'heure de commande (cas « dès que possible »).
const seedOrder = (id, statut, agoMs, extra = {}) =>
  orders.doc(id).set({ snackId: "snack_clock", statut, date: at(agoMs), eta: { readyAt: at(agoMs) }, mode: "collect", clientNom: "Léa", secretCode: "K7Q2", ...extra });
const get = async (id) => (await orders.doc(id).get()).data();

async function main() {
  // Client avec un appareil push (jeton « legacy » sur son profil).
  await db.collection("users").doc("client_clock").set({ role: "client", fcmToken: `tok_clock_${"x".repeat(40)}` });
  const readyFor = (id, readyAgoMs, promisedAgoMs, extra = {}) => seedOrder(id, "prete", 30 * MIN, {
    userId: "client_clock", datePrete: at(readyAgoMs), eta: { readyAt: at(promisedAgoMs) }, ...extra,
  });
  await Promise.all([
    readyFor("c13_remind", 6 * MIN, 10 * MIN),
    readyFor("c14_too_soon", 2 * MIN, 10 * MIN),
    readyFor("c15_slot_early", 6 * MIN, -10 * MIN),
    readyFor("c16_delivery", 6 * MIN, 10 * MIN, { mode: "delivery" }),
  ]);
  await Promise.all([
    seedOrder("c1_waiting_old", "en_attente_client", 25 * MIN),
    seedOrder("c2_waiting_recent", "en_attente_client", 5 * MIN),
    seedOrder("c3_ready_stale", "prete", 4 * 60 * MIN),
    seedOrder("c4_delivery_stale", "prete", 4 * 60 * MIN, { mode: "delivery" }),
    seedOrder("c5_ready_recent", "prete", 60 * MIN),
    seedOrder("c6_cooking_old", "nouvelle", 4 * 60 * MIN),
    seedOrder("c10_scheduled_due", "programmee", 60 * MIN, { retrait: { mode: "creneau", heure: at(-10 * MIN), lancerA: at(2 * MIN) } }),
    seedOrder("c11_scheduled_later", "programmee", 60 * MIN, { retrait: { mode: "creneau", heure: at(-3 * 60 * MIN), lancerA: at(-170 * MIN) } }),
    // Commandée il y a 10 h pour un retrait il y a 1 h, toujours pas venue chercher.
    seedOrder("c12_evening_slot", "prete", 10 * 60 * MIN, { eta: { readyAt: at(60 * MIN) } }),
  ]);

  const first = await runOrderClock({ nowMs: NOW });

  const c1 = await get("c1_waiting_old");
  ok("C1 en attente depuis 25 min → lancée en cuisine", c1.statut === "nouvelle" && c1.lancementAuto === "transition" && !!c1.dateLancement, JSON.stringify({ statut: c1.statut, lancementAuto: c1.lancementAuto }));
  ok("C2 en attente depuis 5 min → intacte", (await get("c2_waiting_recent")).statut === "en_attente_client");
  const c3 = await get("c3_ready_stale");
  ok("C3 prête depuis 4 h (à emporter) → terminée, non récupérée", c3.statut === "terminee" && c3.nonRecuperee === true && !!c3.clotureAutoAt);
  ok("C4 livraison prête depuis 4 h → intacte", (await get("c4_delivery_stale")).statut === "prete");
  ok("C5 prête depuis 1 h → intacte", (await get("c5_ready_recent")).statut === "prete");
  ok("C6 à cuisiner depuis 4 h → intacte", (await get("c6_cooking_old")).statut === "nouvelle");
  const c10 = await get("c10_scheduled_due");
  ok("C10 programmée, lancement dépassé → à cuisiner", c10.statut === "nouvelle" && c10.lancementAuto === "creneau" && !!c10.dateLancement);
  ok("C11 programmée pour plus tard → intacte", (await get("c11_scheduled_later")).statut === "programmee");
  ok("C12 créneau du soir prêt depuis 1 h → pas clôturé", (await get("c12_evening_slot")).statut === "prete");
  ok("Premier tour : 1 programmée lancée, 1 en attente lancée, 1 rappel, 1 close, aucune erreur",
    first.launched === 1 && first.released === 1 && first.reminded === 1 && first.closed === 1 && first.errors === 0, JSON.stringify(first));

  const c13 = await get("c13_remind");
  ok("C13 prête depuis 6 min → un rappel au client, marqué",
    !!c13.rappelEnvoyeAt && sentPush.length === 1 &&
      sentPush[0].notification?.title === "🍟 Votre commande vous attend" &&
      sentPush[0].notification?.body === "Au comptoir · code K7Q2",
    JSON.stringify(sentPush[0]?.notification));
  ok("C14 prête depuis 2 min → pas encore", !(await get("c14_too_soon")).rappelEnvoyeAt);
  ok("C15 créneau pas encore atteint → pas de rappel", !(await get("c15_slot_early")).rappelEnvoyeAt);
  ok("C16 livraison → pas de rappel", !(await get("c16_delivery")).rappelEnvoyeAt);

  const second = await runOrderClock({ nowMs: NOW });
  ok("C7 second tour → aucune action (idempotent)",
    second.launched === 0 && second.released === 0 && second.reminded === 0 && second.closed === 0 && second.errors === 0, JSON.stringify(second));
  ok("C17 jamais un second rappel", sentPush.length === 1, `push envoyés=${sentPush.length}`);

  // C8 — le chef a marqué « prête » une commande en attente (ancien parcours) juste avant
  // le tour d'horloge : la transaction revérifie le statut et ne la relance pas.
  await seedOrder("c8_chef_was_faster", "en_attente_client", 30 * MIN);
  await orders.doc("c8_chef_was_faster").update({ statut: "prete" });
  const third = await runOrderClock({ nowMs: NOW });
  const c8 = await get("c8_chef_was_faster");
  ok("C8 statut changé entre-temps → l'horloge ne l'écrase pas", c8.statut === "prete" && !c8.lancementAuto && third.released === 0);

  // C9 — la tâche planifiée réellement exportée (wrapper firebase-functions-test).
  const test = require("firebase-functions-test")();
  const myFunctions = funcRequire("./index.js");
  let threw = null;
  try { await test.wrap(myFunctions.orderClock)({}); } catch (e) { threw = e; }
  ok("C9 tâche planifiée orderClock exportée et exécutable", typeof myFunctions.orderClock === "function" && !threw, threw?.message);
  await test.cleanup?.();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} scénarios horloge OK`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
