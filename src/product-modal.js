// ============================================================================
// 📦 MODALE PRODUIT — Détails et Options (SOLID: Présentation)
// ============================================================================

import { store } from "./core/Store.js";
import { escapeHTML, showToast, triggerVibration } from "./utils.js";

class ProductModalUI {
  constructor() {
    this.backdrop = document.getElementById("product-modal-backdrop");
    this.modal = document.getElementById("product-modal");
    this.closeBtn = document.getElementById("close-product-modal");
    
    this.currentProduct = null;
    this.#init();
  }

  #init() {
    // Fermeture Esc
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.modal.classList.contains("translate-y-full")) {
        this.close();
      }
    });

    // Fermeture clic backdrop
    if (this.backdrop) {
      this.backdrop.onclick = () => this.close();
    }
  }

  open(itemId) {
    const { menu, config: cfg } = store.state;
    const item = menu.find((i) => i.id === itemId || i.nom === itemId);
    
    if (!item) return;

    window.history.pushState(null, null, "#modal");
    
    this.currentProduct = {
      id: item.id,
      nom: item.nom,
      prixBase: item.prix,
      prixMenu: item.menuPriceAdd || 2.5,
      image: item.image,
      allowMenu: item.allowMenu !== false,
      tailleChoisie: null,
    };

    this.#renderContent(item, cfg);
    this.#show();
    this.#setupFocusTrap();
  }

  #renderContent(item, cfg) {
    const devise = cfg.identity.currency || "€";
    
    // Images & Textes (Sécurisés via textContent)
    const modalImg = document.getElementById("modal-img");
    if (modalImg) {
      const applyFallback = () => {
        modalImg.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'><rect width='100%25' height='100%25' fill='transparent'/><text x='50%25' y='50%25' font-family='sans-serif' font-size='24' font-weight='bold' fill='%239ca3af' text-anchor='middle' dominant-baseline='middle'>👨‍🍳 Photo en cours...</text></svg>";
        modalImg.classList.remove("object-cover");
        modalImg.classList.add("object-contain", "p-6", "bg-gray-50");
      };

      const removeFallbackStyles = () => {
        modalImg.classList.add("object-cover");
        modalImg.classList.remove("object-contain", "p-6", "bg-gray-50");
      };

      if (item.image) {
        modalImg.src = item.image;
        removeFallbackStyles();
        modalImg.onerror = applyFallback;
      } else {
        applyFallback();
      }
      modalImg.alt = item.nom;
    }

    document.getElementById("modal-title").textContent = item.nom;
    document.getElementById("modal-desc").textContent = item.description || "";

    // Bouton partage viral (deep link vers ce produit)
    this.#updateShareButton(item, cfg);

    // Allergènes
    const allergenContainer = document.getElementById("modal-allergens-container");
    const allergenText = document.getElementById("modal-allergens");
    if (item.allergenes?.length > 0) {
      allergenContainer?.classList.remove("hidden");
      if (allergenText) allergenText.textContent = item.allergenes.join(", ");
    } else {
      allergenContainer?.classList.add("hidden");
    }

    // Options
    const optionsContainer = document.getElementById("modal-options-container");
    const btn = document.getElementById("modal-cta");
    
    // Un produit est disponible par défaut, sauf s'il est explicitement marqué comme épuisé (false)
    if (item.isAvailable === false) {
      optionsContainer?.classList.add("hidden");
      document.getElementById("modal-fav-btn")?.classList.add("hidden");
      if (btn) {
        btn.textContent = "Épuisé";
        btn.className = "w-full py-4 rounded-xl font-bold text-on-dark bg-gray-500 cursor-not-allowed flex justify-center items-center gap-2";
        btn.onclick = null;
      }
      return;
    }

    this.#renderOptions(item, cfg, optionsContainer);
    this.#updateCTA(cfg, btn);
    this.#updateFavButton(cfg);
  }

  /** Affiche/branche le bouton cœur "favori" (uniquement si commande possible). */
  #updateFavButton(cfg) {
    const btn = document.getElementById("modal-fav-btn");
    if (!btn) return;

    const isOrderingEnabled = cfg.features?.enableClickAndCollect !== false;
    if (!isOrderingEnabled || !this.currentProduct?.id) {
      btn.classList.add("hidden");
      return;
    }

    btn.classList.remove("hidden");
    btn.onclick = async () => {
      await window.favoritesService?.toggle(this.#buildCartItem());
      this.refreshFavButton();
    };
    this.refreshFavButton();
  }

  /** Met le cœur à jour selon que la personnalisation courante est déjà en favori. */
  refreshFavButton() {
    const btn = document.getElementById("modal-fav-btn");
    if (!btn || btn.classList.contains("hidden")) return;

    const isFav = window.favoritesService?.isFavorite(this.#buildCartItem());
    const icon = btn.querySelector("i");
    btn.setAttribute("aria-pressed", isFav ? "true" : "false");
    btn.setAttribute("aria-label", isFav ? "Retirer des favoris" : "Ajouter aux favoris");

    if (isFav) {
      if (icon) icon.className = "fas fa-heart";
      btn.classList.add("text-red-500", "border-red-200");
      btn.classList.remove("text-text-muted", "border-gray-200");
    } else {
      if (icon) icon.className = "far fa-heart";
      btn.classList.add("text-text-muted", "border-gray-200");
      btn.classList.remove("text-red-500", "border-red-200");
    }
  }

  #renderOptions(item, cfg, container) {
    const isOrderingEnabled = cfg.features?.enableClickAndCollect !== false;
    
    if (!isOrderingEnabled) {
        container?.classList.add("hidden");
        return;
    }

    container?.classList.remove("hidden");
    let html = "";
    const devise = cfg.identity.currency || "€";

    // Module Tailles (Pizzas)
    if (item.tailles?.length > 0) {
      this.currentProduct.allowMenu = false;
      this.currentProduct.prixBase = item.tailles[0].prix;
      this.currentProduct.tailleChoisie = item.tailles[0].nom;

      html += `<fieldset class="mb-4">
        <legend class="text-lg font-black text-text mb-2 flex justify-between items-center">
            <span>Taille</span>
            <span class="text-[10px] font-black bg-primary text-on-primary px-2 py-1 rounded uppercase tracking-widest">Obligatoire</span>
        </legend>
        <div class="grid grid-cols-2 gap-3">
            ${item.tailles.map((t, i) => {
                const safeNom = escapeHTML(t.nom || "");
                const safePrix = (parseFloat(t.prix) || 0).toFixed(2);
                return `
                <label class="relative cursor-pointer">
                    <input type="radio" name="taille_produit" value="${safeNom}" data-prix="${safePrix}" ${i === 0 ? "checked" : ""} class="sr-only peer" onchange="window.updateProductSize(this)">
                    <div class="p-4 border-2 border-gray-100 rounded-2xl peer-checked:border-accent peer-checked:bg-primary-light transition-all flex flex-col items-center">
                        <span class="font-bold text-text">${safeNom}</span>
                        <span class="font-black text-accent text-sm">${safePrix} ${escapeHTML(devise)}</span>
                    </div>
                </label>
            `;}).join("")}
        </div>
      </fieldset>`;
    }

    // Module Menu (Burgers/Tacos)
    else if (this.currentProduct.allowMenu) {
      const drinks = store.state.menu.filter(i => i.categorieId === "drinks" && i.isAvailable !== false);
      html += `<fieldset class="mb-4">
        <legend class="text-lg font-black text-text mb-2 flex justify-between items-center">
            <span>Formule</span>
            <span class="text-[10px] font-black bg-primary text-on-primary px-2 py-1 rounded uppercase tracking-widest">Obligatoire</span>
        </legend>
        <div class="grid grid-cols-2 gap-3">
            <label class="relative cursor-pointer">
                <input type="radio" name="formule" value="seul" checked class="sr-only peer" onchange="window.toggleDrinkSection()">
                <div class="p-4 border-2 border-gray-100 rounded-2xl peer-checked:border-accent peer-checked:bg-primary-light transition-all flex flex-col items-center">
                    <span class="font-bold text-text">Seul</span>
                    <span class="text-sm font-black text-gray-500">${this.currentProduct.prixBase.toFixed(2)} ${devise}</span>
                </div>
            </label>
            <label class="relative cursor-pointer">
                <input type="radio" name="formule" value="menu" class="sr-only peer" onchange="window.toggleDrinkSection()">
                <div class="p-4 border-2 border-gray-100 rounded-2xl peer-checked:border-accent peer-checked:bg-primary-light transition-all flex flex-col items-center">
                    <span class="font-bold text-text">En Menu</span>
                    <span class="text-sm font-black text-accent">+ ${this.currentProduct.prixMenu.toFixed(2)} ${devise}</span>
                </div>
            </label>
        </div>
      </fieldset>
      <fieldset id="drink-section" class="mb-4 hidden opacity-0 transition-all">
        <legend class="text-lg font-black text-text mb-2">Votre Boisson</legend>
        <div class="grid grid-cols-2 gap-3">
            ${drinks.slice(0, 6).map((d, i) => {
                const safeNom = escapeHTML(d.nom || "");
                return `
                <label class="relative cursor-pointer">
                    <input type="radio" name="boisson" value="${safeNom}" ${i === 0 ? "checked" : ""} class="sr-only peer">
                    <div class="p-3 border-2 border-gray-100 rounded-xl peer-checked:border-accent peer-checked:bg-primary-light transition-all flex items-center gap-2">
                        <i class="fas fa-glass-water text-accent"></i>
                        <span class="font-bold text-text text-sm">${safeNom}</span>
                    </div>
                </label>
            `;}).join("")}
        </div>
      </fieldset>`;
    }

    // Sauces
    if (item.choixSauces) {
      const max = parseInt(item.choixSauces.max) || 2;
      const list = item.choixSauces.liste || ["Blanche", "Algérienne", "Samouraï", "Mayonnaise"];
      html += `<fieldset class="mb-4">
        <legend class="text-lg font-black text-text mb-2 flex justify-between items-center">
            <span>Sauces (${max} max)</span>
            <span class="text-[10px] font-black bg-gray-900 text-on-dark px-2 py-1 rounded-full uppercase tracking-widest">
                <span id="sauce-counter-ui">0</span> / ${max}
            </span>
        </legend>
        <div class="grid grid-cols-2 gap-3">
            ${list.map(s => {
                const safe = escapeHTML(s || "");
                return `
                <label class="relative cursor-pointer">
                    <input type="checkbox" name="sauce" value="${safe}" data-max="${max}" class="sr-only peer sauce-checkbox" onchange="window.checkSauceLimit(event, ${max})">
                    <div class="p-3 border-2 border-gray-100 rounded-xl peer-checked:border-accent peer-checked:bg-primary-light transition-all flex justify-center items-center">
                        <span class="font-bold text-text text-sm">${safe}</span>
                    </div>
                </label>
            `;}).join("")}
        </div>
      </fieldset>`;
    }

    // Crudités : le client coche celles à RETIRER (→ sansCrudites). Source : champ
    // produit `crudites` configuré côté admin quand `hasCrudites`. Consommé tel quel
    // par la cuisine (admin-kitchen), le panier et les favoris.
    if (this.currentProduct.hasCrudites && Array.isArray(this.currentProduct.crudites) && this.currentProduct.crudites.length) {
      html += `<fieldset class="mb-4">
        <legend class="text-lg font-black text-text mb-2 flex justify-between items-center">
            <span>Crudités</span>
            <span class="text-[10px] font-black bg-gray-900 text-on-dark px-2 py-1 rounded-full uppercase tracking-widest">À retirer</span>
        </legend>
        <div class="grid grid-cols-2 gap-3">
            ${this.currentProduct.crudites.map(c => {
                const safe = escapeHTML(c || "");
                return `
                <label class="relative cursor-pointer">
                    <input type="checkbox" name="crudite" value="${safe}" class="sr-only peer crudite-checkbox">
                    <div class="p-3 border-2 border-gray-100 rounded-xl peer-checked:border-red-400 peer-checked:bg-red-50 transition-all flex justify-center items-center">
                        <span class="font-bold text-text text-sm">Sans ${safe}</span>
                    </div>
                </label>
            `;}).join("")}
        </div>
      </fieldset>`;
    }

    container.innerHTML = html;
  }

  #updateShareButton(item, cfg) {
    const shareBtn = document.getElementById("modal-share-btn");
    if (!shareBtn) return;

    if (!cfg.features?.enableViralShare) {
      shareBtn.classList.add("hidden");
      shareBtn.onclick = null;
      return;
    }

    shareBtn.classList.remove("hidden");
    shareBtn.onclick = async () => {
      const url = `${window.location.origin}${window.location.pathname}?action=product&id=${encodeURIComponent(item.id)}`;
      const shareData = {
        title: `🍔 ${item.nom} chez ${cfg.identity?.name || "ce snack"}`,
        text: `Regarde ce que je viens de trouver : ${item.nom}. Tu vas adorer !`,
        url,
      };

      try {
        if (navigator.share) {
          await navigator.share(shareData);
        } else {
          await navigator.clipboard.writeText(url);
          showToast("Lien copié ! 📋", "success");
        }
        triggerVibration?.("light");
      } catch (err) {
        if (err?.name !== "AbortError") console.error("Erreur partage produit :", err);
      }
    };
  }

  #updateCTA(cfg, btn) {
    if (!btn) return;
    const devise = cfg.identity.currency || "€";
    const isOrderingEnabled = cfg.features?.enableClickAndCollect !== false;

    if (isOrderingEnabled) {
      btn.innerHTML = `<span>Ajouter - ${this.currentProduct.prixBase.toFixed(2)} ${devise}</span>`;
      btn.className = "w-full py-4 rounded-xl font-bold text-on-dark bg-gray-900 hover:bg-primary hover:scale-105 transition-all flex justify-center items-center gap-2";
      btn.onclick = () => window.confirmAddToCart();
    } else {
      btn.textContent = "Fermer";
      btn.className = "w-full py-4 rounded-xl font-bold text-text bg-gray-100 hover:bg-gray-200 transition-all flex justify-center items-center gap-2";
      btn.onclick = () => this.close();
    }
  }

  #show() {
    if (!this.backdrop || !this.modal) return;
    this.backdrop.classList.remove("hidden");
    setTimeout(() => {
      this.backdrop.classList.remove("opacity-0");
      this.modal.classList.remove("translate-y-full", "md:opacity-0", "md:scale-95", "md:pointer-events-none");
    }, 10);
    document.body.style.overflow = "hidden";
  }

  close() {
    if (!this.backdrop || !this.modal) return;
    this.modal.classList.add("translate-y-full", "md:opacity-0", "md:scale-95", "md:pointer-events-none");
    this.backdrop.classList.add("opacity-0");
    setTimeout(() => {
      this.backdrop.classList.add("hidden");
      document.body.style.overflow = "";
    }, 300);
  }

  #setupFocusTrap() {
    const focusable = this.modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    this.modal.onkeydown = (e) => {
      if (e.key === "Tab") {
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    setTimeout(() => first.focus(), 100);
  }

  /**
   * Construit l'article au format panier depuis l'état courant du formulaire.
   * Source unique consommée par l'ajout au panier ET la mise en favori (DRY).
   * @returns {Object} Article personnalisé ({id, productId, nom, prix, image, formule, sauces, boisson, taille}).
   */
  #buildCartItem() {
    const formule = document.querySelector('input[name="formule"]:checked')?.value || "seul";
    const isMenu = formule === "menu";
    const sauces = Array.from(document.querySelectorAll(".sauce-checkbox:checked")).map((cb) => cb.value);
    const boisson = isMenu ? (document.querySelector('input[name="boisson"]:checked')?.value || null) : null;
    const sansCrudites = Array.from(document.querySelectorAll(".crudite-checkbox:checked")).map((cb) => cb.value);
    const taille = this.currentProduct.tailleChoisie || null;

    return {
      // ⚠️ La clé `id` doit inclure TOUTES les options qui distinguent deux
      // articles (boisson, sansCrudites compris), sinon store.addToCart fusionne
      // par id → mauvaise boisson servie / exclusion perdue.
      id: `${this.currentProduct.id}-${formule}-${sauces.join("-")}-${boisson || ""}-${sansCrudites.join("-")}-${taille || ""}`,
      productId: this.currentProduct.id,
      nom: isMenu ? `Menu ${this.currentProduct.nom}` : this.currentProduct.nom,
      prix: this.currentProduct.prixBase + (isMenu ? this.currentProduct.prixMenu : 0),
      image: this.currentProduct.image,
      formule,
      sauces,
      boisson,
      sansCrudites,
      taille,
    };
  }

  confirmAddToCart() {
    const item = this.#buildCartItem();
    if (item.formule === "menu" && !item.boisson) return showToast("Choisissez une boisson", "error");

    store.addToCart(item);

    showToast("Ajouté au panier ! 🍔", "success");
    triggerVibration("success");
    this.close();
  }
}

