import { adminStore } from "../core/AdminStore.js";
import { escapeHTML, showToast } from "../utils.js";
import { functions, httpsCallable } from "../core/firebase.js";
import { computeOrderRow } from "../services/comptaService.js";

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
        this.refreshStripeStatus(); // statut live (une fois par chargement de page)
    }

    /**
     * Carte Stripe à 3 états :
     *  - pas de compte         → badge "À configurer" + bouton "Configurer les paiements"
     *  - compte sans charges   → badge "À finaliser"  + bouton "Terminer la configuration"
     *  - compte + charges OK    → badge "Connecté"     + bouton "Ouvrir mon portail"
     * `chargesEnabled` vient du live (refreshStripeStatus) sinon du flag config (webhook).
     */
    renderStripeStatus() {
        const cfg = adminStore.state.config;
        const hasAccount = !!cfg?.stripeAccountId;
        const chargesEnabled = this._chargesEnabled ?? (cfg?.stripeChargesEnabled === true);
        const complete = hasAccount && chargesEnabled;

        const onboardBtn = document.getElementById("btn-stripe-onboard");
        const manageBtn = document.getElementById("btn-stripe-dashboard");
        if (!onboardBtn || !manageBtn) return;

        onboardBtn.classList.toggle("hidden", complete);
        manageBtn.classList.toggle("hidden", !complete);

        if (!complete) {
            onboardBtn.innerHTML = (hasAccount ? "Terminer la configuration" : "Configurer les paiements") +
                ' <i data-lucide="arrow-right" class="text-sm text-gray-400"></i>';
        }

        const badge = document.getElementById("stripe-status-badge");
        if (badge) {
            const [label, cls] = complete
                ? ["Connecté", "bg-green-500/20 text-green-300"]
                : hasAccount
                    ? ["À finaliser", "bg-orange-500/20 text-orange-300"]
                    : ["À configurer", "bg-amber-500/20 text-amber-300"];
            badge.textContent = label;
            badge.className = "ml-auto text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full " + cls;
        }

        const text = document.getElementById("stripe-card-text");
        if (text) {
            text.innerHTML = complete
                ? 'Accédez à <span class="font-bold text-white">Stripe Express</span> pour votre RIB et vos versements.'
                : hasAccount
                    ? 'Votre compte est créé mais <span class="font-bold text-white">l\'inscription Stripe n\'est pas terminée</span> — finalisez-la pour encaisser.'
                    : 'Connectez votre compte bancaire via <span class="font-bold text-white">Stripe</span> pour recevoir vos paiements.';
        }
    }

    /**
     * Récupère le statut LIVE du compte (charges_enabled) une fois par chargement
     * de page, puis re-rend la carte. Évite d'afficher "Connecté" sur un compte
     * dont l'onboarding n'est pas fini (les charges échoueraient).
     */
    async refreshStripeStatus() {
        if (this._statusFetched) return;
        const cfg = adminStore.state.config;
        if (!cfg?.stripeAccountId) return;
        this._statusFetched = true;
        try {
            const res = await httpsCallable(functions, "getStripeAccountStatus")({ snackId: window.currentAdminSnackId });
            this._chargesEnabled = !!res.data?.chargesEnabled;
            this.renderStripeStatus();
        } catch (e) {
            console.warn("Statut Stripe non rafraîchi :", e);
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
        if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Connexion Stripe…'; }
        try {
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
        // En-tête : CA BRUT visible, mais le héros décisionnel est le CA NET (§8.3).
        if (this.totalSalesEl) this.totalSalesEl.textContent = `${kpis.total} €`;
        if (this.totalOrdersEl) this.totalOrdersEl.textContent = kpis.count;

        if (!this.kpiExtrasEl) return;

        const brut = kpis.caBrutNum || 0;
        const barPct = (v) => (brut > 0 ? Math.min(100, Math.max(0, (Math.abs(Number(v) || 0) / brut) * 100)) : 0);

        // Pastille de variation ↑↓ vs période précédente (null → « — » neutre).
        const deltaBadge = (pct) => {
            if (pct === null || pct === undefined) return `<span class="text-[10px] font-bold text-gray-300">—</span>`;
            const up = pct >= 0;
            const cls = up ? "text-green-600" : "text-red-600";
            return `<span class="text-[10px] font-black ${cls}">${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(1).replace(".", ",")} %</span>`;
        };

        // Ligne de cascade avec barre proportionnelle au CA brut.
        const bar = (label, val, kind, extra = "") => {
            const barCls = kind === "deduct" ? "bg-red-400" : "bg-gray-300";
            const valCls = kind === "deduct" ? "text-red-600" : "text-gray-900";
            const style = kind === "net" ? 'background:var(--color-primary,#1E2938)' : "";
            return `
                <div>
                    <div class="flex items-baseline justify-between text-sm mb-1">
                        <span class="text-gray-500">${label} ${extra}</span>
                        <span class="font-bold ${valCls} tabular-nums">${kind === "deduct" ? "−" : ""}${val} €</span>
                    </div>
                    <div class="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div class="h-full rounded-full ${style ? "" : barCls}" style="width:${barPct(val)}%;${style}"></div>
                    </div>
                </div>`;
        };

        const fr = kpis.franchise || {};
        const cmp = kpis.comparison;

        // Ligne commission : remplacée par un encart FRANCHISE positif si active (§8.2).
        const commissionBlock = fr.active
            ? `
                <div>
                    <div class="flex items-baseline justify-between text-sm mb-1">
                        <span class="text-gray-500">Commission plateforme</span>
                        <span class="font-black text-green-600">Franchise 0 %</span>
                    </div>
                    <div class="h-1.5 rounded-full bg-green-100 overflow-hidden"><div class="h-full rounded-full bg-green-400" style="width:100%"></div></div>
                    <p class="text-[10px] font-bold text-green-600 mt-0.5">🎁 Offerte encore ${fr.monthsRemaining} mois</p>
                </div>`
            : bar("Commission plateforme (nette)", kpis.commissionNette, "deduct");

        // Ventilation TVA collectée par taux (uniquement les taux présents).
        const tvaRows = (kpis.tvaParTaux || []).length
            ? kpis.tvaParTaux.map(t => `
                <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-500">TVA ${String(t.rate).replace(".", ",")} %
                        <span class="text-gray-400">(HT ${t.ht.toFixed(2)} €)</span></span>
                    <span class="font-bold text-gray-900 tabular-nums">${t.tva.toFixed(2)} €</span>
                </div>`).join("")
            : `<p class="text-xs text-gray-400">Aucune commande ventilée sur la période (commandes antérieures au socle compta).</p>`;

        // Comparaison période précédente (bandeau discret).
        const comparisonNote = cmp && cmp.hasPrev
            ? `<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500 mb-3">
                   <span class="font-bold uppercase tracking-wider text-gray-400">vs période précédente</span>
                   <span>CA ${deltaBadge(cmp.deltaTotal)}</span>
                   <span>Commandes ${deltaBadge(cmp.deltaCount)}</span>
               </div>`
            : `<p class="text-[10px] text-gray-400 mb-3">Pas d'historique comparable sur la période précédente.</p>`;

        // Cartes secondaires optionnelles (affichées seulement si pertinentes).
        const deliveryCard = kpis.deliveryShare !== null
            ? `<div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                   <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Part livraison</p>
                   <p class="text-xl font-black text-gray-900">${kpis.deliveryShare} %</p>
               </div>` : "";
        const upsellCard = Number(kpis.upsellRevenue) > 0
            ? `<div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                   <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Upsell généré</p>
                   <p class="text-xl font-black text-gray-900">${kpis.upsellRevenue} €</p>
               </div>` : "";

        this.kpiExtrasEl.innerHTML = `
            <div class="sm:col-span-2 lg:col-span-3 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                <div class="flex items-center justify-between mb-2">
                    <p class="text-[10px] text-gray-500 font-black uppercase tracking-wider">Du brut au net</p>
                    ${fr.active ? `<span class="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/15 text-green-600">Franchise 0 % · ${fr.monthsRemaining} mois</span>` : ""}
                </div>
                ${comparisonNote}
                <div class="space-y-2.5">
                    ${bar("CA brut TTC", kpis.total, "brut", deltaBadge(cmp?.deltaTotal))}
                    ${bar("Remboursements", kpis.refundTotal, "deduct")}
                    ${commissionBlock}
                    ${bar("Frais Stripe", kpis.stripeFee, "deduct")}
                    <div class="pt-2 mt-1 border-t border-gray-200">
                        <div class="flex items-center justify-between mb-1">
                            <span class="text-sm font-black text-gray-900">CA net encaissé</span>
                            <span class="text-2xl font-black tabular-nums" style="color:var(--color-primary,#1E2938)">${kpis.caNet} €</span>
                        </div>
                        <div class="h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div class="h-full rounded-full" style="width:${barPct(kpis.caNetNum)}%;background:var(--color-primary,#1E2938)"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Panier Moyen</p>
                <p class="text-xl font-black text-gray-900">${kpis.avg} €</p>
            </div>
            ${deliveryCard}
            ${upsellCard}

            <div class="sm:col-span-2 lg:col-span-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                <p class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">TVA collectée par taux</p>
                <div class="space-y-1.5">${tvaRows}</div>
                <p class="text-[10px] text-gray-400 mt-2 leading-snug">
                    TVA <b>collectée</b> (hors TVA déductible sur vos achats) — à valider avec votre comptable. Données de gestion, non certifiées NF525.
                </p>
            </div>
        `;
    }

    renderHistory() {
        if (!this.historyTableEl) return;
        const sales = adminStore.state.salesData;

        if (sales.length === 0) {
            this.historyTableEl.innerHTML = `
                <div class="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                    <i data-lucide="search" class="text-3xl text-gray-200 mb-3"></i>
                    <p class="text-gray-400 font-bold">Aucune vente sur cette période.</p>
                </div>
            `;
            return;
        }

        // L'historique est borné à 200 lignes (affichage). Les KPIs ci-dessus
        // restent exacts (agrégat serveur). Au-delà, inviter à l'export CSV complet.
        const truncatedNote = sales.length >= 200 ? `
            <div class="mb-3 px-4 py-2 rounded-xl bg-amber-50 border border-amber-100 text-amber-700 text-xs font-bold">
                <i data-lucide="info" class="mr-1"></i> 200 commandes les plus récentes affichées. Les totaux restent exacts ; utilisez l'export CSV pour le détail complet.
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
        // Date robuste : Timestamp Firestore, ms/ISO, ou absente. Une commande sans
        // `date` valide (legacy / serverTimestamp non résolu) ne doit pas afficher
        // « Invalid Date » mais « — ».
        const d = s.date?.toDate ? s.date.toDate() : (s.date != null ? new Date(s.date) : null);
        const valid = d && !isNaN(d.getTime());
        const dateStr = valid ? escapeHTML(d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })) : "—";
        const timeStr = valid ? escapeHTML(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : "";

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
                    <button type="button" data-action="order-detail" data-id="${escapeHTML(s.id)}" aria-label="Voir le détail de la commande" class="w-8 h-8 rounded-lg bg-gray-100 text-gray-400 hover:bg-gray-900 hover:text-white transition-all flex items-center justify-center ml-auto">
                        <i data-lucide="eye" class="text-xs pointer-events-none"></i>
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

        // BOM UTF-8 (﻿) : Excel FR ouvre alors les accents correctement (LOT E).
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
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

    // ====================================================================
    // 🧾 FICHE COMMANDE (modale) — ouverte depuis le bouton Détails de
    // l'historique. Affiche TOUTE la commande (y compris terminée) + permet le
    // remboursement, ce que le radar cuisine ne peut pas (commandes actives only).
    // ====================================================================
    openOrderDetail(orderId) {
        const order = (adminStore.state.salesData || []).find((o) => o.id === orderId);
        if (!order) { showToast("Commande introuvable (recharge l'onglet).", "error"); return; }

        let modal = document.getElementById("order-detail-modal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "order-detail-modal";
            modal.className = "fixed inset-0 z-[60] hidden items-end sm:items-center justify-center bg-black/50";
            // Clic sur le fond (hors carte) → fermeture.
            modal.addEventListener("click", (e) => { if (e.target === modal) this.closeOrderDetail(); });
            document.body.appendChild(modal);
        }
        modal.innerHTML = this.renderOrderDetailModal(order);
        modal.classList.remove("hidden");
        modal.classList.add("flex");
        window.lucide?.createIcons?.(); // re-render des icônes Lucide injectées
    }

    closeOrderDetail() {
        const modal = document.getElementById("order-detail-modal");
        if (modal) { modal.classList.add("hidden"); modal.classList.remove("flex"); }
    }

    renderOrderDetailModal(order) {
        const r = computeOrderRow(order);
        const eur = (n) => `${(Number(n) || 0).toFixed(2).replace(".", ",")} €`;
        const d = order.date?.toDate ? order.date.toDate() : (order.date != null ? new Date(order.date) : null);
        const dateStr = d && !isNaN(d.getTime())
            ? d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—";
        const mode = order.mode === "delivery" ? "Livraison" : "Click & Collect";
        const payStatut = escapeHTML(order.paiement?.statut || "—");
        const canRefund = (order.paiement?.methode || "carte_bancaire") === "carte_bancaire"
            && (order.paiement?.statut === "paye" || order.paiement?.statut === "partiellement_rembourse");

        const items = (order.items || []).map((it) => {
            const opts = [];
            if (it.tailleChoisie) opts.push(escapeHTML(it.tailleChoisie));
            if (it.boissonNom) opts.push(escapeHTML(it.boissonNom));
            if (Array.isArray(it.sauces) && it.sauces.length) opts.push(it.sauces.map(escapeHTML).join(" + "));
            const optStr = opts.length ? `<span class="text-gray-400"> · ${opts.join(" · ")}</span>` : "";
            const lineTtc = (Number(it.prix) || 0) * (Number(it.quantity) || 0);
            return `<div class="flex justify-between text-sm py-1">
                <span class="text-gray-700"><b>${Number(it.quantity) || 0}×</b> ${escapeHTML(it.nom || "?")}${optStr}</span>
                <span class="font-bold text-gray-900 tabular-nums">${eur(lineTtc)}</span></div>`;
        }).join("") || `<p class="text-xs text-gray-400">Aucun article.</p>`;

        const tvaLines = [["5,5 %", r.ht5_5, r.tva5_5], ["10 %", r.ht10, r.tva10], ["20 %", r.ht20, r.tva20]]
            .filter(([, ht, tva]) => ht > 0 || tva > 0)
            .map(([lbl, ht, tva]) => `<div class="flex justify-between text-xs"><span class="text-gray-500">TVA ${lbl} <span class="text-gray-400">(HT ${eur(ht)})</span></span><span class="tabular-nums">${eur(tva)}</span></div>`).join("");

        const stripeFeeStr = (order.stripeFee == null || order.stripeFeePending)
            ? `<span class="text-amber-600">en attente</span>` : eur(r.stripeFee);

        const refundItems = Array.isArray(order.refund?.items) ? order.refund.items : [];
        const refundHist = refundItems.length
            ? refundItems.map((it) => {
                const rd = it.at?.toDate ? it.at.toDate() : (it.at != null ? new Date(it.at) : null);
                const rdStr = rd && !isNaN(rd.getTime()) ? rd.toLocaleDateString("fr-FR") : "";
                return `<div class="flex justify-between text-xs"><span class="text-gray-500">${eur((Number(it.amount) || 0) / 100)} <span class="text-gray-400">· ${escapeHTML(it.reason || "")} ${rdStr}</span></span><span class="text-gray-400">${it.source === "stripe" ? "Stripe" : "App"}</span></div>`;
            }).join("")
            : `<p class="text-xs text-gray-400">Aucun remboursement.</p>`;

        return `
        <div class="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div class="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
                <div>
                    <p class="font-black text-gray-900">Commande <span class="font-mono">${escapeHTML(order.secretCode || "—")}</span></p>
                    <p class="text-xs text-gray-400">${dateStr} · ${mode}</p>
                </div>
                <button type="button" data-action="close-order-detail" aria-label="Fermer" class="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center"><i data-lucide="x" class="pointer-events-none"></i></button>
            </div>
            <div class="p-5 space-y-4">
                <div class="flex items-center gap-2 text-xs">
                    <span class="px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-bold">${escapeHTML(order.statut || "—")}</span>
                    <span class="px-2 py-0.5 rounded bg-green-100 text-green-700 font-bold">Paiement : ${payStatut}</span>
                </div>
                <div>
                    <p class="text-[10px] uppercase font-black text-gray-400 mb-1">Client</p>
                    <p class="text-sm text-gray-700">${escapeHTML(order.clientNom || "—")} <span class="text-gray-400">${escapeHTML(order.clientEmail || "")}</span></p>
                </div>
                <div>
                    <p class="text-[10px] uppercase font-black text-gray-400 mb-1">Articles</p>
                    ${items}
                </div>
                <div class="border-t border-gray-100 pt-3">
                    <div class="flex justify-between text-sm font-bold"><span>Total TTC</span><span class="tabular-nums">${eur(r.ttc)}</span></div>
                    ${r.fraisLivraison > 0 ? `<div class="flex justify-between text-xs text-gray-500"><span>dont frais livraison</span><span class="tabular-nums">${eur(r.fraisLivraison)}</span></div>` : ""}
                    ${tvaLines ? `<div class="mt-2 space-y-0.5">${tvaLines}</div>` : `<p class="text-xs text-gray-400 mt-1">Commande non ventilée (antérieure au socle compta).</p>`}
                </div>
                <div class="border-t border-gray-100 pt-3 space-y-0.5">
                    <p class="text-[10px] uppercase font-black text-gray-400 mb-1">Compta</p>
                    <div class="flex justify-between text-xs"><span class="text-gray-500">Commission plateforme</span><span class="tabular-nums">${eur(r.commission)}</span></div>
                    <div class="flex justify-between text-xs"><span class="text-gray-500">Frais Stripe</span><span class="tabular-nums">${stripeFeeStr}</span></div>
                    <div class="flex justify-between text-sm font-black pt-1"><span>CA net</span><span class="tabular-nums" style="color:var(--color-primary,#1E2938)">${eur(r.net)}</span></div>
                </div>
                <div class="border-t border-gray-100 pt-3">
                    <p class="text-[10px] uppercase font-black text-gray-400 mb-1">Remboursements ${(Number(order.refund?.total) || 0) > 0 ? `· ${eur((Number(order.refund.total) || 0) / 100)}` : ""}</p>
                    ${refundHist}
                </div>
                ${canRefund
                    ? `<button type="button" data-action="refund-order" data-id="${escapeHTML(order.id)}" class="w-full mt-1 bg-white text-red-600 border border-red-200 hover:bg-red-50 font-bold py-3 rounded-xl transition active:scale-95 flex items-center justify-center gap-2"><i data-lucide="rotate-ccw" class="pointer-events-none"></i> Rembourser</button>`
                    : (order.paiement?.statut === "rembourse" ? `<p class="text-center text-xs font-bold text-gray-400">Commande remboursée.</p>` : "")}
            </div>
        </div>`;
    }
}

export const adminComptaUI = new AdminComptaUI();

// Bridges globaux
window.exportComptaCSV = () => adminComptaUI.handleExport();
window.startStripeOnboarding = () => adminComptaUI.startOnboarding();
window.openOrderDetail = (id) => adminComptaUI.openOrderDetail(id);
window.closeOrderDetail = () => adminComptaUI.closeOrderDetail();
