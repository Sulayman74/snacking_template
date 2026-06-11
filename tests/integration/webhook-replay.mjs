// 🔁 Rejeu de webhook Stripe AUTO-SIGNÉ contre l'émulateur functions+firestore
// (Lot 5). Valide de bout en bout : vérif de signature → resolveSubscriptionId
// (legacy ET Basil) → séparation customer.subscription.deleted → toggle Firestore
// maintenanceMode. Aucune clé Stripe réelle requise : on signe nous-mêmes avec
// le secret de test (functions/.env.local). À lancer via `firebase emulators:exec`.
import { createRequire } from "node:module";
const require = createRequire(`${process.cwd()}/functions/index.js`);

const admin = require("firebase-admin");
const Stripe = require("stripe");

const PROJECT = "snacking-template";
const WHSEC = "whsec_emulatortestsecret"; // doit matcher functions/.env.local
const SUB = "sub_TEST";
const URL = `http://127.0.0.1:5001/${PROJECT}/europe-west9/stripeWebhook`;

const stripe = Stripe("sk_test_dummy_for_emulator");
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

const snackRef = db.collection("snacks").doc("snack_test");

async function setMaintenance(v) {
  await snackRef.set({ stripeSubscriptionId: SUB, maintenanceMode: v }, { merge: true });
}
async function getMaintenance() {
  const s = await snackRef.get();
  return s.exists ? s.data().maintenanceMode : undefined;
}

async function postEvent(evt) {
  const payload = JSON.stringify(evt);
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": sig },
    body: payload,
  });
  return res.status;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// Fabrique d'events
const invoiceBasil = (id, type) => ({
  id, type,
  data: { object: { object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: SUB } } } },
});
const invoiceLegacy = (id, type) => ({
  id, type, data: { object: { object: "invoice", subscription: SUB } },
});
const subDeleted = (id) => ({
  id, type: "customer.subscription.deleted",
  data: { object: { object: "subscription", id: SUB } },
});

async function run() {
  // A. payment_failed (Basil) → suspend (maintenanceMode true)
  await setMaintenance(false);
  let st = await postEvent(invoiceBasil("evt_pf_basil", "invoice.payment_failed"));
  check("invoice.payment_failed (Basil) → 200 + suspendu", st === 200 && (await getMaintenance()) === true, `http ${st}`);

  // B. payment_succeeded (Basil) → réactive (maintenanceMode false)
  st = await postEvent(invoiceBasil("evt_ps_basil", "invoice.payment_succeeded"));
  check("invoice.payment_succeeded (Basil) → 200 + réactivé", st === 200 && (await getMaintenance()) === false, `http ${st}`);

  // C. customer.subscription.deleted (objet = Subscription, id = object.id) → suspend
  st = await postEvent(subDeleted("evt_del"));
  check("customer.subscription.deleted → 200 + suspendu (via object.id)", st === 200 && (await getMaintenance()) === true, `http ${st}`);

  // D. payment_failed LEGACY (invoice.subscription string) → suspend
  await setMaintenance(false);
  st = await postEvent(invoiceLegacy("evt_pf_legacy", "invoice.payment_failed"));
  check("invoice.payment_failed (legacy) → 200 + suspendu", st === 200 && (await getMaintenance()) === true, `http ${st}`);

  // E. idempotence : rejouer evt_del (même id) → 200 duplicate, état inchangé
  await setMaintenance(true);
  st = await postEvent(subDeleted("evt_del"));
  check("rejeu même event.id → 200 (idempotent, no-op)", st === 200, `http ${st}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scénarios OK`);
  process.exit(failed.length === 0 ? 0 : 1);
}

run().catch((e) => { console.error("💥 Erreur rejeu:", e); process.exit(1); });
