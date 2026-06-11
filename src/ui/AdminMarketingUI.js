import { adminStore } from "../core/AdminStore.js";
import { db, fs } from "../core/firebase.js";
import { escapeHTML, showToast } from "../utils.js";
import { getWeatherForCity } from "../services/weatherService.js";
import { getInsight } from "../services/weatherInsights.js";

class AdminMarketingUI {
    constructor() {
        this.form = document.getElementById("push-campaign-form");
        this.tipsContainer = document.getElementById("marketing-tips-container");
        this.quotaContainer = document.getElementById("marketing-quota-info");
        this.weatherCard = document.getElementById("weather-insight-card");

        this.init();
    }

    init() {
        adminStore.addEventListener("admin-push-updated", () => this.render());
        // La config peut arriver après l'init (loadConfigView async) → on
        // re-render la météo dès qu'elle est en place.
        adminStore.addEventListener("admin-config-updated", () => this.renderWeatherInsight());
        if (this.form) {
            this.form.addEventListener("submit", (e) => this.handleSubmit(e));
        }
        // 1er essai au montage (si la config est déjà chargée)
        this.renderWeatherInsight();
    }

    render() {
        this.renderTips();
        this.renderQuota();
    }

    /**
     * 🌤️ Insight météo — fail-safe : si la ville est absente ou si l'API
     * Open-Meteo ne répond pas, on masque simplement la card. Aucun blocker
     * pour le reste du dashboard marketing.
     */
    async renderWeatherInsight() {
        if (!this.weatherCard) return;

        const city = adminStore.state.config?.contact?.address?.city;
        if (!city) {
            this.weatherCard.classList.add("hidden");
            return;
        }

        const weather = await getWeatherForCity(city, "FR");
        if (!weather) {
            this.weatherCard.classList.add("hidden");
            return;
        }

        const insight = getInsight(weather.condition);

        this.weatherCard.classList.remove("hidden");
        this.weatherCard.innerHTML = `
            <div class="bg-linear-to-br ${insight.bgGradient} rounded-3xl p-6 text-white shadow-lg overflow-hidden relative">
                <div class="flex items-start gap-5">
                    <div class="shrink-0 w-16 h-16 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                        <i class="fas ${insight.icon} ${insight.iconColor} text-3xl"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-baseline gap-3 flex-wrap">
                            <span class="text-3xl font-black tracking-tight">${weather.temperature}°C</span>
                            <span class="text-sm font-bold opacity-80 uppercase tracking-wider">${escapeHTML(weather.city)}</span>
                        </div>
                        <h4 class="text-lg font-black mt-1">${escapeHTML(insight.title)}</h4>
                        <p class="text-sm leading-snug mt-1 opacity-90">${escapeHTML(insight.advice)}</p>
                    </div>
                </div>
                <button type="button" id="btn-weather-template"
                        class="mt-5 w-full bg-white/95 hover:bg-white text-gray-900 font-black py-3 rounded-2xl shadow transition-all active:scale-95 flex items-center justify-center gap-2">
                    <i class="fas fa-magic-wand-sparkles"></i> Utiliser ce modèle
                </button>
            </div>
        `;

        const btn = document.getElementById("btn-weather-template");
        if (btn) btn.onclick = () => this.applyWeatherTemplate(insight.template);
    }

    /**
     * Pré-remplit titre + message du form push avec le template météo.
     * Ne déclenche PAS la soumission : le gérant relit/édite puis soumet
     * lui-même via le bouton existant. Respect du flow campagne actuel.
     */
    applyWeatherTemplate(template) {
        const titleEl = document.getElementById("push-title");
        const messageEl = document.getElementById("push-message");
        if (!titleEl || !messageEl) return;

        titleEl.value = template.title;
        messageEl.value = template.message;
        // Notifie d'éventuels listeners (validation, compteurs de caractères…)
        titleEl.dispatchEvent(new Event("input", { bubbles: true }));
        messageEl.dispatchEvent(new Event("input", { bubbles: true }));

        titleEl.focus();
        titleEl.scrollIntoView({ behavior: "smooth", block: "center" });
        showToast("Modèle météo appliqué — relisez avant d'envoyer.", "success");
    }

