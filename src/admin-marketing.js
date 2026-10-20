/**
 * 📣 MARKETING (Bridge)
 * Gère l'historique des campagnes et délègue l'UI à AdminMarketingUI.
 */
import { adminStore } from "./core/AdminStore.js";
import { escapeHTML } from "./utils.js";
import {
    db,
    query,
    collection,
    where,
    getDocs,
    orderBy,
    limit,
} from "./core/firebase.js";

let currentPushPage = 1;
const PUSH_PAGE_SIZE = 5;

async function loadPushHistory() {
    if (!window.currentAdminSnackId) return;

    try {
        const q = query(
            collection(db, "campagnes_push"),
            where("snackId", "==", window.currentAdminSnackId),
            orderBy("dateCreation", "desc"),
            limit(50)
        );

        const snapshot = await getDocs(q);
        const history = [];
        snapshot.forEach(doc => history.push({ id: doc.id, ...doc.data() }));

        currentPushPage = 1;
        adminStore.setPushHistory(history);
        renderPushHistory(history);

    } catch (error) {
        console.error("Erreur historique push:", error);
    }
}

function renderPushHistory(history) {
    const container = document.getElementById("last-campaign-stats");
    if (!container) return;

    const list = Array.isArray(history) ? history : (history ? [history] : []);

    if (list.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 px-4 bg-surface-2 rounded-2xl border border-dashed border-line">
                <i data-lucide="bell-off" class="text-2xl text-text-muted mb-2"></i>
                <p class="text-xs text-text-muted font-bold">Aucune campagne envoyée.</p>
                <p class="text-[10px] text-text-muted mt-1">Vos notifications programmées et envoyées s'afficheront ici.</p>
            </div>
        `;
        window.lucide?.createIcons?.();
        return;
    }

    const totalPages = Math.ceil(list.length / PUSH_PAGE_SIZE) || 1;
    if (currentPushPage > totalPages) currentPushPage = totalPages;
    if (currentPushPage < 1) currentPushPage = 1;

    const startIndex = (currentPushPage - 1) * PUSH_PAGE_SIZE;
    const endIndex = Math.min(startIndex + PUSH_PAGE_SIZE, list.length);
    const pagedList = list.slice(startIndex, endIndex);

    const TARGET_LABELS = {
        all: "🚀 Tous",
        active: "🔥 Actifs",
        inactive: "❄️ Inactifs"
    };

    const itemsHtml = pagedList.map((c) => {
        const date = c.dateCreation?.toDate ? c.dateCreation.toDate() : (c.dateCreation != null ? new Date(c.dateCreation) : new Date());
        const dateStr = !isNaN(date.getTime())
            ? date.toLocaleDateString("fr-FR", { day: '2-digit', month: '2-digit' }) + " · " + date.toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit' })
            : "—";
        const targetLabel = TARGET_LABELS[c.cible] || c.cible || "Tous";
        const isFlash = c.type === "flash" || c.isFlash === true;
        const sentCount = parseInt(c.stats?.envoye ?? c.envoye ?? 0) || 0;
        const clicksCount = parseInt(c.stats?.clics ?? c.clics ?? 0) || 0;

        return `
            <div class="p-3.5 bg-surface-2 hover:bg-surface-3 transition rounded-2xl border border-line space-y-2">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap mb-1">
                            <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${isFlash ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'}">
                                ${isFlash ? '⚡ Flash' : '📣 Manuel'}
                            </span>
                            <span class="text-[9px] font-bold text-text-muted bg-surface px-1.5 py-0.5 rounded border border-line">
                                ${targetLabel}
                            </span>
                        </div>
                        <h4 class="text-xs font-black text-text line-clamp-1">${escapeHTML(c.titre || "Sans titre")}</h4>
                    </div>
                    <span class="text-[10px] text-text-muted shrink-0 font-medium">${escapeHTML(dateStr)}</span>
                </div>
                <p class="text-[11px] text-text-muted line-clamp-2 leading-relaxed">${escapeHTML(c.message || "")}</p>
                <div class="flex items-center gap-3 pt-1 border-t border-line/60 text-[10px] font-bold">
                    <span class="text-green-600 dark:text-green-400">📤 <strong>${sentCount}</strong> envoyée${sentCount > 1 ? 's' : ''}</span>
                    <span class="text-blue-600 dark:text-blue-400">👆 <strong>${clicksCount}</strong> clic${clicksCount > 1 ? 's' : ''}</span>
                    ${sentCount > 0 ? `<span class="text-text-muted ml-auto font-black text-[9px]">${Math.round((clicksCount / sentCount) * 100)} % taux</span>` : ''}
                </div>
            </div>
        `;
    }).join("");

    const paginationHtml = totalPages > 1 ? `
        <div class="flex items-center justify-between gap-2 pt-3 border-t border-line text-xs">
            <span class="text-text-muted text-[11px] font-medium">
                Affichage <strong class="text-text">${startIndex + 1}–${endIndex}</strong> sur <strong class="text-text">${list.length}</strong>
            </span>
            <div class="flex items-center gap-1.5">
                <button
                    type="button"
                    onclick="window.changePushHistoryPage(${currentPushPage - 1})"
                    ${currentPushPage <= 1 ? "disabled" : ""}
                    class="px-2.5 py-1.5 rounded-xl border border-line bg-surface-2 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed text-text font-bold transition flex items-center gap-1 text-xs"
                    title="Page précédente"
                    aria-label="Page précédente"
                >
                    <i data-lucide="chevron-left" class="w-3.5 h-3.5"></i>
                    <span class="hidden sm:inline">Précédent</span>
                </button>
                <span class="px-2.5 py-1 text-[11px] font-black text-text bg-surface-2 rounded-lg border border-line">
                    ${currentPushPage} / ${totalPages}
                </span>
                <button
                    type="button"
                    onclick="window.changePushHistoryPage(${currentPushPage + 1})"
                    ${currentPushPage >= totalPages ? "disabled" : ""}
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

    container.innerHTML = `
        <div class="space-y-3">
            ${itemsHtml}
            ${paginationHtml}
        </div>
    `;
    window.lucide?.createIcons?.();
}

function renderLastCampaignStats(arg) {
    renderPushHistory(Array.isArray(arg) ? arg : (arg ? [arg] : []));
}

window.changePushHistoryPage = (page) => {
    currentPushPage = page;
    renderPushHistory(adminStore.state.pushHistory || []);
};

// Compatibilité legacy
window.loadPushHistory = loadPushHistory;

window.populatePushProducts = () => {
    const select = document.getElementById("push-product-link");
    if (!select) return;

    const parts = ['<option value="">📱 Accueil de l\'application</option>'];
    adminStore.state.products.forEach((p) => {
        parts.push(`<option value="${escapeHTML(p.id)}">🏷️ Promo sur : ${escapeHTML(p.nom || "")}</option>`);
    });
    select.innerHTML = parts.join("");
};
