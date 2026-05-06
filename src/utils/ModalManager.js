/**
 * 📢 ModalManager — Centralisation des dialogues de confirmation (DRY)
 * Utilise un template HTML pour garantir la cohérence.
 */
export async function confirmAction({ 
    title = "Confirmation", 
    message = "Êtes-vous sûr de vouloir effectuer cette action ?", 
    confirmText = "Confirmer", 
    cancelText = "Annuler",
    type = "danger" 
}) {
    return new Promise((resolve) => {
        const template = document.getElementById("confirm-modal-template");
        if (!template) {
            // Fallback natif si le template est manquant
            const ok = window.confirm(`${title}\n\n${message}`);
            return resolve(ok);
        }

        const clone = template.content.cloneNode(true);
        const backdrop = clone.querySelector(".modal-backdrop");
        const modal = clone.querySelector(".modal-content");
        const titleEl = clone.querySelector(".modal-title");
        const messageEl = clone.querySelector(".modal-message");
        const confirmBtn = clone.querySelector(".modal-confirm-btn");
        const cancelBtn = clone.querySelector(".modal-cancel-btn");

        // Remplissage
        titleEl.textContent = title;
        messageEl.textContent = message;
        confirmBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;

        if (type === "danger") {
            confirmBtn.classList.add("bg-red-600", "hover:bg-red-700");
        } else {
            confirmBtn.classList.add("bg-primary", "hover:opacity-90");
        }

        // Ajout au DOM
        document.body.appendChild(clone);

        // Récupération des éléments après injection pour les animations
        const backdropEl = document.querySelector(".modal-backdrop:last-child");
        const modalEl = backdropEl.querySelector(".modal-content");

        // Animation d'entrée
        setTimeout(() => {
            backdropEl.classList.remove("opacity-0");
            modalEl.classList.remove("scale-95", "opacity-0");
        }, 10);

        const cleanup = (result) => {
            modalEl.classList.add("scale-95", "opacity-0");
            backdropEl.classList.add("opacity-0");
            setTimeout(() => {
                backdropEl.remove();
                resolve(result);
            }, 300);
        };

        confirmBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        backdropEl.onclick = (e) => { if (e.target === backdropEl) cleanup(false); };
    });
}
