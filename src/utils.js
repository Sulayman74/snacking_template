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

// Whitelist d'origines/protocoles pour empêcher javascript:, data:, vbscript:
const SAFE_URL_SCHEMES = /^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i;

/**
 * Filtre une URL pour neutraliser les schemes XSS (javascript:, data:, vbscript:).
 * Retourne "#" si l'URL est suspecte. Toujours combiner avec escapeHTML pour l'attribut.
 */
export function safeURL(url) {
    if (!url) return "#";
    const trimmed = String(url).trim();
    if (!SAFE_URL_SCHEMES.test(trimmed)) return "#";
    return escapeHTML(trimmed);
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
        toast.classList.add("bg-gray-900", "text-on-dark");
        icon.className = "fas fa-check-circle text-green-400";
    } else {
        toast.classList.add("bg-danger", "text-on-dark");
        icon.className = "fas fa-exclamation-triangle text-on-dark";
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
 * Construit une signature déterministe d'un article personnalisé (panier ou favori).
 * Deux articles avec EXACTEMENT les mêmes options (produit, formule, taille, boisson,
 * sauces, sans-crudités) produisent la même clé → permet la déduplication des favoris
 * et l'état "déjà en favori" du bouton cœur, indépendamment de l'ordre des sauces.
 * @param {Object} item - Article au format panier ({productId, formule, taille, boisson, sauces, sansCrudites}).
 * @returns {string} Clé stable réutilisable comme identifiant de favori.
 */
export function favoriteKey(item) {
    if (!item) return "";
    const norm = (arr) => [...(arr || [])].map((v) => String(v)).sort().join(",");
    return [
        item.productId || item.id || "",
        item.formule || "",
        item.taille || "",
        item.boisson || "",
        norm(item.sauces),
        norm(item.sansCrudites),
    ].join("|");
}

/**
 * Formate les options d'un article (boisson, sauces, sans-crudités) en HTML.
 * Source unique consommée par l'affichage du panier ET des favoris (DRY).
 * Le contenu dynamique est échappé via escapeHTML ; les icônes/balises sont sûres.
 * @param {Object} item - Article personnalisé.
 * @returns {string} HTML des détails, ou "" si aucune option.
 */
export function formatCustomizationDetails(item) {
    const parts = [];
    if (item.boisson) parts.push(`🥤 ${escapeHTML(item.boisson)}`);
    if (item.sauces && item.sauces.length > 0) {
        parts.push(`🥣 ${item.sauces.map((s) => escapeHTML(s)).join(", ")}`);
    }
    if (item.sansCrudites && item.sansCrudites.length > 0) {
        parts.push(`<span class="text-danger font-black">⚠️ ${item.sansCrudites.map((c) => escapeHTML(c)).join(", ")}</span>`);
    }
    return parts.length > 0
        ? parts.join(" <span class='text-text-muted'>|</span> ")
        : "";
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
window.safeURL = safeURL;
window.showToast = showToast;
window.triggerVibration = triggerVibration;
window.favoriteKey = favoriteKey;
window.formatCustomizationDetails = formatCustomizationDetails;
