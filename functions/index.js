const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { getStorage } = require("firebase-admin/storage");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {RecaptchaEnterpriseServiceClient} = require('@google-cloud/recaptcha-enterprise');
const logger = require("firebase-functions/logger");
const { onCall,HttpsError} = require("firebase-functions/v2/https");
const path = require("path");
const os = require("os");
const fs = require("fs");
const sharp = require("sharp");
const admin = require("firebase-admin");

// Initialisation de Firebase Admin
admin.initializeApp();

// 🚨 CORRECTION 1 : On branche la base de données !
const db = admin.firestore();

// Force toutes les fonctions à être hébergées à Paris (europe-west9)
setGlobalOptions({ region: "europe-west9" });

// ============================================================================
// 🎁 FONCTION 1 : CADEAU DE FIDÉLITÉ (10 POINTS)
// ============================================================================
exports.notifierMenuOffert = onDocumentUpdated("users/{userId}", async (event) => {
    const dataBefore = event.data.before.data();
    const dataAfter = event.data.after.data();
    const userId = event.params.userId;

    console.log(`🔍 Analyse du changement pour l'utilisateur : ${userId}`);

    if (dataAfter.points >= 10 && dataBefore.points < 10) {
        const token = dataAfter.fcmToken;

        if (!token) {
            console.log("⚠️ Abandon : Le client n'a pas de token FCM enregistré.");
            return;
        }

        const message = {
            notification: {
                title: "🎁 CADEAU : Menu Offert !",
                body: "Félicitations ! Tu as atteint 10 points. Ton prochain menu est gratuit chez nous !",
            },
            data: {
                type: "REWARD_UNLOCKED",
                points: "10"
            },
            token: token
        };

        try {
            const response = await getMessaging().send(message);
            console.log("✅ Notification envoyée avec succès :", response);
        } catch (error) {
            console.error("❌ Erreur lors de l'envoi FCM :", error);
        }
    } else {
        console.log("ℹ️ Changement ignoré (pas le palier des 10 points).");
    }
});

// ============================================================================
// 🖼️ FONCTION 2 : OPTIMISATION D'IMAGES (SHARP)
// ============================================================================
exports.optimizeImage = onObjectFinalized({ memory: "512MiB" }, async (event) => {
    const fileBucket = event.data.bucket;
    const filePath = event.data.name;
    const contentType = event.data.contentType;

    if (!contentType.startsWith("image/") || !filePath.startsWith("produits/")) {
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
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({ quality: 80 }) 
            .toFile(tempOptimizedPath);

        logger.log("Upload de l'image optimisée...");
        await bucket.upload(tempOptimizedPath, {
            destination: filePath,
            metadata: {
                contentType: "image/webp",
                metadata: { optimized: "true" }
            }
        });

        fs.unlinkSync(tempFilePath);
        fs.unlinkSync(tempOptimizedPath);
        
        return logger.log(`✅ Succès ! L'image ${fileName} a été compressée.`);

    } catch (error) {
        logger.error("❌ Erreur lors de l'optimisation :", error);
        return null;
    }
});

// ============================================================================
// 🛠️ OUTIL : DÉCOUPEUR DE TABLEAUX (POUR LES BATCHS PUSH)
// ============================================================================
function chunkArray(array, size) {
    const chunked = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
}

