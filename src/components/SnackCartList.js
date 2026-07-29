import { html, nothing } from 'lit';
import { SnackElement } from './SnackElement.js';
import { store } from '../core/Store.js';
import { StoreController } from '../store/StoreController.js';
import './SnackCartItem.js'; 

export class SnackCartList extends SnackElement {
  
  cartController = new StoreController(this, 'cart-updated');
  deliveryController = new StoreController(this, 'delivery-updated');
  favoritesController = new StoreController(this, 'favorites-updated');

  getProgressBarTemplate() {
    const cart = store.state.cart || [];
    const cfg = window.snackConfig;
    const delivery = store.state.delivery || { mode: "collect" };
    const minOrder = Number(cfg?.delivery?.minOrder) || 0;

    const subtotal = cart.reduce((acc, item) => acc + (Number(item.prix) || 0) * (Number(item.quantity) || 1), 0);
    const remaining = minOrder - subtotal;

    if (delivery.mode !== "delivery" || minOrder <= 0 || cart.length === 0 || remaining <= 0) {
      return nothing;
    }

    const pct = Math.min(100, Math.round((subtotal / minOrder) * 100));

    return html`
      <div id="cart-progress-bar" class="mb-4">
        <div class="rounded-xl bg-surface-3 p-3">
          <p class="text-sm font-medium text-text mb-2">Plus que <span class="font-bold text-primary">${remaining.toFixed(2)} €</span> pour commander en livraison 🛵</p>
          <div class="h-2 w-full rounded-full bg-line overflow-hidden">
            <div class="h-full rounded-full bg-primary transition-all duration-300" style="width:${pct}%"></div>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    const cart = store.state.cart;

    if (!cart || cart.length === 0) {
      return html`
        <div class="h-full flex items-center justify-center">
          <p class="text-center py-10 text-text-muted">Votre panier est vide.</p>
        </div>
      `;
    }

    return html`
      ${this.getProgressBarTemplate()}
      <div class="space-y-4">
        ${cart.map(item => html`<snack-cart-item .item="${item}"></snack-cart-item>`)}
      </div>
    `;
  }
}

customElements.define('snack-cart-list', SnackCartList);
