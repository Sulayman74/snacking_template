// 🔴 Harness R1 — vérifie l'enforcement SERVEUR des frais de livraison dans
// finalizeOrder (audit). In-process (hors wrapper Functions Emulator), clés Stripe
// TEST, émulateur Firestore. Scénarios :
//   S1 (delivery, sous-payé : articles seuls) → finalizeOrder REJETÉ
//   S2 (delivery, payé articles+frais)        → ACCEPTÉ, total = articles+frais
//   S3 (collect, payé articles)               → ACCEPTÉ (aucun frais exigé)
// Lancé via `firebase emulators:exec --only firestore`.
const path = require("node:path");
const fs = require("node:fs");
const FUNC_DIR = path.join(__dirname, "..", "..", "functions");

for (const line of fs.readFileSync(path.join(FUNC_DIR, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
process.env.GCLOUD_PROJECT = "snacking-template";
process.env.GOOGLE_CLOUD_PROJECT = "snacking-template";

const funcRequire = require("module").createRequire(path.join(FUNC_DIR, "index.js"));
const admin = funcRequire("firebase-admin");
const Stripe = funcRequire("stripe");
const test = require("firebase-functions-test")();
const myFunctions = funcRequire("./index.js");

const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" });
const finalize = test.wrap(myFunctions.finalizeOrder);

const SNACK = "snack_deliv_r1";
const PROD = "prod_burger_r1";
const FRAIS = 3.5; // €

const results = [];
const ok = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed() {
  await db.collection("snacks").doc(SNACK).set({
    delivery: { frais: FRAIS, radiusKm: 10, minOrder: 0, avgSpeedKmh: 22 },
    restaurantLat: 48.85, restaurantLng: 2.35,
    createdAt: admin.firestore.Timestamp.now(),
  });
  await db.collection("produits").doc(PROD).set({
    snackId: SNACK, nom: "Burger", prix: 10, isAvailable: true,
  });
}

async function confirmedPI(amountCents) {
  const pi = await stripe.paymentIntents.create({
    amount: amountCents, currency: "eur", confirm: true,
    payment_method: "pm_card_visa",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  return pi;
}

const cartItems = [{
  id: `${PROD}-seul---`, productId: PROD, nom: "Burger", type: "seul",
  prix: 10, prixBase: 10, prixMenuAdd: 0, quantity: 1,
  sauces: [], sansCrudites: [], boissonNom: null, tailleChoisie: null, viaUpsell: false,
}];
const livraison = { adresse: "1 rue Test", lat: 48.851, lng: 2.351 };
const auth = { uid: "u_r1", token: { email: "r1@test.dev" } };
const baseData = { snackId: SNACK, cartItems, clientEmail: "r1@test.dev", clientNom: "R1" };

async function main() {
  await seed();

  // S1 — delivery, sous-payé (articles 1000c seulement, frais 350c non payés)
  const pi1 = await confirmedPI(1000);
  try {
    await finalize({ data: { ...baseData, paymentIntentId: pi1.id, totalCents: 1000, mode: "delivery", livraison }, auth });
    ok("S1 delivery sous-payé → REJET", false, "aurait dû rejeter");
  } catch (e) {
    ok("S1 delivery sous-payé → REJET", /total attendu/i.test(e.message || ""), e.message);
  }

  // S2 — delivery, payé articles + frais (1350c)
  const pi2 = await confirmedPI(1350);
  try {
    const r = await finalize({ data: { ...baseData, paymentIntentId: pi2.id, totalCents: 1350, mode: "delivery", livraison }, auth });
    const cmd = (await db.collection("commandes").doc(r.orderId).get()).data();
    ok("S2 delivery payé complet → ACCEPTÉ + total=13.5 + frais=3.5",
      !!r.orderId && cmd && Math.abs(cmd.total - 13.5) < 0.001 && Math.abs(cmd.livraison.frais - 3.5) < 0.001,
      `total=${cmd?.total} frais=${cmd?.livraison?.frais}`);
  } catch (e) { ok("S2 delivery payé complet → ACCEPTÉ", false, e.message); }

  // S3 — collect, payé articles (aucun frais exigé)
  const pi3 = await confirmedPI(1000);
  try {
    const r = await finalize({ data: { ...baseData, paymentIntentId: pi3.id, totalCents: 1000, mode: "collect" }, auth });
    const cmd = (await db.collection("commandes").doc(r.orderId).get()).data();
    ok("S3 collect payé → ACCEPTÉ + total=10", !!r.orderId && Math.abs(cmd.total - 10) < 0.001, `total=${cmd?.total}`);
  } catch (e) { ok("S3 collect payé → ACCEPTÉ", false, e.message); }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} scénarios R1 OK`);
  await test.cleanup?.();
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error("💥", e); process.exit(1); });
