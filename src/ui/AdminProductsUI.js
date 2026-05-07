import { adminStore } from "../core/AdminStore.js";
import { confirmAction } from "../utils/ModalManager.js";
import { escapeHTML, safeURL, showToast } from "../utils.js";

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
            <div class="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col transition-all hover:shadow-xl hover:-translate-y-1 group ${!isAvailable ? 'opacity-75 grayscale-[0.5]' : ''}">
                <div class="relative h-48 overflow-hidden bg-gray-50">
                    ${p.image ? `
                        <img src="${safeImg}" alt="${safeNom}"
                             class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                             onerror="this.classList.add('hidden'); this.nextElementSibling.classList.remove('hidden');">
                        <div class="absolute inset-0 flex flex-col items-center justify-center text-gray-300 hidden">
                            <i class="fas fa-pizza-slice text-4xl mb-2 opacity-20"></i>
                            <span class="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Photo absente... 👨‍🍳</span>
                        </div>
                    ` : `
                        <div class="absolute inset-0 flex flex-col items-center justify-center text-gray-300">
                            <i class="fas fa-pizza-slice text-4xl mb-2 opacity-20"></i>
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
                        <button data-action="toggle-product-ui" data-id="${safeId}" class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isAvailable ? 'bg-green-500' : 'bg-gray-200'}">
                            <span class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isAvailable ? 'translate-x-5' : 'translate-x-0'}"></span>
                        </button>
                    </div>
                    <p class="text-gray-400 text-sm font-bold mb-4 line-clamp-2">${safeDesc}</p>
                    <div class="flex items-center justify-between mt-auto pt-4 border-t border-gray-50">
                        <span class="text-2xl font-black text-gray-900">${prix} €</span>
                        <div class="flex gap-2">
                            <button data-action="open-edit-modal" data-id="${safeId}" class="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 hover:bg-gray-900 hover:text-white transition-all flex items-center justify-center">
                                <i class="fas fa-pen text-sm"></i>
                            </button>
                            <button data-action="delete-product-ui" data-id="${safeId}" class="w-10 h-10 rounded-xl bg-red-50 text-red-400 hover:bg-red-600 hover:text-white transition-all flex items-center justify-center">
                                <i class="fas fa-trash text-sm"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    async handleToggle(productId) {
        try {
            await adminStore.toggleProductStatus(window.db, window.fs, productId);
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
                const { deleteDoc, doc } = window.fs;
                await deleteDoc(doc(window.db, "produits", productId));
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
        document.getElementById("save-product-btn").innerHTML = productId ? '<i class="fas fa-save mr-2"></i> Enregistrer' : '<i class="fas fa-plus mr-2"></i> Créer le produit';

        if (product) {
            document.getElementById("edit-nom").value = product.nom || "";
            document.getElementById("edit-desc").value = product.description || "";
            document.getElementById("edit-prix").value = product.prix || 0;
            document.getElementById("edit-prix-menu").value = product.menuPriceAdd || 2.5;
            document.getElementById("edit-category").value = product.categorieId || "burgers";
            document.getElementById("edit-tags").value = product.tags?.[0] || "";
            document.getElementById("edit-allow-menu").checked = product.allowMenu !== false;
            
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
            document.getElementById("edit-category").value = "burgers";
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
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Sauvegarde...';
        btn.disabled = true;

        try {
            const productData = this.collectFormData();
            if (this.currentEditingId) productData.id = this.currentEditingId;

            // Image Upload
            const fileInput = document.getElementById("edit-img-file");
            if (fileInput.files.length > 0) {
                const snackId = adminStore.state.config?.identity?.id || window.currentAdminSnackId;
                if (!snackId) throw new Error("Snack non identifié. Recharge l'onglet Configuration.");
                const file = fileInput.files[0];
                const { ref, uploadBytes, getDownloadURL } = window.storageTools;
                const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, "")}`;
                const storageRef = ref(window.storage, `produits/${snackId}/${fileName}`);
                await uploadBytes(storageRef, file);
                productData.image = await getDownloadURL(storageRef);
            } else if (this.currentEditingId) {
                // Keep old image if no new file
                const oldProduct = adminStore.state.products.find(p => p.id === this.currentEditingId);
                if (oldProduct?.image) productData.image = oldProduct.image;
            }

            await adminStore.saveProduct(window.db, window.fs, productData);
            showToast("Produit enregistré !", "success");
            window.closeModal("edit-product-modal");
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
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
            categorieId: document.getElementById("edit-category").value,
            tags: document.getElementById("edit-tags").value ? [document.getElementById("edit-tags").value] : [],
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
