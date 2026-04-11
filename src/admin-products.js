// ============================================================================
// 🍔 PRODUITS ADMIN — PIM, CRUD, Upload image, Catégories
// ============================================================================
// Dépendances : window.currentAdminSnackId, window.adminProducts,
//               window.db, window.fs, window.storage, window.storageTools,
//               window.showToast

import { escapeHTML } from "./utils.js";

// ============================================================================
// 📋 CHARGEMENT DES PRODUITS
// ============================================================================
async function loadAdminProducts() {
  if (!window.currentAdminSnackId) return;
  const grid = document.getElementById("admin-products-grid");
  if (!grid) return;

  // 💀 Skeleton loaders
  const skeletonHtml = Array(6)
    .fill(
      `
            <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col animate-pulse">
                <div class="flex items-center gap-4 p-4 border-b border-gray-100">
                    <div class="w-16 h-16 rounded-xl bg-gray-200"></div>
                    <div class="flex-1 space-y-3">
                        <div class="h-4 bg-gray-200 rounded-md w-3/4"></div>
                        <div class="h-3 bg-gray-200 rounded-md w-1/2"></div>
                    </div>
                </div>
                <div class="p-4 bg-gray-50 flex justify-between items-center mt-auto">
                    <div class="h-8 w-28 bg-gray-200 rounded-full"></div>
                    <div class="h-8 w-24 bg-gray-200 rounded-xl"></div>
                </div>
            </div>
        `,
    )
    .join("");
  grid.innerHTML = skeletonHtml;

  try {
    const { query, collection, where, getDocs } = window.fs;
    const q = query(
      collection(window.db, "produits"),
      where("snackId", "==", window.currentAdminSnackId),
    );
    const snapshot = await getDocs(q);
    window.adminProducts = [];
    grid.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const item = { id: docSnap.id, ...docSnap.data() };
      window.adminProducts.push(item);

      const isAvailable = item.isAvailable !== false;
      const toggleColor = isAvailable ? "bg-green-500" : "bg-gray-300";
      const toggleTranslate = isAvailable ? "translate-x-6" : "translate-x-1";
      const statusText = isAvailable
        ? "<span class='text-green-600'>En stock</span>"
        : "<span class='text-red-600 font-bold'>Épuisé</span>";
      const prixBaseText = `${(item.prix || 0).toFixed(2)} €`;
      const prixMenuText =
        item.allowMenu !== false
          ? `<span class="text-red-500 text-xs ml-1 bg-red-50 px-2 py-0.5 rounded-md">(Menu +${(item.menuPriceAdd || 2.5).toFixed(2)}€)</span>`
          : `<span class="text-gray-400 text-xs ml-1 italic">Solo</span>`;

      const imageUrl =
        item.image && item.image.trim() !== "" ? item.image : null;
      const fallbackHtml = `
                <div class="w-16 h-16 rounded-xl bg-gray-100 shadow-inner flex items-center justify-center shrink-0 border border-gray-200">
                    <i class="fas fa-hamburger text-gray-300 text-2xl"></i>
                </div>`;
      const imageHtml = imageUrl
        ? `<div class="relative w-16 h-16 shrink-0">
                <img src="${imageUrl}" alt="${escapeHTML(item.nom)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="absolute inset-0 w-full h-full rounded-xl object-cover shadow-sm border border-gray-200 z-10">
                <div style="display: none;" class="absolute inset-0 rounded-xl bg-gray-100 shadow-inner items-center justify-center border border-gray-200 z-0">
                    <i class="fas fa-hamburger text-gray-300 text-2xl"></i>
                </div>
            </div>`
        : fallbackHtml;

      grid.innerHTML += `
                <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col transition-all hover:shadow-md animate-fade-in-up">
                    <div class="flex items-center gap-4 p-4 border-b border-gray-100">
                        ${imageHtml}
                        <div class="flex-1">
                            <h4 class="font-black text-gray-900 leading-tight">${escapeHTML(item.nom)}</h4>
                            <p class="text-gray-500 text-sm font-bold mt-1">${prixBaseText} <span class="text-red-500 text-xs ml-1">${prixMenuText}</span></p>
                        </div>
                    </div>
                    <div class="p-4 bg-gray-50 flex justify-between items-center mt-auto">
                        <div class="flex flex-col items-start gap-1">
                            <p class="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Disponibilité</p>
                            <div class="flex items-center gap-3">
                                <button data-action="toggle-product" data-id="${item.id}" data-current-status="${isAvailable}" class="relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${toggleColor}">
                                    <span class="inline-block h-5 w-5 transform rounded-full bg-white transition duration-300 shadow-md ${toggleTranslate}"></span>
                                </button>
                                <span class="text-sm font-bold">${statusText}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button data-action="open-edit-modal" data-id="${item.id}" aria-label="Modifier" class="bg-white border border-gray-200 text-gray-900 hover:bg-gray-900 hover:text-white w-10 h-10 rounded-xl text-sm font-bold transition shadow-sm flex items-center justify-center">
                                <i class="fas fa-pen"></i>
                            </button>
                            <button data-action="open-delete-modal" data-id="${item.id}" aria-label="Supprimer" class="bg-white border border-red-200 text-red-600 hover:bg-red-600 hover:text-white w-10 h-10 rounded-xl text-sm font-bold transition shadow-sm flex items-center justify-center">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
    });

    // Met à jour le dropdown marketing
    if (typeof window.populatePushProducts === "function")
      window.populatePushProducts();
  } catch (error) {
    grid.innerHTML =
      '<p class="text-red-500 bg-red-50 p-4 rounded-xl font-bold"><i class="fas fa-exclamation-triangle mr-2"></i> Erreur lors du chargement du menu.</p>';
  }
}

async function toggleProductStatus(productId, currentStatus) {
  try {
    const { updateDoc, doc } = window.fs;
    await updateDoc(doc(window.db, "produits", productId), {
      isAvailable: !currentStatus,
    });
    loadAdminProducts();
  } catch (error) {
    alert("Erreur de modification du statut.");
  }
}

// ============================================================================
// ✏️ MODALE D'ÉDITION
// ============================================================================
let currentEditingProductId = null;
let productToDeleteId = null;

// Expose pour que closeModal (dans admin.js) puisse réinitialiser
window.adminResetEditIds = () => {
  currentEditingProductId = null;
  productToDeleteId = null;
};

async function openEditModal(productId) {
  const product = window.adminProducts.find((p) => p.id === productId);
  if (!product) return;
  currentEditingProductId = productId;

  document.getElementById("edit-modal-title").innerText = `Modifier : ${product.nom}`;
  document.getElementById("edit-nom").value = product.nom || "";
  document.getElementById("edit-desc").value = product.description || "";
  document.getElementById("edit-prix").value = product.prix || 0;
  document.getElementById("edit-prix-menu").value = product.menuPriceAdd || 2.5;
  const currentTag = Array.isArray(product.tags)
    ? product.tags[0]
    : product.tags || "";
  document.getElementById("edit-tags").value = currentTag;
  populateCategoryDropdown(product.categorieId);
  document.getElementById("edit-img-file").value = "";

  const checkbox = document.getElementById("edit-allow-menu");
  const prixMenuContainer = document.getElementById("edit-prix-menu-container");

  let isMenuAllowed = true;
  if (product.allowMenu !== undefined) {
    isMenuAllowed = product.allowMenu;
  } else if (
    product.categorieId === "drinks" ||
    product.categorieId === "deserts"
  ) {
    isMenuAllowed = false;
  }
  checkbox.checked = isMenuAllowed;
  checkbox.dispatchEvent(new Event("change"));

  const hasCrudites = !!product.hasCrudites;
  document.getElementById("edit-has-crudites").checked = hasCrudites;
  if (hasCrudites) {
    document.getElementById("edit-crudites-list").value = Array.isArray(
      product.crudites,
    )
      ? product.crudites.join(", ")
      : "Salade, Tomate, Oignon";
  }

  const hasSauces = !!product.choixSauces;
  document.getElementById("edit-has-sauces").checked = hasSauces;
  if (hasSauces && product.choixSauces) {
    document.getElementById("edit-sauces-list").value = Array.isArray(
      product.choixSauces.liste,
    )
      ? product.choixSauces.liste.join(", ")
      : "";
    document.getElementById("edit-sauces-max").value =
      product.choixSauces.max || 2;
  }

  document
    .getElementById("edit-has-crudites")
    .dispatchEvent(new Event("change"));
  document
    .getElementById("edit-has-sauces")
    .dispatchEvent(new Event("change"));

  const imgEl = document.getElementById("edit-preview-img");
  const fallbackEl = document.getElementById("edit-preview-fallback");
  if (product.image && product.image.trim() !== "") {
    imgEl.src = product.image;
    imgEl.style.display = "block";
    fallbackEl.style.display = "none";
  } else {
    imgEl.src = "";
    imgEl.style.display = "none";
    fallbackEl.style.display = "flex";
  }

  const modal = document.getElementById("edit-product-modal");
  const modalContent = modal.querySelector(".bg-white");
  modal.classList.add("opacity-0");
  modalContent.classList.add("scale-95");
  modal.classList.remove("hidden");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modalContent.classList.remove("scale-95");
  }, 10);
}

// Prévisualisation en direct de la nouvelle photo
document.getElementById("edit-img-file")?.addEventListener("change", function (event) {
  if (event.target.files && event.target.files[0]) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const imgEl = document.getElementById("edit-preview-img");
      const fallbackEl = document.getElementById("edit-preview-fallback");
      imgEl.src = e.target.result;
      imgEl.style.display = "block";
      fallbackEl.style.display = "none";
    };
    reader.readAsDataURL(event.target.files[0]);
  }
});

async function openDeleteModal(id) {
  productToDeleteId = id;
  const modal = document.getElementById("delete-confirm-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector(".bg-white").classList.remove("scale-95");
  }, 10);
}

window.confirmDeleteProduct = async () => {
  if (!productToDeleteId) return;
  const btn = document.getElementById("confirm-delete-btn");
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Suppression...';
  btn.disabled = true;

  try {
    const { deleteDoc, doc } = window.fs;
    await deleteDoc(doc(window.db, "produits", productToDeleteId));
    window.showToast("Produit définitivement supprimé.", "success");
    window.closeModal("delete-confirm-modal");
    loadAdminProducts();
  } catch (error) {
    console.error("Erreur de suppression:", error);
    window.showToast("Erreur lors de la suppression.", "error");
  } finally {
    setTimeout(() => {
      btn.innerHTML = '<i class="fas fa-trash"></i> Oui, supprimer';
      btn.disabled = false;
    }, 300);
  }
};

window.openAddProductModal = () => {
  currentEditingProductId = null;
  document.getElementById("edit-product-form").reset();
  document.getElementById("edit-modal-title").innerText = "➕ Nouveau Produit";
  document.getElementById("save-product-btn").innerHTML =
    '<i class="fas fa-plus mr-2"></i> Créer le produit';
  document.getElementById("edit-allow-menu").checked = true;
  document.getElementById("edit-has-crudites").checked = false;
  document.getElementById("edit-has-sauces").checked = false;
  populateCategoryDropdown("burgers");

  const modal = document.getElementById("edit-product-modal");
  modal.classList.remove("hidden");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector(".bg-white").classList.remove("scale-95");
  }, 10);
};

// ============================================================================
// 💾 SAUVEGARDE DU PRODUIT (CRÉATION ET ÉDITION)
// ============================================================================
async function saveProduct(event) {
  if (event) event.preventDefault();
  const btn = document.getElementById("save-product-btn");
  if (!btn) return;

  const originalBtnHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Sauvegarde...';
  btn.disabled = true;

  try {
    const { doc, updateDoc, addDoc, collection, serverTimestamp } = window.fs;
    const { ref, uploadBytes, getDownloadURL } = window.storageTools;

    const nom = document.getElementById("edit-nom").value.trim();
    const desc = document.getElementById("edit-desc").value.trim();
    const prix = parseFloat(document.getElementById("edit-prix").value) || 0;
    const prixMenu =
      parseFloat(document.getElementById("edit-prix-menu").value) || 0;
    const fileInput = document.getElementById("edit-img-file");
    const tagChoisi = document.getElementById("edit-tags").value.trim();
    let categorieChoisie = document.getElementById("edit-category").value;
    let categorieTitre = null;

    if (categorieChoisie === "NEW") {
      const newCatRaw = document
        .getElementById("edit-new-category")
        .value.trim();
      if (!newCatRaw) {
        window.showToast("Veuillez saisir le nom de la catégorie", "error");
        btn.innerHTML = originalBtnHtml;
        btn.disabled = false;
        return;
      }
      categorieTitre = newCatRaw;
      categorieChoisie = newCatRaw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "-")
        .replace(/^-+|-+$/g, "");
    }

    const allowMenuCheckbox = document.getElementById("edit-allow-menu");
    const allowMenu = allowMenuCheckbox ? allowMenuCheckbox.checked : true;

    const hasCrudites = document.getElementById("edit-has-crudites").checked;
    let finalCrudites = null;
    if (hasCrudites) {
      const cruditesInput = document.getElementById("edit-crudites-list").value;
      finalCrudites = cruditesInput
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      if (finalCrudites.length === 0)
        finalCrudites = ["Salade", "Tomate", "Oignon"];
    }

    const hasSauces = document.getElementById("edit-has-sauces").checked;
    let finalSauces = null;
    if (hasSauces) {
      const saucesInput = document.getElementById("edit-sauces-list").value;
      const maxSauces =
        parseInt(document.getElementById("edit-sauces-max").value) || 2;
      const listeSauces = saucesInput
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      if (listeSauces.length > 0) {
        finalSauces = { liste: listeSauces, max: maxSauces };
      }
    }

    let updateData = {
      nom,
      description: desc,
      prix,
      menuPriceAdd: prixMenu,
      tags: tagChoisi ? [tagChoisi] : [],
      categorieId: categorieChoisie,
      ...(categorieTitre && { categorieTitre }),
      allowMenu,
      hasCrudites,
      crudites: finalCrudites,
      choixSauces: finalSauces,
      updatedAt: serverTimestamp(),
    };

    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, "")}`;
      const storageReference = ref(
        window.storage,
        `produits/${window.currentAdminSnackId}/${fileName}`,
      );
      await uploadBytes(storageReference, file);
      updateData.image = await getDownloadURL(storageReference);
    }

    if (currentEditingProductId) {
      await updateDoc(
        doc(window.db, "produits", currentEditingProductId),
        updateData,
      );
      window.showToast("Produit mis à jour avec succès !", "success");
    } else {
      updateData.snackId = window.currentAdminSnackId;
      updateData.createdAt = serverTimestamp();
      updateData.isAvailable = true;
      await addDoc(collection(window.db, "produits"), updateData);
      window.showToast("Nouveau produit ajouté !", "success");
    }

    loadAdminProducts();

    const modal = document.getElementById("edit-product-modal");
    if (modal) {
      const modalContent = modal.querySelector(".bg-white");
      modal.classList.add("opacity-0");
      if (modalContent) modalContent.classList.add("scale-95");
      setTimeout(() => {
        modal.classList.add("hidden");
        modal.classList.add("flex", "items-center", "justify-center");
      }, 300);
    }
  } catch (error) {
    console.error("🔥 Erreur de sauvegarde :", error);
    window.showToast("Erreur lors de la sauvegarde.", "error");
  } finally {
    btn.innerHTML = originalBtnHtml;
    btn.disabled = false;
  }
}

