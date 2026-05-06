/**
 * ⚙️ ADMIN-CONFIG (Bridge)
 * Ce fichier sert de pont vers AdminStore et AdminConfigUI.
 */
import { adminStore } from "./core/AdminStore.js";
import { showToast } from "./utils.js";

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
            hours: data.hours || []
        };

        adminStore.setConfig(configData);

    } catch (error) {
        console.error("Erreur chargement config:", error);
        showToast("Erreur lors du chargement des réglages.", "error");
    }
};