    async renderTips() {
        if (!this.tipsContainer) return;

        // 1. Tips calendrier (sync) — affichage immédiat sans attendre Firestore.
        const tips = [...adminStore.getSmartMarketingTips()];
        this.paintTips(tips);

        // 2 & 3 : async tips en parallèle pour minimiser la latence perçue.
        const snackId = window.currentAdminSnackId;
        const [salesTip, footballTip] = await Promise.all([
            (snackId && db && fs)
                ? adminStore.getSalesTrendTip(db, fs, snackId)
                : Promise.resolve(null),
            fs ? adminStore.getFootballTip(fs) : Promise.resolve(null),
        ]);

        // Ordre de priorité visuelle (top → bas) :
        //   sales-trend (alerte rouge) > football (actionnable J+1) > calendrier
        if (footballTip) tips.unshift(footballTip);
        if (salesTip) tips.unshift(salesTip);
        if (salesTip || footballTip) this.paintTips(tips);
    }

    /**
     * Rend la liste de tips dans le container. Sépare la logique de fetch
     * (renderTips async) de la peinture DOM (sync) pour SOLID + tests.
     */
    paintTips(tips) {
        if (!this.tipsContainer) return;

        if (tips.length === 0) {
            this.tipsContainer.innerHTML = `<p class="text-xs text-gray-400 italic">Aucun conseil particulier pour le moment.</p>`;
            return;
        }

        const ICON_BY_TYPE = {
            "creux": "fa-clock",
            "event": "fa-calendar",
            "weekend": "fa-calendar-week",
            "sales-trend": "fa-chart-line",
            "football": "fa-futbol",
        };

        this.tipsContainer.innerHTML = tips.map(tip => {
            const isAlert = tip.type === "sales-trend";
            const bgClass = isAlert ? "bg-red-50 border-red-100" : "bg-blue-50 border-blue-100";
            const dotClass = isAlert ? "bg-red-500" : "bg-blue-500";
            const titleClass = isAlert ? "text-red-900" : "text-blue-900";
            const msgClass = isAlert ? "text-red-700" : "text-blue-700";
            const icon = ICON_BY_TYPE[tip.type] || "fa-star";

            return `
                <div class="flex items-start gap-3 p-3 ${bgClass} rounded-xl border animate-fade-in">
                    <div class="w-8 h-8 rounded-full ${dotClass} text-white flex items-center justify-center shrink-0">
                        <i class="fas ${icon} text-xs"></i>
                    </div>
                    <div>
                        <h5 class="text-xs font-black ${titleClass} mb-0.5">${escapeHTML(tip.title || "")}</h5>
                        <p class="text-[10px] ${msgClass} leading-tight">${escapeHTML(tip.message || "")}</p>
                    </div>
                </div>
            `;
        }).join("");
    }

    renderQuota() {
        if (!this.quotaContainer) return;
        const eligibility = adminStore.getPushEligibility();
        
        const percentage = (eligibility.count / eligibility.limit) * 100;
        const colorClass = percentage >= 100 ? "bg-red-500" : percentage >= 50 ? "bg-orange-500" : "bg-green-500";

        const safePct = Math.max(0, Math.min(100, Number(percentage) || 0));
        this.quotaContainer.innerHTML = `
            <div class="space-y-2">
                <div class="flex justify-between items-center text-[10px] font-black uppercase tracking-wider">
                    <span class="text-gray-400">Quota mensuel</span>
                    <span class="${percentage >= 100 ? 'text-red-500' : 'text-gray-900'}">${parseInt(eligibility.count) || 0} / ${parseInt(eligibility.limit) || 0}</span>
                </div>
                <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full ${colorClass} transition-all duration-1000" style="width: ${safePct}%"></div>
                </div>
                <p class="text-[10px] text-gray-500 italic">${escapeHTML(eligibility.message || 'Utilisez vos notifications stratégiquement pour maximiser l\'impact.')}</p>
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

            await adminStore.schedulePush(db, fs, {
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
