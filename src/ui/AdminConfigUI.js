import { adminStore } from "../core/AdminStore.js";
import { escapeHTML, showToast } from "../utils.js";
import { db, fs } from "../core/firebase.js";

export class AdminConfigUI {
    constructor() {
        this.hoursGrid = document.getElementById("config-hours-grid");
        this.identityForm = document.getElementById("config-identity-form");
        this.hoursForm = document.getElementById("config-hours-form");
        this.contactForm = document.getElementById("config-contact-form");
        this.deliveryForm = document.getElementById("config-delivery-form");
        this.loyaltyForm = document.getElementById("config-loyalty-form");

        this.init();
    }

    init() {
        // Écouter les mises à jour du Store
        adminStore.addEventListener("admin-config-updated", () => this.render());
        adminStore.addEventListener("admin-saving-status", (e) => this.handleSavingState(e.detail.isSaving));

        // Forms Handlers
        if (this.identityForm) {
            this.identityForm.addEventListener("submit", (e) => this.handleIdentitySubmit(e));
        }
        if (this.hoursForm) {
            this.hoursForm.addEventListener("submit", (e) => this.handleHoursSubmit(e));
        }
        if (this.contactForm) {
            this.contactForm.addEventListener("submit", (e) => this.handleContactSubmit(e));
        }
        if (this.deliveryForm) {
            this.deliveryForm.addEventListener("submit", (e) => this.handleDeliverySubmit(e));
            document.getElementById("config-resto-locate")?.addEventListener("click", () => this.locateResto());
        }
        if (this.loyaltyForm) {
            this.loyaltyForm.addEventListener("submit", (e) => this.handleLoyaltySubmit(e));
            // Liste des cadeaux : une case par produit, écriture immédiate (pas de bouton).
            adminStore.addEventListener("admin-products-updated", () => this.renderGiftProducts());
            document.getElementById("config-gift-products")?.addEventListener("change", (e) => this.handleGiftToggle(e));
        }
    }

    render() {
        const cfg = adminStore.state.config;
        if (!cfg) return;

        // 1. Identité
        const descInput = document.getElementById("config-description");
        const promoInput = document.getElementById("config-promo");
        if (descInput) descInput.value = cfg.identity?.description || "";
        if (promoInput) promoInput.value = cfg.config?.promoPhrase || cfg.promoPhrase || "";

        // 1b. Fidélité
        const lo = cfg.loyalty || {};
        const setV = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ""; };
        setV("config-loyalty-name", lo.programName || "");
        setV("config-loyalty-minorder", lo.minOrderCents ? String(lo.minOrderCents / 100) : "0");
        setV("config-loyalty-cooldown", String(lo.creditCooldownMin ?? 10));
        const state = document.getElementById("config-loyalty-state");
        if (state) {
            const on = cfg.features?.enableLoyaltyCard !== false;
            state.textContent = on ? "Activé" : "Désactivé — géré par votre offre";
            state.className = `text-sm font-bold ${on ? "text-green-600" : "text-text-muted"}`;
        }
        this.renderGiftProducts();

        // 2. Horaires
        if (this.hoursGrid) {
            this.hoursGrid.innerHTML = cfg.hours.map(h => this.renderDayRow(h)).join("");
        }
        const lastOrder = document.getElementById("config-last-order");
        if (lastOrder) lastOrder.value = String(cfg.lastOrderMinutesBeforeClose || 0);

        // 3. Coordonnées & Réseaux
        const c = cfg.contact || {};
        const a = c.address || {};
        const s = c.socials || {};
        const r = cfg.reviews || {};
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
        setVal("config-phone", c.phone);
        setVal("config-email", c.email);
        setVal("config-street", a.street);
        setVal("config-zipcode", a.zip);
        setVal("config-city", a.city);
        setVal("config-google-maps-url", a.googleMapsUrl);
        setVal("config-google-review-url", r.googleReviewUrl);
        setVal("config-instagram", s.instagram);
        setVal("config-facebook", s.facebook);
        setVal("config-tiktok", s.tiktok);

