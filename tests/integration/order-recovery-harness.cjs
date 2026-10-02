// 🧾 Harness — filet « DÉBITÉ SANS COMMANDE » (réconciliateur planifié).
// In-process, clés Stripe TEST, émulateur Firestore. Vérifie que :
//   R1. createPaymentIntent            → pendingOrders/{pi} écrit + metadata.uid posé
//   R2. PI payé SANS finalizeOrder      → le réconciliateur ne touche à rien avant le délai de grâce
//   R3. …après le délai de grâce        → commande créée (bon client, bon total) + pending nettoyé
//   R4. réconciliateur rejoué            → aucune commande en double
//   R5. finalizeOrder par un AUTRE uid  → REJET permission-denied
//   R6. chemin nominal finalizeOrder    → commande créée + pending nettoyé (non-régression)
//   R7. PI jamais payé depuis > 24 h     → PI annulé chez Stripe + pending nettoyé
//   R8. créneau « plus tard » valide     → pending.retrait ; finalizeOrder → commande « programmée » à l'heure choisie
//   R9. créneau hors grille / sans horaires → createPaymentIntent REJETÉ, aucun débit
//   R10. créneau + réseau perdu         → le réconciliateur recrée la commande AVEC son créneau
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

// Snack ouvert 24 h/24 (00:00 → 00:00), préparation 12 min : il y a toujours des créneaux.
const SNACK_SLOT = "snack_recovery_slot";
const PROD_SLOT = "prod_recovery_slot";
const HOURS_24H = Array.from({ length: 7 }, () => ({ open: "00:00", close: "00:00", closed: false }));
const PREP_MIN = 12;
const { getPickupSlots } = funcRequire("./lib/openingHours");

async function seed() {
  await db.collection("snacks").doc(SNACK).set({ createdAt: admin.firestore.Timestamp.now() });
  await db.collection("produits").doc(PROD).set({ snackId: SNACK, nom: "Burger", prix: UNIT });
  await db.collection("snacks").doc(SNACK_SLOT).set({
    createdAt: admin.firestore.Timestamp.now(), hours: HOURS_24H, delivery: { prepBaseMin: PREP_MIN },
  });
  await db.collection("produits").doc(PROD_SLOT).set({ snackId: SNACK_SLOT, nom: "Burger", prix: UNIT });
}
const cartSlot = () => [{ productId: PROD_SLOT, nom: "Burger", prix: UNIT, quantity: 2 }];
/** Un créneau proposable (le 2e, marge sur l'horloge du test). */
const aSlot = () => getPickupSlots(HOURS_24H, new Date(), "Europe/Paris", { prepMin: PREP_MIN })[1].atMs;
async function newSlotPI(auth, heure) {
  const out = await createPI({ data: { snackId: SNACK_SLOT, cartItems: cartSlot(), mode: "collect", retrait: { mode: "creneau", heure } }, auth });
  return out.clientSecret.split("_secret_")[0];
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

  // R8 — créneau « plus tard » valide : chemin nominal
  const slot = aSlot();
  const piSlot = await newSlotPI(authA, slot);
  const pendingSlot = (await db.collection("pendingOrders").doc(piSlot).get()).data();
  ok("R8 createPaymentIntent créneau → pending.retrait (lancement = créneau − préparation)",
    pendingSlot?.retrait?.mode === "creneau" && pendingSlot.retrait.heureMs === slot &&
      pendingSlot.retrait.lancerAMs === slot - PREP_MIN * 60000,
    JSON.stringify(pendingSlot?.retrait));
  await pay(piSlot);
  await finalize({ data: { paymentIntentId: piSlot, snackId: SNACK_SLOT, cartItems: cartSlot(), clientEmail: "a@test.dev", totalCents: 2000, mode: "collect" }, auth: authA });
  const scheduled = (await db.collection("commandes").doc(piSlot).get()).data();
  ok("R8 finalizeOrder → commande « programmée », heure promise = créneau",
    scheduled?.statut === "programmee" && scheduled.retrait?.mode === "creneau" &&
      scheduled.retrait.heure.toMillis() === slot &&
      scheduled.retrait.lancerA.toMillis() === slot - PREP_MIN * 60000 &&
      scheduled.eta?.readyAt?.toMillis() === slot,
    `statut=${scheduled?.statut}`);

  // R9 — créneaux invalides : rien n'est débité
  const rejected = async (snackId, heure) => {
    try {
      await createPI({ data: { snackId, cartItems: snackId === SNACK ? cart() : cartSlot(), mode: "collect", retrait: { mode: "creneau", heure } }, auth: authA });
      return "accepté";
    } catch (e) { return e.code; }
  };
  const offGrid = await rejected(SNACK_SLOT, slot + 7 * 60000);
  const past = await rejected(SNACK_SLOT, Date.now() - 60 * 60000);
  const noHours = await rejected(SNACK, slot);
  ok("R9 créneau hors grille / passé / snack sans horaires → REJET",
    offGrid === "invalid-argument" && past === "invalid-argument" && noHours === "invalid-argument",
    JSON.stringify({ offGrid, past, noHours }));

  // R10 — créneau + réseau perdu après paiement : le réconciliateur garde le créneau
  const slot2 = aSlot();
  const piSlotLost = await newSlotPI(authA, slot2);
  await pay(piSlotLost);
  await reconcilePendingOrders(stripe, { nowMs: later() });
  const recovered = (await db.collection("commandes").doc(piSlotLost).get()).data();
  ok("R10 récupération → commande « programmée » avec son créneau",
    recovered?.statut === "programmee" && recovered.retrait?.heure?.toMillis() === slot2,
    `statut=${recovered?.statut}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} scénarios récupération OK`);
  await test.cleanup?.();
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error("💥", e); process.exit(1); });
