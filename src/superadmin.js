// ============================================================================
// 🚀 SUPERADMIN DASHBOARD - CODECRAFTERS HQ
// ============================================================================
// import './bridge.js';
import './snack-config.js';
import './firebase-init.js';
import './icons.js';
import './theme-mode.js';

import { escapeHTML } from './utils.js';
import { setupSWUpdatePrompt } from './sw-update.js';
import {
    auth,
    db,
    functions,
    collection,
    doc,
    getDoc,
    getDocs,
    updateDoc,
    addDoc,
    serverTimestamp,
    query,
    orderBy,
    limit,
    where,
    getAggregateFromServer,
    sum,
    count,
    httpsCallable,
    onAuthStateChanged,
    signOut,
} from './core/firebase.js';

// Enregistre le Service Worker (prérequis à l'installation desktop "Add to Dock")
// + branche le bandeau #pwa-update-banner (pattern "prompt", mutualisé DRY).
setupSWUpdatePrompt({ context: 'SuperAdmin' });

// Variables Globales
let allSnacks = [];
const snackMonthlyCa = new Map();

// 💰 PRICING — Source de vérité unique (DRY) pour les tarifs SaaS.
// Starter   : 0 €/mois + 8% (1er mois offert) -> Risque zéro pour le restaurateur
// Pro       : 89 €/mois fixe · 0% commission  -> Idéal dès ~1 100 € de CA (seuil rentabilité)
// Franchise : 149 €/mois fixe · 0% commission -> Multi-restaurants / VIP
const PRICING = {
    starter:   { label: 'Starter',   prix: 0,   commissionRate: 0.08, minFeeCents: 50, description: '0 €/mois + 8% (1er mois offert)' },
    pro:       { label: 'Pro',       prix: 89,  commissionRate: 0,    minFeeCents: 0,  description: '89 €/mois · 0% commission' },
    franchise: { label: 'Franchise', prix: 149, commissionRate: 0,    minFeeCents: 0,  description: '149 €/mois · 0% (Multi-sites)' },
};
const getPlanPrix = (plan) => (PRICING[plan] || PRICING.starter).prix;

// ============================================================================
// 🛡️ 1. LE VIGILE DE SÉCURITÉ (AUTH GUARD)
// ============================================================================
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById("saas-loader");
    const content = document.getElementById("saas-content");

    if (user) {
        // L'utilisateur est connecté, on vérifie son badge VIP
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            
            if (userDoc.exists() && userDoc.data().role === "superadmin") {
                // ✅ ACCÈS AUTORISÉ
                document.getElementById("superadmin-email").innerText = user.email;
                loader.classList.add("hidden");
                content.classList.remove("hidden");
                
                // On lance le chargement des données !
                loadDashboardData();
            } else {
                // ❌ ACCÈS REFUSÉ (C'est un client ou un admin de resto)
                alert("ALERTE SÉCURITÉ : Vous n'avez pas l'habilitation SuperAdmin.");
                await signOut(auth);
                window.location.href = "index.html";
            }
        } catch (error) {
            console.error("Erreur de vérification des droits", error);
        }
    } else {
        // ❌ NON CONNECTÉ -> On le renvoie vers l'app publique pour qu'il se connecte
        alert("Veuillez vous connecter avec votre compte agence.");
        window.location.href = "index.html";
    }
});

// Bouton de déconnexion
document.getElementById("btn-logout").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "index.html";
});

// ============================================================================
// 📊 2. CHARGEMENT DES DONNÉES (FETCH) ET KPIs
// ============================================================================
async function loadDashboardData() {
    try {
        const snacksSnapshot = await getDocs(collection(db, "snacks"));
        allSnacks = [];
        let snacksEnMaintenance = 0;
        let snacksActifs = 0;

        snacksSnapshot.forEach((doc) => {
            const data = doc.data();
            allSnacks.push({ id: doc.id, ...data });

            if (data.maintenanceMode === true) {
                snacksEnMaintenance++;
            } else {
                snacksActifs++;
            }
        });

        // 💰 Calcul du CA et nombre de commandes du mois en cours par agrégation Firestore
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        let totalOrdersMonth = 0;
        snackMonthlyCa.clear();

        await Promise.all(allSnacks.map(async (snack) => {
            try {
                const snap = await getAggregateFromServer(
                    query(collection(db, "commandes"), where("snackId", "==", snack.id), where("date", ">=", monthStart)),
                    { ca: sum("total"), count: count() }
                );
                const ca = Number(snap.data().ca) || 0;
                const cnt = Number(snap.data().count) || 0;
                snackMonthlyCa.set(snack.id, ca);
                totalOrdersMonth += cnt;
            } catch (e) {
                snackMonthlyCa.set(snack.id, 0);
            }
        }));

        // 💰 MRR : somme des abonnements récurrents actifs
        const mrr = allSnacks
            .filter(s => !s.maintenanceMode)
            .reduce((sum, s) => sum + (typeof s.prixAbonnement === 'number' ? s.prixAbonnement : getPlanPrix(s.pricingPlan)), 0);

        // Mise à jour de l'UI
        document.getElementById("kpi-total-snacks").innerText = allSnacks.length;
        document.getElementById("kpi-maintenance").innerText = snacksEnMaintenance;
        document.getElementById("kpi-mrr").innerText = `${mrr.toFixed(2)} €`;
        document.getElementById("kpi-orders").innerText = totalOrdersMonth.toString();

        console.log(`✅ ${allSnacks.length} locataires chargés (${totalOrdersMonth} commandes ce mois).`);
        
        renderUpsellAlertsBanner();
        renderSnacksTable();

    } catch (error) {
        console.error("Erreur lors du chargement des locataires :", error);
    }
}