        // 4. Livraison
        const d = cfg.delivery || {};
        const geo = cfg.geo || {};
        const enableDelivery = document.getElementById("config-enable-delivery");
        if (enableDelivery) enableDelivery.checked = !!cfg.features?.enableDelivery;
        setVal("config-delivery-radius", d.radiusKm);
        setVal("config-delivery-fee", d.frais);
        setVal("config-delivery-minorder", d.minOrder);
        setVal("config-delivery-speed", d.avgSpeedKmh);
        setVal("config-delivery-prep", d.prepBaseMin);
        setVal("config-delivery-queue", d.queueFactorMin);
        setVal("config-resto-lat", geo.lat);
        setVal("config-resto-lng", geo.lng);
    }

    renderDayRow(h) {
        const isClosed = h.closed ?? false;
        const hasBreak = h.hasBreak ?? false;
        const safeDay = escapeHTML(h.day || "");
        const safeOpen = escapeHTML(h.open || "11:30");
        const safeClose = escapeHTML(h.close || "22:30");
        const safeBreakStart = escapeHTML(h.breakStart || "15:00");
        const safeBreakEnd = escapeHTML(h.breakEnd || "17:00");

        return `
        <div class="day-row flex flex-col gap-2.5 p-3.5 sm:p-4 bg-surface rounded-2xl border border-line shadow-sm transition-all hover:border-blue-400 overflow-hidden">
            <div class="flex flex-wrap items-center justify-between gap-2.5 sm:gap-4">
                <span class="day-name w-auto sm:w-24 font-black text-text uppercase tracking-tight text-xs sm:text-sm shrink-0 order-1">${safeDay}</span>

                <div class="flex items-center gap-2 shrink-0 order-2 sm:order-3 sm:ml-auto">
                    <button type="button"
                        class="break-toggle text-[10px] px-2.5 py-1.5 rounded-full font-black border transition-all ${hasBreak && !isClosed ? "bg-blue-600 border-blue-600 text-white" : "bg-surface-2 border-line text-text-muted"}"
                        onclick="window.toggleBreakRow(this)"
                        ${isClosed ? "disabled" : ""}>
                        <i data-lucide="coffee" class="mr-0.5 sm:mr-1"></i> COUPURE
                    </button>

                    <label class="flex items-center gap-1.5 cursor-pointer group shrink-0">
                        <input type="checkbox" class="hour-closed w-4 h-4 sm:w-5 sm:h-5 rounded-lg text-red-600 border-line focus:ring-red-500 transition-all cursor-pointer"
                            ${isClosed ? "checked" : ""}
                            onchange="window.toggleDayClosed(this)">
                        <span class="text-[11px] sm:text-xs font-black text-text-muted group-hover:text-red-500 transition-colors">FERMÉ</span>
                    </label>
                </div>

                <div class="hours-range-container flex items-center gap-2 w-full sm:w-auto order-3 sm:order-2 shrink-0 ${isClosed ? "opacity-30 pointer-events-none" : ""}">
                    <input type="time" class="hour-open flex-1 sm:flex-initial sm:w-28 px-3 py-2 sm:py-1.5 rounded-xl border border-line font-bold text-text bg-surface-2 focus:border-blue-500 outline-none text-base sm:text-sm text-center min-w-0"
                        value="${safeOpen}" ${isClosed ? "disabled" : ""}>
                    <span class="text-text-muted font-black text-xs sm:text-sm shrink-0">→</span>
                    <input type="time" class="hour-close flex-1 sm:flex-initial sm:w-28 px-3 py-2 sm:py-1.5 rounded-xl border border-line font-bold text-text bg-surface-2 focus:border-blue-500 outline-none text-base sm:text-sm text-center min-w-0"
                        value="${safeClose}" ${isClosed ? "disabled" : ""}>
                </div>
            </div>

            <div class="break-row flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pl-0 sm:pl-28 mt-1.5 transition-all ${hasBreak && !isClosed ? "" : "hidden opacity-0"}">
                <div class="flex items-center gap-2 flex-1 sm:flex-initial min-w-0">
                    <span class="text-[10px] font-black text-blue-500 uppercase shrink-0 w-20 sm:w-auto">Fermeture</span>
                    <input type="time" class="hour-break-start flex-1 sm:flex-initial sm:w-28 px-3 py-2 sm:py-1.5 rounded-xl border border-blue-500/30 font-bold text-blue-700 dark:text-blue-400 bg-blue-500/10 focus:border-blue-500 outline-none text-base sm:text-sm text-center min-w-0"
                        value="${safeBreakStart}" ${isClosed ? "disabled" : ""}>
                </div>
                <div class="flex items-center gap-2 flex-1 sm:flex-initial min-w-0">
                    <span class="text-[10px] font-black text-blue-500 uppercase shrink-0 w-20 sm:w-auto">Réouverture</span>
                    <input type="time" class="hour-break-end flex-1 sm:flex-initial sm:w-28 px-3 py-2 sm:py-1.5 rounded-xl border border-blue-500/30 font-bold text-blue-700 dark:text-blue-400 bg-blue-500/10 focus:border-blue-500 outline-none text-base sm:text-sm text-center min-w-0"
                        value="${safeBreakEnd}" ${isClosed ? "disabled" : ""}>
                </div>
            </div>
        </div>`;
    }

    /** 🎁 Liste des produits cochables comme cadeau surprise (par catégorie, puis nom). */
    renderGiftProducts() {
        const host = document.getElementById("config-gift-products");
        if (!host) return;
        const products = [...(adminStore.state.products || [])].sort((a, b) => String(a.categorieId || "").localeCompare(String(b.categorieId || "")) || String(a.nom || "").localeCompare(String(b.nom || "")));
        const count = products.filter((p) => p.eligibleForWheel === true).length;
        const counter = document.getElementById("config-gift-count");
        if (counter) counter.textContent = count ? `· ${count} coché${count > 1 ? "s" : ""}` : "· aucun pour l'instant";
        if (!products.length) {
            host.innerHTML = `<p class="text-sm text-text-muted col-span-full">Ajoutez d'abord des produits dans l'onglet Carte.</p>`;
            return;
        }
        host.innerHTML = products.map((p) => `
            <label class="flex items-center gap-3 p-3 rounded-xl bg-surface border border-line cursor-pointer hover:border-pink-300 transition ${p.isAvailable === false ? "opacity-60" : ""}">
                <input type="checkbox" data-gift-product="${escapeHTML(p.id)}" ${p.eligibleForWheel === true ? "checked" : ""} class="w-5 h-5 rounded text-pink-600 border-line focus:ring-pink-500 cursor-pointer">
                <span class="min-w-0 flex-1">
                    <span class="block text-sm font-bold text-text truncate">${escapeHTML(p.nom || "")}</span>
                    <span class="block text-xs text-text-muted">${escapeHTML(p.categorieId || "")} · ${Number(p.prix || 0).toFixed(2)} €${p.isAvailable === false ? " · épuisé" : ""}</span>
                </span>
            </label>`).join("");
    }

    async handleGiftToggle(e) {
        const input = e.target;
        const id = input?.dataset?.giftProduct;
        if (!id) return;
        const eligible = input.checked;
        try {
            await adminStore.setProductGiftEligible(db, fs, id, eligible);
            showToast(eligible ? "Produit ajouté aux cadeaux 🎁" : "Produit retiré des cadeaux", "success");
        } catch (err) {
            input.checked = !eligible;
            showToast(err?.message || "Enregistrement impossible.", "error");
        }
    }

    handleLoyaltySubmit(e) {
        e.preventDefault();
        const name = document.getElementById("config-loyalty-name")?.value.trim() || "";
        const minOrderEur = Number(document.getElementById("config-loyalty-minorder")?.value || 0);
        const cooldown = Number(document.getElementById("config-loyalty-cooldown")?.value ?? 10);
        adminStore.updateConfigField("loyalty.programName", name);
        adminStore.updateConfigField("loyalty.minOrderCents", Number.isFinite(minOrderEur) ? Math.round(minOrderEur * 100) : 0);
        adminStore.updateConfigField("loyalty.creditCooldownMin", Number.isFinite(cooldown) ? cooldown : 10);
        this.saveToServer("Fidélité mise à jour !");
    }

    handleIdentitySubmit(e) {
        e.preventDefault();
        const desc = document.getElementById("config-description").value;
        const promo = document.getElementById("config-promo").value;

        // On met à jour le Store localement
        adminStore.updateConfigField("identity.description", desc);
        adminStore.updateConfigField("promoPhrase", promo);

        this.saveToServer("Identité mise à jour !");
    }

    handleContactSubmit(e) {
        e.preventDefault();
        const getVal = (id) => document.getElementById(id)?.value.trim() || "";

        // ⚠️ On capture TOUTES les valeurs AVANT de muter le store.
        // updateConfigField() émet "admin-config-updated" → render() réécrit les
        // inputs depuis le store. Si on lisait un champ APRÈS un update, render()
        // l'aurait déjà remis à sa valeur store (vide) → on perdait la saisie.
        // Seul le 1er champ survivait (d'où l'ancien bug "seul phoneNumber").
        const values = {
            "contact.phone": getVal("config-phone"),
            "contact.email": getVal("config-email"),
            "contact.address.street": getVal("config-street"),
            "contact.address.zip": getVal("config-zipcode"),
            "contact.address.city": getVal("config-city"),
            "contact.address.googleMapsUrl": getVal("config-google-maps-url"),
            "reviews.googleReviewUrl": getVal("config-google-review-url"),
            "contact.socials.instagram": getVal("config-instagram"),
            "contact.socials.facebook": getVal("config-facebook"),
            "contact.socials.tiktok": getVal("config-tiktok"),
        };
        Object.entries(values).forEach(([path, v]) => adminStore.updateConfigField(path, v));

        this.saveToServer("Coordonnées mises à jour !");
    }

    handleDeliverySubmit(e) {
        e.preventDefault();
        const numVal = (id) => {
            const raw = document.getElementById(id)?.value;
            const n = parseFloat(raw);
            return Number.isFinite(n) ? n : null;
        };

        // ⚠️ Même précaution que handleContactSubmit : on capture TOUTES les valeurs
        // AVANT de muter le store. Le 1er updateConfigField émet "admin-config-updated"
        // → render() réécrit les inputs depuis le store, ce qui écraserait la saisie des
        // champs lus ensuite (bug "seul enableDelivery sauvegardé").
        const values = {
            "features.enableDelivery": !!document.getElementById("config-enable-delivery")?.checked,
            "delivery.radiusKm": numVal("config-delivery-radius") ?? 5,
            "delivery.frais": numVal("config-delivery-fee") ?? 2.5,
            "delivery.minOrder": numVal("config-delivery-minorder") ?? 0,
            "delivery.avgSpeedKmh": numVal("config-delivery-speed") ?? 22,
            "delivery.prepBaseMin": numVal("config-delivery-prep") ?? 12,
            "delivery.queueFactorMin": numVal("config-delivery-queue") ?? 3,
            "geo.lat": numVal("config-resto-lat"),
            "geo.lng": numVal("config-resto-lng"),
        };
        Object.entries(values).forEach(([path, v]) => adminStore.updateConfigField(path, v));

        this.saveToServer("Réglages de livraison enregistrés !");
    }

    locateResto() {
        if (!("geolocation" in navigator)) {
            showToast("Géolocalisation non supportée sur cet appareil.", "error");
            return;
        }
        showToast("Récupération de la position…", "success");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = document.getElementById("config-resto-lat");
                const lng = document.getElementById("config-resto-lng");
                if (lat) lat.value = pos.coords.latitude.toFixed(6);
                if (lng) lng.value = pos.coords.longitude.toFixed(6);
                showToast("Position récupérée. Pensez à enregistrer.", "success");
            },
            () => showToast("Impossible de récupérer la position.", "error"),
            { enableHighAccuracy: true, timeout: 10000 },
        );
    }

    handleHoursSubmit(e) {
        e.preventDefault();
        const rows = this.hoursGrid.querySelectorAll(".day-row");
        const hours = Array.from(rows).map(row => ({
            day: (row.querySelector(".day-name, span.font-black")?.textContent || "").trim(),
            open: row.querySelector(".hour-open").value,
            close: row.querySelector(".hour-close").value,
            closed: row.querySelector(".hour-closed").checked,
            hasBreak: !row.querySelector(".break-row").classList.contains("hidden"),
            breakStart: row.querySelector(".hour-break-start").value,
            breakEnd: row.querySelector(".hour-break-end").value
        }));

        // Lu AVANT updateConfigField : chaque update relance render() (formulaire réécrit).
        const lastOrderMinutes = Number(document.getElementById("config-last-order")?.value) || 0;

        adminStore.updateConfigField("hours", hours);
        adminStore.updateConfigField("lastOrderMinutesBeforeClose", lastOrderMinutes);
        this.saveToServer("Horaires mis à jour !");
    }

    async saveToServer(successMsg) {
        try {
            await adminStore.saveConfig(db, fs);
            showToast(successMsg, "success");
        } catch (error) {
            showToast(error.message, "error");
        }
    }

    handleSavingState(isSaving) {
        const btns = document.querySelectorAll("button[type='submit']");
        btns.forEach(btn => {
            if (isSaving) {
                btn.disabled = true;
                btn.dataset.originalHtml = btn.innerHTML;
                btn.innerHTML = '<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Sauvegarde...';
            } else {
                btn.disabled = false;
                if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
            }
        });
    }
}

