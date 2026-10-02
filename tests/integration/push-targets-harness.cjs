// 🔔 Harness — abonnements push par appareil / snack / app (lib/pushTargets +
// callable registerPushToken). Émulateur Firestore, FCM REMPLACÉ par un stub
// (aucun envoi réel). Vérifie que :
//   P1. registerPushToken client            → pushSubscriptions/{sha256(token)} créé
//   P2. registerPushToken admin             → refusé hors rôle / hors snack, accepté sinon
//   P3. token ré-enregistré par un autre uid → un seul doc, nouveau propriétaire
//   P4. getUserPushTargets                  → seulement les appareils de CE snack
//   P5. repli legacy users.fcmToken         → seulement si AUCUN abonnement
//   P6. getStaffPushTargets                 → exclut un compte qui a perdu le rôle
//   P7. sendToTargets                       → dédoublonne, supprime abonnement / champ legacy morts
//   P8. transactionnel bout-en-bout          → notif « commande prête » part vers les bons appareils
//   P9. arrivée du client (click & collect)  → push aux ADMINS du snack uniquement, lien admin
//   P10. lancée par l'horloge (client muet)  → push cuisine « à lancer maintenant », pas « client dans 5 min »
// Lancé via `npm run test:push`.
const path = require("node:path");
const FUNC_DIR = path.join(__dirname, "..", "..", "functions");

require("./loadTestEnv.cjs").loadTestEnv();
process.env.GCLOUD_PROJECT = "snacking-template";
process.env.GOOGLE_CLOUD_PROJECT = "snacking-template";

const funcRequire = require("module").createRequire(path.join(FUNC_DIR, "index.js"));
const admin = funcRequire("firebase-admin");
const test = require("firebase-functions-test")();
const myFunctions = funcRequire("./index.js");
const P = funcRequire("./lib/pushTargets");

const db = admin.firestore();
const register = test.wrap(myFunctions.registerPushToken);

const results = [];
const ok = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };
const tok = (s) => `tok_${s}_${"x".repeat(40)}`;
const auth = (uid) => ({ uid, token: { firebase: { sign_in_provider: "password" } } });

/** Stub FCM : échoue (token invalide) pour les tokens listés dans `dead`. */
function stubMessaging(dead = []) {
  const calls = [];
  return {
    calls,
    async sendEachForMulticast(msg) {
      calls.push(msg);
      const responses = msg.tokens.map((t) => dead.includes(t)
        ? { success: false, error: { code: "messaging/registration-token-not-registered" } }
        : { success: true });
      return { responses, successCount: responses.filter((r) => r.success).length, failureCount: responses.filter((r) => !r.success).length };
    },
  };
}

async function seed() {
  await db.collection("snacks").doc("snackA").set({ nom: "A" });
  await db.collection("snacks").doc("snackB").set({ nom: "B" });
  await db.collection("users").doc("client1").set({ role: "client", pointsBySnack: {} });
  await db.collection("users").doc("adminA").set({ role: "admin", snackId: "snackA" });
  await db.collection("users").doc("adminB").set({ role: "admin", snackId: "snackB" });
  await db.collection("users").doc("legacyUser").set({ role: "client", fcmToken: tok("legacy") });
  await db.collection("users").doc("legacyAdmin").set({ role: "admin", snackId: "snackA", fcmToken: tok("legacyAdmin") });
}

