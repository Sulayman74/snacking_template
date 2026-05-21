/**
 * ⚙️ ADMIN-CONFIG (Bridge)
 * Ce fichier sert de pont vers AdminStore et AdminConfigUI.
 */
import { adminStore } from "./core/AdminStore.js";
import { showToast } from "./utils.js";

// Coerce une valeur Firestore en nombre fini, sinon le fallback (ex: null).
const num = (v, fallback) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
};

window.loadConfigView = async () => {
    if (!window.currentAdminSnackId) return;
    
    const { doc, getDoc } = window.fs;
    try {
        const snackRef = doc(window.db, "snacks", window.currentAdminSnackId);
        const snackSnap = await getDoc(snackRef);

        if (!snackSnap.exists()) return;
        const data = snackSnap.data();

        // On normalise les données pour le Store
        const configData = {
            identity: {
                id: window.currentAdminSnackId,
                name: data.name || "Snack",
                description: data.description || ""
            },
            promoPhrase: data.promoPhrase || "",
            hours: data.hours || [],
            contact: {
                phone: data.phoneNumber || "",
                email: data.email || "",
                address: {
                    street: data.street || "",
                    zip: data.zipcode || "",
                    city: data.city || "",
                    googleMapsUrl: data.googleMapsUrl || "",
                },
                socials: {
                    instagram: data.instagram || "",
                    facebook: data.facebook || "",
                    tiktok: data.tiktok || "",
                },
            },
            reviews: {
                googleReviewUrl: data.googleReviewUrl || "",
            },
            // 🚚 Livraison : flag + réglages + position resto (défauts sûrs).
            features: {
                enableDelivery: data.enableDelivery === true,
            },
            delivery: {
                radiusKm: num(data.delivery?.radiusKm, 5),
                frais: num(data.delivery?.frais, 2.5),
                minOrder: num(data.delivery?.minOrder, 0),
                avgSpeedKmh: num(data.delivery?.avgSpeedKmh, 22),
                prepBaseMin: num(data.delivery?.prepBaseMin, 12),
                queueFactorMin: num(data.delivery?.queueFactorMin, 3),
            },
            geo: {
                lat: num(data.restaurantLat, null),
                lng: num(data.restaurantLng, null),
            },
        };

        adminStore.setConfig(configData);

    } catch (error) {
        console.error("Erreur chargement config:", error);
        showToast("Erreur lors du chargement des réglages.", "error");
    }
};