// ============================================================================
// 🏢 3. AFFICHAGE DES RESTAURANTS (TABLEAU)
// ============================================================================
function renderSnacksTable() {
    const tbody = document.getElementById("snacks-table-body");
    tbody.innerHTML = "";

    if (allSnacks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-text-muted">Aucun client pour le moment.</td></tr>`;
        return;
    }

    const rows = allSnacks.map(snack => {
        const safeId = escapeHTML(snack.id);
        const safeNom = escapeHTML(snack.nom || "Sans Nom");

        const statusBadge = snack.maintenanceMode
            ? `<span class="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30 px-3 py-1 rounded-full text-xs font-bold shadow-sm"><i data-lucide="wrench" class="mr-1"></i> Maintenance</span>`
            : `<span class="bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30 px-3 py-1 rounded-full text-xs font-bold shadow-sm"><i data-lucide="globe" class="mr-1"></i> En Ligne</span>`;

        let featuresHtml = '';
        if (snack.enableClickAndCollect) featuresHtml += `<i data-lucide="shopping-bag" title="Click & Collect" class="text-indigo-500 mx-1"></i>`;
        if (snack.enableDelivery)        featuresHtml += `<i data-lucide="bike" title="Livraison" class="text-orange-500 mx-1"></i>`;
        if (snack.enableLoyaltyCard)     featuresHtml += `<i data-lucide="gift" title="Fidélité" class="text-pink-500 mx-1"></i>`;
        if (snack.enablePushNotifs)      featuresHtml += `<i data-lucide="bell" title="Push Notifs" class="text-blue-500 mx-1"></i>`;
        if (snack.enableSmartReview)     featuresHtml += `<i data-lucide="star" title="Smart Review" class="text-yellow-500 mx-1"></i>`;
        if (snack.enableViralShare)      featuresHtml += `<i data-lucide="share-2" title="Partage Viral" class="text-teal-500 mx-1"></i>`;
        if (snack.enableUpsell)          featuresHtml += `<i data-lucide="shopping-cart" title="Upsell" class="text-emerald-500 mx-1"></i>`;

        const plan = snack.pricingPlan || "starter";
        const caSnack = snackMonthlyCa.get(snack.id) || 0;
        const commSnack = caSnack * 0.08;
        const isUpsellEligible = (plan === "starter" && commSnack > 89);

        let planBadge = `<span class="bg-blue-500/10 text-blue-700 dark:text-blue-400 font-black px-2 py-0.5 rounded-md text-[10px]">STARTER (8%)</span>`;
        if (plan === "pro") {
            planBadge = `<span class="bg-purple-500/10 text-purple-700 dark:text-purple-400 font-black px-2 py-0.5 rounded-md text-[10px]">PRO (89€ · 0%)</span>`;
        } else if (plan === "franchise") {
            planBadge = `<span class="bg-amber-500/10 text-amber-700 dark:text-amber-400 font-black px-2 py-0.5 rounded-md text-[10px]">FRANCHISE (149€)</span>`;
        }

        const upsellBtn = isUpsellEligible
            ? `<button data-action="upsell-pitch" data-snack-id="${safeId}" class="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-600 hover:text-white px-3 py-2 rounded-lg font-bold text-xs transition animate-pulse" title="Proposer le passage en Pro 0% (Économie client: +${(commSnack - 89).toFixed(0)}€/m)">
                <i data-lucide="sparkles" class="text-xs"></i> Upsell Pro (+${(commSnack - 89).toFixed(0)}€)
               </button>`
            : '';

        const mrrClient = (parseFloat(snack.prixAbonnement) || getPlanPrix(snack.pricingPlan)).toFixed(0);
        const powerBtnClass = snack.maintenanceMode
            ? "text-yellow-700 bg-yellow-100 hover:bg-yellow-200"
            : "text-text-muted bg-surface-2 hover:bg-surface-3";

        const stripeBadge = snack.stripeAccountId
            ? `<span class="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-black px-2 py-0.5 rounded-md text-[10px]"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="w-[1em] h-[1em] inline-block align-[-0.125em]"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"/></svg> Connecté</span>`
            : `<span class="bg-surface-2 text-text-muted font-bold px-2 py-0.5 rounded-md text-[10px]">Démo / Platform</span>`;

        return `
            <tr class="hover:bg-surface-2 transition border-b border-line last:border-0">
                <td class="p-4">
                    <div class="font-bold text-text text-lg">${safeNom}</div>
                    <div class="text-xs text-text-muted mt-1 flex items-center gap-2 flex-wrap">
                        <span class="font-mono bg-surface-2 px-1.5 py-0.5 rounded">${safeId}</span>
                        <span class="bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 font-black px-2 py-0.5 rounded-md">${mrrClient} €/mois</span>
                        ${planBadge}
                        ${stripeBadge}
                    </div>
                </td>
                <td class="p-4 text-center">${statusBadge}</td>
                <td class="p-4 text-center text-lg">${featuresHtml || '<span class="text-text-muted text-xs">—</span>'}</td>
                <td class="p-4 text-right space-x-1 whitespace-nowrap">
                    ${upsellBtn}
                    <a href="index.html?s=${encodeURIComponent(snack.id)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:text-white font-bold text-sm bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-600 px-3 py-2 rounded-lg transition">
                        <i data-lucide="external-link" class="text-xs"></i> Voir
                    </a>
                    <a href="admin.html?s=${encodeURIComponent(snack.id)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:text-white font-bold text-sm bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-600 px-3 py-2 rounded-lg transition" title="Ouvrir le back-office (mode superadmin)">
                        <i data-lucide="shield-check" class="text-xs"></i> Admin
                    </a>
                    <a href="livreur.html?s=${encodeURIComponent(snack.id)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-teal-600 dark:text-teal-400 hover:text-white font-bold text-sm bg-teal-50 dark:bg-teal-950/40 hover:bg-teal-600 px-3 py-2 rounded-lg transition" title="Ouvrir l'app livreur (mode superadmin)">
                        <i data-lucide="bike" class="text-xs"></i> Livreur
                    </a>
                    <button data-action="sub-link" data-snack-id="${safeId}" class="text-emerald-700 dark:text-emerald-400 hover:text-white font-bold text-sm bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-600 px-3 py-2 rounded-lg transition" title="Générer un lien d'abonnement">
                        <i data-lucide="credit-card"></i>
                    </button>
                    <button data-action="open-config" data-snack-id="${safeId}" class="text-text-muted hover:text-text font-bold text-sm bg-surface-2 hover:bg-surface-3 px-3 py-2 rounded-lg transition" title="Configurer les modules">
                        <i data-lucide="settings"></i>
                    </button>
                    <button data-action="toggle-maintenance" data-snack-id="${safeId}" data-maintenance="${snack.maintenanceMode ? '1' : '0'}" class="font-bold text-sm px-3 py-2 rounded-lg transition ${powerBtnClass}" title="${snack.maintenanceMode ? 'Mettre en ligne' : 'Mettre en maintenance'}">
                        <i data-lucide="power"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = rows.join("");
}

// ============================================================================
// 🐛 3.5 LOGS & MONITORING
// ============================================================================
async function loadLogs() {
    const tbody = document.getElementById("logs-table-body");
    const btn = document.getElementById("btn-refresh-logs");
    
    if (!tbody || !btn) return;
    
    const originalBtn = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin"></i>`;
    btn.disabled = true;

    try {
        const q = query(collection(db, "system_logs"), orderBy("timestamp", "desc"), limit(50));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-text-muted">Aucun log enregistré.</td></tr>`;
            return;
        }

        const rows = [];
        snapshot.forEach(docSnap => {
            const log = docSnap.data();
            const dateStr = log.timestamp ? log.timestamp.toDate().toLocaleString("fr-FR") : "N/A";
            
            let levelClass = "text-text-muted bg-surface-2";
            if (log.level === "error") levelClass = "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40";
            else if (log.level === "warning") levelClass = "text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/40";

            rows.push(`
                <tr class="hover:bg-surface-2 transition border-b border-line last:border-0 text-sm">
                    <td class="p-4 text-text-muted whitespace-nowrap">${dateStr}</td>
                    <td class="p-4 font-mono text-xs text-indigo-600 dark:text-indigo-400">${escapeHTML(log.snackId || "N/A")}</td>
                    <td class="p-4"><span class="px-2 py-1 rounded font-bold text-[10px] uppercase ${levelClass}">${escapeHTML(log.action || "UNKNOWN")}</span></td>
                    <td class="p-4 font-bold text-text">${escapeHTML(log.message || "")}</td>
                    <td class="p-4 text-right">
                        <button class="text-xs bg-surface-2 hover:bg-surface-3 text-text-muted hover:text-text px-2 py-1 rounded transition" onclick="alert('${escapeHTML((log.details || "").replace(/'/g, "\\'"))}')">Détails</button>
                    </td>
                </tr>
            `);
        });

        tbody.innerHTML = rows.join("");
    } catch (e) {
        console.error("Erreur logs :", e);
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-danger">Erreur lors de la lecture des logs.</td></tr>`;
    } finally {
        btn.innerHTML = originalBtn;
        btn.disabled = false;
    }
}

const btnRefreshLogs = document.getElementById("btn-refresh-logs");
if (btnRefreshLogs) {
    btnRefreshLogs.addEventListener("click", loadLogs);
}

// Event delegation pour remplacer les onclick inline (évite l'injection via snack.id)
document.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const snackId = btn.getAttribute("data-snack-id");
    if (!snackId) return;
    const action = btn.getAttribute("data-action");
    if (action === "open-config") {
        window.openConfigModal(snackId);
    } else if (action === "toggle-maintenance") {
        const isOn = btn.getAttribute("data-maintenance") === "1";
        window.toggleMaintenance(snackId, isOn);
    } else if (action === "sub-link") {
        window.openSubLinkModal(snackId);
    } else if (action === "upsell-pitch") {
        window.openUpsellPitchModal(snackId);
    } else if (action === "quick-pro-switch") {
        window.quickSwitchToPro(snackId);
    }
});


