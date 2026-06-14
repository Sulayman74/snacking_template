/**
 * 🎨 FavoritesUI — Écran « Mes Favoris » (SOLID: Présentation)
 * Liste les achats personnalisés sauvegardés et permet la re-commande 1-tap.
 * Écoute le Store ; toute la logique métier est dans favorites.js.
 */
import { store } from "../core/Store.js";
import { escapeHTML, formatCustomizationDetails } from "../utils.js";

class FavoritesUI {
  constructor() {
    this.view = document.getElementById("favorites-view");
    this.container = document.getElementById("favorites-container");
    this.lastFocused = null;
    this.#init();
  }

  #init() {
    // Re-render réactif : la liste change OU l'utilisateur se (dé)connecte.
    store.addEventListener("favorites-updated", () => this.render());
    store.addEventListener("auth-updated", () => {
      this.render();
      // Si l'utilisateur se déconnecte alors que l'écran est ouvert, on ferme.
      if (!store.state.user && this.#isOpen()) this.close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.#isOpen()) this.close();
    });
  }

  #isOpen() {
    return this.view && !this.view.classList.contains("hidden");
  }

  open() {
    if (!this.view) return;
    if (!store.state.user) {
      window.showToast?.("Connectez-vous pour voir vos favoris", "error");
      window.toggleAuthModal?.();
      return;
    }
    this.lastFocused = document.activeElement;
    this.render();
    this.view.classList.remove("hidden");
    requestAnimationFrame(() => this.view.classList.remove("opacity-0"));
    document.body.style.overflow = "hidden";

    setTimeout(() => {
      const first = this.view.querySelector('button, [href], [tabindex]:not([tabindex="-1"])');
      first?.focus();
    }, 150);
  }

  close() {
    if (!this.view || !this.#isOpen()) return;
    this.view.classList.add("opacity-0");
    setTimeout(() => {
      this.view.classList.add("hidden");
      document.body.style.overflow = "";
    }, 300);
    if (this.lastFocused && typeof this.lastFocused.focus === "function") {
      this.lastFocused.focus();
    }
  }

  render() {
    if (!this.container) return;
    const favorites = window.favoritesService?.getForCurrentSnack?.() || [];
    const devise = store.state.config?.identity?.currency || "€";

    if (favorites.length === 0) {
      this.container.innerHTML = `
        <div class="text-center py-20 px-6">
          <i class="fas fa-heart text-6xl text-text-muted mb-6" aria-hidden="true"></i>
          <h3 class="text-xl font-black text-text mb-2">Aucun favori pour l'instant</h3>
          <p class="text-text-muted mb-8 max-w-sm mx-auto">Personnalisez un produit (sauces, options…) puis touchez le cœur ❤️ pour le retrouver ici et le recommander en un clin d'œil.</p>
          <button data-action="switch-menu" class="bg-primary text-on-primary font-bold px-8 py-4 rounded-full shadow-lg hover:-translate-y-1 transition-all">
            <i class="fas fa-utensils mr-2" aria-hidden="true"></i> Voir la carte
          </button>
        </div>`;
      return;
    }

    // Plus récents en tête.
    const sorted = [...favorites].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    this.container.innerHTML = "";
    const fragment = document.createDocumentFragment();

    sorted.forEach((fav) => {
      const item = fav.item || {};
      const card = document.createElement("article");
      card.className = "flex items-center gap-4 bg-surface p-4 rounded-2xl shadow-sm border border-gray-100";

      const details = formatCustomizationDetails(item);
      const safeName = escapeHTML(fav.label || item.nom || "Favori");
      const prix = (Number(item.prix) || 0).toFixed(2);
      const imgSrc = item.image && item.image.trim() !== "" ? escapeHTML(item.image) : "";

      card.innerHTML = `
        <div class="w-16 h-16 shrink-0 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center">
          ${imgSrc
            ? `<img src="${imgSrc}" alt="" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
               <span class="w-full h-full hidden items-center justify-center"><i class="fas fa-heart text-text-muted text-xl" aria-hidden="true"></i></span>`
            : `<i class="fas fa-heart text-text-muted text-xl" aria-hidden="true"></i>`}
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-bold text-text truncate">${safeName}</p>
          ${details ? `<p class="text-xs text-text-muted mt-0.5">${details}</p>` : ""}
          <p class="text-sm font-black text-accent mt-1">${prix} ${escapeHTML(devise)}</p>
        </div>
        <div class="flex flex-col gap-2 shrink-0">
          <button type="button" class="fav-reorder-btn bg-primary text-on-primary text-sm font-bold px-4 py-2 rounded-full hover:scale-105 transition-transform flex items-center gap-1">
            <i class="fas fa-cart-plus" aria-hidden="true"></i> Ajouter
          </button>
          <button type="button" aria-label="Retirer ${safeName} des favoris" class="fav-remove-btn text-text-muted hover:text-danger text-sm transition-colors">
            <i class="fas fa-trash-alt" aria-hidden="true"></i>
          </button>
        </div>`;

      card.querySelector(".fav-reorder-btn").onclick = () => window.reorderFavorite(fav.favId);
      card.querySelector(".fav-remove-btn").onclick = () => window.removeFavorite(fav.favId);
      fragment.appendChild(card);
    });

    this.container.appendChild(fragment);
  }
}

export const favoritesUI = new FavoritesUI();

window.openFavoritesView = () => favoritesUI.open();
window.closeFavoritesView = () => favoritesUI.close();
