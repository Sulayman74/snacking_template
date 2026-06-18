// ============================================================================
// 🖼️ MÉDIA — optimisation d'images (Sharp)
// ============================================================================

const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const path = require("path");
const os = require("os");
const fs = require("fs");
const sharp = require("sharp");

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