// Fonction globale pour le bouton ON/OFF rapide
window.toggleMaintenance = async (snackId, currentStatus) => {
    const action = currentStatus ? "mettre EN LIGNE" : "mettre EN MAINTENANCE";
    if (confirm(`Voulez-vous ${action} ce restaurant ?`)) {
        await updateDoc(doc(db, "snacks", snackId), { maintenanceMode: !currentStatus });
        loadDashboardData();
    }
};

// ============================================================================
// 🔔 3.6 ALERTE PROACTIVE UPSELL & RAPPORT DE BASCULE AVEC DONNÉES
// ============================================================================
function renderUpsellAlertsBanner() {
    const container = document.getElementById("upsell-alerts-container");
    if (!container) return;

    // Repère les snacks sous Starter dont la commission à 8% dépasse 89 € (seuil de rentabilité)
    const upsellCandidates = allSnacks.filter(s => {
        const plan = s.pricingPlan || "starter";
        if (plan !== "starter") return false;
        const ca = snackMonthlyCa.get(s.id) || 0;
        return (ca * 0.08) > 89;
    });

    if (upsellCandidates.length === 0) {
        container.classList.add("hidden");
        container.innerHTML = "";
        return;
    }

    const cardsHtml = upsellCandidates.map(s => {
        const ca = snackMonthlyCa.get(s.id) || 0;
        const comm = ca * 0.08;
        const eco = comm - 89;
        const safeId = escapeHTML(s.id);
        const safeNom = escapeHTML(s.nom || s.id);

        return `
            <div class="bg-surface border-2 border-amber-500/30 rounded-2xl p-5 shadow-md flex flex-col justify-between">
                <div>
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <h4 class="font-black text-text text-base truncate">${safeNom}</h4>
                        <span class="bg-amber-500/15 text-amber-700 dark:text-amber-400 font-black text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider">Starter 8%</span>
                    </div>
                    <div class="space-y-1.5 text-xs text-text-muted mb-4">
                        <div class="flex justify-between">
                            <span>CA généré ce mois :</span>
                            <strong class="text-text">${ca.toFixed(2)} €</strong>
                        </div>
                        <div class="flex justify-between">
                            <span>Commission 8% payée :</span>
                            <strong class="text-indigo-600 dark:text-indigo-400">${comm.toFixed(2)} €</strong>
                        </div>
                        <div class="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold pt-1.5 border-t border-line">
                            <span>Gain client avec Forfait Pro :</span>
                            <span>+${eco.toFixed(0)} € / mois</span>
                        </div>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button data-action="upsell-pitch" data-snack-id="${safeId}" class="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs py-2.5 px-3 rounded-xl transition shadow-sm flex items-center justify-center gap-1.5">
                        <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Données à lui montrer
                    </button>
                    <button data-action="quick-pro-switch" data-snack-id="${safeId}" class="bg-surface-2 hover:bg-indigo-600 hover:text-white text-text font-bold text-xs py-2.5 px-3 rounded-xl transition border border-line" title="Basculer directement en Pro (89€ · 0%)">
                        <i data-lucide="zap" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </div>
        `;
    }).join("");

    container.innerHTML = `
        <div class="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-indigo-500/15 border-2 border-amber-500/40 rounded-3xl p-6 shadow-xl">
            <div class="flex items-center justify-between flex-wrap gap-4 mb-5">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-500 flex items-center justify-center text-2xl shadow-inner animate-pulse">
                        🔔
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h3 class="text-lg font-black text-text">${upsellCandidates.length} Restaurant(s) Prêt(s) pour le Forfait Pro (0% Commission)</h3>
                            <span class="bg-amber-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">Opportunité Upsell</span>
                        </div>
                        <p class="text-xs text-text-muted mt-0.5">Ces restaurants sous formule Starter génèrent plus de 89 € de commission. Proposez-leur le Forfait Pro pour les fidéliser et leur faire économiser de l'argent !</p>
                    </div>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${cardsHtml}
            </div>
        </div>
    `;

    container.classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
}