export const adminConfigUI = new AdminConfigUI();

// Global Bridges for legacy/HTML-inline calls
window.toggleBreakRow = (btn) => {
    const row = btn.closest(".day-row");
    const breakRow = row.querySelector(".break-row");
    const isHidden = breakRow.classList.contains("hidden");
    
    breakRow.classList.toggle("hidden", !isHidden);
    setTimeout(() => breakRow.classList.toggle("opacity-0", !isHidden), 10);
    
    btn.classList.toggle("bg-blue-600", isHidden);
    btn.classList.toggle("text-white", isHidden);
    btn.classList.toggle("bg-surface-2", !isHidden);
    btn.classList.toggle("text-text-muted", !isHidden);
};

window.toggleDayClosed = (checkbox) => {
    const row = checkbox.closest(".day-row");
    const inputs = row.querySelectorAll("input[type=time]");
    const breakToggle = row.querySelector(".break-toggle");
    const breakRow = row.querySelector(".break-row");
    
    inputs.forEach(i => i.disabled = checkbox.checked);
    if (checkbox.checked) {
        breakRow.classList.add("hidden", "opacity-0");
        breakToggle.classList.add("opacity-30", "pointer-events-none");
    } else {
        breakToggle.classList.remove("opacity-30", "pointer-events-none");
    }
    
    const hoursContainer = row.querySelector(".hours-range-container") || row.querySelector(".flex.items-center.gap-2");
    if (hoursContainer) {
        hoursContainer.classList.toggle("opacity-30", checkbox.checked);
        hoursContainer.classList.toggle("pointer-events-none", checkbox.checked);
    }
};
