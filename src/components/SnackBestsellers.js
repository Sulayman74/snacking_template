import { html } from 'lit';
import { SnackElement } from './SnackElement.js';
import { store } from '../store/Store.js';
import { StoreController } from '../store/StoreController.js';
import './SnackMenuItem.js';

export class SnackBestsellers extends SnackElement {
  
  // Abonnement automatique aux changements du menu
  menuController = new StoreController(this, 'menu-changed');

  render() {
    const menu = store.state.menu;
    if (!menu || menu.length === 0) return html``;

    const top3 = [...menu].sort((a, b) => (b.ventes || 0) - (a.ventes || 0)).slice(0, 3);

    return html`
      ${top3.map(p => html`
        <snack-menu-item .product="${p}" class="block snap-center shrink-0 w-[85%] md:w-auto"></snack-menu-item>
      `)}
    `;
  }
}

customElements.define('snack-bestsellers', SnackBestsellers);
