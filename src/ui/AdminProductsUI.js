import { adminStore } from "../core/AdminStore.js";
import { confirmAction } from "../utils/ModalManager.js";
import { escapeHTML, safeURL, showToast } from "../utils.js";
import {
    db,
    storage,
    fs,
    deleteDoc,
    doc,
    updateDoc,
    ref,
    uploadBytes,
    getDownloadURL,
} from "../core/firebase.js";

/**
 * Liste des 14 allergènes à déclaration obligatoire (UE, règlement INCO 1169/2011).
 * La valeur stockée (`name`) est exactement ce qu'affiche la modale client
 * (`item.allergenes.join(", ")`), d'où des libellés propres sans emoji.
 * @type {Array<{name: string, emoji: string}>}
 */
const ALLERGENS = [
    { name: "Gluten", emoji: "🌾" },
    { name: "Crustacés", emoji: "🦐" },
    { name: "Œufs", emoji: "🥚" },
    { name: "Poisson", emoji: "🐟" },
    { name: "Arachides", emoji: "🥜" },
    { name: "Soja", emoji: "🫛" },
    { name: "Lait", emoji: "🥛" },
    { name: "Fruits à coque", emoji: "🌰" },
    { name: "Céleri", emoji: "🥬" },
    { name: "Moutarde", emoji: "🟡" },
    { name: "Sésame", emoji: "◦" },
    { name: "Sulfites", emoji: "🍷" },
    { name: "Lupin", emoji: "🌸" },
    { name: "Mollusques", emoji: "🦪" },
];

class AdminProductsUI {
    constructor() {
        this.grid = document.getElementById("admin-products-grid");
        this.modal = document.getElementById("edit-product-modal");
        this.form = document.getElementById("edit-product-form");
        this.currentEditingId = null;
        
        this.init();
    }

    init() {
        adminStore.addEventListener("admin-products-updated", () => this.render());
        if (this.form) {
            this.form.addEventListener("submit", (e) => this.handleSubmit(e));
        }
        this.renderAllergenOptions();
    }

    /**
     * Injecte une fois les cases à cocher des allergènes dans la modale produit.
     * La grille HTML (#edit-allergens-grid) est statique ; on la peuple au démarrage.
     */
    renderAllergenOptions() {
        const grid = document.getElementById("edit-allergens-grid");
        if (!grid) return;
        grid.innerHTML = ALLERGENS.map(({ name, emoji }) => `
            <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-amber-900 bg-white px-2 py-1.5 rounded-lg border border-amber-100 hover:border-amber-300 transition">
                <input type="checkbox" class="edit-allergen w-4 h-4 text-amber-600 rounded focus:ring-amber-500 cursor-pointer" value="${escapeHTML(name)}">
                <span>${emoji} ${escapeHTML(name)}</span>
            </label>`).join("");
    }

    /**
     * Coche les allergènes correspondant au produit (réinitialise les autres).
     * @param {string[]} [list] - allergènes du produit (noms canoniques).
     */
    setAllergens(list) {
        const selected = new Set(Array.isArray(list) ? list : []);
        document.querySelectorAll(".edit-allergen").forEach((cb) => {
            cb.checked = selected.has(cb.value);
        });
    }

    render() {
        if (!this.grid) return;
        let products = adminStore.state.products;
        
        // --- 1. Remplir dynamiquement le select de catégories ---
        const categorySelect = document.getElementById("admin-product-category");
        if (categorySelect && products.length > 0) {
            const currentCat = categorySelect.value;
            const categories = [...new Set(products.map(p => p.categorieId).filter(Boolean))];
            
            // On ne reconstruit les options que si nécessaire (ou de manière basique)
            // Pour faire simple, on les met à jour en gardant la sélection
            categorySelect.innerHTML = `<option value="">Toutes les catégories</option>` + 
                categories.map(cat => `<option value="${escapeHTML(cat)}" ${currentCat === cat ? 'selected' : ''}>${escapeHTML(cat)}</option>`).join("");
        }

        // --- 2. Filtrer les produits ---
        const searchInput = document.getElementById("admin-product-search");
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";
        const selectedCategory = categorySelect ? categorySelect.value : "";

        if (searchTerm) {
            products = products.filter(p => 
                (p.nom && p.nom.toLowerCase().includes(searchTerm)) || 
                (p.description && p.description.toLowerCase().includes(searchTerm))
            );
        }

        if (selectedCategory) {
            products = products.filter(p => p.categorieId === selectedCategory);
        }
        
        if (products.length === 0) {
            this.grid.innerHTML = `<p class="col-span-full text-center py-10 text-gray-400 font-bold">Aucun produit trouvé.</p>`;
            return;
        }

        this.grid.innerHTML = products.map(p => this.renderProductCard(p)).join("");
    }

