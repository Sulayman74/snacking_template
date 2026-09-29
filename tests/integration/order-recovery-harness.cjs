// 🧾 Harness — filet « DÉBITÉ SANS COMMANDE » (réconciliateur planifié).
// In-process, clés Stripe TEST, émulateur Firestore. Vérifie que :
//   R1. createPaymentIntent            → pendingOrders/{pi} écrit + metadata.uid posé
//   R2. PI payé SANS finalizeOrder      → le réconciliateur ne touche à rien avant le délai de grâce
//   R3. …après le délai de grâce        → commande créée (bon client, bon total) + pending nettoyé
//   R4. réconciliateur rejoué            → aucune commande en double
//   R5. finalizeOrder par un AUTRE uid  → REJET permission-denied
//   R6. chemin nominal finalizeOrder    → commande créée + pending nettoyé (non-régression)
//   R7. PI jamais payé depuis > 24 h     → PI annulé chez Stripe + pending nettoyé
// Lancé via `npm run test:recovery`. Clés lues depuis functions/.secret.local.
const path = require("node:path");
const FUNC_DIR = path.join(__dirname, "..", "..", "functions");

require("./loadTestEnv.cjs").loadTestEnv();
process.env.GCLOUD_PROJECT = "snacking-template";
process.env.GOOGLE_CLOUD_PROJECT = "snacking-template";

const funcRequire = require("module").createRequire(path.join(FUNC_DIR, "index.js"));
const admin = funcRequire("firebase-admin");
const Stripe = funcRequire("stripe");
const test = require("firebase-functions-test")();
const myFunctions = funcRequire("./index.js");
const { reconcilePendingOrders, GRACE_MS } = funcRequire("./lib/orderRecovery");

const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" });
const createPI = test.wrap(myFunctions.createPaymentIntent);
const finalize = test.wrap(myFunctions.finalizeOrder);

const SNACK = "snack_recovery";
const PROD = "prod_recovery";
const UNIT = 10; // 10,00 €

const results = [];
const ok = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

const authA = { uid: "u_recovery_a", token: { email: "a@test.dev", firebase: { sign_in_provider: "password" } } };
const authB = { uid: "u_recovery_b", token: { email: "b@test.dev", firebase: { sign_in_provider: "password" } } };
const cart = () => [{ productId: PROD, nom: "Burger", prix: UNIT, quantity: 2 }];

async function seed() {
  await db.collection("snacks").doc(SNACK).set({ createdAt: admin.firestore.Timestamp.now() });
  await db.collection("produits").doc(PROD).set({ snackId: SNACK, nom: "Burger", prix: UNIT });
}

/** createPaymentIntent (callable réel) → id du PI. */
async function newPI(auth) {
  const out = await createPI({ data: { snackId: SNACK, cartItems: cart(), mode: "collect" }, auth });
  return out.clientSecret.split("_secret_")[0];
}
const pay = (piId) => stripe.paymentIntents.confirm(piId, { payment_method: "pm_card_visa" });
const later = () => Date.now() + GRACE_MS + 60_000;

async function main() {
  await seed();

  // R1 — pending + metadata.uid
  const piLost = await newPI(authA);
  const pending = await db.collection("pendingOrders").doc(piLost).get();
  const piObj = await stripe.paymentIntents.retrieve(piLost);
  ok("R1 createPaymentIntent → pendingOrders + metadata.uid",
    pending.exists && pending.data().uid === authA.uid && piObj.metadata.uid === authA.uid,
    `pending=${pending.exists} metadata.uid=${piObj.metadata.uid}`);

  // R2 — payé, finalizeOrder jamais appelé, encore dans le délai de grâce
  await pay(piLost);
  const early = await reconcilePendingOrders(stripe);
  const earlyOrder = await db.collection("commandes").doc(piLost).get();
  ok("R2 avant délai de grâce → rien", !earlyOrder.exists && early.recovered === 0, JSON.stringify(early));

  // R3 — après le délai de grâce → commande récupérée
  const s1 = await reconcilePendingOrders(stripe, { nowMs: later() });
  const order = await db.collection("commandes").doc(piLost).get();
  const pendingAfter = await db.collection("pendingOrders").doc(piLost).get();
  ok("R3 après délai → commande créée + pending nettoyé",
    order.exists && order.data().userId === authA.uid && order.data().total === 20 &&
      order.data().clientEmail === "a@test.dev" && !pendingAfter.exists && s1.recovered === 1,
    `${JSON.stringify(s1)} total=${order.data()?.total}`);

  // R4 — rejeu → pas de doublon
  const s2 = await reconcilePendingOrders(stripe, { nowMs: later() });
  const dup = await db.collection("commandes").where("paiement.stripeSessionId", "==", piLost).get();
  ok("R4 rejeu → pas de doublon", s2.recovered === 0 && dup.size === 1, `${JSON.stringify(s2)} commandes=${dup.size}`);

  // R5 — finalizeOrder par un autre utilisateur
  const piA = await newPI(authA);
  await pay(piA);
  try {
    await finalize({ data: { paymentIntentId: piA, snackId: SNACK, cartItems: cart(), clientEmail: "b@test.dev", totalCents: 2000, mode: "collect" }, auth: authB });
    ok("R5 finalizeOrder autre uid → REJET", false, "aurait dû rejeter");
  } catch (e) {
    ok("R5 finalizeOrder autre uid → REJET", e.code === "permission-denied", `${e.code} ${e.message}`);
  }

  // R6 — chemin nominal (même PI, bon propriétaire)
  const res = await finalize({ data: { paymentIntentId: piA, snackId: SNACK, cartItems: cart(), clientEmail: "a@test.dev", totalCents: 2000, mode: "collect" }, auth: authA });
  const nominal = await db.collection("commandes").doc(piA).get();
  const pendingA = await db.collection("pendingOrders").doc(piA).get();
  ok("R6 finalizeOrder nominal → commande + pending nettoyé",
    res.orderId === piA && nominal.exists && nominal.data().userId === authA.uid && !pendingA.exists,
    `orderId=${res.orderId} pending=${pendingA.exists}`);

  // R7 — PI abandonné > 24 h
  const piOld = await newPI(authA);
  await db.collection("pendingOrders").doc(piOld).update({
    createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 25 * 3600 * 1000),
  });
  await reconcilePendingOrders(stripe, { nowMs: later() });
  const oldPi = await stripe.paymentIntents.retrieve(piOld);
  const oldPending = await db.collection("pendingOrders").doc(piOld).get();
  ok("R7 PI abandonné > 24 h → annulé + nettoyé", oldPi.status === "canceled" && !oldPending.exists, `status=${oldPi.status}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} scénarios récupération OK`);
  await test.cleanup?.();
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error("💥", e); process.exit(1); });
