// ============================================================================
// 🖼️ MÉDIA — codebase « media » : optimisation d'images (Sharp)
// ----------------------------------------------------------------------------
// Codebase Firebase SÉPARÉ (firebase.json → functions[] : source "functions-media",
// codebase "media"). sharp (~16 Mo de binaires libvips) n'est installé et chargé
// QUE par cette function : les ~50 autres (checkout, webhooks, schedules…) du
// codebase « default » (./functions) n'en portent plus le poids au cold start.
// Aucune dépendance vers ./functions : ce dossier est empaqueté SEUL au déploiement.
//
// Déploiement : `firebase deploy --only functions` (tous les codebases) ou
// `firebase deploy --only functions:media`. Cf. docs/FUNCTIONS-CODEBASES.md.
// Règle d'or inchangée : ne jamais renommer `optimizeImage` (renommer = delete+create).
// ============================================================================

const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const path = require("path");
const os = require("os");
const fs = require("fs");
const sharp = require("sharp");

admin.initializeApp();
// Mêmes options globales que functions/lib/admin.js : la function garde sa région
// (europe-west9) et son plafond → le déploiement la met à jour EN PLACE.
setGlobalOptions({ region: "europe-west9", maxInstances: 10 });

exports.optimizeImage = onObjectFinalized(
  { memory: "512MiB" },
  async (event) => {
    const fileBucket = event.data.bucket;
    const filePath = event.data.name;
    const contentType = event.data.contentType;

    if (
      !contentType.startsWith("image/") ||
      !filePath.startsWith("produits/")
    ) {
      return logger.log("Fichier ignoré (Pas une image de produit).");
    }

    if (event.data.metadata && event.data.metadata.optimized === "true") {
      return logger.log("Image déjà optimisée.");
    }

    const bucket = getStorage().bucket(fileBucket);
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(os.tmpdir(), fileName);
    const tempOptimizedPath = path.join(os.tmpdir(), `opt_${fileName}`);

    try {
      logger.log(`Téléchargement de ${filePath} pour optimisation...`);
      await bucket.file(filePath).download({ destination: tempFilePath });

      logger.log("Compression en cours avec Sharp...");
      await sharp(tempFilePath)
        .resize(800, 800, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toFile(tempOptimizedPath);

      // ⚠️ On préserve le token de téléchargement existant. Le client appelle
      // getDownloadURL() (qui pose firebaseStorageDownloadTokens) puis stocke l'URL
      // dans Firestore. Réécrire l'objet sans reporter ce token l'invaliderait
      // → l'URL en base renverrait 403 (image cassée). On le lit juste avant l'upload
      // pour laisser le temps au getDownloadURL client de l'avoir posé.
      let downloadToken;
      try {
        const [existingMeta] = await bucket.file(filePath).getMetadata();
        downloadToken = existingMeta?.metadata?.firebaseStorageDownloadTokens;
      } catch (e) {
        logger.warn("Lecture du token existant impossible (conservation ignorée) :", e);
      }

      logger.log("Upload de l'image optimisée...");
      await bucket.upload(tempOptimizedPath, {
        destination: filePath,
        metadata: {
          contentType: "image/webp",
          metadata: {
            optimized: "true",
            ...(downloadToken ? { firebaseStorageDownloadTokens: downloadToken } : {}),
          },
        },
      });

      fs.unlinkSync(tempFilePath);
      fs.unlinkSync(tempOptimizedPath);

      return logger.log(`✅ Succès ! L'image ${fileName} a été compressée.`);
    } catch (error) {
      logger.error("❌ Erreur lors de l'optimisation :", error);
      return null;
    }
  },
);
