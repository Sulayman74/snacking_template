import { html, nothing } from 'lit';
import { SnackElement } from './SnackElement.js';
import { store } from '../core/Store.js';
import { t } from '../i18n/index.js';

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

  // Une ligne par option, libellée : lisible d'un coup d'œil. Lit échappe le
  // texte interpolé (pas d'escapeHTML manuel : il provoquait un double échappement).
  getDetailsTemplate() {
    const item = this.item;
    const rows = [];
    if (item.taille) rows.push([t('cart.size'), item.taille]);
    if (item.boisson) rows.push([t('cart.drink'), item.boisson]);
    if (Array.isArray(item.sauces) && item.sauces.length) rows.push([t('cart.sauces'), item.sauces.join(", ")]);
    if (Array.isArray(item.supplements) && item.supplements.length) {
      rows.push([t('cart.extras'), item.supplements.map((s) => `+${s.nom}`).join(", "), "text-accent font-bold"]);
    }
    if (Array.isArray(item.sansCrudites) && item.sansCrudites.length) {
      rows.push([t('cart.without'), item.sansCrudites.join(", "), "text-danger font-bold"]);
    }
    if (rows.length === 0) return nothing;

    return html`
      <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs leading-snug">
        ${rows.map(([label, value, cls]) => html`
          <dt class="text-text-muted">${label}</dt>
          <dd class="m-0 text-text ${cls || ''}">${value}</dd>
        `)}
      </dl>`;
  }

  render() {
    if (!this.item) return nothing;
    const item = this.item;
    const isFav = window.favoritesService?.isFavorite(item);
    const unit = Number(item.prix) || 0;
    const qty = Number(item.quantity) || 1;
    const isLast = qty <= 1;

    return html`
      <div class="flex flex-col gap-3 bg-surface p-3 rounded-xl border border-line" role="group" aria-label="${item.nom}">
        <div class="flex items-start gap-3">
          <div class="relative w-16 h-16 shrink-0">
            ${item.image && item.image.trim() !== "" ? html`
              <img class="absolute inset-0 w-full h-full rounded-lg object-cover z-10"
                   src="${item.image}"
                   alt=""
                   loading="lazy"
                   @error="${this._handleImageError}">
            ` : html`
              <div class="absolute inset-0 rounded-lg bg-surface-2 flex items-center justify-center border border-line z-0">
                <i data-lucide="sandwich" aria-hidden="true" class="text-text-muted text-xl"></i>
              </div>
            `}
          </div>

          <div class="flex-1 min-w-0">
            <h2 class="font-bold text-text leading-tight line-clamp-2 break-words">${item.nom}</h2>
            ${this.getDetailsTemplate()}
          </div>

          <button type="button"
                  class="w-11 h-11 -mt-1 -mr-1 shrink-0 transition-colors flex items-center justify-center cursor-pointer rounded-full ${isFav ? 'text-red-500' : 'text-text-muted hover:text-red-500'}"
                  aria-pressed="${isFav ? 'true' : 'false'}"
                  aria-label="${isFav ? t('common.removeFavorite') : t('common.addFavorite')}"
                  @click="${this._toggleFavorite}">
            <i data-lucide="heart" aria-hidden="true" class="text-lg ${isFav ? 'fill-current' : ''}"></i>
          </button>
        </div>

        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-primary font-black">${(unit * qty).toFixed(2)} €</p>
            ${qty > 1 ? html`<p class="text-[11px] text-text-muted">${t('cart.unitPrice', { price: unit.toFixed(2) })}</p>` : nothing}
          </div>

          <div class="flex items-center gap-1 bg-surface-2 rounded-xl p-1">
            <button type="button"
                    class="cart-item-minus w-11 h-11 rounded-lg transition flex items-center justify-center cursor-pointer ${isLast ? 'text-danger hover:bg-danger/15' : 'text-text-muted hover:bg-surface-3'}"
                    aria-label="${isLast ? t('cart.remove', { name: item.nom }) : t('cart.decrease', { name: item.nom })}"
                    @click="${this._decrement}">
              <i data-lucide="${isLast ? 'trash-2' : 'minus'}" aria-hidden="true" class="text-base"></i>
            </button>
            <span class="font-bold min-w-6 text-text text-center tabular-nums" aria-live="polite">${qty}</span>
            <button type="button"
                    class="cart-item-plus w-11 h-11 text-text-muted hover:bg-surface-3 rounded-lg transition flex items-center justify-center cursor-pointer"
                    aria-label="${t('cart.increase', { name: item.nom })}"
                    @click="${this._increment}">
              <i data-lucide="plus" aria-hidden="true" class="text-base"></i>
            </button>
          </div>
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
