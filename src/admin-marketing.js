/**
 * 📣 MARKETING (Bridge)
 * Gère l'historique des campagnes et délègue l'UI à AdminMarketingUI.
 */
import { adminStore } from "./core/AdminStore.js";

async function loadPushHistory() {
    if (!window.currentAdminSnackId) return;

    try {
        const { query, collection, where, getDocs, orderBy, limit } = window.fs;
        const q = query(
            collection(window.db, "campagnes_push"),
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
            <div class="p-3 bg-gray-50 rounded-2xl border border-gray-100">
                <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">Titre</p>
                <p class="text-sm font-black text-gray-900 line-clamp-1">${last.titre}</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div class="p-3 bg-green-50 rounded-2xl border border-green-100 text-center">
                    <p class="text-[10px] text-green-600 font-bold uppercase mb-1">Envoyées</p>
                    <p class="text-xl font-black text-green-700">${last.stats?.envoye || 0}</p>
                </div>
                <div class="p-3 bg-blue-50 rounded-2xl border border-blue-100 text-center">
                    <p class="text-[10px] text-blue-600 font-bold uppercase mb-1">Clics</p>
                    <p class="text-xl font-black text-blue-700">${last.stats?.clics || 0}</p>
                </div>
            </div>
            <p class="text-[10px] text-gray-400 text-center italic">Dernier envoi : ${date.toLocaleDateString()} à ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
        </div>
    `;
}

// Compatibilité legacy
window.loadPushHistory = loadPushHistory;

window.populatePushProducts = () => {
    const select = document.getElementById("push-product-link");
    if (!select) return;

    select.innerHTML = '<option value="">📱 Accueil de l\'application</option>';
    adminStore.state.products.forEach((p) => {
        select.innerHTML += `<option value="${p.id}">🏷️ Promo sur : ${p.nom}</option>`;
    });
};
