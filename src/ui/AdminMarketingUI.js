import { adminStore } from "../core/AdminStore.js";
import { db, fs } from "../core/firebase.js";
import { escapeHTML, showToast } from "../utils.js";
import { getWeatherForCity } from "../services/weatherService.js";
import { getInsight } from "../services/weatherInsights.js";
import { analyzeProductSales } from "../services/productSalesInsights.js";

class AdminMarketingUI {
    constructor() {
        this.form = document.getElementById("push-campaign-form");
        this.tipsContainer = document.getElementById("marketing-tips-container");
        this.quotaContainer = document.getElementById("marketing-quota-info");
        this.weatherCard = document.getElementById("weather-insight-card");
        this.flashBtn = document.getElementById("btn-flash-offer");
        this.flashHint = document.getElementById("flash-offer-hint");
        this.suggestionsWidget = document.getElementById("marketing-sales-suggestions-widget");
        this.suggestionsList = document.getElementById("marketing-product-suggestions-list");
        this.cachedSuggestions = [];

        this.init();
    }

    init() {
        adminStore.addEventListener("admin-push-updated", () => this.render());
        // La config peut arriver après l'init (loadConfigView async) → on
        // re-render la météo dès qu'elle est en place.
        adminStore.addEventListener("admin-config-updated", () => this.renderWeatherInsight());
        // 🔥 Le bouton offre flash reflète la charge cuisine (rushMode serveur).
        adminStore.addEventListener("admin-kitchen-load-updated", () => this.renderFlashEligibility());
        // 📊 Les suggestions de vente réagissent aux commandes et aux produits
        adminStore.addEventListener("admin-sales-updated", () => this.renderProductSuggestions());
        adminStore.addEventListener("admin-products-updated", () => this.renderProductSuggestions());
        if (this.form) {
            this.form.addEventListener("submit", (e) => this.handleSubmit(e));
        }
        if (this.flashBtn) {
            this.flashBtn.addEventListener("click", () => this.handleFlashOffer());
        }
        // 1er essai au montage (si la config est déjà chargée)
        this.renderWeatherInsight();
        this.renderFlashEligibility();
        this.renderProductSuggestions();
    }

    render() {
        this.renderTips();
        this.renderQuota();
        this.renderFlashEligibility();
        this.renderProductSuggestions();
    }

    /**
     * Reflète l'éligibilité d'une offre flash sur le bouton dédié : désactivé en
     * rushMode (cuisine en charge) ou quota mensuel atteint. Purement UX — le
     * serveur (pushFlashOffer) reste la source de vérité de la garde.
     */
    renderFlashEligibility() {
        if (!this.flashBtn) return;
        const { canSendFlash, message } = adminStore.getFlashOfferEligibility();
        this.flashBtn.disabled = !canSendFlash;
        if (!canSendFlash) {
            this.flashBtn.classList.add("opacity-50", "grayscale");
            this.flashBtn.title = message;
        } else {
            this.flashBtn.classList.remove("opacity-50", "grayscale");
            this.flashBtn.title = "";
        }
        if (this.flashHint) this.flashHint.textContent = canSendFlash ? "" : message;
    }

    async handleFlashOffer() {
        if (!this.flashBtn) return;
        const title = document.getElementById("push-title")?.value?.trim();
        const message = document.getElementById("push-message")?.value?.trim();
        if (!title || !message) {
            showToast("Renseigne un titre et un message pour l'offre flash.", "error");
            return;
        }

        const originalHtml = this.flashBtn.innerHTML;
        this.flashBtn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Envoi flash...`;
        this.flashBtn.disabled = true;
        try {
            // ttlMin par défaut : 60 min (offre courte). Le serveur revérifie le rushMode.
            await adminStore.pushFlashOffer(fs, { title, body: message, ttlMin: 60 });
            showToast("Offre flash envoyée aux clients actifs ! ⚡", "success");
            this.form?.reset();
            if (typeof window.loadPushHistory === "function") window.loadPushHistory();
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            this.flashBtn.innerHTML = originalHtml;
            this.renderFlashEligibility();
        }
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
            <div class="bg-linear-to-br ${insight.bgGradient} rounded-3xl p-5 sm:p-6 text-white shadow-lg overflow-hidden relative">
                <div class="flex items-start gap-4 sm:gap-5">
                    <div class="shrink-0 w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                        <i data-lucide="${insight.icon}" class="${insight.iconColor} text-2xl sm:text-3xl"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-baseline gap-2 sm:gap-3 flex-wrap">
                            <span class="text-2xl sm:text-3xl font-black tracking-tight">${weather.temperature}°C</span>
                            <span class="text-xs sm:text-sm font-bold opacity-80 uppercase tracking-wider truncate">${escapeHTML(weather.city)}</span>
                        </div>
                        <h4 class="text-base sm:text-lg font-black mt-1">${escapeHTML(insight.title)}</h4>
                        <p class="text-xs sm:text-sm leading-snug mt-1 opacity-90">${escapeHTML(insight.advice)}</p>
                    </div>
                </div>
                <div class="mt-4 pt-3 border-t border-white/20 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span class="inline-flex items-center gap-1.5 font-bold text-white text-xs">
                        <span class="relative flex h-2 w-2">
                            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                        </span>
                        Notification météo automatique active
                    </span>
                    <span class="text-[10px] font-black uppercase tracking-wider bg-white/20 text-white px-2.5 py-1 rounded-full">
                        Géré par Smart Advisor
                    </span>
                </div>
            </div>
        `;
        window.lucide?.createIcons?.();
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
            this.tipsContainer.innerHTML = `<p class="text-xs text-text-muted italic">Aucun conseil particulier pour le moment.</p>`;
            return;
        }

