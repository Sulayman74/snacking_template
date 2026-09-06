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
        this.init();
    }

    init() {
        adminStore.addEventListener("admin-upsell-updated", () => this.render());
    }

    render() {
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
            return;
        }

        this.tableEl.innerHTML = `
            <div class="overflow-x-auto">
                <table class="w-full text-left">
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
                        ${rows.map((r) => this.renderRow(r)).join("")}
                    </tbody>
                </table>
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
