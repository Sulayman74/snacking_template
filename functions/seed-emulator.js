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

  console.log(`✅ Seed E2E OK — snack ${SNACK_ID}, user ${TEST_EMAIL} (admin), ${produits.length} produits.`);
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Seed échoué :", e);
    process.exit(1);
  });
