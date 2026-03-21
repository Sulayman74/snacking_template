const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2"); // Ajoute ça
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const path = require("path");
const os = require("os");
const fs = require("fs");
const sharp = require("sharp");

// Force toutes les fonctions à être hébergées à Paris (europe-west9)
setGlobalOptions({ region: "europe-west9" });

initializeApp();

exports.notifierMenuOffert = onDocumentUpdated("users/{userId}", async (event) => {
    // 1. Récupération des données avant/après
    const dataBefore = event.data.before.data();
    const dataAfter = event.data.after.data();
    const userId = event.params.userId;

    console.log(`🔍 Analyse du changement pour l'utilisateur : ${userId}`);

    // 🎯 LA CONDITION ROYALE : On passe de moins de 10 à 10 (ou plus)
    if (dataAfter.points >= 10 && dataBefore.points < 10) {
        
        const token = dataAfter.fcmToken;

        if (!token) {
            console.log("⚠️ Abandon : Le client n'a pas de token FCM enregistré.");
            return;
        }

        // 📝 Préparation du message
        const message = {
            notification: {
                title: "🎁 CADEAU : Menu Offert !",
                body: "Félicitations ! Tu as atteint 10 points. Ton prochain menu est gratuit chez nous !",
            },
            // On ajoute des données pour que l'app sache quoi faire au clic
            data: {
                type: "REWARD_UNLOCKED",
                points: "10"
            },
            token: token
        };

        try {
            // 🚀 Envoi de la notification
            const response = await getMessaging().send(message);
            console.log("✅ Notification envoyée avec succès :", response);
        } catch (error) {
            console.error("❌ Erreur lors de l'envoi FCM :", error);
        }
    } else {
        console.log("ℹ️ Changement ignoré (pas le palier des 10 points).");
    }
});

// On alloue 512Mo de RAM car le traitement d'image est gourmand !
exports.optimizeImage = onObjectFinalized({ memory: "512MiB" }, async (event) => {
    const fileBucket = event.data.bucket;
    const filePath = event.data.name;
    const contentType = event.data.contentType;

    // 1. SÉCURITÉ : On ne traite que les images des "produits"
    if (!contentType.startsWith("image/") || !filePath.startsWith("produits/")) {
        return logger.log("Fichier ignoré (Pas une image de produit).");
    }

    // 2. ANTI-BOUCLE INFINIE : On vérifie les métadonnées
    // Si l'image a déjà été optimisée par cette fonction, on s'arrête !
    if (event.data.metadata && event.data.metadata.optimized === "true") {
        return logger.log("Image déjà optimisée.");
    }

    const bucket = getStorage().bucket(fileBucket);
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(os.tmpdir(), fileName);
    const tempOptimizedPath = path.join(os.tmpdir(), `opt_${fileName}`);

    try {
        // 3. TÉLÉCHARGEMENT de l'image lourde dans la mémoire temporaire du serveur
        logger.log(`Téléchargement de ${filePath} pour optimisation...`);
        await bucket.file(filePath).download({ destination: tempFilePath });

        // 4. LA MAGIE : Redimensionnement (Max 800x800) et Compression (WebP ou JPEG)
        logger.log("Compression en cours avec Sharp...");
        await sharp(tempFilePath)
            .resize(800, 800, {
                fit: 'inside',
                withoutEnlargement: true // On ne grossit pas les petites images
            })
            // Convertit en WebP avec 80% de qualité (Poids divisé par 5 à 10 !)
            .webp({ quality: 80 }) 
            .toFile(tempOptimizedPath);

        // 5. UPLOAD : On écrase l'ancienne image avec la nouvelle !
        logger.log("Upload de l'image optimisée...");
        await bucket.upload(tempOptimizedPath, {
            destination: filePath, // On garde le MÊME nom pour ne pas casser le lien Firebase !
            metadata: {
                contentType: "image/webp", // On précise le nouveau format
                metadata: {
                    optimized: "true" // 🛑 Le fameux drapeau Anti-Boucle Infinie
                }
            }
        });

        // 6. NETTOYAGE : On vide la corbeille du serveur
        fs.unlinkSync(tempFilePath);
        fs.unlinkSync(tempOptimizedPath);
        
        return logger.log(`✅ Succès ! L'image ${fileName} a été compressée.`);

    } catch (error) {
        logger.error("❌ Erreur lors de l'optimisation :", error);
        return null;
    }
});