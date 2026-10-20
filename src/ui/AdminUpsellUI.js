/**
 * 📊 AdminUpsellUI — « Performance Upsell » dans l'onglet Compta.
 *
 * Présentation pure : écoute adminStore("admin-upsell-updated") et rend un
 * tableau Produit · Vues · Ajouts · Taux d'acceptation · CA attribuable.
 * Aucune logique métier ni écriture (les stats sont serveur-only).
 *
 * Dépendance DOM : #upsell-stats-table (déclaré dans admin.html, view-compta).
 */
import { adminStore } from "../core/AdminStore.js";
import { escapeHTML } from "../utils.js";

class AdminUpsellUI {
    constructor() {
        this.tableEl = document.getElementById("upsell-stats-table");
        this.currentPage = 1;
        this.pageSize = 5;
        this.init();
    }

    init() {
        adminStore.addEventListener("admin-upsell-updated", () => {
            this.currentPage = 1;
            this.render();
        });

        document.addEventListener("click", (e) => {
            const btn = e.target.closest("#upsell-stats-table [data-upsell-page]");
            if (btn && !btn.disabled) {
                const page = parseInt(btn.dataset.upsellPage, 10);
                if (!isNaN(page)) {
                    this.setPage(page);
                }
            }
        });
    }

    setPage(page) {
        this.currentPage = page;
        this.render();
    }

    render() {
        if (!this.tableEl) this.tableEl = document.getElementById("upsell-stats-table");
        if (!this.tableEl) return;
        const rows = adminStore.state.upsellStats || [];

        if (rows.length === 0) {
            this.tableEl.innerHTML = `
                <div class="text-center py-12 bg-surface-2 rounded-2xl border-2 border-dashed border-line">
                    <i data-lucide="trending-up" class="text-3xl text-text-muted mb-3"></i>
                    <p class="text-text-muted font-bold">Aucune donnée d'upsell pour le moment.</p>
                    <p class="text-text-muted text-sm mt-1">Les suggestions affichées et acceptées s'afficheront ici.</p>
                </div>
            `;
            window.lucide?.createIcons?.();
            return;
        }

        const totalPages = Math.ceil(rows.length / this.pageSize) || 1;
        if (this.currentPage > totalPages) this.currentPage = totalPages;
        if (this.currentPage < 1) this.currentPage = 1;

        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = Math.min(startIndex + this.pageSize, rows.length);
        const pagedRows = rows.slice(startIndex, endIndex);

        const paginationHtml = totalPages > 1 ? `
            <div class="flex items-center justify-between gap-2 pt-4 border-t border-line mt-4 text-xs">
                <span class="text-text-muted text-[11px] font-medium">
                    Affichage <strong class="text-text">${startIndex + 1}–${endIndex}</strong> sur <strong class="text-text">${rows.length}</strong> produits
                </span>
                <div class="flex items-center gap-1.5">
                    <button
                        type="button"
                        data-upsell-page="${this.currentPage - 1}"
                        ${this.currentPage <= 1 ? "disabled" : ""}
                        class="px-2.5 py-1.5 rounded-xl border border-line bg-surface-2 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed text-text font-bold transition flex items-center gap-1 text-xs"
                        title="Page précédente"
                        aria-label="Page précédente"
                    >
                        <i data-lucide="chevron-left" class="w-3.5 h-3.5"></i>
                        <span class="hidden sm:inline">Précédent</span>
                    </button>
                    <span class="px-2.5 py-1 text-[11px] font-black text-text bg-surface-2 rounded-lg border border-line">
                        ${this.currentPage} / ${totalPages}
                    </span>
                    <button
                        type="button"
                        data-upsell-page="${this.currentPage + 1}"
                        ${this.currentPage >= totalPages ? "disabled" : ""}
                        class="px-2.5 py-1.5 rounded-xl border border-line bg-surface-2 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed text-text font-bold transition flex items-center gap-1 text-xs"
                        title="Page suivante"
                        aria-label="Page suivante"
                    >
                        <span class="hidden sm:inline">Suivant</span>
                        <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </div>
        ` : "";

        this.tableEl.innerHTML = `
            <!-- Desktop Table -->
            <div class="hidden md:block overflow-x-auto">
                <table class="w-full text-left min-w-[500px]">
                    <thead class="bg-surface-2 text-[10px] font-black text-text-muted uppercase tracking-widest">
                        <tr>
                            <th class="px-4 py-3">Produit</th>
                            <th class="px-4 py-3 text-right">Vues</th>
                            <th class="px-4 py-3 text-right">Ajouts</th>
                            <th class="px-4 py-3 text-right">Taux</th>
                            <th class="px-4 py-3 text-right">CA attribuable</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        ${pagedRows.map((r) => this.renderRow(r)).join("")}
                    </tbody>
                </table>
            </div>

            <!-- Mobile Cards -->
            <div class="block md:hidden space-y-2.5">
                ${pagedRows.map((r) => this.renderMobileCard(r)).join("")}
            </div>

            ${paginationHtml}
        `;
        window.lucide?.createIcons?.();
    }

