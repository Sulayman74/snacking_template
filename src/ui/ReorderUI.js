/**
 * 🎨 ReorderUI — Bloc « Commander à nouveau » de l'accueil (SOLID: Présentation)
 * Visible uniquement pour un utilisateur connecté ayant déjà commandé sur CE
 * snack. Écoute le Store ; toute la logique métier est dans reorder.js.
 */
import { store } from "../core/Store.js";
import { escapeHTML } from "../utils.js";

class ReorderUI {
  constructor() {
    this.section = document.getElementById("reorder-section");
    this.container = document.getElementById("reorder-container");
    this.#init();
  }

  #init() {
    store.addEventListener("last-order-updated", () => this.render());
    store.addEventListener("auth-updated", () => this.render());
  }

  /** Résumé court de la commande : « Menu Tacos XL ×2, Frites, Coca ». */
  #summary(items) {
    const parts = (items || []).map((i) => {
      const qty = Number(i.quantity) || 1;
      return `${escapeHTML(i.nom || "Article")}${qty > 1 ? ` ×${qty}` : ""}`;
    });
    const text = parts.join(", ");
    return text.length > 90 ? `${text.slice(0, 87)}…` : text;
  }

  render() {
    if (!this.section || !this.container) return;

    const order = store.state.lastOrder;
    const user = store.state.user;

    // Masqué pour un visiteur ou un client sans historique (non-régression accueil).
    if (!user || !Array.isArray(order?.items) || order.items.length === 0) {
      this.section.classList.add("hidden");
      this.container.innerHTML = "";
      return;
    }

    const devise = store.state.config?.identity?.currency || "€";
    const total = (Number(order.total) || 0).toFixed(2);

    this.container.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center gap-4 bg-surface p-5 rounded-3xl shadow-sm border border-gray-100">
        <div class="flex-1 min-w-0">
          <p class="text-xs font-black uppercase tracking-widest text-accent mb-1">
            <i class="fas fa-rotate-left mr-1" aria-hidden="true"></i> Commander à nouveau
          </p>
          <p class="font-bold text-text truncate">${this.#summary(order.items)}</p>
          <p class="text-sm font-black text-text-muted mt-0.5">${total} ${escapeHTML(devise)}</p>
        </div>
        <button type="button" data-action="reorder-last"
          class="shrink-0 bg-primary text-on-primary font-bold px-6 py-3 rounded-full shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
          <i class="fas fa-cart-plus" aria-hidden="true"></i> Recommander
        </button>
      </div>`;

    this.section.classList.remove("hidden");
  }
}

export const reorderUI = new ReorderUI();
