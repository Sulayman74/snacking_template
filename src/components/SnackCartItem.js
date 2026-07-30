import { html, nothing } from 'lit';
import { SnackElement } from './SnackElement.js';
import { store } from '../core/Store.js';

export class SnackCartItem extends SnackElement {
  static properties = {
    item: { type: Object }
  };

  constructor() {
    super();
    this.item = null;
  }

  updated() {
    if (window.lucide) {
      window.lucide.createIcons({ root: this.shadowRoot });
    }
  }

  escapeHTML(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  getDetailsTemplate() {
    const item = this.item;
    let detailsTemplate = [];

    if (item.boisson) {
      detailsTemplate.push(html`<span>🥤 ${this.escapeHTML(item.boisson)}</span>`);
    }

    if (item.sauces && item.sauces.length > 0) {
      const safeSauces = item.sauces.map((s) => this.escapeHTML(s)).join(", ");
      detailsTemplate.push(html`<span>🥣 ${safeSauces}</span>`);
    }

    if (item.sansCrudites && item.sansCrudites.length > 0) {
      const safeCrudites = item.sansCrudites.map((c) => this.escapeHTML(c)).join(", ");
      detailsTemplate.push(html`<span class="text-danger font-black">⚠️ ${safeCrudites}</span>`);
    }

    if (detailsTemplate.length === 0) return nothing;

    const separatedTemplate = detailsTemplate.reduce((acc, x) => acc === null ? [x] : [acc, html` <span class='text-text-muted'>|</span> `, x], null);
    
    return html`<div class="text-[11px] text-text-muted mt-1 leading-snug flex flex-wrap gap-x-2 gap-y-1">${separatedTemplate}</div>`;
  }

  render() {
    if (!this.item) return nothing;
    const item = this.item;
    const isFav = window.favoritesService?.isFavorite(item);

    return html`
      <div class="flex items-center gap-4 bg-surface p-3 rounded-xl border border-line" role="group">
        <div class="relative w-16 h-16 shrink-0">
          ${item.image && item.image.trim() !== "" ? html`
            <img class="absolute inset-0 w-full h-full rounded-lg object-cover z-10" 
                 src="${item.image}" 
                 alt="${item.nom}" 
                 loading="lazy"
                 @error="${this._handleImageError}">
          ` : html`
            <div class="absolute inset-0 rounded-lg bg-surface-2 flex items-center justify-center border border-line z-0">
              <i data-lucide="sandwich" aria-hidden="true" class="text-text-muted text-xl"></i>
            </div>
          `}
        </div>
        
        <div class="flex-1 min-w-0">
          <h2 class="font-bold text-text leading-tight truncate">${item.nom}</h2>
          ${this.getDetailsTemplate()}
          <p class="text-danger font-bold mt-1">${(item.prix * item.quantity).toFixed(2)} €</p>
        </div>
        
        <button type="button" 
                class="w-9 h-9 shrink-0 transition-colors flex items-center justify-center ${isFav ? 'text-red-500' : 'text-text-muted hover:text-red-500'}"
                aria-pressed="${isFav ? 'true' : 'false'}"
                aria-label="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}"
                @click="${this._toggleFavorite}">
          <i data-lucide="heart" aria-hidden="true" class="text-lg ${isFav ? 'fill-current' : ''}"></i>
        </button>

        <div class="flex items-center gap-3 bg-surface-2 rounded-lg p-1">
          <button type="button" 
                  class="cart-item-minus w-8 h-8 text-text-muted hover:bg-surface-3 rounded-md transition flex items-center justify-center"
                  @click="${this._decrement}">
            <i data-lucide="minus" class="text-xs"></i>
          </button>
          <span class="font-bold w-4 text-text text-center text-sm">${item.quantity}</span>
          <button type="button" 
                  class="cart-item-plus w-8 h-8 text-text-muted hover:bg-surface-3 rounded-md transition flex items-center justify-center"
                  @click="${this._increment}">
            <i data-lucide="plus" class="text-xs"></i>
          </button>
        </div>
      </div>
    `;
  }

  async _toggleFavorite() {
    if (window.favoritesService) {
      await window.favoritesService.toggle(this.item);
      this.requestUpdate();
    }
  }

  _increment() {
    store.updateQuantity(this.item.id, 1);
  }

  _decrement() {
    store.updateQuantity(this.item.id, -1);
  }

  _handleImageError(e) {
    e.target.style.display = 'none';
    const parent = e.target.parentElement;
    parent.innerHTML += `
      <div class="absolute inset-0 rounded-lg bg-surface-2 flex items-center justify-center border border-line z-0">
        <i data-lucide="sandwich" aria-hidden="true" class="text-text-muted text-xl"></i>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: parent });
  }
}

customElements.define('snack-cart-item', SnackCartItem);