    renderMobileCard(r) {
        const shown = Number(r.shown) || 0;
        const accepted = Number(r.accepted) || 0;
        const revenue = Number(r.revenue) || 0;
        const rate = shown > 0 ? (accepted / shown) * 100 : 0;

        const rateCls = rate >= 25
            ? "bg-green-500/10 text-green-700 dark:text-green-400"
            : rate >= 10
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "bg-surface-2 text-text-muted";

        return `
            <div class="p-3.5 bg-surface-2/60 rounded-xl border border-line flex flex-col gap-2">
                <div class="flex items-center justify-between gap-2">
                    <p class="text-sm font-black text-text truncate">${escapeHTML(r.nom || r.productId)}</p>
                    <span class="px-2 py-0.5 rounded-md text-[10px] font-black shrink-0 ${rateCls}">
                        ${shown > 0 ? rate.toFixed(0) + " %" : "—"}
                    </span>
                </div>
                <div class="grid grid-cols-3 gap-2 pt-1 border-t border-line/60 text-center">
                    <div>
                        <span class="text-[9px] uppercase tracking-wider text-text-muted block">Vues</span>
                        <span class="text-xs font-bold text-text-muted">${shown}</span>
                    </div>
                    <div>
                        <span class="text-[9px] uppercase tracking-wider text-text-muted block">Ajouts</span>
                        <span class="text-xs font-black text-text">${accepted}</span>
                    </div>
                    <div>
                        <span class="text-[9px] uppercase tracking-wider text-text-muted block">CA généré</span>
                        <span class="text-xs font-black text-primary">${revenue.toFixed(2)} €</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderRow(r) {
        const shown = Number(r.shown) || 0;
        const accepted = Number(r.accepted) || 0;
        const revenue = Number(r.revenue) || 0;
        const rate = shown > 0 ? (accepted / shown) * 100 : 0;

        // Couleur du badge taux : vert ≥ 25%, ambre ≥ 10%, gris sinon.
        const rateCls = rate >= 25
            ? "bg-green-500/10 text-green-700 dark:text-green-400"
            : rate >= 10
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "bg-surface-2 text-text-muted";

        return `
            <tr class="hover:bg-surface-2 transition-colors">
                <td class="px-4 py-4">
                    <p class="text-sm font-bold text-text">${escapeHTML(r.nom || r.productId)}</p>
                </td>
                <td class="px-4 py-4 text-right">
                    <p class="text-sm font-bold text-text-muted">${shown}</p>
                </td>
                <td class="px-4 py-4 text-right">
                    <p class="text-sm font-black text-text">${accepted}</p>
                </td>
                <td class="px-4 py-4 text-right">
                    <span class="px-2 py-1 rounded-md text-[10px] font-black ${rateCls}">
                        ${shown > 0 ? rate.toFixed(0) + " %" : "—"}
                    </span>
                </td>
                <td class="px-4 py-4 text-right">
                    <p class="text-sm font-black text-text">${revenue.toFixed(2)} €</p>
                </td>
            </tr>
        `;
    }
}

export const adminUpsellUI = new AdminUpsellUI();
window.changeUpsellPage = (page) => adminUpsellUI.setPage(page);
