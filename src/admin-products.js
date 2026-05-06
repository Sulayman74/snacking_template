/**
 * 🍔 PRODUITS ADMIN (Bridge)
 * Centralise le chargement des produits et délègue l'UI à AdminProductsUI.
 */
import { adminStore } from "./core/AdminStore.js";
import { escapeHTML } from "./utils.js";

let adminProductsUnsubscribe = null;

async function loadAdminProducts() {
  if (!window.currentAdminSnackId) return;
  
  if (adminProductsUnsubscribe) adminProductsUnsubscribe();

  const { query, collection, where, onSnapshot } = window.fs;
  const q = query(
    collection(window.db, "produits"),
    where("snackId", "==", window.currentAdminSnackId),
  );

  adminProductsUnsubscribe = onSnapshot(q, (snapshot) => {
    const products = [];
    snapshot.forEach((docSnap) => {
      products.push({ id: docSnap.id, ...docSnap.data() });
    });

    adminStore.setProducts(products);
    window.adminProducts = products;
    if (typeof window.populatePushProducts === "function") window.populatePushProducts();
  }, (error) => {
    console.error("Erreur temps réel admin products:", error);
  });
}

// UI Handlers (Legacy Bridges)
window.loadAdminProducts = loadAdminProducts;

// Ajout dynamique de rangée pour les tailles (utilisé par AdminProductsUI et le HTML)
window.addTailleRow = (nom = "", prix = "") => {
  const container = document.getElementById("edit-tailles-list");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "flex gap-2 items-center taille-row animate-fade-in";
  row.innerHTML = `
    <input type="text" placeholder="Ex: M, L, 33cm…" value="${escapeHTML(String(nom))}"
      class="edit-taille-nom flex-1 px-3 py-2 rounded-lg border border-gray-200 focus:border-blue-500 outline-none text-sm font-bold">
    <input type="number" step="0.10" min="0" placeholder="Prix" value="${prix !== "" ? prix : ""}"
      class="edit-taille-prix w-24 px-3 py-2 rounded-lg border border-gray-200 focus:border-blue-500 outline-none text-sm font-bold text-center">
    <span class="text-gray-500 text-sm font-bold shrink-0">€</span>
    <button type="button" onclick="this.closest('.taille-row').remove()"
      class="w-8 h-8 shrink-0 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
      <i class="fas fa-times text-xs"></i>
    </button>
  `;
  container.appendChild(row);
};

// Initialisation des comportements de formulaire (A11y/UX)
document.addEventListener("change", (e) => {
    const target = e.target;
    if (target.id === "edit-has-tailles") {
        document.getElementById("edit-tailles-container")?.classList.toggle("hidden", !target.checked);
    }
    if (target.id === "edit-allow-menu") {
        document.getElementById("edit-prix-menu-container")?.classList.toggle("hidden", !target.checked);
    }
    if (target.id === "edit-has-crudites") {
        document.getElementById("edit-crudites-container")?.classList.toggle("hidden", !target.checked);
    }
    if (target.id === "edit-has-sauces") {
        document.getElementById("edit-sauces-container")?.classList.toggle("hidden", !target.checked);
    }
    if (target.id === "edit-category" && target.value === "NEW") {
        document.getElementById("edit-new-category")?.classList.remove("hidden");
        document.getElementById("edit-new-category")?.focus();
    } else if (target.id === "edit-category") {
        document.getElementById("edit-new-category")?.classList.add("hidden");
    }
});

// Image preview handler
document.addEventListener("change", (e) => {
    if (e.target.id === "edit-img-file" && e.target.files?.[0]) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const imgEl = document.getElementById("edit-preview-img");
            const fallbackEl = document.getElementById("edit-preview-fallback");
            if (imgEl) {
                imgEl.src = event.target.result;
                imgEl.style.display = "block";
            }
            if (fallbackEl) fallbackEl.style.display = "none";
        };
        reader.readAsDataURL(e.target.files[0]);
    }
});
