/**
 * 🌱 SEED des ÉMULATEURS Firebase pour les tests E2E (Playwright).
 *
 * À lancer DANS `firebase emulators:exec` : les hôtes émulateurs
 * (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST) sont alors injectés
 * automatiquement, et firebase-admin s'y connecte tout seul. Refuse de tourner
 * si aucun émulateur n'est détecté (garde-fou anti-écriture en prod).
 *
 * Idempotent : ré-exécutable sans dupliquer (createUser tolère l'existant,
 * les docs sont écrits en merge / id déterministe).
 */
const admin = require("firebase-admin");
const { Timestamp } = require("firebase-admin/firestore");

const SNACK_ID = process.env.SNACK_ID || "Ym1YiO4Ue5Fb5UXlxr06"; // = snack par défaut du dev server
const TEST_EMAIL = "robot@test.com";
const TEST_PASSWORD = "123456";
const DRIVER_EMAIL = "livreur@test.com";

// 🛡️ Garde-fou : on n'écrit JAMAIS ailleurs que dans un émulateur.
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    "⛔ Seed refusé : émulateurs non détectés. Lance via `firebase emulators:exec \"node functions/seed-emulator.js\"`."
  );
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "snacking-template" });
const db = admin.firestore();
const auth = admin.auth();

async function seed() {
  // 1) Utilisateur de test — sert à la fois de CLIENT et d'ADMIN dans les specs.
  let uid;
  try {
    uid = (await auth.createUser({ email: TEST_EMAIL, password: TEST_PASSWORD, emailVerified: true })).uid;
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      uid = (await auth.getUserByEmail(TEST_EMAIL)).uid;
    } else {
      throw e;
    }
  }

  // 2) Snack (config SaaS minimale pour que le menu client se charge).
  await db.collection("snacks").doc(SNACK_ID).set(
    {
      nom: "Snack Robot (E2E)",
      colorPalette: "belly",
      enableOnlineOrder: true,
      enableClickAndCollect: true,
      enableDelivery: false,
      enableLoyaltyCard: true,
      maintenanceMode: false,
      enableGuestCheckout: true,
      hours: [],
    },
    { merge: true }
  );

  // 3) Doc user = admin du snack (rôle vérifié au login admin).
  await db.collection("users").doc(uid).set(
    { email: TEST_EMAIL, nom: "Robot Test", role: "admin", snackId: SNACK_ID, pointsBySnack: {} },
    { merge: true }
  );

  // 4) Produits : au moins un disponible + option "menu" (coché par cart.spec).
  //    ⚠️ Une BOISSON (catégorie "drinks") est indispensable : un menu exige une
  //    boisson (product-modal : formule "menu" + !boisson → ajout bloqué). La 1ʳᵉ
  //    boisson est cochée par défaut → l'ajout du menu (cart/commande.spec) aboutit.
  const produits = [
    { nom: "Burger Robot", description: "Test E2E", prix: 9.5, menuPriceAdd: 2.5, categorieId: "burgers", isAvailable: true, allowMenu: true, snackId: SNACK_ID },
    { nom: "Frites Test", description: "Test E2E", prix: 3.5, menuPriceAdd: 2.5, categorieId: "frites", isAvailable: true, allowMenu: true, snackId: SNACK_ID },
    { nom: "Boisson Robot", description: "Test E2E", prix: 2, menuPriceAdd: 0, categorieId: "drinks", isAvailable: true, allowMenu: false, snackId: SNACK_ID },
  ];
  const batch = db.batch();
  produits.forEach((p, i) => batch.set(db.collection("produits").doc(`e2e_${i}`), p));
  await batch.commit();

  // 5) Commande passée du user de test : alimente le bloc « Commander à nouveau »
  //    (reorder.spec). Contient une ligne valide (Frites : 3.5 + 2.5 menu = 6) et
  //    une ligne dont le produit n'existe plus → doit être exclue à la re-commande.
  //    ⚠️ On référence e2e_1 (Frites Test) et PAS e2e_0 : stock.spec désactive le
  //    PREMIER produit « En Stock » de la liste admin (triée par nom → Burger
  //    Robot), et les specs tournent en parallèle sur le même émulateur.
  await db.collection("commandes").doc("e2e_order_1").set({
    snackId: SNACK_ID,
    userId: uid,
    clientNom: "Robot Test",
    clientEmail: TEST_EMAIL,
    secretCode: "E2E001",
    date: Timestamp.fromDate(new Date("2026-01-01T12:00:00Z")),
    statut: "en_attente_client",
    items: [
      { id: "e2e_1-menu--", productId: "e2e_1", nom: "Menu Frites Test", prix: 6, image: "", formule: "menu", boisson: "Coca", taille: null, sauces: [], quantity: 2 },
      { id: "e2e_ghost-seul--", productId: "e2e_ghost", nom: "Produit Disparu", prix: 4, image: "", formule: "seul", boisson: null, taille: null, sauces: [], quantity: 1 },
    ],
    total: 16,
    mode: "collect",
    paiement: { methode: "carte_bancaire", statut: "paye", stripeSessionId: "pi_e2e_seed" },
  });

  // 5) Livreur + course EN COURS (livreur.spec : photo de preuve hors-ligne).
  let driverUid;
  try {
    driverUid = (await auth.createUser({ email: DRIVER_EMAIL, password: TEST_PASSWORD, emailVerified: true })).uid;
  } catch (e) {
    if (e.code !== "auth/email-already-exists") throw e;
    driverUid = (await auth.getUserByEmail(DRIVER_EMAIL)).uid;
  }
  await db.collection("users").doc(driverUid).set(
    { email: DRIVER_EMAIL, nom: "Livreur Test", role: "livreur", snackId: SNACK_ID, actif: true, pointsBySnack: {} },
    { merge: true }
  );
  // Client DISTINCT du robot : sinon cette course devient sa « dernière commande »
  // (reorder.spec).
  await db.collection("commandes").doc("e2e_delivery_1").set({
    snackId: SNACK_ID,
    userId: "e2e_delivery_client",
    clientNom: "Client Livraison",
    clientEmail: "client.livraison@test.com",
    secretCode: "E2E002",
    date: Timestamp.fromDate(new Date("2026-01-01T12:30:00Z")),
    statut: "en_livraison",
    mode: "delivery",
    livreurId: driverUid,
    livreur: { nom: "Livreur Test", position: null, lastNotifiedBucket: null },
    livraison: { adresse: "1 rue du Test", lat: 45.9, lng: 6.35, frais: 3 },
    items: [{ id: "e2e_1-seul--", productId: "e2e_1", nom: "Frites Test", prix: 3.5, image: "", formule: "seul", boisson: null, taille: null, sauces: [], quantity: 1 }],
    total: 6.5,
    paiement: { methode: "carte_bancaire", statut: "paye", stripeSessionId: "pi_e2e_delivery" },
  });

  console.log(`✅ Seed E2E OK — snack ${SNACK_ID}, user ${TEST_EMAIL} (admin), livreur ${DRIVER_EMAIL}, ${produits.length} produits, 2 commandes.`);
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Seed échoué :", e);
    process.exit(1);
  });
