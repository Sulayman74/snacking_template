import { adminStore } from "../core/AdminStore.js";
import { escapeHTML, showToast } from "../utils.js";

class AdminComptaUI {
    constructor() {
        this.totalSalesEl = document.getElementById("compta-total-sales");
        this.totalOrdersEl = document.getElementById("compta-total-orders");
        this.kpiExtrasEl = document.getElementById("compta-kpi-extras");
        this.historyTableEl = document.getElementById("compta-history-table");
        
        this.init();
    }

    init() {
        adminStore.addEventListener("admin-sales-updated", () => this.render());
        // Le statut Stripe dépend de la config (admin-config-updated), pas des ventes.
        adminStore.addEventListener("admin-config-updated", () => this.renderStripeStatus());
    }

    render() {
        this.renderKPIs();
        this.renderHistory();
        this.renderStripeStatus();
    }

    /**
     * Bascule la carte Stripe selon la présence de stripeAccountId :
     * absent → "Configurer les paiements" (onboarding) ; présent → "Ouvrir mon portail".
     */
    renderStripeStatus() {
        const cfg = adminStore.state.config;
        const hasAccount = !!cfg?.stripeAccountId;
        const onboardBtn = document.getElementById("btn-stripe-onboard");
        const manageBtn = document.getElementById("btn-stripe-dashboard");
        if (!onboardBtn || !manageBtn) return;

        onboardBtn.classList.toggle("hidden", hasAccount);
        manageBtn.classList.toggle("hidden", !hasAccount);

        const badge = document.getElementById("stripe-status-badge");
        if (badge) {
            badge.textContent = hasAccount ? "Connecté" : "À configurer";
            badge.className = "ml-auto text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full " +
                (hasAccount ? "bg-green-500/20 text-green-300" : "bg-amber-500/20 text-amber-300");
        }
        const text = document.getElementById("stripe-card-text");
        if (text) {
            text.innerHTML = hasAccount
                ? 'Accédez à <span class="font-bold text-white">Stripe Express</span> pour votre RIB et vos versements.'
                : 'Connectez votre compte bancaire via <span class="font-bold text-white">Stripe</span> pour recevoir vos paiements.';
        }
    }

    /**
     * Lance l'onboarding Stripe Connect : appelle getStripeOnboardingLink puis
     * redirige en plein écran vers l'AccountLink (requis par Stripe). En cas
     * d'échec, on restaure le bouton ; en cas de succès, la page change (redirection).
     */
    async startOnboarding() {
        const btn = document.getElementById("btn-stripe-onboard");
        const original = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Connexion Stripe…'; }
        try {
            const { httpsCallable, functions } = window.fs;
            const fn = httpsCallable(functions, "getStripeOnboardingLink");
            const res = await fn({ snackId: window.currentAdminSnackId, origin: window.location.origin });
            if (res.data?.url) {
                window.location.href = res.data.url; // redirection plein écran (AccountLink)
            } else {
                throw new Error("URL d'onboarding manquante.");
            }
        } catch (e) {
            console.error("Erreur onboarding Stripe :", e);
            showToast("Impossible de démarrer la configuration Stripe.", "error");
            if (btn && original != null) { btn.disabled = false; btn.innerHTML = original; }
        }
    }

    renderKPIs() {
        const kpis = adminStore.getSalesKPIs();
        if (this.totalSalesEl) this.totalSalesEl.textContent = `${kpis.total} €`;
        if (this.totalOrdersEl) this.totalOrdersEl.textContent = kpis.count;

        if (this.kpiExtrasEl) {
            this.kpiExtrasEl.innerHTML = `
                <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Panier Moyen</p>
                    <p class="text-xl font-black text-gray-900">${kpis.avg} €</p>
                </div>
                <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">TVA (10%)</p>
                    <p class="text-xl font-black text-gray-900">${kpis.tva} €</p>
                </div>
                <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Total HT</p>
                    <p class="text-xl font-black text-gray-900">${kpis.ht} €</p>
                </div>
            `;
        }
    }