// ============================================================================
// 🗂️ CATÉGORIES & UX CHECKBOXES
// ============================================================================
function populateCategoryDropdown(selectedCategory = "burgers") {
  const select = document.getElementById("edit-category");
  const newCatInput = document.getElementById("edit-new-category");

  const categoriesMap = new Map([
    ["tacos", "🌮 Tacos"],
    ["burgers", "🍔 Burgers"],
    ["wraps", "🌯 Wraps & Sandwichs"],
    ["pizzas", "🍕 Pizzas"],
    ["sides", "🍟 Sides (Frites...)"],
    ["drinks", "🥤 Boissons"],
    ["deserts", "🍰 Desserts"],
  ]);

  window.adminProducts.forEach((p) => {
    if (p.categorieId && !categoriesMap.has(p.categorieId)) {
      const title =
        p.categorieTitre ||
        p.categorieId.charAt(0).toUpperCase() + p.categorieId.slice(1);
      categoriesMap.set(p.categorieId, title);
    }
  });

  select.innerHTML = "";
  categoriesMap.forEach((titre, id) => {
    select.innerHTML += `<option value="${id}">${titre}</option>`;
  });
  select.innerHTML += `<option value="NEW" class="font-black text-blue-600">➕ Créer une nouvelle catégorie...</option>`;

  if (categoriesMap.has(selectedCategory)) {
    select.value = selectedCategory;
    newCatInput.classList.add("hidden");
  } else {
    select.value = "burgers";
    newCatInput.classList.add("hidden");
  }
}

