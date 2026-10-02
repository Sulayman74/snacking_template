import { html, nothing } from 'lit';
import { SnackElement } from './SnackElement.js';
import { store } from '../core/Store.js';
import { StoreController } from '../store/StoreController.js';
import { getStorefrontStatus } from '../core/storefrontStatus.js';
import { statusMessage } from '../ui/statusMessage.js';

const TONES = {
  danger: 'bg-danger/10 text-danger border-danger/30',
  warn: 'bg-primary/10 text-text border-primary/40',
  info: 'bg-surface-2 text-text border-line',
};
const ICONS = { danger: 'circle-alert', warn: 'clock', info: 'clock' };

/**
 * 🚦 Pastille « Fermé · réouvre à 11:00 », « Cuisine en pause jusqu'à 20:15 »,
 * « Dernières commandes à 21:30 ». Rien quand tout est normal.
 * context="cart" : en retrait, le bloc « Retrait au comptoir » dit déjà les
 * horaires → la pastille ne parle que de ce qui bloque.
 */
export class SnackStatusPill extends SnackElement {
  static properties = { context: { type: String } };

  configController = new StoreController(this, 'config-updated');
  clockController = new StoreController(this, 'clock-tick');
  deliveryController = new StoreController(this, 'delivery-updated');

  constructor() {
    super();
    this.context = 'menu';
  }

  updated() {
    window.lucide?.createIcons?.({ root: this.shadowRoot });
  }

  render() {
    const cfg = store.state.config;
    if (!cfg) return nothing;
    const mode = store.state.delivery?.mode === 'delivery' ? 'delivery' : 'collect';
    const status = getStorefrontStatus(cfg, new Date(), { mode });
    if (this.context === 'cart' && mode === 'collect' && status.canOrder) return nothing;
    const msg = statusMessage(status);
    if (!msg) return nothing;
    return html`
      <div role="status" data-kind="${status.kind}"
           class="flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${TONES[status.tone] || TONES.info}">
        <i data-lucide="${ICONS[status.tone] || 'clock'}" class="mt-0.5 shrink-0"></i>
        <span><span class="block font-bold">${msg.title}</span>${msg.detail ? html`<span class="block text-xs opacity-80">${msg.detail}</span>` : nothing}</span>
      </div>`;
  }
}

customElements.define('snack-status-pill', SnackStatusPill);
