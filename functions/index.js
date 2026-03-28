const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2"); // Ajoute ça
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { getStorage } = require("firebase-admin/storage");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const path = require("path");
const os = require("os");
const fs = require("fs");
const sharp = require("sharp");
const admin = require("firebase-admin");
admin.initializeApp();

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

// 🛠️ Fonction utilitaire pour découper un tableau en paquets (Chunks)
function chunkArray(array, size) {
    const chunked = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
}


// 🤖 Ce robot se réveille toutes les 5 minutes
exports.processPushCampaigns = onSchedule("every 5 minutes", async (event) => {
    const now = admin.firestore.Timestamp.now();
    
    // 🗓️ Calcul de la date d'il y a 30 jours (pour filtrer les inactifs)
    const thirtyDaysAgoDate = new Date();
    thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
    const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(thirtyDaysAgoDate);

    try {
        // 1. On cherche les campagnes à envoyer MAINTENANT
        const snapshot = await db.collection("campagnes_push")
            .where("statut", "==", "en_attente")
            .where("dateEnvoiPrevue", "<=", now)
            .get();

        if (snapshot.empty) return null;

        for (const doc of snapshot.docs) {
            const campagne = doc.data();
            
            // 2. On récupère TOUS les utilisateurs du snack ayant accepté les notifs
            const usersSnapshot = await db.collection("users")
                .where("snackId", "==", campagne.snackId)
                .where("fcmToken", "!=", null) 
                .get();

            const tokens = [];

            // 🎯 3. LE FILTRAGE INTELLIGENT (Ciblage)
            usersSnapshot.forEach(userDoc => {
                const user = userDoc.data();
                const lastOrder = user.lastOrderDate; // Peut être null s'il n'a jamais commandé

                if (campagne.cible === "active") {
                    // 🔥 Clients Récents : Ont commandé il y a moins de 30 jours
                    if (lastOrder && lastOrder.toMillis() >= thirtyDaysAgo.toMillis()) {
                        tokens.push(user.fcmToken);
                    }
                } 
                else if (campagne.cible === "inactive") {
                    // 😴 Clients Inactifs : N'ont pas commandé depuis plus de 30 jours (ou jamais)
                    if (!lastOrder || lastOrder.toMillis() < thirtyDaysAgo.toMillis()) {
                        tokens.push(user.fcmToken);
                    }
                } 
                else {
                    // 🌍 Tous les clients (par défaut)
                    tokens.push(user.fcmToken);
                }
            });

            // Si le ciblage a éliminé tout le monde (ex: aucun client inactif)
            if (tokens.length === 0) {
                await doc.ref.update({ 
                    statut: "annulee_sans_cible",
                    dateEnvoiReelle: admin.firestore.FieldValue.serverTimestamp(),
                    notes: "Ciblage n'a retourné aucun client"
                });
                console.log(`⚠️ Campagne ${doc.id} annulée : Aucun utilisateur ne correspond au ciblage "${campagne.cible}".`);
                continue;
            }

            // 📦 4. STRATÉGIE DE CHUNKS : On coupe en paquets de 500 (Limite stricte Google FCM)
            const tokenChunks = chunkArray(tokens, 500);
            let totalSuccess = 0;
            let totalErrors = 0;

            // 🎨 5. CRÉATION DU MESSAGE (Avec gestion des images Optionnelles)
            const basePayload = {
                notification: {
                    title: campagne.titre,
                    body: campagne.message,
                    // Si l'Architecte DB a mis une image, on l'ajoute pour faire une "Rich Notification" !
                    ...(campagne.imageUrl && { image: campagne.imageUrl })
                },
                data: {
                    // Pour rediriger le client au clic (ex: ?action=menu)
                    ...(campagne.actionUrl && { click_action: campagne.actionUrl })
                }
            };

            // 🎢 6. ENVOI BATCH PAR BATCH
            for (let i = 0; i < tokenChunks.length; i++) {
                const payload = { ...basePayload, tokens: tokenChunks[i] };
                
                // On tire la salve de 500
                const response = await admin.messaging().sendEachForMulticast(payload);
                totalSuccess += response.successCount;
                totalErrors += response.failureCount;

                // 🚦 LE JITTER (Lissage de charge pour éviter d'assassiner ton Firestore si les clients ouvrent l'app en même temps)
                if (i < tokenChunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }

            // ✅ 7. Mise à jour finale de la campagne
            await doc.ref.update({
                statut: "envoyee",
                dateEnvoiReelle: admin.firestore.FieldValue.serverTimestamp(),
                stats: { envoye: totalSuccess, erreurs: totalErrors }
            });

            console.log(`✅ Campagne ${doc.id} terminée (${campagne.cible}). Succès: ${totalSuccess} | Erreurs: ${totalErrors}`);
        }
    } catch (error) {
        console.error("❌ Erreur critique Push :", error);
    }
});

// Petite fonction utilitaire pour couper le tableau en morceaux de 500 (à laisser en dehors de la fonction)
function chunkArray(array, size) {
    const chunked = [];
    let index = 0;
    while (index < array.length) {
        chunked.push(array.slice(index, size + index));
        index += size;
    }
    return chunked;
}
