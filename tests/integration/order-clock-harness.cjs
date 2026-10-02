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
const results = [];
const ok = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

const MIN = 60 * 1000;
const NOW = Date.now();
const orders = db.collection("commandes");
const at = (agoMs) => Timestamp.fromMillis(NOW - agoMs);
const seedOrder = (id, statut, agoMs, extra = {}) =>
  orders.doc(id).set({ snackId: "snack_clock", statut, date: at(agoMs), mode: "collect", clientNom: "Léa", secretCode: "K7Q2", ...extra });
const get = async (id) => (await orders.doc(id).get()).data();

async function main() {
  await Promise.all([
    seedOrder("c1_waiting_old", "en_attente_client", 25 * MIN),
    seedOrder("c2_waiting_recent", "en_attente_client", 5 * MIN),
    seedOrder("c3_ready_stale", "prete", 4 * 60 * MIN),
    seedOrder("c4_delivery_stale", "prete", 4 * 60 * MIN, { mode: "delivery" }),
    seedOrder("c5_ready_recent", "prete", 60 * MIN),
    seedOrder("c6_cooking_old", "nouvelle", 4 * 60 * MIN),
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
  ok("Premier tour : 1 lancée, 1 close, aucune erreur", first.released === 1 && first.closed === 1 && first.errors === 0, JSON.stringify(first));

  const second = await runOrderClock({ nowMs: NOW });
  ok("C7 second tour → aucune action (idempotent)", second.released === 0 && second.closed === 0 && second.errors === 0, JSON.stringify(second));

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
