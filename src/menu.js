// ============================================================================
// 🍔 MENU — Rendu Réactif et Accessibilité (SOLID: Présentation)
// ============================================================================

import { store } from "./core/Store.js";
import { db, collection, onSnapshot, query, where } from "./core/firebase.js";

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

    // 🕵️‍♂️ SCROLL SPY : Détection de la catégorie active au défilement
    if (this.scrollContainer) {
      this.scrollContainer.addEventListener("scroll", () => this.handleScrollSpy(), { passive: true });
    }
  }

  handleScrollSpy() {
    // Pendant un scroll déclenché par un clic sur une pille, on ne laisse PAS le spy
    // réagir : sinon il émet des recentrages concurrents qui interrompent le scroll
    // au clic et le font atterrir court (bug sauts longs cat1→cat4).
    if (this.isProgrammaticScroll) return;

    const sections = this.container.querySelectorAll(".menu-section");
    const nav = document.getElementById("menu-categories-nav");
    if (!sections.length || !nav) return;

    const containerRect = this.scrollContainer.getBoundingClientRect();
    // La hauteur typique du header sticky + nav est d'environ 120px-140px. On place la ligne de détection juste en dessous.
    const detectionY = containerRect.top + 160;

    let activeCatId = sections[0].getAttribute("data-cat-id"); // Fallback par défaut

    // Vérifier si l'utilisateur a scrollé tout en bas avec une tolérance plus souple (iOS / paddings)
    const scrollPosition = this.scrollContainer.scrollTop + this.scrollContainer.clientHeight;
    const isAtBottom = scrollPosition >= this.scrollContainer.scrollHeight - 100;

    if (isAtBottom) {
      activeCatId = sections[sections.length - 1].getAttribute("data-cat-id");
    } else {
      // Parcourir à l'envers pour trouver la dernière section dont le haut a franchi la ligne de détection
      for (let i = sections.length - 1; i >= 0; i--) {
        const rect = sections[i].getBoundingClientRect();
        if (rect.top <= detectionY) {
          activeCatId = sections[i].getAttribute("data-cat-id");
          break;
        }
      }
    }

    if (activeCatId && activeCatId !== this.currentActiveCatId) {
      this.setActivePill(activeCatId);
    }
  }

  /**
   * Surligne la pille de la catégorie active et la recentre dans la nav HORIZONTALE.
   * ⚠️ On ne fait JAMAIS `pill.scrollIntoView()` : ça scrollerait aussi le conteneur
   * vertical `#full-menu` et casserait le scroll-au-clic. On ne touche que `nav.scrollLeft`.
   * @param {string} activeCatId
   */
  setActivePill(activeCatId) {
    const nav = document.getElementById("menu-categories-nav");
    if (!nav) return;
    this.currentActiveCatId = activeCatId;

    const pills = nav.querySelectorAll(".cat-pill");
    pills.forEach((pill) => {
      const isTarget = pill.getAttribute("data-cat-id") === activeCatId;
      pill.classList.toggle("bg-gray-900", isTarget);
      pill.classList.toggle("text-on-dark", isTarget);
      pill.classList.toggle("bg-surface-2", !isTarget);
      pill.classList.toggle("text-text-muted", !isTarget);

      if (isTarget) {
        // Centrage horizontal de la pille DANS la nav uniquement (pas d'ancêtre vertical).
        const left =
          pill.getBoundingClientRect().left - nav.getBoundingClientRect().left +
          nav.scrollLeft + pill.offsetWidth / 2 - nav.clientWidth / 2;
        nav.scrollTo({ left, behavior: "smooth" });
      }
    });
  }

  render() {
    const menu = store.state.menu;
    if (!menu || menu.length === 0) return;

    this.renderFullMenu(menu);
    this.renderBestSellers(menu);
    this.renderCategoriesNav(menu);

    // Initialisation immédiate du Scroll Spy pour la première catégorie
    setTimeout(() => this.handleScrollSpy(), 50);
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
      title.className = "text-2xl font-black text-text uppercase tracking-tight";
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
    const placeholder = clone.querySelector(".menu-item-placeholder");

    if (p.image) {
      img.src = p.image;
      img.alt = p.nom;
      img.onerror = () => {
        img.classList.add("hidden");
        placeholder?.classList.remove("hidden");
      };
    } else {
      img.classList.add("hidden");
      placeholder?.classList.remove("hidden");
    }

    clone.querySelector(".menu-item-name").textContent = p.nom;
    clone.querySelector(".menu-item-price").textContent = `${p.prix.toFixed(2)} €`;
    clone.querySelector(".menu-item-desc").textContent = p.description || "";

    const badge = clone.querySelector(".menu-item-badge");
    
    // 1. Épuisé prend toujours la priorité visuelle absolue
    if (p.isAvailable === false) {
      badge.textContent = "Épuisé";
      badge.className = "menu-item-badge absolute top-3 right-3 bg-danger/90 backdrop-blur px-3 py-1.5 rounded-2xl text-[10px] font-black uppercase tracking-tighter text-on-dark shadow-sm";
      img.classList.add("grayscale", "opacity-50");
      
      const btn = clone.querySelector("[data-lucide='plus']").parentElement;
      btn.className = "w-8 h-8 rounded-full bg-surface-3 text-text-muted flex items-center justify-center";
      btn.innerHTML = `<i data-lucide="ban" class="text-xs"></i>`;
    } 
    // 2. Sinon, on affiche le badge (string) ou le premier tag de l'array
    else {
      const badgeText = p.badge || (Array.isArray(p.tags) && p.tags.length > 0 ? p.tags[0] : null);
      if (badgeText) {
        badge.textContent = badgeText;
        badge.classList.remove("hidden");
      }
    }

    const tagsContainer = clone.querySelector(".flex.gap-2");
    
    // Ancien système (isVegan, isSpicy) - conservé pour rétrocompatibilité
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
      btn.className = "cat-pill whitespace-nowrap px-4 py-2 rounded-xl bg-surface-2 text-text-muted font-bold text-sm transition-all active:scale-95 border-2 border-transparent";
      btn.textContent = this.getCategoryName(catId);
      btn.setAttribute("data-cat-id", catId);
      btn.onclick = () => {
        const target = document.getElementById(`cat-${catId}`);
        if (target && this.scrollContainer) {
            // Gèle le scroll-spy le temps du scroll programmatique (sinon il interrompt
            // le saut et on atterrit court). On surligne tout de suite la pille cliquée.
            this.isProgrammaticScroll = true;
            clearTimeout(this._spyResumeTimer);
            this.setActivePill(catId);

            const headerHeight = document.querySelector('#full-menu .sticky')?.offsetHeight || 120;
            const targetPos = (target.getBoundingClientRect().top - this.scrollContainer.getBoundingClientRect().top) + this.scrollContainer.scrollTop - headerHeight - 10;
            this.scrollContainer.scrollTo({ top: targetPos, behavior: 'smooth' });

            // Réactive le spy une fois le scroll fluide stabilisé.
            this._spyResumeTimer = setTimeout(() => { this.isProgrammaticScroll = false; }, 700);
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

  // 🔄 On ferme l'écoute précédente AVANT d'en ouvrir une nouvelle.
  // chargerMenuComplet est rappelé à chaque onAuthStateChanged (login/logout,
  // refresh de token Firebase ~1h) et à chaque pull-to-refresh. Sans ce teardown,
  // les listeners onSnapshot s'empilent → coût lectures temps réel + callbacks
  // store.setMenu multiples re-déclenchant le rendu. (cf. admin-products.js:13)
  if (typeof window.__menuUnsub === "function") {
    window.__menuUnsub();
    window.__menuUnsub = null;
  }

  const q = query(collection(db, "produits"), where("snackId", "==", snackId));

  // Écoute en temps réel les changements de produits (stocks, prix, etc.)
  const unsub = onSnapshot(q, (snapshot) => {
    let tousLesProduits = [];
    snapshot.forEach((doc) => {
      tousLesProduits.push({ id: doc.id, ...doc.data() });
    });

    store.setMenu(tousLesProduits);
    window.dispatchEvent(new CustomEvent("snack:menu:ready"));
  }, (err) => {
    console.error("Erreur temps réel menu :", err);
  });

  window.__menuUnsub = unsub;
  return unsub;
};