export const productModalUI = new ProductModalUI();

// Bridge globals
window.openProductModal = (id) => productModalUI.open(id);
window.closeProductModal = () => productModalUI.close();
window.confirmAddToCart = () => productModalUI.confirmAddToCart();
window.toggleDrinkSection = () => {
    const drinkSection = document.getElementById("drink-section");
    const isMenu = document.querySelector('input[name="formule"]:checked')?.value === "menu";
    if (isMenu) {
        drinkSection?.classList.remove("hidden");
        setTimeout(() => drinkSection?.classList.add("opacity-100"), 10);
    } else {
        drinkSection?.classList.add("hidden");
        drinkSection?.classList.remove("opacity-100");
    }
    // Update price in CTA
    const btn = document.getElementById("modal-cta");
    const devise = store.state.config.identity.currency || "€";
    const prix = productModalUI.currentProduct.prixBase + (isMenu ? productModalUI.currentProduct.prixMenu : 0);
    if (btn) btn.innerHTML = `<span>Ajouter - ${prix.toFixed(2)} ${devise}</span>`;
    productModalUI.refreshFavButton();
};
window.checkSauceLimit = (e, max) => {
    const checked = document.querySelectorAll(".sauce-checkbox:checked");
    const counter = document.getElementById("sauce-counter-ui");
    if (counter) counter.textContent = checked.length;
    if (checked.length > max) {
        e.target.checked = false;
        if (counter) counter.textContent = max;
        showToast(`Max ${max} sauces !`, "error");
    }
    productModalUI.refreshFavButton();
};
window.updateProductSize = (radio) => {
    productModalUI.currentProduct.prixBase = parseFloat(radio.getAttribute("data-prix"));
    productModalUI.currentProduct.tailleChoisie = radio.value;
    const btn = document.getElementById("modal-cta");
    const devise = store.state.config.identity.currency || "€";
    if (btn) btn.innerHTML = `<span>Ajouter - ${productModalUI.currentProduct.prixBase.toFixed(2)} ${devise}</span>`;
    productModalUI.refreshFavButton();
};
