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

const SNACK_ID = process.env.SNACK_ID || "Ym1YiO4Ue5Fb5UXlxr06"; // = snack par défaut du dev server
const TEST_EMAIL = "robot@test.com";
const TEST_PASSWORD = "123456";

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
  const produits = [
    { nom: "Burger Robot", description: "Test E2E", prix: 9.5, menuPriceAdd: 2.5, categorieId: "burgers", isAvailable: true, allowMenu: true, snackId: SNACK_ID },
    { nom: "Frites Test", description: "Test E2E", prix: 3.5, menuPriceAdd: 2.5, categorieId: "frites", isAvailable: true, allowMenu: true, snackId: SNACK_ID },
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
    date: admin.firestore.Timestamp.fromDate(new Date("2026-01-01T12:00:00Z")),
    statut: "livree",
    items: [
      { id: "e2e_1-menu--", productId: "e2e_1", nom: "Menu Frites Test", prix: 6, image: "", formule: "menu", boisson: "Coca", taille: null, sauces: [], quantity: 2 },
      { id: "e2e_ghost-seul--", productId: "e2e_ghost", nom: "Produit Disparu", prix: 4, image: "", formule: "seul", boisson: null, taille: null, sauces: [], quantity: 1 },
    ],
    total: 16,
    mode: "collect",
    paiement: { methode: "carte_bancaire", statut: "paye", stripeSessionId: "pi_e2e_seed" },
  });

  console.log(`✅ Seed E2E OK — snack ${SNACK_ID}, user ${TEST_EMAIL} (admin), ${produits.length} produits, 1 commande.`);
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Seed échoué :", e);
    process.exit(1);
  });