document.getElementById("edit-category")?.addEventListener("change", (e) => {
  const newCategoryInput = document.getElementById("edit-new-category");
  if (e.target.value === "NEW") {
    newCategoryInput.classList.remove("hidden");
    newCategoryInput.value = "";
    newCategoryInput.focus();
  } else {
    newCategoryInput.classList.add("hidden");
  }
});

const allowMenuCheckbox = document.getElementById("edit-allow-menu");
const prixMenuContainer = document.getElementById("edit-prix-menu-container");
if (allowMenuCheckbox && prixMenuContainer) {
  allowMenuCheckbox.addEventListener("change", (e) => {
    e.target.checked
      ? prixMenuContainer.classList.replace("hidden", "block")
      : prixMenuContainer.classList.replace("block", "hidden");
  });
}

const cruditesCheckbox = document.getElementById("edit-has-crudites");
const cruditesContainer = document.getElementById("edit-crudites-container");
if (cruditesCheckbox && cruditesContainer) {
  cruditesCheckbox.addEventListener("change", (e) => {
    e.target.checked
      ? cruditesContainer.classList.remove("hidden")
      : cruditesContainer.classList.add("hidden");
  });
}

const saucesCheckbox = document.getElementById("edit-has-sauces");
const saucesContainer = document.getElementById("edit-sauces-container");
if (saucesCheckbox && saucesContainer) {
  saucesCheckbox.addEventListener("change", (e) => {
    e.target.checked
      ? saucesContainer.classList.remove("hidden")
      : saucesContainer.classList.add("hidden");
  });
}

window.loadAdminProducts = loadAdminProducts;
window.toggleProductStatus = toggleProductStatus;
window.openEditModal = openEditModal;
window.openDeleteModal = openDeleteModal;
window.saveProduct = saveProduct;
