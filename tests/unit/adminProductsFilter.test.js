// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/utils.js", () => ({
  escapeHTML: (s) => String(s ?? ""),
  safeURL: (s) => String(s ?? ""),
  showToast: vi.fn(),
}));

vi.mock("../../src/core/firebase.js", () => ({
  db: {},
  storage: {},
  fs: {},
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  updateDoc: vi.fn(),
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
}));

vi.mock("../../src/utils/ModalManager.js", () => ({
  confirmAction: vi.fn(),
}));

import { adminStore } from "../../src/core/AdminStore.js";
import { adminProductsUI } from "../../src/ui/AdminProductsUI.js";

function setupAdminProductsDOM() {
  document.body.innerHTML = `
    <div id="view-menu">
      <input type="text" id="admin-product-search" value="">
      <button id="admin-product-search-clear" class="hidden"></button>
      <select id="admin-product-category">
        <option value="">Toutes les catégories</option>
      </select>
      <div id="admin-category-pills"></div>
      <div id="admin-products-filter-status" class="hidden">
        <span id="admin-products-count-text"></span>
      </div>
      <div id="admin-products-grid"></div>
    </div>
  `;
}

const mockProducts = [
  { id: "p1", nom: "Classic Cheese", description: "Délicieux burger cheddar", categorieId: "burgers", prix: 9.50, isAvailable: true },
  { id: "p2", nom: "Smash Bacon", description: "Double steak smashé", categorieId: "burgers", prix: 11.50, isAvailable: true },
  { id: "p3", nom: "Tacos 2 Viandes", description: "Sauce fromagère maison", categorieId: "tacos", prix: 8.50, isAvailable: true },
  { id: "p4", nom: "Coca-Cola 33cl", description: "Canette fraîche", categorieId: "drinks", prix: 2.50, isAvailable: true },
];

describe("AdminProductsUI - Filtrage par catégorie et recherche", () => {
  beforeEach(() => {
    setupAdminProductsDOM();
    adminProductsUI.grid = document.getElementById("admin-products-grid");
    adminStore.setProducts(mockProducts);
  });

  it("génère les pills de catégories avec emojis et décomptes exacts", () => {
    adminProductsUI.render();

    const pillsContainer = document.getElementById("admin-category-pills");
    const pills = Array.from(pillsContainer.querySelectorAll(".category-pill"));

    expect(pills.length).toBe(4); // Toutes + burgers + tacos + drinks

    const allPill = pills[0];
    expect(allPill.textContent).toContain("Toutes");
    expect(allPill.textContent).toContain("4");
    expect(allPill.getAttribute("aria-selected")).toBe("true");

    const burgerPill = pills.find(p => p.getAttribute("data-category") === "burgers");
    expect(burgerPill).toBeDefined();
    expect(burgerPill.textContent).toContain("Burgers");
    expect(burgerPill.textContent).toContain("2");

    const tacosPill = pills.find(p => p.getAttribute("data-category") === "tacos");
    expect(tacosPill).toBeDefined();
    expect(tacosPill.textContent).toContain("Tacos");
    expect(tacosPill.textContent).toContain("1");
  });

  it("filtre les produits lorsqu'une catégorie est sélectionnée via window.setAdminProductCategory", () => {
    window.setAdminProductCategory("burgers");

    const categorySelect = document.getElementById("admin-product-category");
    expect(categorySelect.value).toBe("burgers");

    const grid = document.getElementById("admin-products-grid");
    expect(grid.textContent).toContain("Classic Cheese");
    expect(grid.textContent).toContain("Smash Bacon");
    expect(grid.textContent).not.toContain("Tacos 2 Viandes");
    expect(grid.textContent).not.toContain("Coca-Cola");

    const pillsContainer = document.getElementById("admin-category-pills");
    const burgerPill = pillsContainer.querySelector('[data-category="burgers"]');
    expect(burgerPill.getAttribute("aria-selected")).toBe("true");

    const statusText = document.getElementById("admin-products-count-text");
    expect(statusText.textContent).toContain("2 produits trouvés sur 4");
    expect(statusText.textContent).toContain("Burgers");
  });

  it("combine la recherche textuelle et le filtre de catégorie", () => {
    window.setAdminProductCategory("burgers");
    const searchInput = document.getElementById("admin-product-search");
    searchInput.value = "bacon";

    window.filterAdminProducts();

    const grid = document.getElementById("admin-products-grid");
    expect(grid.textContent).toContain("Smash Bacon");
    expect(grid.textContent).not.toContain("Classic Cheese");

    const clearBtn = document.getElementById("admin-product-search-clear");
    expect(clearBtn.classList.contains("hidden")).toBe(false);
  });

  it("affiche un état vide élégant et permet la réinitialisation si aucun produit ne correspond", () => {
    const searchInput = document.getElementById("admin-product-search");
    searchInput.value = "introuvable";
    window.filterAdminProducts();

    const grid = document.getElementById("admin-products-grid");
    expect(grid.textContent).toContain("Aucun produit ne correspond à vos filtres");
    expect(grid.textContent).toContain("Réinitialiser les filtres");

    // Test de la réinitialisation
    window.resetAdminProductFilters();

    expect(searchInput.value).toBe("");
    expect(document.getElementById("admin-product-category").value).toBe("");
    expect(grid.textContent).toContain("Classic Cheese");
    expect(grid.textContent).toContain("Tacos 2 Viandes");
  });

  it("vide la recherche avec window.clearAdminProductSearch", () => {
    const searchInput = document.getElementById("admin-product-search");
    searchInput.value = "Classic";
    window.filterAdminProducts();

    expect(document.getElementById("admin-products-grid").textContent).toContain("Classic Cheese");

    window.clearAdminProductSearch();

    expect(searchInput.value).toBe("");
    expect(document.getElementById("admin-products-grid").children.length).toBe(4);
  });
});
