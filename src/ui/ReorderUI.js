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
      <div class="relative overflow-hidden bg-surface border border-line hover:border-accent/40 rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-xl transition-all duration-300 group">
        <!-- Liseré supérieur dégradé subtil -->
        <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-primary to-accent opacity-80"></div>

        <div class="flex items-center gap-3 sm:gap-4">
          <!-- Pastille icône à gauche -->
          <div class="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-surface-2 border border-line flex items-center justify-center text-accent shrink-0 shadow-sm transition-transform group-hover:scale-105">
            <i data-lucide="rotate-ccw" class="w-5 h-5" aria-hidden="true"></i>
          </div>

          <!-- Contenu central -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 mb-0.5">
              <span class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0"></span>
              <span class="text-[10px] sm:text-xs font-black uppercase tracking-wider text-accent truncate">
                Commander à nouveau
              </span>
            </div>
            <p class="font-bold text-text text-xs sm:text-sm truncate leading-snug">
              ${this.#summary(order.items)}
            </p>
            <div class="flex items-center gap-2 mt-0.5 text-[11px] sm:text-xs text-text-muted">
              <span class="font-black text-text">${total} ${escapeHTML(devise)}</span>
              <span class="text-line">·</span>
              <span class="font-medium text-status-ok flex items-center gap-1">
                <i data-lucide="zap" class="w-3 h-3 inline"></i> 1-clic
              </span>
            </div>
          </div>

          <!-- Bouton CTA à droite -->
          <button type="button" data-action="reorder-last"
            class="shrink-0 bg-primary hover:bg-primary-hover active:scale-95 text-on-primary font-bold px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl shadow-lg shadow-primary/25 hover:shadow-xl transition-all flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm whitespace-nowrap">
            <i data-lucide="shopping-cart" class="w-4 h-4" aria-hidden="true"></i>
            <span>Recommander</span>
          </button>
        </div>
      </div>`;

    this.section.classList.remove("hidden");
    window.lucide?.createIcons?.();
  }
}

export const reorderUI = new ReorderUI();
