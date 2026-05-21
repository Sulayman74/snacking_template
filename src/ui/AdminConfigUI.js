import { adminStore } from "../core/AdminStore.js";
import { escapeHTML, showToast } from "../utils.js";

class AdminConfigUI {
    constructor() {
        this.hoursGrid = document.getElementById("config-hours-grid");
        this.identityForm = document.getElementById("config-identity-form");
        this.hoursForm = document.getElementById("config-hours-form");
        this.contactForm = document.getElementById("config-contact-form");
        this.deliveryForm = document.getElementById("config-delivery-form");

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
    }

    render() {
        const cfg = adminStore.state.config;
        if (!cfg) return;

        // 1. Identité
        const descInput = document.getElementById("config-description");
        const promoInput = document.getElementById("config-promo");
        if (descInput) descInput.value = cfg.identity?.description || "";
        if (promoInput) promoInput.value = cfg.config?.promoPhrase || cfg.promoPhrase || "";

        // 2. Horaires
        if (this.hoursGrid) {
            this.hoursGrid.innerHTML = cfg.hours.map(h => this.renderDayRow(h)).join("");
        }

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
        <div class="day-row flex flex-col gap-2 p-4 bg-white rounded-2xl border border-gray-100 shadow-sm transition-all hover:border-blue-200">
            <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <span class="w-24 font-black text-gray-900 uppercase tracking-tight text-sm">${safeDay}</span>

                <div class="flex items-center gap-2 ${isClosed ? "opacity-30 pointer-events-none" : ""}">
                    <input type="time" class="hour-open p-2 rounded-xl border border-gray-200 font-bold text-gray-700 bg-gray-50 focus:border-blue-500 outline-none"
                        value="${safeOpen}" ${isClosed ? "disabled" : ""}>
                    <span class="text-gray-400 font-black">→</span>
                    <input type="time" class="hour-close p-2 rounded-xl border border-gray-200 font-bold text-gray-700 bg-gray-50 focus:border-blue-500 outline-none"
                        value="${safeClose}" ${isClosed ? "disabled" : ""}>
                </div>

                <button type="button"
                    class="break-toggle text-[10px] px-3 py-1.5 rounded-full font-black border transition-all ${hasBreak && !isClosed ? "bg-blue-600 border-blue-600 text-white" : "bg-gray-100 border-gray-200 text-gray-400"}"
                    onclick="window.toggleBreakRow(this)"
                    ${isClosed ? "disabled" : ""}>
                    <i class="fas fa-coffee mr-1"></i> COUPURE
                </button>

                <label class="flex items-center gap-2 cursor-pointer ml-auto shrink-0 group">
                    <input type="checkbox" class="hour-closed w-5 h-5 rounded-lg text-red-600 border-gray-200 focus:ring-red-500 transition-all cursor-pointer"
                        ${isClosed ? "checked" : ""}
                        onchange="window.toggleDayClosed(this)">
                    <span class="text-xs font-black text-gray-400 group-hover:text-red-500 transition-colors">FERMÉ</span>
                </label>
            </div>

            <div class="break-row flex items-center gap-3 pl-0 sm:pl-28 mt-2 transition-all ${hasBreak && !isClosed ? "" : "hidden opacity-0"}">
                <span class="text-[10px] font-black text-blue-500 uppercase">Fermeture</span>
                <input type="time" class="hour-break-start p-2 rounded-xl border border-blue-100 font-bold text-blue-700 bg-blue-50 focus:border-blue-500 outline-none"
                    value="${safeBreakStart}" ${isClosed ? "disabled" : ""}>
                <span class="text-[10px] font-black text-blue-500 uppercase">Réouverture</span>
                <input type="time" class="hour-break-end p-2 rounded-xl border border-blue-100 font-bold text-blue-700 bg-blue-50 focus:border-blue-500 outline-none"
                    value="${safeBreakEnd}" ${isClosed ? "disabled" : ""}>
            </div>
        </div>`;
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

        adminStore.updateConfigField("contact.phone", getVal("config-phone"));
        adminStore.updateConfigField("contact.email", getVal("config-email"));
        adminStore.updateConfigField("contact.address.street", getVal("config-street"));
        adminStore.updateConfigField("contact.address.zip", getVal("config-zipcode"));
        adminStore.updateConfigField("contact.address.city", getVal("config-city"));
        adminStore.updateConfigField("contact.address.googleMapsUrl", getVal("config-google-maps-url"));
        adminStore.updateConfigField("reviews.googleReviewUrl", getVal("config-google-review-url"));
        adminStore.updateConfigField("contact.socials.instagram", getVal("config-instagram"));
        adminStore.updateConfigField("contact.socials.facebook", getVal("config-facebook"));
        adminStore.updateConfigField("contact.socials.tiktok", getVal("config-tiktok"));

        this.saveToServer("Coordonnées mises à jour !");
    }

    handleDeliverySubmit(e) {
        e.preventDefault();
        const numVal = (id) => {
            const raw = document.getElementById(id)?.value;
            const n = parseFloat(raw);
            return Number.isFinite(n) ? n : null;
        };

        adminStore.updateConfigField("features.enableDelivery", !!document.getElementById("config-enable-delivery")?.checked);
        adminStore.updateConfigField("delivery.radiusKm", numVal("config-delivery-radius") ?? 5);
        adminStore.updateConfigField("delivery.frais", numVal("config-delivery-fee") ?? 2.5);
        adminStore.updateConfigField("delivery.minOrder", numVal("config-delivery-minorder") ?? 0);
        adminStore.updateConfigField("delivery.avgSpeedKmh", numVal("config-delivery-speed") ?? 22);
        adminStore.updateConfigField("delivery.prepBaseMin", numVal("config-delivery-prep") ?? 12);
        adminStore.updateConfigField("delivery.queueFactorMin", numVal("config-delivery-queue") ?? 3);
        adminStore.updateConfigField("geo.lat", numVal("config-resto-lat"));
        adminStore.updateConfigField("geo.lng", numVal("config-resto-lng"));

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
            day: row.querySelector("span.font-black").innerText.trim(),
            open: row.querySelector(".hour-open").value,
            close: row.querySelector(".hour-close").value,
            closed: row.querySelector(".hour-closed").checked,
            hasBreak: !row.querySelector(".break-row").classList.contains("hidden"),
            breakStart: row.querySelector(".hour-break-start").value,
            breakEnd: row.querySelector(".hour-break-end").value
        }));

        adminStore.updateConfigField("hours", hours);
        this.saveToServer("Horaires mis à jour !");
    }

    async saveToServer(successMsg) {
        try {
            await adminStore.saveConfig(window.db, window.fs);
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
                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Sauvegarde...';
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
    btn.classList.toggle("bg-gray-100", !isHidden);
    btn.classList.toggle("text-gray-400", !isHidden);
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
    
    row.querySelector(".flex.items-center.gap-2")?.classList.toggle("opacity-30", checkbox.checked);
};
