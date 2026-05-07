// ============================================================================
// 🐛 LOGGER CENTRALISÉ (MYSAAS HQ)
// ============================================================================
// Envoie discrètement les erreurs critiques ou événements importants 
// vers Firestore pour le monitoring SuperAdmin.

export async function logError(action, message, details = {}) {
    try {
        if (!window.fs || !window.db) return; // Firestore pas encore prêt
        
        const { collection, addDoc, serverTimestamp } = window.fs;
        const snackId = window.snackConfig?.identity?.id || window.currentAdminSnackId || "inconnu";
        const userId = window.auth?.currentUser?.uid || "anonyme";
        
        const logEntry = {
            snackId,
            userId,
            action,
            message,
            details: JSON.stringify(details),
            level: "error", // info, warning, error
            timestamp: serverTimestamp(),
            userAgent: navigator.userAgent
        };

        await addDoc(collection(window.db, "system_logs"), logEntry);
        console.log("📡 [SaaS Logger] Erreur remontée au QG.");
    } catch (e) {
        // Fallback silencieux : on ne veut pas qu'un plantage du logger casse l'app.
        console.error("Échec du Logger Central:", e);
    }
}

// Rendre disponible globalement
window.logError = logError;