window.openUpsellPitchModal = (snackId) => {
    const modal = document.getElementById("modal-upsell-pitch");
    if (!modal) return;
    const snack = allSnacks.find(s => s.id === snackId);
    if (!snack) return;

    const ca = snackMonthlyCa.get(snackId) || 0;
    const uberCost = ca * 0.30;
    const starterCost = ca * 0.08;
    const proCost = 89;
    const monthlySaving = Math.max(0, starterCost - proCost);
    const annualSavingVsUber = (uberCost - proCost) * 12;

    document.getElementById("upsell-modal-title").textContent = `Proposition Forfait Pro (0% Commission) — ${snack.nom || snackId}`;
    document.getElementById("upsell-modal-subtitle").textContent = `Calculé en direct pour ${snack.nom || snackId} (${snack.id}) sur les commandes de ce mois`;

    document.getElementById("upsell-ca-val").textContent = `${ca.toFixed(2)} €`;
    document.getElementById("upsell-uber-val").textContent = `${uberCost.toFixed(2)} €`;
    document.getElementById("upsell-starter-val").textContent = `${starterCost.toFixed(2)} €`;
    document.getElementById("upsell-saving-monthly").textContent = `+${monthlySaving.toFixed(2)} € / mois dans sa poche`;
    document.getElementById("upsell-saving-annual").textContent = `Soit +${annualSavingVsUber.toFixed(0)} € économisés par an par rapport à Uber Eats`;

    const pitchMessage = `Bonjour ${snack.nom || "l'équipe"},\n\nFélicitations pour vos superbes résultats ce mois-ci sur votre application Click & Collect avec ${ca.toFixed(0)} € de commandes encaissées ! 🚀\n\n📈 Bilan comparatif de vos ventes :\n• Sur Uber Eats, ces commandes vous auraient coûté ${uberCost.toFixed(0)} € de commissions (30%).\n• Avec notre formule Starter (8%), vous n'avez payé que ${starterCost.toFixed(0)} € (déjà ${(uberCost - starterCost).toFixed(0)} € d'économisés !).\n\n💡 Notre recommandation pour votre restaurant :\nVu votre volume, il est désormais beaucoup plus rentable pour vous de passer à notre Forfait Pro à 89 € / mois fixe (0 % de commission) !\n\nEn passant au Forfait Pro :\n✅ 0 % de commission : vous conservez 100 % de votre chiffre d'affaires.\n✅ Vous gardez +${monthlySaving.toFixed(0)} € de plus chaque mois dans votre poche (soit +${(monthlySaving * 12).toFixed(0)} € / an de bénéfice net supplémentaire).\n\nSouhaitez-vous que j'active votre passage au Forfait Pro dès aujourd'hui ?`;

    const pitchTextarea = document.getElementById("upsell-pitch-text");
    if (pitchTextarea) pitchTextarea.value = pitchMessage;

    const whatsappBtn = document.getElementById("btn-share-whatsapp");
    if (whatsappBtn) {
        whatsappBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(pitchMessage)}`;
    }

    modal.dataset.snackId = snackId;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    if (window.lucide) window.lucide.createIcons();
};

window.quickSwitchToPro = async (snackId) => {
    const snack = allSnacks.find(s => s.id === snackId);
    const nom = snack?.nom || snackId;
    if (!confirm(`Basculer ${nom} vers le Forfait Pro (89 € / mois · 0% commission) ?`)) return;

    try {
        await updateDoc(doc(db, "snacks", snackId), {
            pricingPlan: "pro",
            prixAbonnement: 89,
            commissionRate: 0,
        });
        showSAToast(`✅ ${nom} basculé en Forfait Pro (89 € · 0%) !`);
        loadDashboardData();
    } catch (err) {
        console.error("Erreur quick switch:", err);
        showSAToast("❌ Erreur lors de la bascule.", "error");
    }
};

document.getElementById("btn-close-upsell-modal")?.addEventListener("click", () => {
    const modal = document.getElementById("modal-upsell-pitch");
    modal?.classList.replace("flex", "hidden");
});

document.getElementById("btn-copy-pitch-text")?.addEventListener("click", () => {
    const textarea = document.getElementById("upsell-pitch-text");
    if (textarea?.value && navigator.clipboard) {
        navigator.clipboard.writeText(textarea.value).then(() => {
            showSAToast("✅ Message argumentaire copié ! Prêt à être envoyé.");
        });
    }
});

document.getElementById("btn-apply-pro-switch")?.addEventListener("click", async () => {
    const modal = document.getElementById("modal-upsell-pitch");
    const snackId = modal?.dataset?.snackId;
    if (!snackId) return;

    const snack = allSnacks.find(s => s.id === snackId);
    const nom = snack?.nom || snackId;

    if (!confirm(`Confirmer la bascule de ${nom} vers le Forfait Pro (89 €/mois · 0% commission) ?`)) return;

    try {
        await updateDoc(doc(db, "snacks", snackId), {
            pricingPlan: "pro",
            prixAbonnement: 89,
            commissionRate: 0,
        });

        modal.classList.replace("flex", "hidden");
        showSAToast(`✅ ${nom} est désormais sur le Forfait Pro (89 € · 0%) !`);
        loadDashboardData();
    } catch (err) {
        console.error("Erreur switch pro:", err);
        showSAToast("❌ Erreur lors de la bascule.", "error");
    }
});

// ============================================================================
// ⚙️ 4. CONFIGURATION PAR CLIENT — Feature Flags
// ============================================================================
const CONFIG_FLAGS = [
    "maintenanceMode",
    "enableClickAndCollect",
    "enableDelivery",
    "enableLoyaltyCard",
    "enablePushNotifs",
    "enableSmartReview",
    "enableViralShare",
    "enableUpsell",
];

let currentConfigSnackId = null;

function _setToggle(btn, isOn) {
    const isMaintenance = btn.id === "cfg-maintenanceMode";
    const onColor = isMaintenance ? "bg-yellow-500" : "bg-indigo-600";
    btn.setAttribute("data-state", isOn ? "on" : "off");
    if (isOn) {
        btn.classList.remove("bg-surface-3");
        btn.classList.add(onColor);
        btn.querySelector("span").classList.remove("translate-x-1");
        btn.querySelector("span").classList.add("translate-x-6");
    } else {
        btn.classList.remove("bg-indigo-600", "bg-yellow-500");
        btn.classList.add("bg-surface-3");
        btn.querySelector("span").classList.remove("translate-x-6");
        btn.querySelector("span").classList.add("translate-x-1");
    }
}

window.toggleConfigFlag = (btn) => {
    _setToggle(btn, btn.getAttribute("data-state") !== "on");
};

window.openConfigModal = (snackId) => {
    const snack = allSnacks.find(s => s.id === snackId);
    if (!snack) return;
    currentConfigSnackId = snackId;

    document.getElementById("config-modal-title").textContent = `Configurer : ${snack.nom || snackId}`;
    document.getElementById("config-modal-snack-id").textContent = `ID : ${snackId}`;

    CONFIG_FLAGS.forEach(flag => {
        const btn = document.getElementById(`cfg-${flag}`);
        if (btn) _setToggle(btn, !!snack[flag]);
    });

    document.getElementById("cfg-maxPoints").value = snack.maxPoints || 10;
    document.getElementById("cfg-prixAbonnement").value = snack.prixAbonnement || getPlanPrix(snack.pricingPlan);
    document.getElementById("cfg-trialPeriodMonths").value = typeof snack.trialPeriodMonths === 'number' ? snack.trialPeriodMonths : 1;
    document.getElementById("cfg-pricingPlan").value = snack.pricingPlan || "starter";
    document.getElementById("cfg-colorPalette").value = snack.colorPalette || "ruby";
    document.getElementById("cfg-domaine").value = snack.domaine || "";
    document.getElementById("cfg-stripeAccountId").value = snack.stripeAccountId || "";
    document.getElementById("cfg-stripeSubscriptionId").value = snack.stripeSubscriptionId || "";

    const modal = document.getElementById("modal-config-snack");
    modal.classList.remove("hidden");
    modal.classList.add("flex");
};

document.getElementById("cfg-pricingPlan")?.addEventListener("change", (e) => {
    const plan = e.target.value;
    const prixInput = document.getElementById("cfg-prixAbonnement");
    if (prixInput) prixInput.value = getPlanPrix(plan);
});

document.getElementById("btn-close-config-modal").addEventListener("click", () => {
    document.getElementById("modal-config-snack").classList.replace("flex", "hidden");
});

document.getElementById("btn-save-config").addEventListener("click", async () => {
    if (!currentConfigSnackId) return;

    const btn = document.getElementById("btn-save-config");
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Sauvegarde...`;
    btn.disabled = true;

    const updates = {};
    CONFIG_FLAGS.forEach(flag => {
        const el = document.getElementById(`cfg-${flag}`);
        if (el) updates[flag] = el.getAttribute("data-state") === "on";
    });
    updates.maxPoints          = parseInt(document.getElementById("cfg-maxPoints").value) || 10;
    updates.prixAbonnement     = parseFloat(document.getElementById("cfg-prixAbonnement").value) || getPlanPrix(updates.pricingPlan);
    updates.trialPeriodMonths  = parseInt(document.getElementById("cfg-trialPeriodMonths").value) || 1;
    updates.pricingPlan        = document.getElementById("cfg-pricingPlan").value || "starter";
    updates.colorPalette       = document.getElementById("cfg-colorPalette").value;
    updates.domaine            = document.getElementById("cfg-domaine").value.trim().toLowerCase();
    updates.stripeAccountId    = document.getElementById("cfg-stripeAccountId").value.trim();
    updates.stripeSubscriptionId = document.getElementById("cfg-stripeSubscriptionId").value.trim();

    try {
        await updateDoc(doc(db, "snacks", currentConfigSnackId), updates);

        // Mise à jour du cache local
        const snack = allSnacks.find(s => s.id === currentConfigSnackId);
        if (snack) Object.assign(snack, updates);

        // Recalcul MRR avec les nouveaux tarifs
        const mrr = allSnacks
            .filter(s => !s.maintenanceMode)
            .reduce((sum, s) => sum + (s.prixAbonnement || getPlanPrix(s.pricingPlan)), 0);
        document.getElementById("kpi-mrr").textContent = `${mrr.toFixed(2)} €`;

        renderSnacksTable();
        document.getElementById("modal-config-snack").classList.replace("flex", "hidden");
        showSAToast("✅ Configuration mise à jour !");
    } catch (error) {
        console.error("Erreur sauvegarde config :", error);
        showSAToast("❌ Erreur lors de la sauvegarde.", "error");
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
});