    renderHistory() {
        if (!this.historyTableEl) return;
        const sales = adminStore.state.salesData;

        if (sales.length === 0) {
            this.historyTableEl.innerHTML = `
                <div class="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                    <i class="fas fa-search text-3xl text-gray-200 mb-3"></i>
                    <p class="text-gray-400 font-bold">Aucune vente sur cette période.</p>
                </div>
            `;
            return;
        }

        // L'historique est borné à 200 lignes (affichage). Les KPIs ci-dessus
        // restent exacts (agrégat serveur). Au-delà, inviter à l'export CSV complet.
        const truncatedNote = sales.length >= 200 ? `
            <div class="mb-3 px-4 py-2 rounded-xl bg-amber-50 border border-amber-100 text-amber-700 text-xs font-bold">
                <i class="fas fa-circle-info mr-1"></i> 200 commandes les plus récentes affichées. Les totaux restent exacts ; utilisez l'export CSV pour le détail complet.
            </div>` : "";

        this.historyTableEl.innerHTML = `
            ${truncatedNote}
            <div class="overflow-x-auto">
                <table class="w-full text-left">
                    <thead class="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        <tr>
                            <th class="px-4 py-3">Date</th>
                            <th class="px-4 py-3">Client</th>
                            <th class="px-4 py-3">Total TTC</th>
                            <th class="px-4 py-3">Statut</th>
                            <th class="px-4 py-3 text-right">Détails</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${sales.map(s => this.renderTableRow(s)).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderTableRow(s) {
        const date = s.date?.toDate ? s.date.toDate() : new Date(s.date);
        const dateStr = escapeHTML(date.toLocaleDateString([], { day: '2-digit', month: '2-digit' }));
        const timeStr = escapeHTML(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

        return `
            <tr class="hover:bg-blue-50/30 transition-colors group">
                <td class="px-4 py-4">
                    <p class="font-black text-gray-900 text-sm">${dateStr}</p>
                    <p class="text-[10px] text-gray-400 font-bold">${timeStr}</p>
                </td>
                <td class="px-4 py-4">
                    <p class="text-sm font-bold text-gray-700">${escapeHTML(s.clientNom || s.clientEmail?.split("@")[0] || "Anonyme")}</p>
                </td>
                <td class="px-4 py-4">
                    <p class="text-sm font-black text-gray-900">${(parseFloat(s.total) || 0).toFixed(2)} €</p>
                </td>
                <td class="px-4 py-4">
                    <span class="px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-tighter bg-green-100 text-green-700">
                        ${escapeHTML(s.statut || "payé")}
                    </span>
                </td>
                <td class="px-4 py-4 text-right">
                    <button class="w-8 h-8 rounded-lg bg-gray-100 text-gray-400 hover:bg-gray-900 hover:text-white transition-all flex items-center justify-center ml-auto">
                        <i class="fas fa-eye text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    async handleExport() {
        showToast("Préparation de l'export…", "info");
        // Export comptable COMPLET : on récupère toute la plage (au-delà des 200
        // lignes affichées), lecture lourde mais délibérée car déclenchée au clic.
        let sales;
        try {
            sales = typeof window.fetchAllComptaSales === "function"
                ? await window.fetchAllComptaSales()
                : adminStore.state.salesData;
        } catch (e) {
            console.error("Export compta — échec récupération:", e);
            showToast("Erreur lors de la récupération des ventes.", "error");
            return;
        }

        const csv = adminStore.generateSalesCSV(sales);
        if (!csv) {
            showToast("Aucune donnée à exporter.", "error");
            return;
        }

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `compta_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast("Export terminé !", "success");
    }
}

export const adminComptaUI = new AdminComptaUI();

// Bridges globaux
window.exportComptaCSV = () => adminComptaUI.handleExport();
window.startStripeOnboarding = () => adminComptaUI.startOnboarding();
