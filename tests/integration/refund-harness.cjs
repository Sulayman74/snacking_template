// 💸 Harness de validation IN-PROCESS — Remboursements (LOT B).
// Exécute la vraie fonction exportée `refundOrder` (et `finalizeOrder` pour créer
// la commande) avec de VRAIES clés Stripe TEST, pointé sur l'émulateur Firestore.
// Valide :
//   1. Remboursement TOTAL → refund.total = total, fullyRefunded, paiement.statut='rembourse'
//   2. Remboursement PARTIEL puis 2e partiel → cumul (total, count=2), statut 'partiellement_rembourse'
//   3. Montant > restant → REFUSÉ (invalid-argument), aucun refund créé
//   4. Deux appels TOTAL identiques concurrents (idempotence) → count=1, total=montant (pas de double)
//   5. Gating : admin d'un AUTRE snack → permission-denied ; client → permission-denied
// Lancé via `firebase emulators:exec --only firestore`. Clés lues depuis
// functions/.env.local si présent, sinon functions/.env (gitignored).
// 🛡️ Garde-fou : ABORT si la clé n'est pas `sk_test_` (jamais de refund sur clé live).
const path = require("node:path");
const fs = require("node:fs");

const FUNC_DIR = path.join(__dirname, "..", "..", "functions");

// 1) Charger les clés test AVANT de requérir index.js (.env.local prioritaire).
const envFile = fs.existsSync(path.join(FUNC_DIR, ".env.local"))
  ? path.join(FUNC_DIR, ".env.local")
  : path.join(FUNC_DIR, ".env");
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
process.env.GCLOUD_PROJECT = "snacking-template";
process.env.GOOGLE_CLOUD_PROJECT = "snacking-template";

// 🛡️ Sécurité absolue : ce harness crée de VRAIS remboursements → jamais sur live.
if (!String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test_")) {
  console.error("💥 ABORT : STRIPE_SECRET_KEY n'est pas une clé TEST (sk_test_). Refus de rembourser sur une clé live.");
  process.exit(1);
}

const fftRequire = require;
const funcRequire = require("module").createRequire(path.join(FUNC_DIR, "index.js"));

const admin = funcRequire("firebase-admin");
const Stripe = funcRequire("stripe");
const test = fftRequire("firebase-functions-test")();

const myFunctions = funcRequire("./index.js");
const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" });

const SNACK = "snack_refund_harness";
const OTHER = "snack_refund_other";
const PRODUCT = "prod_refund_harness";
const UNIT_EUR = 10; // 10,00 € → 1000 c

