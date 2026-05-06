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
 * Affiche un message temporaire (Snackbar/Toast)
 */
export function showToast(message, type = "success") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.className = "fixed bottom-8 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 items-center pointer-events-none";
        document.body.appendChild(container);
    }

    const template = document.getElementById("toast-template");
    if (!template) {
        alert(message);
        return;
    }

    const clone = template.content.cloneNode(true);
    const toast = clone.querySelector(".toast-item");
    const icon = clone.querySelector(".toast-icon");
    const msg = clone.querySelector(".toast-message");

    msg.textContent = message;

    if (type === "success") {
        toast.classList.add("bg-gray-900", "text-white");
        icon.className = "fas fa-check-circle text-green-400";
    } else {
        toast.classList.add("bg-red-600", "text-white");
        icon.className = "fas fa-exclamation-triangle text-white";
    }

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove("translate-y-24", "opacity-0");
    });

    setTimeout(() => {
        toast.classList.add("opacity-0", "scale-95");
        setTimeout(() => toast.remove(), 300);
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
