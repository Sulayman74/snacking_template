#!/usr/bin/env node
/**
 * 🛠️ Migration : ajoute les champs manquants aux snacks existants.
 *
 * Champs backfillés (avec leur valeur par défaut, mappés ci-dessous) :
 *   - email            : ""    (string vide, à remplir par le resto)
 *   - googleMapsUrl    : ""    (string vide)
 *   - googleReviewUrl  : ""    (string vide)
 *   - enableUpsell     : false (feature flag — OFF par défaut, comme tous les flags)
 *
 * Idempotent : ne touche QUE les snacks où le champ est `undefined`.
 * Un champ déjà rempli (même falsy : "", false, 0) est laissé tel quel.
 *
 * Pour ajouter un champ : ajoute juste une entrée à FIELDS_DEFAULTS.
 * Le script gère automatiquement string/boolean/number/null.
 *
 * Usage (depuis la racine du repo) :
 *   npm run migrate:snack-fields            # dry-run (par défaut, lit seul)
 *   npm run migrate:snack-fields:apply      # écrit en base
 *
 * Auth (une seule fois sur ta machine) :
 *   gcloud auth application-default login
 *   gcloud config set project snacking-template
 *
 * Override projet : --project=<id>
 */

const admin = require("firebase-admin");

const FIELDS_DEFAULTS = {
  email: "",
  googleMapsUrl: "",
  googleReviewUrl: "",
  enableUpsell: false,
};
const FIELDS_TO_BACKFILL = Object.keys(FIELDS_DEFAULTS);
const BATCH_SIZE = 400;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const projectArg = args.find((a) => a.startsWith("--project="));
const PROJECT_ID = projectArg ? projectArg.split("=")[1] : "snacking-template";

async function main() {
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  console.log(`\n🚀 Migration snacks — projet=${PROJECT_ID} mode=${APPLY ? "APPLY ✍️" : "DRY-RUN 👀"}\n`);

  const snapshot = await db.collection("snacks").get();
  if (snapshot.empty) {
    console.log("Aucun snack trouvé.");
    return;
  }

  const stats = { total: 0, alreadyOk: 0, toUpdate: 0 };
  let batch = db.batch();
  let pendingWrites = 0;

  for (const doc of snapshot.docs) {
    stats.total++;
    const data = doc.data();
    const missing = FIELDS_TO_BACKFILL.filter((f) => data[f] === undefined);

    if (missing.length === 0) {
      stats.alreadyOk++;
      console.log(`  ✓ ${doc.id} (${data.nom || "?"}) — déjà à jour`);
      continue;
    }

    stats.toUpdate++;
    const update = Object.fromEntries(missing.map((f) => [f, FIELDS_DEFAULTS[f]]));
    const human = missing.map((f) => `${f}=${JSON.stringify(FIELDS_DEFAULTS[f])}`).join(", ");
    console.log(`  + ${doc.id} (${data.nom || "?"}) — ajoute : ${human}`);

    if (APPLY) {
      batch.update(doc.ref, update);
      pendingWrites++;
      if (pendingWrites >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        pendingWrites = 0;
      }
    }
  }

  if (APPLY && pendingWrites > 0) await batch.commit();

  console.log(`\n📊 Récap`);
  console.log(`   Total snacks   : ${stats.total}`);
  console.log(`   Déjà à jour    : ${stats.alreadyOk}`);
  console.log(`   ${APPLY ? "Mis à jour     " : "À mettre à jour"} : ${stats.toUpdate}`);
  if (!APPLY && stats.toUpdate > 0) {
    console.log(`\n💡 Relance avec --apply (ou \`npm run migrate:snack-fields:apply\`) pour écrire en base.\n`);
  } else {
    console.log();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Erreur:", err.message);
    if (err.code === 16 || /credentials/i.test(err.message)) {
      console.error("\n💡 Auth manquante. Lance :");
      console.error("   gcloud auth application-default login");
      console.error(`   gcloud config set project ${PROJECT_ID}\n`);
    }
    process.exit(1);
  });
