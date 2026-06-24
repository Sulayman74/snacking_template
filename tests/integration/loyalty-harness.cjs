// 🎁 Harness de validation IN-PROCESS — Fidélité sur commande payée.
// Exécute les vraies fonctions exportées (finalizeOrder, awardLoyaltyPoint) avec de
// VRAIES clés Stripe TEST, pointé sur l'émulateur Firestore. Valide :
//   1. Commande COLLECT payée → +1 point sur pointsBySnack.{snackId}
//   2. Commande LIVRAISON payée → +1 point (mode-agnostique)
//   3. Retry réseau (même paymentIntentId) → PAS de double crédit (idempotent)
//   4. Palier (current >= MAX) → reward:true, report du point (1) + 1 menu banqué (LOT F2)
//   5. Scan QR (awardLoyaltyPoint) → +1 via le helper partagé (non-régression)
//   6. Client SANS fcmToken au palier → crédit OK, pas de crash
//   7. redeemLoyaltyReward → consomme 1 menu banqué + trace d'audit (LOT F2)
//   8. Anti-doublon (F3) : re-scan rapproché du même client → REJET
//   9. Anti-doublon (F3) cross-canal : commande payée puis scan → REJET
// Lancé via `firebase emulators:exec --only firestore`. Clés lues depuis
// functions/.env.local (gitignored). Aucun appel FCM réel : les scénarios à
// récompense utilisent un client sans fcmToken (sendRewardPush = no-op).
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

const fftRequire = require;
const funcRequire = require("module").createRequire(path.join(FUNC_DIR, "index.js"));

const admin = funcRequire("firebase-admin");
const Stripe = funcRequire("stripe");
const test = fftRequire("firebase-functions-test")();

const myFunctions = funcRequire("./index.js");
const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" });

const SNACK = "snack_loyalty_harness";
const PRODUCT = "prod_loyalty_harness";
const UNIT_EUR = 10; // 10,00 € → 1000 c
const UNIT_CENTS = UNIT_EUR * 100;