// ============================================================================
// 🍞 TOAST SUPERADMIN
// ============================================================================
function showSAToast(message, type = "success") {
    const toast = document.getElementById("sa-toast");
    document.getElementById("sa-toast-msg").textContent = message;
    const saIcon = document.getElementById("sa-toast-icon");
    if (type === "error") window.swapIcon?.(saIcon, "circle-alert", "text-red-400");
    else window.swapIcon?.(saIcon, "circle-check", "text-green-400");
    toast.classList.remove("translate-y-20", "opacity-0");
    setTimeout(() => toast.classList.add("translate-y-20", "opacity-0"), 3000);
}

// ============================================================================
// 🪄 5. CRÉATION D'UN NOUVEAU CLIENT (MODALE)
// ============================================================================
const modalNewSnack = document.getElementById("modal-new-snack");
const btnOpenModal = document.getElementById("btn-open-new-snack");
const btnCloseModal = document.getElementById("btn-close-modal");
const formNewSnack = document.getElementById("form-new-snack");

if (btnOpenModal && modalNewSnack) {
    btnOpenModal.addEventListener("click", () => {
        // Toujours rouvrir sur le formulaire (et pas sur un ancien panneau de succès).
        document.getElementById("new-snack-success")?.classList.add("hidden");
        formNewSnack.classList.remove("hidden");
        modalNewSnack.classList.remove("hidden");
        modalNewSnack.classList.add("flex");
    });

    btnCloseModal.addEventListener("click", () => {
        modalNewSnack.classList.add("hidden");
        modalNewSnack.classList.remove("flex");
    });

    formNewSnack.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const btnSubmit = document.getElementById("btn-submit-snack");
        const originalText = btnSubmit.innerHTML;
        btnSubmit.innerHTML = `<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Création du locataire...`;
        btnSubmit.disabled = true;

        const nom = document.getElementById("input-snack-name").value;
        const type = document.getElementById("input-snack-type").value;
        const theme = document.getElementById("input-snack-theme").value;
        const domaine = document.getElementById("input-snack-domain").value.toLowerCase().trim();
        const adminEmail = document.getElementById("input-snack-admin-email").value.trim();
        const trialPeriodMonths = parseInt(document.getElementById("input-snack-trial")?.value) || 1;
        const pricingPlan = document.getElementById("input-snack-plan")?.value || "starter";

        try {
// 🏭 L'USINE À RESTAURANTS : Clonage complet du modèle de base
            const newSnackRef = await addDoc(collection(db, "snacks"), {
                nom: nom,
                domaine:domaine,
                typeCuisine: type,
                colorPalette: theme, // Le moteur de thème !
                description: `Découvrez le menu digital de ${nom}. Commandez en ligne vos spécialités en Click & Collect ou Livraison. Gagnez des récompenses !`,
                currency: "€",
                trialPeriodMonths: trialPeriodMonths,
                pricingPlan: pricingPlan,
                prixAbonnement: getPlanPrix(pricingPlan),
                
                // Coordonnées (Vides par défaut, le client les remplira plus tard)
                city: "",
                street: "",
                zipcode: "",
                restaurantLat: null,
                restaurantLng: null,
                phoneNumber: "",
                email: "",

                // Google
                googleMapsUrl: "",
                googleReviewUrl: "",

                // Réseaux Sociaux
                facebook: "",
                instagram: "",
                tiktok: "",
                
                // Images par défaut (On évite de mettre les URL du O'Tacos pour les autres clients !)
                logoUrl: "./assets/logo.webp", 
                heroImg: "./assets/heroImg.webp", 
                
                // Paramètres du SaaS (Feature Flags)
                maintenanceMode: true, // 🛑 TOUJOURS en maintenance à la création !
                enableClickAndCollect: false,
                enableDelivery: false,
                enableOnlineOrder: false,
                enableLoyaltyCard: true, 
                enablePushNotifs: false,
                enableSmartReview: false,
                enableViralShare: false,
                enableUpsell: false,
                maxPoints: 10,
                
                // 🕒 HORAIRES PAR DÉFAUT (Le gros morceau !)
                hours: [
                    { day: "lundi", open: "11:00", close: "22:00", closed: false },
                    { day: "mardi", open: "11:00", close: "22:00", closed: false },
                    { day: "mercredi", open: "11:00", close: "22:00", closed: false },
                    { day: "jeudi", open: "11:00", close: "22:00", closed: false },
                    { day: "vendredi", open: "11:00", close: "23:00", closed: false },
                    { day: "samedi", open: "11:00", close: "23:00", closed: false },
                    { day: "dimanche", open: "14:00", close: "22:00", closed: false }
                ],
                
                // Date de création pour ta compta
                createdAt: serverTimestamp()
            });

            // Snack créé → on crée le compte ADMIN du resto (déblocage de /admin.html).
            const snackId = newSnackRef.id;
            let adminInfo = null;
            try {
                const res = await httpsCallable(functions, "createSnackAdmin")({ snackId, email: adminEmail, nom });
                adminInfo = res.data; // { email, tempPassword }
            } catch (adminErr) {
                console.error("createSnackAdmin:", adminErr);
                window.showToast("Snack créé, mais le compte admin a échoué : " + (adminErr.message || adminErr) + " — à créer manuellement.", "error");
            }

            showSnackSuccess({ nom, snackId, admin: adminInfo });
            formNewSnack.reset();
            loadDashboardData();

        } catch (error) {
            console.error("Erreur lors de la création :", error);
            window.showToast("Erreur lors de la création du client. Vérifiez la console.", "error");
        } finally {
            btnSubmit.innerHTML = originalText;
            btnSubmit.disabled = false;
        }
    });
}

