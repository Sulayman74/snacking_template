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

  /** Formatage d'une date relative conviviale (« Aujourd'hui », « Hier », « Vendredi »). */
  #formatDate(dateVal) {
    if (!dateVal) return "";
    try {
      const d = dateVal?.toDate ? dateVal.toDate() : new Date(dateVal);
      if (isNaN(d.getTime())) return "";
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return "Aujourd'hui";
      if (diffDays === 1) return "Hier";
      if (diffDays < 7) {
        const dayStr = d.toLocaleDateString("fr-FR", { weekday: "long" });
        return dayStr.charAt(0).toUpperCase() + dayStr.slice(1);
      }
      return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    } catch {
      return "";
    }
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
    const dateText = this.#formatDate(order.date);

    const maxVisibleChips = 3;
    const items = order.items;
    const visibleItems = items.slice(0, maxVisibleChips);
    const hiddenCount = items.length - maxVisibleChips;

    const chipsHtml = visibleItems
      .map((i) => {
        const qty = Number(i.quantity) || 1;
        const nom = escapeHTML(i.nom || "Article");
        return `
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-line text-xs font-bold text-text shadow-2xs">
            <span class="text-accent font-black">${qty}×</span>
            <span class="truncate max-w-[190px] sm:max-w-[260px]">${nom}</span>
          </span>`;
      })
      .join("");

    const hiddenBadgeHtml =
      hiddenCount > 0
        ? `<span class="inline-flex items-center px-2 py-1 rounded-lg bg-surface-2/80 border border-line text-[11px] font-bold text-text-muted" title="${items
            .slice(maxVisibleChips)
            .map((i) => `${i.quantity || 1}× ${escapeHTML(i.nom)}`)
            .join(", ")}">+${hiddenCount} autre${hiddenCount > 1 ? "s" : ""}</span>`
        : "";

    const dateHtml = dateText
      ? `<span class="text-[11px] font-medium text-text-muted">· ${escapeHTML(dateText)}</span>`
      : "";

    this.container.innerHTML = `
      <div class="relative overflow-hidden bg-surface/95 backdrop-blur-md border border-line hover:border-accent/40 rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 shadow-xl transition-all duration-300 group">
        <!-- Liseré supérieur dégradé subtil -->
        <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-primary to-accent opacity-80"></div>

        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-6">
          <!-- Bloc infos commande -->
          <div class="flex-1 min-w-0 space-y-2">
            <!-- En-tête : Badge + 1-clic + Date + Prix mobile -->
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 flex-wrap min-w-0">
                <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0 shadow-2xs">
                  <i data-lucide="rotate-ccw" class="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true"></i>
                </div>
                <span class="text-xs font-black uppercase tracking-wider text-accent flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0"></span>
                  Commander à nouveau
                </span>
                <span class="text-[11px] font-bold text-status-ok bg-status-ok/10 border border-status-ok/20 px-2 py-0.5 rounded-full inline-flex items-center gap-1 shrink-0">
                  <i data-lucide="zap" class="w-3 h-3"></i> 1-clic
                </span>
                ${dateHtml}
              </div>

              <!-- Prix bien visible en haut à droite sur mobile -->
              <div class="sm:hidden text-right shrink-0">
                <span class="text-base font-black text-text">${total} ${escapeHTML(devise)}</span>
              </div>
            </div>

            <!-- Chips d'articles lisibles et aérés -->
            <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
              ${chipsHtml}
              ${hiddenBadgeHtml}
            </div>
          </div>

          <!-- Bloc action (CTA + Total desktop) -->
          <div class="flex items-center sm:flex-col sm:items-end justify-between sm:justify-center gap-3 shrink-0 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-line/60">
            <div class="hidden sm:block text-right">
              <span class="text-[11px] font-bold uppercase tracking-wider text-text-muted block">Total commande</span>
              <span class="text-lg font-black text-text">${total} ${escapeHTML(devise)}</span>
            </div>

            <button type="button" data-action="reorder-last"
              class="w-full sm:w-auto bg-primary hover:bg-primary-hover active:scale-95 text-on-primary font-bold px-5 py-3 sm:py-2.5 rounded-xl sm:rounded-2xl shadow-lg shadow-primary/20 hover:shadow-xl transition-all flex items-center justify-center gap-2 text-xs sm:text-sm whitespace-nowrap cursor-pointer">
              <i data-lucide="shopping-cart" class="w-4 h-4" aria-hidden="true"></i>
              <span>Recommander</span>
            </button>
          </div>
        </div>
      </div>`;

    this.section.classList.remove("hidden");
    window.lucide?.createIcons?.();
  }
}

export const reorderUI = new ReorderUI();