const results = [];
const ok = (name, cond, detail) => {
  results.push(!!cond);
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// PaymentIntent TEST réellement "succeeded" (carte test confirmée immédiatement).
async function makeSucceededPI(amountCents) {
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "eur",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  return pi;
}

const cart = () => [{ productId: PRODUCT, nom: "Tacos test", prix: UNIT_EUR, quantity: 1 }];

async function getPoints(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return (snap.exists ? (snap.data().pointsBySnack || {}) : {})[SNACK] || 0;
}

async function getAvailable(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return (snap.exists ? (snap.data().rewardsAvailable || {}) : {})[SNACK] || 0;
}

async function seed() {
  // Produit légitime (anti-fraude prix) + snack minimal (collect & livraison OK).
  await db.collection("produits").doc(PRODUCT).set({ snackId: SNACK, nom: "Tacos test", prix: UNIT_EUR });
  await db.collection("snacks").doc(SNACK).set({ nom: "Snack Harness" });
  // Clients de test (aucun fcmToken → zéro appel FCM réel).
  await db.collection("users").doc("u_collect").set({ role: "client", pointsBySnack: {} });
  await db.collection("users").doc("u_delivery").set({ role: "client", pointsBySnack: {} });
  await db.collection("users").doc("u_retry").set({ role: "client", pointsBySnack: {} });
  await db.collection("users").doc("u_palier").set({ role: "client", pointsBySnack: { [SNACK]: 10 } });
  // Scan QR : un admin du snack + un client cible.
  await db.collection("users").doc("a_admin").set({ role: "admin", snackId: SNACK });
  await db.collection("users").doc("c_scan").set({ role: "client", pointsBySnack: {} });
}

async function main() {
  await seed();
  const finalize = test.wrap(myFunctions.finalizeOrder);
  const award = test.wrap(myFunctions.awardLoyaltyPoint);

  // ===== 1. COLLECT → +1 =====
  try {
    const pi = await makeSucceededPI(UNIT_CENTS);
    await finalize({
      data: { paymentIntentId: pi.id, snackId: SNACK, cartItems: cart(), clientEmail: "c@test.dev", clientNom: "Collect", totalCents: UNIT_CENTS, mode: "collect" },
      auth: { uid: "u_collect", token: { email: "c@test.dev" } },
    });
    const pts = await getPoints("u_collect");
    ok("1. Commande COLLECT payée → +1 point", pts === 1, `pointsBySnack.${SNACK}=${pts}`);
  } catch (e) { ok("1. Commande COLLECT", false, e?.message || String(e)); }

  // ===== 2. LIVRAISON → +1 =====
  try {
    const pi = await makeSucceededPI(UNIT_CENTS);
    await finalize({
      data: { paymentIntentId: pi.id, snackId: SNACK, cartItems: cart(), clientEmail: "d@test.dev", clientNom: "Delivery", totalCents: UNIT_CENTS, mode: "delivery", livraison: { lat: 48.8566, lng: 2.3522, adresse: "1 rue test" } },
      auth: { uid: "u_delivery", token: { email: "d@test.dev" } },
    });
    const pts = await getPoints("u_delivery");
    ok("2. Commande LIVRAISON payée → +1 point (mode-agnostique)", pts === 1, `pointsBySnack.${SNACK}=${pts}`);
  } catch (e) { ok("2. Commande LIVRAISON", false, e?.message || String(e)); }

  // ===== 3. RETRY (même PI) → pas de double crédit =====
  try {
    const pi = await makeSucceededPI(UNIT_CENTS);
    const payload = {
      data: { paymentIntentId: pi.id, snackId: SNACK, cartItems: cart(), clientEmail: "r@test.dev", clientNom: "Retry", totalCents: UNIT_CENTS, mode: "collect" },
      auth: { uid: "u_retry", token: { email: "r@test.dev" } },
    };
    await finalize(payload);          // 1er appel → crédite
    await finalize(payload);          // retry même orderId → retour anticipé, AUCUN crédit
    const pts = await getPoints("u_retry");
    ok("3. Retry même paymentIntentId → pas de double crédit (idempotent)", pts === 1, `pointsBySnack.${SNACK}=${pts} (attendu 1)`);
  } catch (e) { ok("3. Retry idempotent", false, e?.message || String(e)); }

  // ===== 4. PALIER (current=10) → report du point (1) + 1 menu banqué, sans crash =====
  try {
    const pi = await makeSucceededPI(UNIT_CENTS);
    await finalize({
      data: { paymentIntentId: pi.id, snackId: SNACK, cartItems: cart(), clientEmail: "p@test.dev", clientNom: "Palier", totalCents: UNIT_CENTS, mode: "collect" },
      auth: { uid: "u_palier", token: { email: "p@test.dev" } },
    });
    const pts = await getPoints("u_palier");
    const avail = await getAvailable("u_palier");
    // Modèle report+banque (LOT F2) : le point gagné n'est plus perdu (10→1) et la
    // récompense est banquée durablement (rewardsAvailable=1) au lieu d'une remise à 0.
    ok(
      "4. Palier (current>=MAX) → report point (1) + 1 menu banqué, sans crash",
      pts === 1 && avail === 1,
      `points=${pts} (attendu 1) available=${avail} (attendu 1)`,
    );
  } catch (e) { ok("4. Palier report+banque", false, e?.message || String(e)); }

  // ===== 5. SCAN QR (awardLoyaltyPoint) → +1 via helper partagé (non-régression) =====
  try {
    const out = await award({
      data: { clientUid: "c_scan", snackId: SNACK },
      auth: { uid: "a_admin", token: { email: "admin@test.dev" } },
    });
    const pts = await getPoints("c_scan");
    ok("5. Scan QR (awardLoyaltyPoint) → +1 via helper partagé", pts === 1 && out?.points === 1 && out?.reward === false, `points=${pts} out=${JSON.stringify(out)}`);
  } catch (e) { ok("5. Scan QR non-régression", false, e?.message || String(e)); }

  // ===== 7. REDEEM (u_palier a 1 menu banqué depuis le test 4) → consommé + audit =====
  try {
    const redeem = test.wrap(myFunctions.redeemLoyaltyReward);
    const before = await getAvailable("u_palier");
    const out = await redeem({
      data: { clientUid: "u_palier", snackId: SNACK },
      auth: { uid: "a_admin", token: { email: "admin@test.dev" } },
    });
    const avail = await getAvailable("u_palier");
    const auditSnap = await db.collection("loyaltyRewards")
      .where("snackId", "==", SNACK).where("clientUid", "==", "u_palier").get();
    ok(
      "7. redeemLoyaltyReward → consomme 1 menu banqué + trace d'audit",
      before === 1 && avail === 0 && out?.rewardsAvailable === 0 && auditSnap.size === 1,
      `before=${before} after=${avail} audits=${auditSnap.size}`,
    );
  } catch (e) { ok("7. redeemLoyaltyReward", false, e?.message || String(e)); }

  // ===== 8. ANTI-DOUBLON (F3) re-scan rapproché du même client → REJET, points inchangés =====
  try {
    const before = await getPoints("c_scan"); // crédité au test 5
    let rejected = false;
    try {
      await award({ data: { clientUid: "c_scan", snackId: SNACK }, auth: { uid: "a_admin", token: { email: "admin@test.dev" } } });
    } catch (e) { rejected = /doublon|déjà/i.test(e?.message || ""); }
    const after = await getPoints("c_scan");
    ok("8. Anti-doublon F3 — re-scan rapproché → REJET, points inchangés", rejected && after === before, `rejected=${rejected} points ${before}→${after}`);
  } catch (e) { ok("8. Anti-doublon re-scan", false, e?.message || String(e)); }

  // ===== 9. ANTI-DOUBLON (F3) CROSS-CANAL : commande (test 1) puis scan → REJET =====
  try {
    const before = await getPoints("u_collect"); // crédité via finalizeOrder au test 1
    let rejected = false;
    try {
      await award({ data: { clientUid: "u_collect", snackId: SNACK }, auth: { uid: "a_admin", token: { email: "admin@test.dev" } } });
    } catch (e) { rejected = /doublon|déjà/i.test(e?.message || ""); }
    const after = await getPoints("u_collect");
    ok("9. Anti-doublon F3 cross-canal — commande puis scan → REJET", rejected && after === before, `rejected=${rejected} points ${before}→${after}`);
  } catch (e) { ok("9. Anti-doublon cross-canal", false, e?.message || String(e)); }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} validations OK`);
  await test.cleanup?.();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