/**
 * Affiche le panneau de succès (ID + accès admin + lien preview + checklist)
 * à la place du formulaire. Remplace l'ancienne alert().
 */
function showSnackSuccess({ nom, snackId, admin }) {
    formNewSnack.classList.add("hidden");
    document.getElementById("new-snack-success").classList.remove("hidden");
    document.getElementById("success-snack-name").textContent = nom;
    document.getElementById("success-snack-id").textContent = snackId;
    document.getElementById("success-preview-link").href = "index.html?s=" + encodeURIComponent(snackId);

    const adminBlock = document.getElementById("success-admin-block");
    if (admin && admin.tempPassword) {
        document.getElementById("success-admin-email").textContent = admin.email;
        document.getElementById("success-admin-pwd").textContent = admin.tempPassword;
        adminBlock.classList.remove("hidden");
    } else {
        adminBlock.classList.add("hidden"); // admin non créé → on masque le bloc
    }
}

// Boutons "copier" (délégation) + "Terminé" du panneau de succès.
document.addEventListener("click", (e) => {
    const copyBtn = e.target.closest(".copy-btn");
    if (copyBtn) {
        const el = document.getElementById(copyBtn.getAttribute("data-copy"));
        if (el && navigator.clipboard) {
            navigator.clipboard.writeText(el.textContent.trim())
                .then(() => window.showToast("Copié !"))
                .catch(() => window.showToast("Copie impossible.", "error"));
        }
        return;
    }
    if (e.target.closest("#btn-success-done")) {
        modalNewSnack.classList.add("hidden");
        modalNewSnack.classList.remove("flex");
        document.getElementById("new-snack-success").classList.add("hidden");
        formNewSnack.classList.remove("hidden");
    }
});

