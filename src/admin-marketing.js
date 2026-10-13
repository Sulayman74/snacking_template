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

async function loadPushHistory() {
    if (!window.currentAdminSnackId) return;

    try {
        const q = query(
            collection(db, "campagnes_push"),
            where("snackId", "==", window.currentAdminSnackId),
            orderBy("dateCreation", "desc"),
            limit(10)
        );

        const snapshot = await getDocs(q);
        const history = [];
        snapshot.forEach(doc => history.push({ id: doc.id, ...doc.data() }));

        adminStore.setPushHistory(history);
        renderLastCampaignStats(history[0]);

    } catch (error) {
        console.error("Erreur historique push:", error);
    }
}

function renderLastCampaignStats(last) {
    const container = document.getElementById("last-campaign-stats");
    if (!container) return;

    if (!last) {
        container.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-4">Aucune campagne envoyée.</p>`;
        return;
    }

    const date = last.dateCreation?.toDate ? last.dateCreation.toDate() : new Date(last.dateCreation);
    
    container.innerHTML = `
        <div class="space-y-3">
            <div class="p-3 bg-surface-2 rounded-2xl border border-line">
                <p class="text-[10px] text-text-muted font-bold uppercase mb-1">Titre</p>
                <p class="text-sm font-black text-text line-clamp-1">${escapeHTML(last.titre || "")}</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div class="p-3 bg-green-50 dark:bg-green-950/40 rounded-2xl border border-green-100 dark:border-green-800 text-center">
                    <p class="text-[10px] text-green-600 dark:text-green-400 font-bold uppercase mb-1">Envoyées</p>
                    <p class="text-xl font-black text-green-700 dark:text-green-300">${parseInt(last.stats?.envoye) || 0}</p>
                </div>
                <div class="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-2xl border border-blue-100 dark:border-blue-800 text-center">
                    <p class="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase mb-1">Clics</p>
                    <p class="text-xl font-black text-blue-700 dark:text-blue-300">${parseInt(last.stats?.clics) || 0}</p>
                </div>
            </div>
            <p class="text-[10px] text-text-muted text-center italic">Dernier envoi : ${escapeHTML(date.toLocaleDateString())} à ${escapeHTML(date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}))}</p>
        </div>
    `;
}

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