const results = [];
const ok = (name, cond, detail) => {
  results.push(!!cond);
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// PaymentIntent TEST réellement "succeeded" (carte test confirmée immédiatement).
async function makeSucceededPI(amountCents) {
  return stripe.paymentIntents.create({
    amount: amountCents,
    currency: "eur",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
}

const cart = (eur) => [{ productId: PRODUCT, nom: "Tacos test", prix: eur, quantity: 1 }];

async function seed() {
  await db.collection("produits").doc(PRODUCT).set({ snackId: SNACK, nom: "Tacos test", prix: UNIT_EUR, tvaRate: 10 });
  // Snacks SANS stripeAccountId → charge plateforme (le refund n'a pas de header Connect).
  await db.collection("snacks").doc(SNACK).set({ nom: "Snack Refund Harness" });
  await db.collection("snacks").doc(OTHER).set({ nom: "Autre Snack" });
  // Acteurs : admin du snack, admin d'un AUTRE snack, et un client lambda.
  await db.collection("users").doc("a_admin").set({ role: "admin", snackId: SNACK });
  await db.collection("users").doc("a_other").set({ role: "admin", snackId: OTHER });
  await db.collection("users").doc("c_user").set({ role: "client", pointsBySnack: {} });
}

// Crée une commande payée (collect) de `eur` € et renvoie son orderId (= PI id).
async function makeOrder(finalize, uid, eur) {
  const cents = eur * 100;
  const pi = await makeSucceededPI(cents);
  await finalize({
    data: { paymentIntentId: pi.id, snackId: SNACK, cartItems: cart(eur), clientEmail: "c@test.dev", clientNom: "Client", totalCents: cents, mode: "collect" },
    auth: { uid, token: { email: "c@test.dev" } },
  });
  return pi.id;
}

const getOrder = async (orderId) => (await db.collection("commandes").doc(orderId).get()).data();
const admAuth = (uid) => ({ uid, token: { email: `${uid}@test.dev` } });

async function main() {
  await seed();
  const finalize = test.wrap(myFunctions.finalizeOrder);
  const refund = test.wrap(myFunctions.refundOrder);

  // ===== 1. REMBOURSEMENT TOTAL =====
  try {
    const orderId = await makeOrder(finalize, "c_user", 10); // 1000 c
    const out = await refund({ data: { orderId }, auth: admAuth("a_admin") });
    const o = await getOrder(orderId);
    ok("1. Refund TOTAL → total=1000, fullyRefunded, statut 'rembourse'",
      out.refundTotal === 1000 && out.fullyRefunded === true && o.refund.total === 1000 &&
      o.refund.count === 1 && o.paiement.statut === "rembourse",
      `out=${JSON.stringify(out)} statut=${o.paiement.statut}`);
  } catch (e) { ok("1. Refund TOTAL", false, e?.message || String(e)); }

  // ===== 2. REMBOURSEMENT PARTIEL ×2 (cumul) =====
  try {
    const orderId = await makeOrder(finalize, "c_user", 10); // 1000 c
    await refund({ data: { orderId, amount: 400 }, auth: admAuth("a_admin") });
    const o1 = await getOrder(orderId);
    const partialOk = o1.refund.total === 400 && o1.refund.fullyRefunded === false && o1.paiement.statut === "partiellement_rembourse";
    await refund({ data: { orderId, amount: 300 }, auth: admAuth("a_admin") });
    const o2 = await getOrder(orderId);
    ok("2. Refund PARTIEL ×2 → cumul total=700, count=2, statut 'partiellement_rembourse'",
      partialOk && o2.refund.total === 700 && o2.refund.count === 2 && o2.refund.fullyRefunded === false &&
      o2.paiement.statut === "partiellement_rembourse",
      `total=${o2.refund.total} count=${o2.refund.count} statut=${o2.paiement.statut}`);
  } catch (e) { ok("2. Refund PARTIEL ×2", false, e?.message || String(e)); }

  // ===== 3. MONTANT > RESTANT → REFUSÉ =====
  try {
    const orderId = await makeOrder(finalize, "c_user", 10); // 1000 c
    let threw = false;
    try { await refund({ data: { orderId, amount: 99999 }, auth: admAuth("a_admin") }); }
    catch (_) { threw = true; }
    const o = await getOrder(orderId);
    ok("3. Montant > restant → REFUSÉ, aucun refund persisté", threw && o.refund.total === 0 && o.refund.count === 0,
      `threw=${threw} refund.total=${o.refund.total}`);
  } catch (e) { ok("3. Montant hors limites", false, e?.message || String(e)); }

  // ===== 4. IDEMPOTENCE : deux refunds TOTAL identiques concurrents =====
  try {
    const orderId = await makeOrder(finalize, "c_user", 10); // 1000 c
    const payload = { data: { orderId, amount: 1000 }, auth: admAuth("a_admin") };
    await Promise.allSettled([refund(payload), refund(payload)]);
    const o = await getOrder(orderId);
    ok("4. Idempotence (2 appels TOTAL concurrents) → count=1, total=1000 (pas de double)",
      o.refund.count === 1 && o.refund.total === 1000,
      `count=${o.refund.count} total=${o.refund.total}`);
  } catch (e) { ok("4. Idempotence concurrente", false, e?.message || String(e)); }

  // ===== 5. GATING : autre snack / client → permission-denied =====
  try {
    const orderId = await makeOrder(finalize, "c_user", 10);
    let otherDenied = false, clientDenied = false;
    try { await refund({ data: { orderId }, auth: admAuth("a_other") }); }
    catch (e) { otherDenied = e?.code === "permission-denied" || /permission/i.test(e?.message || ""); }
    try { await refund({ data: { orderId }, auth: admAuth("c_user") }); }
    catch (e) { clientDenied = e?.code === "permission-denied" || /permission/i.test(e?.message || ""); }
    const o = await getOrder(orderId);
    ok("5. Gating → admin autre snack ET client refusés, aucun refund",
      otherDenied && clientDenied && o.refund.total === 0,
      `other=${otherDenied} client=${clientDenied} refund.total=${o.refund.total}`);
  } catch (e) { ok("5. Gating", false, e?.message || String(e)); }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} validations OK`);
  await test.cleanup?.();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
