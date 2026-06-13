#!/usr/bin/env node
/**
 * 🧾 Migration : backfill `tvaRate` sur les produits existants (LOT A).
 *
 * Pose `tvaRate: 10` (défaut restauration) sur tout produit qui n'en a PAS.
 * Idempotent : ne touche QUE les produits où `tvaRate === undefined`. Un produit
 * déjà taxé (même à 10) est laissé tel quel → ⚠️ NE force JAMAIS 10 sur un produit
 * qui aurait été passé à 20 (alcool) entre-temps.
 *
 * ⚠️ Le défaut 10 est un point de départ : les restaurateurs DOIVENT passer leurs
 * boissons alcoolisées à 20 % (sinon risque fiscal — le fisc applique 20 % partout
 * faute de ventilation). Ce backfill évite juste les produits sans taux du tout.
 *
 * Usage (depuis la racine) :
 *   npm run migrate:product-tva           # dry-run (lit seul)
 *   npm run migrate:product-tva:apply     # écrit en base
 *
 * Auth : gcloud auth application-default login ; gcloud config set project snacking-template
 * Override projet : --project=<id>
 */

const admin = require("firebase-admin");

const DEFAULT_TVA = 10;
const BATCH_SIZE = 400;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const projectArg = args.find((a) => a.startsWith("--project="));
const PROJECT_ID = projectArg ? projectArg.split("=")[1] : "snacking-template";

async function main() {
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  console.log(`\n🚀 Migration produits.tvaRate — projet=${PROJECT_ID} mode=${APPLY ? "APPLY ✍️" : "DRY-RUN 👀"}\n`);

  const snapshot = await db.collection("produits").get();
  if (snapshot.empty) {
    console.log("Aucun produit trouvé.");
    return;
  }

  const stats = { total: 0, alreadyOk: 0, toUpdate: 0 };
  let batch = db.batch();
  let pendingWrites = 0;

  for (const doc of snapshot.docs) {
    stats.total++;
    const data = doc.data();

    if (data.tvaRate !== undefined) {
      stats.alreadyOk++;
      continue;
    }

    stats.toUpdate++;
    console.log(`  + ${doc.id} (${data.nom || "?"}) — ajoute tvaRate=${DEFAULT_TVA}`);

    if (APPLY) {
      batch.update(doc.ref, { tvaRate: DEFAULT_TVA });
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
  console.log(`   Total produits : ${stats.total}`);
  console.log(`   Déjà à jour    : ${stats.alreadyOk}`);
  console.log(`   ${APPLY ? "Mis à jour     " : "À mettre à jour"} : ${stats.toUpdate}`);
  if (!APPLY && stats.toUpdate > 0) {
    console.log(`\n💡 Relance avec --apply pour écrire en base.\n`);
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
