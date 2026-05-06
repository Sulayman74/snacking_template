import { adminStore } from "../core/AdminStore.js";
import { showToast } from "../utils.js";

class AdminMarketingUI {
    constructor() {
        this.form = document.getElementById("push-campaign-form");
        this.tipsContainer = document.getElementById("marketing-tips-container");
        this.quotaContainer = document.getElementById("marketing-quota-info");
        
        this.init();
    }

    init() {
        adminStore.addEventListener("admin-push-updated", () => this.render());
        if (this.form) {
            this.form.addEventListener("submit", (e) => this.handleSubmit(e));
        }
    }

    render() {
        this.renderTips();
        this.renderQuota();
    }

    renderTips() {
        if (!this.tipsContainer) return;
        const tips = adminStore.getSmartMarketingTips();
        
        if (tips.length === 0) {
            this.tipsContainer.innerHTML = `<p class="text-xs text-gray-400 italic">Aucun conseil particulier pour le moment.</p>`;
            return;
        }

        this.tipsContainer.innerHTML = tips.map(tip => `
            <div class="flex items-start gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100 animate-fade-in">
                <div class="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0">
                    <i class="fas ${tip.type === 'creux' ? 'fa-clock' : tip.type === 'event' ? 'fa-calendar' : 'fa-star'} text-xs"></i>
                </div>
                <div>
                    <h5 class="text-xs font-black text-blue-900 mb-0.5">${tip.title}</h5>
                    <p class="text-[10px] text-blue-700 leading-tight">${tip.message}</p>
                </div>
            </div>
        `).join("");
    }

    renderQuota() {
        if (!this.quotaContainer) return;
        const eligibility = adminStore.getPushEligibility();
        
        const percentage = (eligibility.count / eligibility.limit) * 100;
        const colorClass = percentage >= 100 ? "bg-red-500" : percentage >= 50 ? "bg-orange-500" : "bg-green-500";

        this.quotaContainer.innerHTML = `
            <div class="space-y-2">
                <div class="flex justify-between items-center text-[10px] font-black uppercase tracking-wider">
                    <span class="text-gray-400">Quota mensuel</span>
                    <span class="${percentage >= 100 ? 'text-red-500' : 'text-gray-900'}">${eligibility.count} / ${eligibility.limit}</span>
                </div>
                <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full ${colorClass} transition-all duration-1000" style="width: ${percentage}%"></div>
                </div>
                <p class="text-[10px] text-gray-500 italic">${eligibility.message || 'Utilisez vos notifications stratégiquement pour maximiser l\'impact.'}</p>
            </div>
        `;

        // Désactiver le bouton d'envoi si quota atteint
        const sendBtn = document.getElementById("btn-send-push");
        if (sendBtn) {
            sendBtn.disabled = !eligibility.canSend;
            if (!eligibility.canSend) {
                sendBtn.classList.add("opacity-50", "grayscale");
                sendBtn.title = eligibility.message;
            } else {
                sendBtn.classList.remove("opacity-50", "grayscale");
                sendBtn.title = "";
            }
        }
    }

    async handleSubmit(e) {
        e.preventDefault();
        const btn = document.getElementById("btn-send-push");
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Programmation...`;
        btn.disabled = true;

        try {
            const titre = document.getElementById("push-title").value;
            const message = document.getElementById("push-message").value;
            const target = document.getElementById("push-target").value;
            const dateSaisie = document.getElementById("push-date").value;
            const selectedProductId = document.getElementById("push-product-link").value;

            const dateEnvoi = dateSaisie ? new Date(dateSaisie) : new Date();

            let actionUrl = null;
            let imageUrl = null;
            if (selectedProductId) {
                actionUrl = `?action=product&id=${selectedProductId}`;
                const product = adminStore.state.products.find(p => p.id === selectedProductId);
                if (product?.image) imageUrl = product.image;
            }

            await adminStore.schedulePush(window.db, window.fs, {
                titre,
                message,
                cible: target,
                actionUrl,
                imageUrl,
                dateEnvoiPrevue: dateEnvoi
            });

            showToast("Campagne programmée !", "success");
            this.form.reset();
            // Rechargement manuel de l'historique (qui mettra à jour le Store et donc le quota)
            if (typeof window.loadPushHistory === "function") window.loadPushHistory();
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    }
}

export const adminMarketingUI = new AdminMarketingUI();
