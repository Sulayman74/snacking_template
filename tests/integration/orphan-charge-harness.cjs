// 🛡️ Harness F1 — anti CHARGE ORPHELINE (audit). In-process, clés Stripe TEST,
// émulateur Firestore. Vérifie que :
//   O1. createPaymentIntent (delivery hors-zone)        → REJET, aucun PI/charge
//   O2. createPaymentIntent (prix manipulé)             → REJET, aucun PI/charge
//   O3. createPaymentIntent (livraison légitime)        → PI.amount = articles+frais (serveur)
//   O4. finalizeOrder (PI payé + panier manipulé)       → REJET *et* charge remboursée
// Lancé via `firebase emulators:exec --only firestore`. Clés lues depuis
// functions/.env.local (gitignored).
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

const funcRequire = require("module").createRequire(path.join(FUNC_DIR, "index.js"));
const admin = funcRequire("firebase-admin");
const Stripe = funcRequire("stripe");
const test = require("firebase-functions-test")();
const myFunctions = funcRequire("./index.js");

const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" });
const createPI = test.wrap(myFunctions.createPaymentIntent);
const finalize = test.wrap(myFunctions.finalizeOrder);

const SNACK = "snack_orphan_f1";
const PROD = "prod_orphan_f1";
const UNIT = 10;       // 10,00 €
const FRAIS = 3.5;     // €

const results = [];
const ok = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed() {
  await db.collection("snacks").doc(SNACK).set({
    delivery: { frais: FRAIS, radiusKm: 5, minOrder: 0, avgSpeedKmh: 22 },
    restaurantLat: 48.85, restaurantLng: 2.35,
    createdAt: admin.firestore.Timestamp.now(),
  });
  await db.collection("produits").doc(PROD).set({ snackId: SNACK, nom: "Burger", prix: UNIT });
}

const auth = { uid: "u_orphan", token: { email: "orphan@test.dev" } };
const legitCart = () => [{ productId: PROD, nom: "Burger", prix: UNIT, quantity: 1 }];
const nearAddr = { adresse: "près", lat: 48.851, lng: 2.351 };  // ~0,1 km → dans la zone
const farAddr = { adresse: "loin", lat: 49.5, lng: 3.5 };       // > 5 km → hors zone

async function confirmedPI(amountCents) {
  return stripe.paymentIntents.create({
    amount: amountCents, currency: "eur", confirm: true,
    payment_method: "pm_card_visa",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
}

async function main() {
  await seed();

  // O1 — delivery hors-zone → createPaymentIntent REJETÉ avant tout débit.
  try {
    await createPI({ data: { snackId: SNACK, cartItems: legitCart(), mode: "delivery", livraison: farAddr }, auth });
    ok("O1 createPaymentIntent hors-zone → REJET (aucune charge)", false, "aurait dû rejeter");
  } catch (e) {
    ok("O1 createPaymentIntent hors-zone → REJET (aucune charge)", /zone|out-of-range/i.test(e.message || ""), e.message);
  }

  // O2 — prix manipulé (5€ au lieu de 10€) → createPaymentIntent REJETÉ avant débit.
  try {
    await createPI({ data: { snackId: SNACK, cartItems: [{ productId: PROD, nom: "Burger", prix: 5, quantity: 1 }], mode: "collect" }, auth });
    ok("O2 createPaymentIntent prix manipulé → REJET (aucune charge)", false, "aurait dû rejeter");
  } catch (e) {
    ok("O2 createPaymentIntent prix manipulé → REJET (aucune charge)", /manipulé/i.test(e.message || ""), e.message);
  }

  // O3 — livraison légitime → PI créé avec montant SERVEUR = articles(1000) + frais(350).
  try {
    const out = await createPI({ data: { snackId: SNACK, cartItems: legitCart(), mode: "delivery", livraison: nearAddr }, auth });
    const piId = out.clientSecret.split("_secret_")[0];
    const pi = await stripe.paymentIntents.retrieve(piId);
    ok("O3 createPaymentIntent delivery → montant serveur = 1350c", pi.amount === 1350, `amount=${pi.amount}`);
  } catch (e) {
    ok("O3 createPaymentIntent delivery → montant serveur", false, e.message);
  }

  // O4 — PI payé puis panier manipulé à la finalisation → REJET + remboursement auto.
  try {
    const pi = await confirmedPI(1000); // client débité de 10,00 €
    let rejected = false;
    try {
      await finalize({
        data: { paymentIntentId: pi.id, snackId: SNACK, cartItems: [{ productId: PROD, nom: "Burger", prix: 5, quantity: 1 }], clientEmail: "orphan@test.dev", clientNom: "Orphan", totalCents: 500, mode: "collect" },
        auth,
      });
    } catch (e) {
      rejected = /manipulé/i.test(e.message || "");
    }
    // La charge doit avoir été remboursée par le filet de secours.
    const after = await stripe.paymentIntents.retrieve(pi.id, { expand: ["latest_charge"] });
    const refunded = after.latest_charge && Number(after.latest_charge.amount_refunded) >= 1000;
    ok("O4 finalizeOrder panier manipulé → REJET + charge remboursée", rejected && refunded, `rejected=${rejected} amount_refunded=${after.latest_charge?.amount_refunded}`);
  } catch (e) {
    ok("O4 finalizeOrder refund net", false, e.message);
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} scénarios F1 OK`);
  await test.cleanup?.();
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error("💥", e); process.exit(1); });
