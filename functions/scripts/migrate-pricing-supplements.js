#!/usr/bin/env node
/**
 * 🛠️ Migration & Seed : Initialise les nouveaux champs Firestore et ajoute les suppléments burgers standards.
 *
 * 1. Snacks :
 *    - pricingPlan        : "starter" (si absent)
 *    - prixAbonnement     : 29 (si absent)
 *    - trialPeriodMonths  : 1 (si absent)
 *    - servicePausedUntil : null (si absent)
 *
 * 2. Produits :
 *    - allowSupplements   : true (si absent sur burgers/tacos/pizzas)
 *
 * 3. Suppléments Burgers (catégorie "supplements") :
 *    - Cheddar Affiné (1.00 €)
 *    - Steak Haché Bouchère (2.00 €)
 *    - Bacon Croustillant (1.50 €)
 *    - Sauce Fromagère Maison (1.00 €)
 *    - Œuf au Plat (1.00 €)
 *    - Oignons Caramélisés (0.80 €)
 *
 * Usage (depuis la racine) :
 *   node functions/scripts/migrate-pricing-supplements.js          # Dry-run (affiche les actions sans écrire)
 *   node functions/scripts/migrate-pricing-supplements.js --apply  # Applique les modifications en base
 *
 * Override projet : --project=<id> (défaut: snacking-template)
 */

const admin = require("firebase-admin");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const projectArg = args.find((a) => a.startsWith("--project="));
const PROJECT_ID = projectArg ? projectArg.split("=")[1] : (process.env.GCLOUD_PROJECT || "snacking-template");

const STANDARD_SUPPLEMENTS = [
  {
    nom: "Cheddar Affiné",
    description: "Tranche fondue de cheddar affiné",
    prix: 1.0,
    categorieId: "supplements",
    isAvailable: true,
    tvaRate: 10,
    allowMenu: false,
    allowSupplements: false,
    menuPriceAdd: 0,
  },
  {
    nom: "Steak Haché Bouchère",
    description: "Steak haché pur bœuf supplémentaire",
    prix: 2.0,
    categorieId: "supplements",
    isAvailable: true,
    tvaRate: 10,
    allowMenu: false,
    allowSupplements: false,
    menuPriceAdd: 0,
  },
  {
    nom: "Bacon Croustillant",
    description: "Tranches de bacon grillé et croustillant",
    prix: 1.5,
    categorieId: "supplements",
    isAvailable: true,
    tvaRate: 10,
    allowMenu: false,
    allowSupplements: false,
    menuPriceAdd: 0,
  },
  {
    nom: "Sauce Fromagère Maison",
    description: "Onctueuse sauce fromagère préparée sur place",
    prix: 1.0,
    categorieId: "supplements",
    isAvailable: true,
    tvaRate: 10,
    allowMenu: false,
    allowSupplements: false,
    menuPriceAdd: 0,
  },
  {
    nom: "Œuf au Plat",
    description: "Œuf frais cuit sur plancha",
    prix: 1.0,
    categorieId: "supplements",
    isAvailable: true,
    tvaRate: 10,
    allowMenu: false,
    allowSupplements: false,
    menuPriceAdd: 0,
  },
  {
    nom: "Oignons Caramélisés",
    description: "Oignons doux mijotés et confits",
    prix: 0.8,
    categorieId: "supplements",
    isAvailable: true,
    tvaRate: 10,
    allowMenu: false,
    allowSupplements: false,
    menuPriceAdd: 0,
  },
];

async function main() {
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const db = admin.firestore();

  console.log(`\n======================================================`);
  console.log(`🚀 Migration & Seed Firestore — Projet : ${PROJECT_ID}`);
  console.log(`Mode : ${APPLY ? "✍️  APPLICATION RÉELLE (--apply)" : "👀 DRY-RUN (aperçu seul)"}`);
  console.log(`======================================================\n`);

  // --- 1. MIGRATION DES SNACKS ---
  console.log(`📦 [1/3] Vérification des Snacks...`);
  const snacksSnap = await db.collection("snacks").get();
  if (snacksSnap.empty) {
    console.log("  ⚠️  Aucun snack trouvé.");
  } else {
    for (const snackDoc of snacksSnap.docs) {
      const data = snackDoc.data();
      const updates = {};

      if (data.pricingPlan === undefined) updates.pricingPlan = "starter";
      if (data.prixAbonnement === undefined) updates.prixAbonnement = 29;
      if (data.trialPeriodMonths === undefined) updates.trialPeriodMonths = 1;
      if (data.servicePausedUntil === undefined) updates.servicePausedUntil = null;

      if (Object.keys(updates).length > 0) {
        console.log(`  + Snack ${snackDoc.id} (${data.nom || data.identity?.name || "Sans nom"}) : ajout de ${JSON.stringify(updates)}`);
        if (APPLY) {
          await snackDoc.ref.set(updates, { merge: true });
        }
      } else {
        console.log(`  ✓ Snack ${snackDoc.id} : déjà à jour (plan=${data.pricingPlan}, essai=${data.trialPeriodMonths}m)`);
      }
    }
  }

  // --- 2. MIGRATION DES PRODUITS (allowSupplements) ---
  console.log(`\n🍔 [2/3] Vérification des Produits existants (allowSupplements)...`);
  const produitsSnap = await db.collection("produits").get();
  let prodUpdatesCount = 0;

  for (const prodDoc of produitsSnap.docs) {
    const data = prodDoc.data();
    if (data.categorieId !== "supplements" && data.categorieId !== "extras" && data.allowSupplements === undefined) {
      prodUpdatesCount++;
      console.log(`  + Produit ${prodDoc.id} (${data.nom || "?"}) : allowSupplements = true`);
      if (APPLY) {
        await prodDoc.ref.set({ allowSupplements: true }, { merge: true });
      }
    }
  }
  if (prodUpdatesCount === 0) {
    console.log(`  ✓ Tous les produits existants ont déjà allowSupplements renseigné.`);
  }

  // --- 3. SEED DES SUPPLÉMENTS STANDARDS (Cheddar, Steak, Bacon...) ---
  console.log(`\n🧀 [3/3] Injection des Suppléments Burgers standards...`);
  const existingNames = new Set(
    produitsSnap.docs.map((d) => (d.data().nom || "").toLowerCase().trim())
  );

  // Détermination du snackId cible (premier snack ou par défaut)
  const defaultSnackId = !snacksSnap.empty ? snacksSnap.docs[0].id : "Ym1YiO4Ue5Fb5UXlxr06";

  for (const supp of STANDARD_SUPPLEMENTS) {
    const alreadyExists = existingNames.has(supp.nom.toLowerCase().trim());
    if (!alreadyExists) {
      console.log(`  + Création du supplément : "${supp.nom}" (${supp.prix.toFixed(2)} €)`);
      if (APPLY) {
        const newRef = db.collection("produits").doc();
        await newRef.set({
          ...supp,
          snackId: defaultSnackId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } else {
      console.log(`  ✓ Supplément "${supp.nom}" déjà présent en base.`);
    }
  }

  console.log(`\n======================================================`);
  if (!APPLY) {
    console.log(`💡 Pour exécuter ces changements sur Firestore, relancez avec :`);
    console.log(`   npm run migrate:pricing-supplements:apply`);
  } else {
    console.log(`✅ Migration et Seed terminés avec succès sur Firestore !`);
  }
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error("❌ Erreur de migration :", err);
  process.exit(1);
});