// ============================================================================
// 🚀 FONCTION 3 : LE ROBOT MARKETING PUSH (CRON JOB)
// ============================================================================
exports.processPushCampaigns = onSchedule({schedule:"every 5 minutes",region: "europe-west1"}, async (event) => {
    const now = admin.firestore.Timestamp.now();
    
    const thirtyDaysAgoDate = new Date();
    thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
    const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(thirtyDaysAgoDate);

    try {
        const snapshot = await db.collection("campagnes_push")
            .where("statut", "==", "en_attente")
            .where("dateEnvoiPrevue", "<=", now)
            .get();

        if (snapshot.empty) return null;

        for (const doc of snapshot.docs) {
            const campagne = doc.data();
            
            const usersSnapshot = await db.collection("users")
                .where("snackId", "==", campagne.snackId)
                .where("fcmToken", "!=", null) 
                .get();

            const tokens = [];

            usersSnapshot.forEach(userDoc => {
                const user = userDoc.data();
                const lastOrder = user.lastOrderDate; 

                if (campagne.cible === "active") {
                    if (lastOrder && lastOrder.toMillis() >= thirtyDaysAgo.toMillis()) {
                        tokens.push(user.fcmToken);
                    }
                } 
                else if (campagne.cible === "inactive") {
                    if (!lastOrder || lastOrder.toMillis() < thirtyDaysAgo.toMillis()) {
                        tokens.push(user.fcmToken);
                    }
                } 
                else {
                    tokens.push(user.fcmToken);
                }
            });

            if (tokens.length === 0) {
                await doc.ref.update({ 
                    statut: "annulee_sans_cible",
                    dateEnvoiReelle: admin.firestore.FieldValue.serverTimestamp(),
                    notes: "Ciblage n'a retourné aucun client"
                });
                console.log(`⚠️ Campagne ${doc.id} annulée : Aucun utilisateur trouvé pour le ciblage "${campagne.cible}".`);
                continue;
            }

            const tokenChunks = chunkArray(tokens, 500);
            let totalSuccess = 0;
            let totalErrors = 0;

            // 🚨 CORRECTION 2 : L'URL DE BASE ET LE FORMAT PWA (WEBPUSH)
            const baseUrl = "https://snacking-template.web.app/"; 

            const basePayload = {
                notification: {
                    title: campagne.titre,
                    body: campagne.message,
                    ...(campagne.imageUrl && { image: campagne.imageUrl })
                },
                webpush: {
                    fcm_options: {
                        link: campagne.actionUrl ? `${baseUrl}${campagne.actionUrl}` : baseUrl
                    }
                }
            };

            for (let i = 0; i < tokenChunks.length; i++) {
                const payload = { ...basePayload, tokens: tokenChunks[i] };
                
                const response = await admin.messaging().sendEachForMulticast(payload);
                totalSuccess += response.successCount;
                totalErrors += response.failureCount;

                if (i < tokenChunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }

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

// ============================================================================
// 💳 FONCTION 4 : LE TIROIR-CAISSE (STRIPE CHECKOUT)
// ============================================================================


exports.createPaymentIntent = onCall({ region: "europe-west1" }, async (request) => {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    try {
        // 1. 👈 ON RÉCUPÈRE LES NOUVELLES INFOS (description et metadata)
        const { amount, currency, description, metadata } = request.data; 

        // Sécurité de base
        if (!amount || amount < 50) { // Stripe refuse les paiements sous 0.50€
            throw new HttpsError("invalid-argument", "Montant invalide.");
        }

        // 2. On crée l'intention de paiement chez Stripe
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount, // Le montant en CENTIMES (ex: 1500 pour 15.00€)
            currency: currency || "eur",
            
            // 🎯 LES DEUX LIGNES MAGIQUES POUR TON DASHBOARD STRIPE
            description: description || "Commande en ligne",
            metadata: metadata || {}, 
            
            automatic_payment_methods: {
                enabled: true, // Active tout seul Apple Pay, Google Pay, CB...
            },
        });

        // 3. On renvoie le secret au téléphone du client pour qu'il affiche le formulaire
        return { clientSecret: paymentIntent.client_secret };

    } catch (error) {
        console.error("❌ Erreur Stripe PaymentIntent :", error);
        throw new HttpsError("internal", "Impossible d'initialiser le paiement.");
    }
});
// TODO ------------------------------ pour Stripe Connect 
// Aiguillage Multi-tenant (Aperçu de ta future fonction)
// exports.createCheckoutSession = onCall({ region: "europe-west1" }, async (request) => {
//     const { cart, snackId } = request.data; 

//     // 1. 🕵️‍♂️ On va chercher le compte Stripe du Snack dans Firestore
//     const snackDoc = await admin.firestore().collection("snacks").doc(snackId).get();
//     const connectedAccountId = snackDoc.data().stripeAccountId; // ex: "acct_1Hxyz..."

//     // 2. On prépare le ticket (identique à tout à l'heure)
//     const lineItems = cart.map(item => ({ /* ... */ }));

//     // 3. 🪄 LA MAGIE STRIPE CONNECT
//     const session = await stripe.checkout.sessions.create({
//         payment_method_types: ["card", "apple_pay", "google_pay"],
//         mode: "payment",
//         line_items: lineItems,
//         success_url: "https://ton-app.com/?payment=success",
//         cancel_url: "https://ton-app.com/?payment=cancel",
//     }, {
//         stripeAccount: connectedAccountId // 🎯 C'EST ICI QUE TOUT SE JOUE !
//     });

//     return { url: session.url };
// });
// TODO ------------------------------ (Bonus de CTO : En utilisant Stripe Connect, tu pourras même ajouter une ligne application_fee_amount pour prélever automatiquement ta commission de 1€ ou 2% sur chaque commande en passant !)

