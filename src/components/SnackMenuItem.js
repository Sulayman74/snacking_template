import { html, nothing } from 'lit';
import { SnackElement } from './SnackElement.js';
import './SnackBadge.js'; // Assure que la dépendance est chargée

export class SnackMenuItem extends SnackElement {
  static properties = {
    product: { type: Object }
  };

  constructor() {
    super();
    this.product = null;
  }

  updated() {
    if (window.lucide) {
      window.lucide.createIcons({ root: this.shadowRoot });
    }
  }

  render() {
    if (!this.product) return nothing;

    const p = this.product;
    const isSoldOut = p.isAvailable === false;
    
    // Détermination du badge
    let badgeText = null;
    let badgeType = 'default';
    if (isSoldOut) {
      badgeText = 'Épuisé';
      badgeType = 'sold-out';
    } else if (p.badge) {
      badgeText = p.badge;
    } else if (Array.isArray(p.tags) && p.tags.length > 0) {
      badgeText = p.tags[0];
    }

    return html`
      <div class="bg-surface rounded-3xl overflow-hidden shadow-sm border border-line flex flex-col group transition-all duration-300 hover:shadow-xl hover:-translate-y-1 active:scale-[0.98] cursor-pointer" 
           role="listitem"
           data-action="open-product-modal"
           data-id="${p.id}"
           @click="${this._openModal}">
        
        <div class="relative h-48 overflow-hidden bg-surface-2">
          ${p.image ? html`
            <img class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 ${isSoldOut ? 'grayscale opacity-50' : ''}" 
                 src="${p.image}" 
                 alt="${p.nom}" 
                 loading="lazy"
                 @error="${this._handleImageError}">
          ` : html`
            <div class="absolute inset-0 flex flex-col items-center justify-center text-primary transition-opacity duration-300">
              <i data-lucide="pizza" class="text-4xl mb-2 opacity-20"></i>
              <span class="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Photo en préparation... 👨‍🍳</span>
            </div>
          `}
          
          ${badgeText ? html`<snack-badge type="${badgeType}" text="${badgeText}"></snack-badge>` : nothing}
        </div>

        <div class="p-5 flex flex-col flex-1">
          <div class="flex justify-between items-start mb-2 gap-2">
            <h3 class="text-lg font-black text-text leading-tight">${p.nom}</h3>
            <span class="text-lg font-black text-primary whitespace-nowrap">${Number(p.prix).toFixed(2)} €</span>
          </div>
          <p class="text-text-muted text-xs font-medium leading-relaxed mb-4 line-clamp-2 flex-1">${p.description || ''}</p>
          
          <div class="flex items-center justify-between pt-4 border-t border-line">
            <div class="flex gap-2">
              ${p.isVegan ? html`<span class="px-2 py-0.5 rounded-full bg-green-50 text-green-600 text-[9px] font-bold uppercase tracking-widest">Vegan</span>` : nothing}
              ${p.isSpicy ? html`<span class="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[9px] font-bold uppercase tracking-widest">Pimenté</span>` : nothing}
            </div>
            
            ${isSoldOut ? html`
              <div class="w-8 h-8 rounded-full bg-surface-3 text-text-muted flex items-center justify-center">
                <i data-lucide="ban" class="text-xs"></i>
              </div>
            ` : html`
              <div class="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center transition-transform group-hover:scale-110 group-hover:opacity-90">
                <i data-lucide="plus" class="text-xs"></i>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  _openModal() {
    if (window.openProductModal && this.product) {
      window.openProductModal(this.product.id);
    }
  }

  _handleImageError(e) {
    e.target.style.display = 'none';
    const parent = e.target.parentElement;
    parent.innerHTML += `
      <div class="absolute inset-0 flex flex-col items-center justify-center text-primary transition-opacity duration-300">
        <i data-lucide="pizza" class="text-4xl mb-2 opacity-20"></i>
        <span class="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Photo indisponible 👨‍🍳</span>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: parent });
  }
}

customElements.define('snack-menu-item', SnackMenuItem);