    renderProductCard(p) {
        const isAvailable = p.isAvailable !== false;
        const safeId = escapeHTML(p.id);
        const safeNom = escapeHTML(p.nom || "");
        const safeDesc = escapeHTML(p.description || "");
        const safeImg = p.image ? safeURL(p.image) : "";
        const prix = (parseFloat(p.prix) || 0).toFixed(2);
        return `
            <div class="bg-white rounded-3xl shadow-sm border border-line overflow-hidden flex flex-col transition-all hover:shadow-xl hover:-translate-y-1 group ${!isAvailable ? 'opacity-75 grayscale-[0.5]' : ''}">
                <div class="relative h-48 overflow-hidden bg-surface-2">
                    ${p.image ? `
                        <img src="${safeImg}" alt="${safeNom}"
                             class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                             onerror="this.classList.add('hidden'); this.nextElementSibling.classList.remove('hidden');">
                        <div class="absolute inset-0 flex flex-col items-center justify-center text-gray-300 hidden">
                            <i data-lucide="pizza" class="text-4xl mb-2 opacity-20"></i>
                            <span class="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Photo absente... 👨‍🍳</span>
                        </div>
                    ` : `
                        <div class="absolute inset-0 flex flex-col items-center justify-center text-gray-300">
                            <i data-lucide="pizza" class="text-4xl mb-2 opacity-20"></i>
                            <span class="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Pas de photo... 👨‍🍳</span>
                        </div>
                    `}
                    <div class="absolute top-4 right-4">
                        <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${isAvailable ? 'bg-green-500 text-white' : 'bg-red-500 text-white shadow-lg'}">
                            ${isAvailable ? 'En Stock' : 'Épuisé'}
                        </span>
                    </div>
                </div>

                <div class="p-6 flex-1 flex flex-col">
                    <div class="flex justify-between items-start mb-2">
                        <h4 class="font-black text-xl text-gray-900">${safeNom}</h4>
                        <button data-action="toggle-product-ui" data-id="${safeId}" class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isAvailable ? 'bg-green-500' : 'bg-surface-3'}">
                            <span class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isAvailable ? 'translate-x-5' : 'translate-x-0'}"></span>
                        </button>
                    </div>
                    <p class="text-gray-400 text-sm font-bold mb-4 line-clamp-2">${safeDesc}</p>
                    <div class="flex items-center justify-between mt-auto pt-4 border-t border-gray-50">
                        <span class="text-2xl font-black text-gray-900">${prix} €</span>
                        <div class="flex gap-2">
                            <button data-action="open-edit-modal" data-id="${safeId}" class="w-10 h-10 rounded-xl bg-surface-2 text-gray-400 hover:bg-gray-900 hover:text-white transition-all flex items-center justify-center">
                                <i data-lucide="pen" class="text-sm"></i>
                            </button>
                            <button data-action="delete-product-ui" data-id="${safeId}" class="w-10 h-10 rounded-xl bg-red-50 text-red-400 hover:bg-red-600 hover:text-white transition-all flex items-center justify-center">
                                <i data-lucide="trash" class="text-sm"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    async handleToggle(productId) {
        try {
            await adminStore.toggleProductStatus(db, fs, productId);
            // Pas besoin de showToast, le changement visuel est immédiat via le listener
        } catch (error) {
            showToast("Erreur lors de la modification du statut", "error");
        }
    }

    async handleDelete(productId) {
        const product = adminStore.state.products.find(p => p.id === productId);
        if (!product) return;

        const confirmed = await confirmAction({
            title: "Supprimer le produit ?",
            message: `Êtes-vous sûr de vouloir supprimer "${product.nom}" ? Cette action est irréversible.`,
            confirmText: "Oui, supprimer",
            type: "danger"
        });

        if (confirmed) {
            try {
                await deleteDoc(doc(db, "produits", productId));
                showToast("Produit supprimé !");
            } catch (error) {
                showToast("Erreur lors de la suppression", "error");
            }
        }
    }

    openModal(productId = null) {
        this.currentEditingId = productId;
        const product = productId ? adminStore.state.products.find(p => p.id === productId) : null;
        
        if (this.form) this.form.reset();
        
        document.getElementById("edit-modal-title").textContent = productId ? `Modifier : ${product.nom}` : "➕ Nouveau Produit";
        document.getElementById("save-product-btn").innerHTML = productId ? '<i data-lucide="save" class="mr-2"></i> Enregistrer' : '<i data-lucide="plus" class="mr-2"></i> Créer le produit';

        if (product) {
            document.getElementById("edit-nom").value = product.nom || "";
            document.getElementById("edit-desc").value = product.description || "";
            document.getElementById("edit-prix").value = product.prix || 0;
            document.getElementById("edit-prix-menu").value = product.menuPriceAdd || 2.5;
            document.getElementById("edit-tva-rate").value = String(product.tvaRate ?? 10);
            this.populateCategorySelect(product.categorieId);
            document.getElementById("edit-tags").value = product.tags?.[0] || "";
            document.getElementById("edit-allow-menu").checked = product.allowMenu !== false;
            this.setAllergens(product.allergenes);
            
            // Image Preview
            const imgEl = document.getElementById("edit-preview-img");
            const fallbackEl = document.getElementById("edit-preview-fallback");
            if (product.image) {
                imgEl.src = product.image;
                imgEl.style.display = "block";
                fallbackEl.style.display = "none";
            } else {
                imgEl.style.display = "none";
                fallbackEl.style.display = "flex";
            }

            // Options (Trigger events to show/hide sections)
            document.getElementById("edit-has-crudites").checked = !!product.hasCrudites;
            document.getElementById("edit-has-sauces").checked = !!product.choixSauces;
            document.getElementById("edit-has-tailles").checked = !!product.tailles?.length;
            
            // Triggers
            ["edit-has-crudites", "edit-has-sauces", "edit-has-tailles", "edit-allow-menu"].forEach(id => {
                document.getElementById(id).dispatchEvent(new Event("change"));
            });

            // Populate dynamic lists
            if (product.crudites) document.getElementById("edit-crudites-list").value = product.crudites.join(", ");
            if (product.choixSauces) {
                document.getElementById("edit-sauces-list").value = product.choixSauces.liste?.join(", ") || "";
                document.getElementById("edit-sauces-max").value = product.choixSauces.max || 2;
            }
            if (product.tailles) {
                const list = document.getElementById("edit-tailles-list");
                list.innerHTML = "";
                product.tailles.forEach(t => window.addTailleRow(t.nom, t.prix));
            }
        } else {
            // New Product defaults
            document.getElementById("edit-preview-img").style.display = "none";
            document.getElementById("edit-preview-fallback").style.display = "flex";
            this.populateCategorySelect(null);
            this.setAllergens([]);
            ["edit-has-crudites", "edit-has-sauces", "edit-has-tailles"].forEach(id => {
                document.getElementById(id).checked = false;
                document.getElementById(id).dispatchEvent(new Event("change"));
            });
            document.getElementById("edit-allow-menu").checked = true;
            document.getElementById("edit-allow-menu").dispatchEvent(new Event("change"));
        }

        this.modal.classList.remove("hidden");
        setTimeout(() => {
            this.modal.classList.remove("opacity-0");
            this.modal.querySelector(".bg-white").classList.remove("scale-95");
        }, 10);
    }

    async handleSubmit(e) {
        e.preventDefault();
        const btn = document.getElementById("save-product-btn");
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Sauvegarde...';
        btn.disabled = true;

        try {
            const productData = this.collectFormData();
            const editingId = this.currentEditingId;
            if (editingId) productData.id = editingId;

            // On capture le fichier image AVANT de fermer/réinitialiser la modale
            // (closeModal → form.reset() viderait l'input).
            const fileInput = document.getElementById("edit-img-file");
            const file = fileInput?.files?.[0] || null;

            // En édition sans nouveau fichier : on conserve l'image existante.
            if (!file && editingId) {
                const oldProduct = adminStore.state.products.find(p => p.id === editingId);
                if (oldProduct?.image) productData.image = oldProduct.image;
            }

            // 1) Écriture rapide du doc (SANS attendre l'upload image) → UI quasi instantanée.
            const productId = await adminStore.saveProduct(db, fs, productData);
            showToast(file ? "Produit enregistré, image en cours…" : "Produit enregistré !", "success");
            window.closeModal("edit-product-modal");

            // 2) Upload image EN ARRIÈRE-PLAN (fire-and-forget, sans Pub/Sub).
            // Le listener onSnapshot rafraîchira la carte dès que l'URL est écrite,
            // puis la Cloud Function optimizeImage compressera le fichier en WebP.
            if (file && productId) this.uploadImageInBackground(productId, file);
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    }

    /**
     * Upload l'image dans Storage puis patche le champ `image` du produit.
     * Volontairement NON attendu par handleSubmit (fire-and-forget) : l'UI rend
     * la main immédiatement après l'écriture du doc. En cas d'échec, le produit
     * existe déjà sans image → on prévient l'utilisateur.
     * @param {string} productId - id du document produit à patcher.
     * @param {File} file - fichier image sélectionné.
     */
    async uploadImageInBackground(productId, file) {
        try {
            const snackId = adminStore.state.config?.identity?.id || window.currentAdminSnackId;
            if (!snackId) throw new Error("Snack non identifié.");
            const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, "")}`;
            const storageRef = ref(storage, `produits/${snackId}/${fileName}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            await updateDoc(doc(db, "produits", productId), { image: url });
        } catch (error) {
            console.error("Upload image (arrière-plan) échoué :", error);
            showToast("Produit créé, mais l'envoi de l'image a échoué. Réessaie via Modifier.", "error");
        }
    }

    /**
     * Peuple le <select> des catégories à partir des produits existants,
     * ajoute l'option "➕ Nouvelle catégorie" (sentinelle "NEW") et sélectionne
     * la valeur voulue. Si aucune catégorie n'existe encore, force "NEW" pour
     * que l'utilisateur saisisse la première.
     * @param {string|null} selected - categorieId à présélectionner.
     */
    populateCategorySelect(selected) {
        const sel = document.getElementById("edit-category");
        if (!sel) return;

        const categories = [...new Set(adminStore.state.products.map(p => p.categorieId).filter(Boolean))];
        sel.innerHTML =
            categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("") +
            `<option value="NEW">➕ Nouvelle catégorie…</option>`;

        if (selected && categories.includes(selected)) sel.value = selected;
        else if (categories.length > 0) sel.value = categories[0];
        else sel.value = "NEW";

        // Affiche le champ texte si on est en mode "nouvelle catégorie"
        const newInput = document.getElementById("edit-new-category");
        if (newInput) {
            newInput.classList.toggle("hidden", sel.value !== "NEW");
            if (sel.value !== "NEW") newInput.value = "";
        }
    }

    /**
     * Résout la catégorie finale : valeur saisie si "Nouvelle catégorie",
     * sinon la valeur sélectionnée dans le <select>.
     * @returns {string} categorieId (peut être "" → bloqué par la validation).
     */
    resolveCategory() {
        const sel = document.getElementById("edit-category");
        if (sel?.value === "NEW") {
            return document.getElementById("edit-new-category")?.value.trim() || "";
        }
        return sel?.value || "";
    }

    collectFormData() {
        const hasTailles = document.getElementById("edit-has-tailles").checked;
        const tailles = hasTailles ? Array.from(document.querySelectorAll("#edit-tailles-list .taille-row")).map(row => ({
            nom: row.querySelector(".edit-taille-nom").value.trim(),
            prix: parseFloat(row.querySelector(".edit-taille-prix").value) || 0
        })).filter(t => t.nom !== "") : [];

        const hasSauces = document.getElementById("edit-has-sauces").checked;
        const sauces = hasSauces ? {
            liste: document.getElementById("edit-sauces-list").value.split(",").map(s => s.trim()).filter(s => s !== ""),
            max: parseInt(document.getElementById("edit-sauces-max").value) || 2
        } : null;

        const hasCrudites = document.getElementById("edit-has-crudites").checked;
        const crudites = hasCrudites ? document.getElementById("edit-crudites-list").value.split(",").map(s => s.trim()).filter(s => s !== "") : null;

        return {
            nom: document.getElementById("edit-nom").value.trim(),
            description: document.getElementById("edit-desc").value.trim(),
            prix: hasTailles && tailles.length > 0 ? tailles[0].prix : parseFloat(document.getElementById("edit-prix").value) || 0,
            menuPriceAdd: parseFloat(document.getElementById("edit-prix-menu").value) || 2.5,
            tvaRate: [5.5, 10, 20].includes(parseFloat(document.getElementById("edit-tva-rate").value))
                ? parseFloat(document.getElementById("edit-tva-rate").value)
                : 10,
            categorieId: this.resolveCategory(),
            tags: document.getElementById("edit-tags").value ? [document.getElementById("edit-tags").value] : [],
            allergenes: Array.from(document.querySelectorAll(".edit-allergen:checked")).map(cb => cb.value),
            allowMenu: hasTailles ? false : document.getElementById("edit-allow-menu").checked,
            hasCrudites: !!hasCrudites,
            crudites,
            choixSauces: (sauces && sauces.liste.length > 0) ? sauces : null,
            tailles
        };
    }
}

export const adminProductsUI = new AdminProductsUI();

// Global Bridge pour l'interface legacy
window.handleDeleteProductUI = (id) => adminProductsUI.handleDelete(id);
window.handleToggleProductUI = (id) => adminProductsUI.handleToggle(id);
window.openAddProductModal = () => adminProductsUI.openModal();
window.openEditModal = (id) => adminProductsUI.openModal(id);
window.editAdminProduct = (id) => adminProductsUI.openModal(id); // Gardé au cas où une autre vue l'utilise
window.closeAdminProductModal = () => {
    const modal = document.getElementById("edit-product-modal");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
};
window.filterAdminProducts = () => adminProductsUI.render();