        const ICON_BY_TYPE = {
            "creux": "clock",
            "event": "calendar",
            "weekend": "calendar-days",
            "sales-trend": "chart-line",
            "football": "trophy",
        };

        this.tipsContainer.innerHTML = tips.map(tip => {
            const isAlert = tip.type === "sales-trend";
            const isFootball = tip.type === "football";

            let bgClass = "bg-blue-500/10 border-blue-500/20";
            let dotClass = "bg-blue-600 text-white";
            let titleClass = "text-blue-700 dark:text-blue-400";
            let msgClass = "text-text-muted";

            if (isAlert) {
                bgClass = "bg-red-500/10 border-red-500/20";
                dotClass = "bg-red-600 text-white";
                titleClass = "text-red-700 dark:text-red-400";
            } else if (isFootball) {
                bgClass = "bg-amber-500/10 border-amber-500/20";
                dotClass = "bg-amber-600 text-white";
                titleClass = "text-amber-700 dark:text-amber-400";
            }

            const icon = ICON_BY_TYPE[tip.type] || "sparkles";

            return `
                <div class="flex items-start gap-3 p-3.5 ${bgClass} rounded-2xl border transition">
                    <div class="w-8 h-8 rounded-xl ${dotClass} flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                        <i data-lucide="${icon}" class="text-xs"></i>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center justify-between gap-2 mb-1">
                            <h5 class="text-xs font-black ${titleClass} truncate">${escapeHTML(tip.title || "")}</h5>
                            <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-surface/90 text-text border border-line shrink-0">Auto</span>
                        </div>
                        <p class="text-[11px] ${msgClass} leading-relaxed">${escapeHTML(tip.message || "")}</p>
                    </div>
                </div>
            `;
        }).join("");
    }

    renderQuota() {
        if (!this.quotaContainer) return;
        const eligibility = adminStore.getPushEligibility();
        const count = parseInt(eligibility.count) || 0;

        this.quotaContainer.innerHTML = `
            <div class="space-y-1.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                        <i data-lucide="info" class="w-3.5 h-3.5"></i> Campagnes Manuelles
                    </span>
                    <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
                        ${count} envoyée${count > 1 ? 's' : ''} ce mois
                    </span>
                </div>
                <p class="text-xs font-bold text-text leading-snug">
                    💡 Recommandation : 1 à 2 notifications manuelles / semaine max.
                </p>
                <p class="text-[11px] text-text-muted leading-relaxed">
                    Le <strong class="text-text font-bold">Smart Advisor</strong> envoie déjà vos notifications automatiques (météo, soirs de match, relances paniers) en continu. Réservez ce formulaire pour vos annonces ponctuelles et promos exclusives !
                </p>
            </div>
        `;
        window.lucide?.createIcons?.();

        const sendBtn = document.getElementById("btn-send-push");
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.classList.remove("opacity-50", "grayscale");
            sendBtn.title = "";
        }
    }

    async handleSubmit(e) {
        e.preventDefault();
        const btn = document.getElementById("btn-send-push");
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Programmation...`;
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

    /**
     * Affiche le widget interactif de suggestions de push basées sur les ventes (Compta ⇄ Push).
     */
    renderProductSuggestions() {
        if (!this.suggestionsList) return;

        const products = adminStore.state.products || [];
        const sales = adminStore.state.sales || [];

        const { totalCoreProducts, suggestions } = analyzeProductSales(products, sales);
        this.cachedSuggestions = suggestions;

        if (totalCoreProducts === 0) {
            this.suggestionsList.innerHTML = `<p class="col-span-full text-xs text-text-muted italic py-3 text-center">Aucun plat principal configuré sur la carte.</p>`;
            return;
        }

        if (suggestions.length === 0) {
            this.suggestionsList.innerHTML = `
                <div class="col-span-full p-4 bg-surface-2 rounded-2xl border border-line text-center space-y-1">
                    <p class="text-xs font-bold text-text">Toutes vos ventes sont équilibrées ! 🎯</p>
                    <p class="text-[11px] text-text-muted">Aucune non-vente critique détectée sur vos plats principaux.</p>
                </div>`;
            return;
        }

        const BADGE_STYLES = {
            amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30",
            emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30",
            orange: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border border-orange-500/30",
        };

        this.suggestionsList.innerHTML = suggestions.map((s) => {
            const badgeClass = BADGE_STYLES[s.badgeColor] || "bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30";
            const safeImg = s.productImage ? escapeHTML(s.productImage) : "";
            const isFlash = s.type === "flash";

            return `
                <div class="p-4 bg-surface-2 hover:bg-surface-3 transition rounded-2xl border border-line flex flex-col justify-between space-y-3.5 shadow-2xs">
                    <div class="space-y-2.5">
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${badgeClass}">
                                ${escapeHTML(s.badge)}
                            </span>
                            <span class="text-xs sm:text-sm font-black text-text">${parseFloat(s.productPrice || 0).toFixed(2)} €</span>
                        </div>

                        <div class="flex items-start gap-3">
                            ${safeImg ? `
                                <img src="${safeImg}" class="w-12 h-12 rounded-xl object-cover shrink-0 border border-line shadow-2xs" alt="${escapeHTML(s.productName)}">
                            ` : `
                                <div class="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center shrink-0 text-lg">🍔</div>
                            `}
                            <div class="min-w-0 flex-1">
                                <h4 class="text-xs sm:text-sm font-black text-text line-clamp-2 leading-snug">${escapeHTML(s.productName)}</h4>
                                <p class="text-xs text-text-muted font-medium mt-0.5">${escapeHTML(s.diagnostic)}</p>
                            </div>
                        </div>

                        <p class="text-xs text-text/85 leading-relaxed italic border-l-2 border-line pl-2.5">
                            "${escapeHTML(s.push.title)}"
                        </p>
                    </div>

                    <button type="button"
                            onclick="if(window.applyProductPushSuggestion) window.applyProductPushSuggestion('${escapeHTML(s.id)}')"
                            class="w-full py-2.5 px-3 ${isFlash ? 'bg-orange-500 hover:bg-orange-600' : 'bg-primary hover:opacity-90'} text-on-primary rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-sm cursor-pointer">
                        <i data-lucide="${isFlash ? 'zap' : 'send'}" class="w-3.5 h-3.5"></i>
                        <span>${isFlash ? 'Pré-remplir l\'Offre Flash' : 'Pré-remplir ce Push'}</span>
                    </button>
                </div>
            `;
        }).join("");

        window.lucide?.createIcons?.();
    }

    /**
     * Pré-remplit le formulaire de push manuel en 1 clic avec les données de la suggestion.
     * @param {string} suggestionId
     */
    applySuggestion(suggestionId) {
        let suggestion = (this.cachedSuggestions || []).find((s) => s.id === suggestionId);
        if (!suggestion) {
            const { suggestions } = analyzeProductSales(adminStore.state.products || [], adminStore.state.sales || []);
            suggestion = suggestions.find((s) => s.id === suggestionId);
        }
        if (!suggestion) {
            showToast("Suggestion introuvable.", "error");
            return;
        }

        const titleEl = document.getElementById("push-title");
        const msgEl = document.getElementById("push-message");
        const targetEl = document.getElementById("push-target");
        const productLinkEl = document.getElementById("push-product-link");

        if (titleEl) {
            titleEl.value = suggestion.push.title;
            titleEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (msgEl) {
            msgEl.value = suggestion.push.message;
            msgEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (targetEl && suggestion.push.target) {
            targetEl.value = suggestion.push.target;
            targetEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (productLinkEl && suggestion.productId) {
            productLinkEl.value = suggestion.productId;
            productLinkEl.dispatchEvent(new Event("change", { bubbles: true }));
        }

        if (titleEl) {
            titleEl.focus();
            titleEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        showToast(`Campagne pré-remplie pour « ${suggestion.productName} » ! Relisez et envoyez.`, "success");
    }
}

export const adminMarketingUI = new AdminMarketingUI();

// Global Bridge pour l'interface
window.applyProductPushSuggestion = (id) => adminMarketingUI.applySuggestion(id);
