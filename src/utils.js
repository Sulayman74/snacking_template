// ============================================================================
// 🛠️ UTILS — Fonctions utilitaires partagées
// ============================================================================

/**
 * Sécurise une chaîne de caractères pour l'affichage HTML
 */
export function escapeHTML(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Affiche un message temporaire (Snackbar)
 */
export function showToast(message, type = "success") {
    const snack = document.getElementById("snackbar");
    const msgEl = document.getElementById("snackbar-message");
    const iconEl = document.getElementById("snackbar-icon");

    if (!snack || !msgEl) return;

    // Mise à jour du message
    msgEl.textContent = message;

    // Gestion de l'icône selon le type
    if (iconEl) {
        iconEl.className = type === "success" 
            ? "fas fa-check-circle text-green-400 text-2xl" 
            : "fas fa-exclamation-circle text-red-400 text-2xl";
    }

    // Animation d'entrée
    snack.classList.remove("translate-y-24", "opacity-0");
    
    // Animation de sortie après 3 secondes
    setTimeout(() => {
        snack.classList.add("translate-y-24", "opacity-0");
    }, 3000);
}

/**
 * Déclenche une vibration haptique sur mobile
 */
export function triggerVibration(type = "light") {
    if (!("vibrate" in navigator)) return;

    if (type === "success") {
        navigator.vibrate([100, 50, 100]);
    } else if (type === "error") {
        navigator.vibrate([200, 100, 200]);
    } else {
        navigator.vibrate(40); // Vibration courte par défaut
    }
}

// Exposition globale pour compatibilité avec les scripts existants
window.escapeHTML = escapeHTML;
window.showToast = showToast;
window.triggerVibration = triggerVibration;