async function main() {
  await seed();
  const subs = db.collection(P.SUBSCRIPTIONS);

  // P1
  await register({ data: { token: tok("c1A"), snackId: "snackA", app: "client" }, auth: auth("client1") });
  const d1 = await subs.doc(P.subscriptionId(tok("c1A"))).get();
  ok("P1 client enregistré", d1.exists && d1.data().uid === "client1" && d1.data().snackId === "snackA" && d1.data().app === "client" && !!d1.data().expireAt);

  // P2
  const denied = async (uid, snackId) => {
    try { await register({ data: { token: tok(`${uid}${snackId}`), snackId, app: "admin" }, auth: auth(uid) }); return false; }
    catch (e) { return e.code === "permission-denied"; }
  };
  const d2a = await denied("client1", "snackA");
  const d2b = await denied("adminB", "snackA");
  await register({ data: { token: tok("adminA"), snackId: "snackA", app: "admin" }, auth: auth("adminA") });
  ok("P2 admin : refusé hors rôle / hors snack, accepté sinon", d2a && d2b && (await subs.doc(P.subscriptionId(tok("adminA"))).get()).exists);

  // P3 — même navigateur, autre compte
  await register({ data: { token: tok("shared"), snackId: "snackA", app: "client" }, auth: auth("client1") });
  await register({ data: { token: tok("shared"), snackId: "snackA", app: "client" }, auth: auth("client2") });
  const shared = await subs.where("token", "==", tok("shared")).get();
  ok("P3 token partagé → un seul doc, dernier propriétaire", shared.size === 1 && shared.docs[0].data().uid === "client2");

  // P4 — client1 a aussi un appareil pour snackB
  await register({ data: { token: tok("c1B"), snackId: "snackB", app: "client" }, auth: auth("client1") });
  const tA = await P.getUserPushTargets("client1", "snackA", "client");
  ok("P4 seulement les appareils de CE snack", tA.length === 1 && tA[0].token === tok("c1A"), tA.map((t) => t.token).join(","));

  // P5 — legacy
  const tLegacy = await P.getUserPushTargets("legacyUser", "snackA", "client");
  await db.collection("users").doc("client1").update({ fcmToken: tok("staleLegacy") });
  const tNoLegacy = await P.getUserPushTargets("client1", "snackB", "admin"); // a des abonnements → legacy ignoré
  ok("P5 legacy seulement sans abonnement", tLegacy.length === 1 && tLegacy[0].legacy && tNoLegacy.length === 0);

  // P6 — staff : abonnement d'un compte rétrogradé exclu, legacy admin inclus
  await subs.doc("ghost").set({ uid: "exAdmin", snackId: "snackA", app: "admin", token: tok("ghost") });
  const staff = await P.getStaffPushTargets("snackA", "admin");
  const staffTokens = staff.map((t) => t.token).sort();
  ok("P6 staff = abonnés actifs + legacy, sans ex-admin",
    JSON.stringify(staffTokens) === JSON.stringify([tok("adminA"), tok("legacyAdmin")].sort()), staffTokens.join(","));

  // P7 — envoi : doublon ignoré, token mort (abonnement + legacy) nettoyé
  const m7 = stubMessaging([tok("adminA"), tok("legacyAdmin")]);
  const r7 = await P.sendToTargets([...staff, staff[0]], { notification: { title: "t" } }, { messaging: m7 });
  const adminSubGone = !(await subs.doc(P.subscriptionId(tok("adminA"))).get()).exists;
  const legacyGone = (await db.collection("users").doc("legacyAdmin").get()).data().fcmToken === undefined;
  ok("P7 dédoublonnage + nettoyage", m7.calls[0].tokens.length === 2 && r7.invalidated === 2 && adminSubGone && legacyGone, JSON.stringify(r7));

  // P8 — bout-en-bout transactionnel via le vrai trigger (FCM stubbé sur l'Admin SDK)
  const sent = [];
  const messaging = funcRequire("firebase-admin/messaging").getMessaging();
  messaging.sendEachForMulticast = async (msg) => {
    sent.push(msg);
    return { responses: msg.tokens.map(() => ({ success: true })), successCount: msg.tokens.length, failureCount: 0 };
  };
  const wrapped = test.wrap(myFunctions.onOrderStatusChange);
  const before = test.firestore.makeDocumentSnapshot({ statut: "nouvelle", userId: "client1", snackId: "snackA", mode: "collect" }, "commandes/ORDER1234");
  const after = test.firestore.makeDocumentSnapshot({ statut: "prete", userId: "client1", snackId: "snackA", mode: "collect" }, "commandes/ORDER1234");
  await wrapped({ data: test.makeChange(before, after), params: { orderId: "ORDER1234" } });
  ok("P8 « commande prête » → appareil snackA uniquement, lien du bon site",
    sent.length === 1 && JSON.stringify(sent[0].tokens) === JSON.stringify([tok("c1A")]) &&
      sent[0].webpush?.fcm_options?.link === "https://snacking-template.web.app/",
    JSON.stringify(sent[0]?.tokens));

  // P9 — le client clique « Je suis à 5 min » : la cuisine (et elle seule) est alertée.
  // (P7 a purgé les appareils admin « morts » : on en réenregistre un, bien vivant.)
  await register({ data: { token: tok("adminA2"), snackId: "snackA", app: "admin" }, auth: auth("adminA") });
  sent.length = 0;
  const waiting = test.firestore.makeDocumentSnapshot({ statut: "en_attente_client", userId: "client1", snackId: "snackA", mode: "collect", clientNom: "Léa", secretCode: "K7Q2" }, "commandes/ORDER5678");
  const arrived = test.firestore.makeDocumentSnapshot({ statut: "nouvelle", userId: "client1", snackId: "snackA", mode: "collect", clientNom: "Léa", secretCode: "K7Q2" }, "commandes/ORDER5678");
  await wrapped({ data: test.makeChange(waiting, arrived), params: { orderId: "ORDER5678" } });
  const adminTokensA = new Set((await P.getStaffPushTargets("snackA", "admin")).map((t) => t.token));
  const p9 = sent[0];
  ok("P9 arrivée client → admins snackA uniquement, texte cuisine, lien admin",
    sent.length === 1 && p9.tokens.includes(tok("adminA2")) && p9.tokens.every((t) => adminTokensA.has(t)) &&
      !p9.tokens.includes(tok("c1A")) &&
      p9.notification?.title === "🏃 Client dans 5 min — lancez la cuisson" &&
      p9.notification?.body === "Léa · code K7Q2" &&
      /\/admin\.html$/.test(p9.webpush?.fcm_options?.link || ""),
    JSON.stringify({ tokens: p9?.tokens, notification: p9?.notification, link: p9?.webpush?.fcm_options?.link }));

  // P10 — l'horloge lance une ancienne commande restée en attente : texte adapté.
  sent.length = 0;
  const auto = test.firestore.makeDocumentSnapshot({ statut: "nouvelle", lancementAuto: "transition", userId: "client1", snackId: "snackA", mode: "collect", clientNom: "Léa", secretCode: "K7Q2" }, "commandes/ORDER9999");
  const waitingAuto = test.firestore.makeDocumentSnapshot({ statut: "en_attente_client", userId: "client1", snackId: "snackA", mode: "collect", clientNom: "Léa", secretCode: "K7Q2" }, "commandes/ORDER9999");
  await wrapped({ data: test.makeChange(waitingAuto, auto), params: { orderId: "ORDER9999" } });
  ok("P10 lancée par l'horloge → « Commande à lancer maintenant »",
    sent.length === 1 && sent[0].notification?.title === "⏱️ Commande à lancer maintenant" && sent[0].tokens.includes(tok("adminA2")),
    JSON.stringify(sent[0]?.notification));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} scénarios push OK`);
  await test.cleanup?.();
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error("💥", e); process.exit(1); });
