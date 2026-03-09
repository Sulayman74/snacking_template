const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2"); // Ajoute ça
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

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