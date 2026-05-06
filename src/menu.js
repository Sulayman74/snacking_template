// ============================================================================
// 🍔 MENU — Rendu Réactif et Accessibilité (SOLID: Présentation)
// ============================================================================

import { store } from "./core/Store.js";

class MenuUI {
  constructor() {
    this.container = document.getElementById("full-menu-container");
    this.bestSellersContainer = document.getElementById("bestsellers-container");
    this.template = document.getElementById("menu-item-template");
    this.scrollContainer = document.getElementById("full-menu");
    
    this.init();
  }

  init() {
    // Écoute les mises à jour du menu dans le Store
    store.addEventListener("menu-updated", () => this.render());
    
    // Gestion de la recherche
    const searchInput = document.getElementById("menu-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => this.handleSearch(e.target.value));
    }

    // Gestion du bouton de nettoyage de recherche
    const clearBtn = document.getElementById("clear-search-btn");
    if (clearBtn) {
      clearBtn.onclick = () => {
        searchInput.value = "";
        this.handleSearch("");
        clearBtn.classList.add("hidden");
      };
    }
  }

  render() {
    const menu = store.state.menu;
    if (!menu || menu.length === 0) return;

    this.renderFullMenu(menu);
    this.renderBestSellers(menu);
    this.renderCategoriesNav(menu);
  }

  renderFullMenu(menu, filter = "") {
    if (!this.container) return;
    this.container.innerHTML = "";

    const categories = [...new Set(menu.map((p) => p.categorieId))].filter(Boolean);
    const fragment = document.createDocumentFragment();

    categories.forEach((catId) => {
      const catProduits = menu.filter(
        (p) => p.categorieId === catId && 
        (p.nom.toLowerCase().includes(filter.toLowerCase()) || (p.description || "").toLowerCase().includes(filter.toLowerCase()))
      );

      if (catProduits.length === 0) return;

      const section = document.createElement("section");
      section.className = "menu-section mb-10 pt-4 scroll-mt-32";
      section.id = `cat-${catId}`;
      section.setAttribute("data-cat-id", catId);
      
      const header = document.createElement("div");
      header.className = "flex items-center gap-3 mb-6";
      
      const title = document.createElement("h2");
      title.className = "text-2xl font-black text-gray-900 uppercase tracking-tight";
      title.textContent = this.getCategoryName(catId);
      
      header.appendChild(title);
      const divider = document.createElement("div");
      divider.className = "flex-1 h-px bg-accent";
      header.appendChild(divider);
      
      section.appendChild(header);

      const grid = document.createElement("div");
      grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6";
      grid.setAttribute("role", "list");

      catProduits.forEach((p) => {
        const item = this.createMenuItem(p);
        grid.appendChild(item);
      });

      section.appendChild(grid);
      fragment.appendChild(section);
    });

    this.container.appendChild(fragment);
  }

  createMenuItem(p) {
    const clone = this.template.content.cloneNode(true);
    const root = clone.querySelector("[role='listitem']");
    
    root.setAttribute("data-action", "open-product-modal");
    root.setAttribute("data-id", p.id);

    const img = clone.querySelector(".menu-item-image");
    img.src = p.image || "./assets/logo.webp";
    img.alt = p.nom;
    img.onerror = () => { img.src = "./assets/logo.webp"; };

    clone.querySelector(".menu-item-name").textContent = p.nom;
    clone.querySelector(".menu-item-price").textContent = `${p.prix.toFixed(2)} €`;
    clone.querySelector(".menu-item-desc").textContent = p.description || "";

    if (p.badge) {
      const badge = clone.querySelector(".menu-item-badge");
      badge.textContent = p.badge;
      badge.classList.remove("hidden");
    }

    if (p.isVegan) clone.querySelector(".menu-item-tag-vegan").classList.remove("hidden");
    if (p.isSpicy) clone.querySelector(".menu-item-tag-spicy").classList.remove("hidden");

    return clone;
  }

  renderBestSellers(menu) {
    if (!this.bestSellersContainer) return;
    this.bestSellersContainer.innerHTML = "";

    const top3 = [...menu].sort((a, b) => (b.ventes || 0) - (a.ventes || 0)).slice(0, 3);
    const fragment = document.createDocumentFragment();

    top3.forEach((p) => {
      const item = this.createMenuItem(p);
      // Pour les bestsellers, on ajoute une classe spécifique pour le scroll horizontal sur mobile
      const wrapper = item.querySelector("[role='listitem']");
      wrapper.classList.add("snap-center", "shrink-0", "w-[85%]", "md:w-auto");
      fragment.appendChild(item);
    });

    this.bestSellersContainer.appendChild(fragment);
  }

  renderCategoriesNav(menu) {
    const nav = document.getElementById("menu-categories-nav");
    if (!nav) return;
    nav.innerHTML = "";

    const categories = [...new Set(menu.map((p) => p.categorieId))].filter(Boolean);
    categories.forEach((catId) => {
      const btn = document.createElement("button");
      btn.className = "cat-pill whitespace-nowrap px-4 py-2 rounded-xl bg-gray-100 text-gray-600 font-bold text-sm transition-all active:scale-95 border-2 border-transparent";
      btn.textContent = this.getCategoryName(catId);
      btn.onclick = () => {
        const target = document.getElementById(`cat-${catId}`);
        if (target && this.scrollContainer) {
            const headerHeight = document.querySelector('#full-menu .sticky')?.offsetHeight || 120;
            const targetPos = (target.getBoundingClientRect().top - this.scrollContainer.getBoundingClientRect().top) + this.scrollContainer.scrollTop - headerHeight - 10;
            this.scrollContainer.scrollTo({ top: targetPos, behavior: 'smooth' });
        }
      };
      nav.appendChild(btn);
    });
  }

  getCategoryName(id) {
    const names = {
      burgers: "🍔 Burgers",
      tacos: "🌯 Tacos",
      drinks: "🥤 Boissons",
      sides: "🍟 Accompagnements",
      desserts: "🍰 Desserts"
    };
    return names[id] || id.charAt(0).toUpperCase() + id.slice(1);
  }

  handleSearch(query) {
    const clearBtn = document.getElementById("clear-search-btn");
    if (clearBtn) {
      if (query) clearBtn.classList.remove("hidden");
      else clearBtn.classList.add("hidden");
    }
    this.renderFullMenu(store.state.menu, query);
  }
}

export const menuUI = new MenuUI();

// Compatibilité globale (Temps Réel)
window.chargerMenuComplet = () => {
  const cfg = store.state.config;
  const snackId = cfg?.identity?.id;
  if (!snackId) return;

  const { query, collection, where, onSnapshot } = window.fs;
  const q = query(collection(window.db, "produits"), where("snackId", "==", snackId));

  // Écoute en temps réel les changements de produits (stocks, prix, etc.)
  return onSnapshot(q, (snapshot) => {
    let tousLesProduits = [];
    snapshot.forEach((doc) => {
      tousLesProduits.push({ id: doc.id, ...doc.data() });
    });

    store.setMenu(tousLesProduits);
    window.dispatchEvent(new CustomEvent("snack:menu:ready"));
  }, (err) => {
    console.error("Erreur temps réel menu :", err);
  });
};