// ============================================================================
// 🧾 COMPTA / FACTURATION (onglet superadmin)
// ============================================================================
let billingRows = [];
const tabDash = document.getElementById("sa-tab-dashboard");
const tabCompta = document.getElementById("sa-tab-compta");
const viewDash = document.getElementById("view-dashboard");
const viewCompta = document.getElementById("view-compta");

function setSuperTab(which) {
    const isCompta = which === "compta";
    viewDash?.classList.toggle("hidden", isCompta);
    viewCompta?.classList.toggle("hidden", !isCompta);
    const active = "bg-primary text-white";
    const idle = "bg-surface text-text-muted border border-line hover:bg-surface-2";
    if (tabDash) tabDash.className = `px-5 py-2.5 rounded-xl font-bold text-sm transition ${isCompta ? idle : active}`;
    if (tabCompta) tabCompta.className = `px-5 py-2.5 rounded-xl font-bold text-sm transition ${isCompta ? active : idle}`;
    if (isCompta) loadBillingData();
}
tabDash?.addEventListener("click", () => setSuperTab("dashboard"));
tabCompta?.addEventListener("click", () => setSuperTab("compta"));

function monthsSince(ts) {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d || isNaN(d)) return null;
    const now = new Date();
    return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

async function loadBillingData() {
    const tbody = document.getElementById("billing-table-body");
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    document.getElementById("compta-month-label").textContent =
        now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

    if (!allSnacks.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-text-muted">Aucun client.</td></tr>`;
        return;
    }
    tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-text-muted"><i data-lucide="loader-circle" class="animate-spin text-2xl"></i> Calcul de la facturation…</td></tr>`;

    // CA du mois par snack via AGRÉGATION serveur (le superadmin lit toutes les
    // commandes : firestore.rules autorise isSuperAdmin). ~1 lecture / 1000 docs.
    const rows = await Promise.all(allSnacks.map(async (snack) => {
        let ca = 0;
        try {
            const snap = await getAggregateFromServer(
                query(collection(db, "commandes"), where("snackId", "==", snack.id), where("date", ">=", monthStart)),
                { ca: sum("total") }
            );
            ca = Number(snap.data().ca) || 0;
        } catch (e) {
            console.warn("CA agg échoué pour", snack.id, e);
        }
        const trialMonths = typeof snack.trialPeriodMonths === 'number' ? snack.trialPeriodMonths : 1;
        const plan = snack.pricingPlan || "starter";
        const ageMonths = monthsSince(snack.createdAt);
        const isFree = ageMonths !== null && ageMonths < trialMonths;
        const defaultSub = getPlanPrix(plan);
        const subscription = snack.maintenanceMode ? 0 : (typeof snack.prixAbonnement === 'number' ? snack.prixAbonnement : defaultSub);
        const commission = (isFree || plan === "pro" || plan === "franchise") ? 0 : Math.round(ca * 0.08 * 100) / 100;

        // 🧠 ALGORITHME CONSEIL ANTI-CHURN (OPTIMISATION TARIF)
        let recommendationHtml = '';
        if (plan === "starter" && ca * 0.08 > 89) {
            const eco = Math.round(ca * 0.08 - 89);
            recommendationHtml = `<button data-action="upsell-pitch" data-snack-id="${escapeHTML(snack.id)}" class="bg-indigo-500/10 hover:bg-indigo-600 hover:text-white text-indigo-700 dark:text-indigo-400 font-bold px-2.5 py-1 rounded-md text-xs shadow-xs inline-flex items-center gap-1 transition cursor-pointer"><i data-lucide="sparkles" class="w-3 h-3"></i> Proposer PRO (+${eco}€/m)</button>`;
        } else if (plan === "pro" && ca < 500 && ca > 0) {
            recommendationHtml = `<span class="bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold px-2 py-1 rounded-md text-xs shadow-xs">💡 Proposer STARTER</span>`;
        } else {
            recommendationHtml = `<span class="bg-green-500/10 text-green-700 dark:text-green-400 font-bold px-2 py-1 rounded-md text-xs shadow-xs">✅ Plan Optimal</span>`;
        }

        return { id: snack.id, nom: snack.nom || "Sans nom", ageMonths, trialMonths, plan, isFree, maintenance: !!snack.maintenanceMode, subscription, ca, commission, total: subscription + commission, recommendationHtml };
    }));
    billingRows = rows;

    const mrr = rows.reduce((s, r) => s + r.subscription, 0);
    const totalCa = rows.reduce((s, r) => s + r.ca, 0);
    const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
    document.getElementById("compta-mrr").textContent = `${mrr.toFixed(2)} €`;
    document.getElementById("compta-arr").textContent = `${(mrr * 12).toFixed(0)} €`;
    document.getElementById("compta-commission").textContent = `${totalCommission.toFixed(2)} €`;
    document.getElementById("compta-ca").textContent = `${totalCa.toFixed(2)} €`;

    rows.sort((a, b) => b.total - a.total);
    tbody.innerHTML = rows.map(r => {
        const planBadge = r.plan === "franchise"
            ? `<span class="bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-md text-[10px] font-black uppercase">FRANCHISE (149€)</span>`
            : r.plan === "pro"
                ? `<span class="bg-purple-500/10 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded-md text-[10px] font-black uppercase">PRO (89€)</span>`
                : `<span class="bg-blue-500/10 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-md text-[10px] font-black uppercase">STARTER (0€+8%)</span>`;

        const ageBadge = r.ageMonths === null
            ? `<span class="text-text-muted">—</span>`
            : r.isFree
                ? `<span class="bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-md text-[11px] font-bold">${r.ageMonths}/${r.trialMonths}m · Essai gratuit</span>`
                : `<span class="bg-surface-2 text-text-muted px-2 py-0.5 rounded-md text-[11px] font-bold">${r.ageMonths} mois</span>`;
        return `
            <tr class="hover:bg-surface-2 border-b border-line last:border-0">
                <td class="p-4">
                    <div class="font-bold text-text">${escapeHTML(r.nom)} ${r.maintenance ? '<span class="text-yellow-600 dark:text-yellow-400 text-xs">(maintenance)</span>' : ''}</div>
                    <div class="font-mono text-[11px] text-text-muted">${escapeHTML(r.id)}</div>
                </td>
                <td class="p-4 text-center">${ageBadge}</td>
                <td class="p-4 text-center">${planBadge}</td>
                <td class="p-4 text-right text-text-muted">${r.ca.toFixed(2)} €</td>
                <td class="p-4 text-right text-indigo-600 dark:text-indigo-400 font-bold">${r.commission.toFixed(2)} €</td>
                <td class="p-4 text-right font-black text-text">${r.total.toFixed(2)} €</td>
                <td class="p-4 text-center">${r.recommendationHtml}</td>
            </tr>`;
    }).join("");
}

