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
//   C18. 101 livraisons prêtes anciennes + 1 à emporter             → la commande à emporter est clôturée
//   K1. client attend 8 min, écran muet 15 min  → push au gérant (1 fois) + incident « alerte », pas de pause
//   K2. client attend 30 min, écran muet 20 min → alerte + « pause simulée » journalisée, RIEN n'est coupé
//   K3. client attend 20 min, écran vivant      → rien
//   K4. commande de 2 min, écran jamais ouvert  → rien (délai de grâce)
//   K5. tour suivant                            → aucun doublon (push ni incident)
//   K6. l'écran revient puis retombe en panne   → nouvelle alerte
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

  // C18 — plus de livraisons « prêtes » anciennes qu'un lot (100) : elles sont filtrées
  // par la requête, donc ne masquent pas une commande à emporter à clôturer.
  const batch = db.batch();
  for (let i = 0; i < 101; i++) {
    batch.set(orders.doc(`c18_delivery_${i}`), { snackId: "snack_clock", statut: "prete", mode: "delivery", date: at(9 * 60 * MIN), eta: { readyAt: at((9 * 60 - i) * MIN) }, datePrete: at(9 * 60 * MIN) });
  }
  await batch.commit();
  await seedOrder("c18_collect_stale", "prete", 4 * 60 * MIN);
  const fourth = await runOrderClock({ nowMs: NOW });
  ok("C18 101 livraisons prêtes anciennes → la commande à emporter est quand même clôturée",
    (await get("c18_collect_stale")).statut === "terminee" && fourth.closed === 1 && fourth.reminded === 0 && fourth.errors === 0, JSON.stringify(fourth));

  // K — surveillance de l'écran cuisine (snacks dédiés, compteur de push remis à zéro).
  sentPush.length = 0;
  const seedKitchen = async (snackId, ordersAgoMin, lastSeenAgoMin) => {
    await db.collection("users").doc(`admin_${snackId}`).set({ role: "admin", snackId, fcmToken: `tok_${snackId}_${"x".repeat(40)}` });
    await db.collection("snacks").doc(snackId).set({ nom: snackId, delivery: { prepBaseMin: 12 } });
    for (const [i, ago] of ordersAgoMin.entries()) await seedOrder(`${snackId}_o${i}`, "nouvelle", ago * MIN, { snackId });
    if (lastSeenAgoMin !== null) await db.collection("kitchenStatus").doc(snackId).set({ lastSeenAt: at(lastSeenAgoMin * MIN) });
  };
  await seedKitchen("kw1", [8, 6], 15);
  await seedKitchen("kw2", [30], 20);
  await seedKitchen("kw3", [20], 1);
  await seedKitchen("kw4", [2], null);
  const incidentsOf = async (snackId) => (await db.collection("kitchenIncidents").where("snackId", "==", snackId).get()).docs.map((d) => d.data().type).sort();
  const pushTo = (snackId) => sentPush.filter((m) => m.tokens.some((t) => t.startsWith(`tok_${snackId}_`)));

  const k1 = await runOrderClock({ nowMs: NOW });
  ok("K1 client attend + écran muet → push gérant, incident alerte, pas de pause",
    pushTo("kw1").length === 1 && pushTo("kw1")[0].notification?.body === "2 commandes à cuisiner en attente · dernier signe il y a 15 min" &&
      JSON.stringify(await incidentsOf("kw1")) === JSON.stringify(["alerte_hors_ligne"]),
    JSON.stringify(pushTo("kw1")[0]?.notification));
  ok("K2 attente longue → alerte + pause SIMULÉE, rien de coupé",
    pushTo("kw2").length === 1 &&
      JSON.stringify(await incidentsOf("kw2")) === JSON.stringify(["alerte_hors_ligne", "pause_simulee"]) &&
      !(await db.collection("snacks").doc("kw2").get()).data().servicePausedUntil,
    JSON.stringify(await incidentsOf("kw2")));
  ok("K3 écran vivant → rien", pushTo("kw3").length === 0 && (await incidentsOf("kw3")).length === 0);
  ok("K4 commande trop récente, écran jamais ouvert → rien", pushTo("kw4").length === 0 && (await incidentsOf("kw4")).length === 0);
  ok("K tour : aucune erreur", k1.errors === 0, JSON.stringify(k1));

  await runOrderClock({ nowMs: NOW });
  ok("K5 tour suivant → aucun doublon",
    pushTo("kw1").length === 1 && pushTo("kw2").length === 1 && (await incidentsOf("kw1")).length === 1 && (await incidentsOf("kw2")).length === 2);

  // K6 — l'écran a rebattu (nouvelle valeur), puis retombe en panne : nouvelle alerte.
  await db.collection("kitchenStatus").doc("kw1").set({ lastSeenAt: at(11 * MIN) }, { merge: true });
  await runOrderClock({ nowMs: NOW });
  ok("K6 nouvelle panne → nouvelle alerte", pushTo("kw1").length === 2 && (await incidentsOf("kw1")).length === 2);

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
