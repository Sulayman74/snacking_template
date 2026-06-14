// 🔐 Harness de validation IN-PROCESS (hors wrapper Functions Emulator) — Lots 5.
// Exécute les vraies fonctions exportées avec de VRAIES clés Stripe TEST, pointé
// sur l'émulateur Firestore. Valide :
//   A. createPaymentIntent (onCall) → PaymentIntent test créé via apiVersion dahlia
//   B. paymentIntents.retrieve (l'appel apiVersion-dépendant de finalizeOrder)
//   C. stripeWebhook (onRequest) : signature réelle → resolveSubscriptionId
//      (legacy+Basil) → séparation customer.subscription.deleted → toggle Firestore
// Lancé via `firebase emulators:exec --only firestore`. Clés lues depuis
// functions/.env.local (gitignored, jamais commité).
const path = require("node:path");
const fs = require("node:fs");

const FUNC_DIR = path.join(__dirname, "..", "..", "functions");

// 1) Charger les clés test (functions/.env.local) AVANT de requérir index.js
for (const line of fs.readFileSync(path.join(FUNC_DIR, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
process.env.GCLOUD_PROJECT = "snacking-template";
process.env.GOOGLE_CLOUD_PROJECT = "snacking-template";

const fftRequire = require; // root node_modules (firebase-functions-test, vitest…)
const funcRequire = require("module").createRequire(path.join(FUNC_DIR, "index.js"));

const admin = funcRequire("firebase-admin"); // MÊME instance que index.js
const Stripe = funcRequire("stripe");
const test = fftRequire("firebase-functions-test")(); // mode offline

const myFunctions = funcRequire("./index.js"); // déclenche admin.initializeApp()
const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" });
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET;
const SUB = "sub_TEST_HARNESS";

const results = [];
const ok = (name, cond, detail) => {
  results.push(!!cond);
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---- mock req/res pour onRequest ----
function mockRes() {
  let status = 0, body = null;
  const res = {
    status(c) { status = c; return res; },
    send(b) { if (!status) status = 200; body = b; return res; },
    json(b) { if (!status) status = 200; body = b; return res; },
  };
  return { res, get: () => ({ status, body }) };
}
async function postWebhook(evt) {
  const payload = JSON.stringify(evt);
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  const req = { method: "POST", headers: { "stripe-signature": sig }, rawBody: Buffer.from(payload) };
  const m = mockRes();
  await myFunctions.stripeWebhook(req, m.res);
  return m.get();
}
const invoiceBasil = (id, type) => ({ id, type, data: { object: { object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: SUB } } } } });
const invoiceLegacy = (id, type) => ({ id, type, data: { object: { object: "invoice", subscription: SUB } } });
const subDeleted = (id) => ({ id, type: "customer.subscription.deleted", data: { object: { object: "subscription", id: SUB } } });

const snackSub = db.collection("snacks").doc("snack_sub_harness");
const setMaint = (v) => snackSub.set({ stripeSubscriptionId: SUB, maintenanceMode: v }, { merge: true });
const getMaint = async () => (await snackSub.get()).data()?.maintenanceMode;

async function main() {
  // Seed produit + snack pour le recalcul serveur du montant (anti charge orpheline F1).
  const PI_SNACK = "snack_pi_harness";
  const PI_PROD = "prod_pi_harness";
  await db.collection("snacks").doc(PI_SNACK).set({ nom: "PI Harness" });
  await db.collection("produits").doc(PI_PROD).set({ snackId: PI_SNACK, nom: "Burger PI", prix: 10 });
  const piCart = [{ productId: PI_PROD, nom: "Burger PI", prix: 10, quantity: 1 }];

  // ===== A. createPaymentIntent (onCall) via firebase-functions-test =====
  // Le montant du PI est RECALCULÉ serveur (10,00 € → 1000c), jamais le client.
  let piId = null;
  try {
    const wrapped = test.wrap(myFunctions.createPaymentIntent);
    const out = await wrapped({
      data: { snackId: PI_SNACK, cartItems: piCart, currency: "eur", description: "Harness test" },
      auth: { uid: "u_harness", token: { email: "harness@test.dev" } },
    });
    const cs = out?.clientSecret;
    ok("A. createPaymentIntent → clientSecret (PI créé via dahlia)", typeof cs === "string" && cs.startsWith("pi_") && cs.includes("_secret_"), cs ? cs.split("_secret_")[0] : String(out));
    if (cs) piId = cs.split("_secret_")[0];
  } catch (e) {
    ok("A. createPaymentIntent", false, e?.message || String(e));
  }

  // ===== B. paymentIntents.retrieve via dahlia (appel de finalizeOrder l.944) =====
  if (piId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId);
      ok("B. paymentIntents.retrieve via dahlia (champs lisibles amount/status)", pi.amount === 1000 && typeof pi.status === "string", `amount=${pi.amount} status=${pi.status}`);
    } catch (e) {
      ok("B. paymentIntents.retrieve", false, e?.message || String(e));
    }
  } else {
    ok("B. paymentIntents.retrieve", false, "pas de PI (A a échoué)");
  }

  // ===== C. stripeWebhook in-process (signature réelle) =====
  await setMaint(false);
  let r = await postWebhook(invoiceBasil("evt_pf_basil", "invoice.payment_failed"));
  ok("C1. payment_failed (Basil) → 200 + suspendu", r.status === 200 && (await getMaint()) === true, `http ${r.status}`);

  r = await postWebhook(invoiceBasil("evt_ps_basil", "invoice.payment_succeeded"));
  ok("C2. payment_succeeded (Basil) → 200 + réactivé", r.status === 200 && (await getMaint()) === false, `http ${r.status}`);

  r = await postWebhook(subDeleted("evt_del"));
  ok("C3. customer.subscription.deleted → 200 + suspendu (object.id)", r.status === 200 && (await getMaint()) === true, `http ${r.status}`);

  await setMaint(false);
  r = await postWebhook(invoiceLegacy("evt_pf_legacy", "invoice.payment_failed"));
  ok("C4. payment_failed (legacy) → 200 + suspendu", r.status === 200 && (await getMaint()) === true, `http ${r.status}`);

  await setMaint(true);
  r = await postWebhook(subDeleted("evt_del")); // même event.id
  ok("C5. rejeu même event.id → 200 (idempotent)", r.status === 200, `http ${r.status}`);

  // Signature INVALIDE → doit être rejetée en 400 :
  {
    const payload = JSON.stringify(subDeleted("evt_tampered"));
    const req = { method: "POST", headers: { "stripe-signature": "t=1,v1=deadbeef" }, rawBody: Buffer.from(payload) };
    const m = mockRes();
    await myFunctions.stripeWebhook(req, m.res);
    ok("C6. signature invalide → 400 (rejet)", m.get().status === 400, `http ${m.get().status}`);
  }

  // ===== D. getKitchenLoad + pushFlashOffer (charge cuisine, Firestore émulé) =====
  const CALM = "snack_load_calm";
  const RUSH = "snack_load_rush";
  // Seeds : seuils en config (jamais en dur) + admins + file de commandes.
  await db.collection("snacks").doc(CALM).set({ capacity: { rushThreshold: 50 } });
  await db.collection("snacks").doc(RUSH).set({ capacity: { rushThreshold: 1 } });
  await db.collection("users").doc("u_admin_calm").set({ role: "admin", snackId: CALM });
  await db.collection("users").doc("u_admin_rush").set({ role: "admin", snackId: RUSH });
  // 2 commandes "en cours" pour le snack RUSH (queue=2 ≥ rushThreshold=1 → rush).
  for (const [i, st] of [["a", "en_attente_client"], ["b", "nouvelle"]]) {
    await db.collection("commandes").doc(`cmd_rush_${i}`).set({ snackId: RUSH, statut: st });
  }

  const loadCalm = test.wrap(myFunctions.getKitchenLoad);
  const flash = test.wrap(myFunctions.pushFlashOffer);

  // D1. Snack calme : queue 0, rushMode false, avgPrepMin = défaut prepBaseMin(12).
  try {
    const out = await loadCalm({ data: { snackId: CALM }, auth: { uid: "u_client" } });
    ok("D1. getKitchenLoad calme → rushMode false (queue 0, avgPrepMin 12)",
      out.queue === 0 && out.rushMode === false && out.avgPrepMin === 12, JSON.stringify(out));
  } catch (e) { ok("D1. getKitchenLoad calme", false, e?.message || String(e)); }

  // D2. 2e appel < TTL → servi depuis le cache.
  try {
    const out = await loadCalm({ data: { snackId: CALM }, auth: { uid: "u_client" } });
    ok("D2. getKitchenLoad calme (2e appel) → cached:true", out.cached === true, JSON.stringify(out));
  } catch (e) { ok("D2. getKitchenLoad cache", false, e?.message || String(e)); }

  // D3. Snack en rush : queue 2 ≥ rushThreshold 1 → rushMode true.
  try {
    const out = await loadCalm({ data: { snackId: RUSH }, auth: { uid: "u_client" } });
    ok("D3. getKitchenLoad rush → rushMode true (queue 2)", out.queue === 2 && out.rushMode === true, JSON.stringify(out));
  } catch (e) { ok("D3. getKitchenLoad rush", false, e?.message || String(e)); }

  // D4. pushFlashOffer hors rush → crée une campagne immédiate (source flash_offer).
  try {
    const before = (await db.collection("campagnes_push").where("snackId", "==", CALM).get()).size;
    await flash({ data: { snackId: CALM, title: "Goûter -20%", body: "1h seulement", ttlMin: 60 }, auth: { uid: "u_admin_calm" } });
    const after = await db.collection("campagnes_push").where("snackId", "==", CALM).get();
    const created = after.docs.find((d) => d.data().source === "flash_offer");
    ok("D4. pushFlashOffer calme → campagne en_attente créée",
      after.size === before + 1 && created?.data().statut === "en_attente" && created?.data().cible === "active",
      `n=${after.size}`);
  } catch (e) { ok("D4. pushFlashOffer calme", false, e?.message || String(e)); }

  // D5. pushFlashOffer en rush → refusé failed-precondition / kitchen-busy.
  try {
    await flash({ data: { snackId: RUSH, title: "X", body: "Y", ttlMin: 30 }, auth: { uid: "u_admin_rush" } });
    ok("D5. pushFlashOffer rush → refusé kitchen-busy", false, "aucune exception levée");
  } catch (e) {
    ok("D5. pushFlashOffer rush → refusé kitchen-busy", e?.message?.includes("kitchen-busy"), e?.message || String(e));
  }

  // D6. pushFlashOffer non-admin → permission-denied.
  try {
    await flash({ data: { snackId: CALM, title: "X", body: "Y", ttlMin: 30 }, auth: { uid: "u_inconnu" } });
    ok("D6. pushFlashOffer non-admin → permission-denied", false, "aucune exception levée");
  } catch (e) {
    ok("D6. pushFlashOffer non-admin → permission-denied", /permission|administrateur/i.test(e?.message || ""), e?.message || String(e));
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} validations OK`);
  await test.cleanup?.();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