document.getElementById("btn-export-billing")?.addEventListener("click", () => {
    if (!billingRows.length) { window.showToast?.("Rien à exporter.", "error"); return; }
    const headers = ["Client", "Snack ID", "Anciennete (mois)", "Abonnement", "CA mois", "Commission", "Total a facturer"];
    const lines = billingRows.map(r => [
        `"${(r.nom || "").replace(/"/g, '""')}"`, r.id, r.ageMonths ?? "",
        r.subscription.toFixed(2), r.ca.toFixed(2), r.commission.toFixed(2), r.total.toFixed(2)
    ].join(";"));
    const csv = [headers.join(";"), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facturation_${new Date().toISOString().slice(0, 7)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    window.showToast?.("Export facturation terminé !");
});

// ============================================================================
// 💼 LIEN D'ABONNEMENT SaaS (modale)
// ============================================================================
window.openSubLinkModal = (snackId) => {
    const modal = document.getElementById("modal-sub-link");
    if (!modal) return;
    const snack = allSnacks.find(s => s.id === snackId);
    document.getElementById("sub-snack-name").textContent = snack?.nom || snackId;
    document.getElementById("sub-link-result").classList.add("hidden");
    document.getElementById("sub-link-input").value = "";
    modal.dataset.snackId = snackId;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
};

document.getElementById("btn-close-sub")?.addEventListener("click", () => {
    const modal = document.getElementById("modal-sub-link");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
});

document.querySelectorAll(".sub-amount").forEach((btn) => {
    btn.addEventListener("click", async () => {
        const modal = document.getElementById("modal-sub-link");
        const snackId = modal.dataset.snackId;
        const amountEur = parseInt(btn.getAttribute("data-amount"), 10);
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-circle" class="animate-spin"></i>';
        try {
            const res = await httpsCallable(functions, "createSubscriptionCheckout")({
                snackId, amountEur, origin: window.location.origin,
            });
            const url = res.data?.url;
            if (!url) throw new Error("URL manquante.");
            document.getElementById("sub-link-input").value = url;
            document.getElementById("sub-link-result").classList.remove("hidden");
            window.showToast?.(`Lien ${amountEur} €/mois généré !`);
        } catch (e) {
            console.error("createSubscriptionCheckout:", e);
            window.showToast?.("Erreur génération du lien : " + (e.message || e), "error");
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    });
});

document.getElementById("btn-copy-sub-link")?.addEventListener("click", () => {
    const input = document.getElementById("sub-link-input");
    if (input?.value && navigator.clipboard) {
        navigator.clipboard.writeText(input.value).then(() => window.showToast?.("Lien copié !"));
    }
});