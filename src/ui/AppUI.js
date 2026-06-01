/**
 * 🎨 AppUI — Gestion de l'UI globale (SaaS, Thème, Navigation)
 * SOLID: Présentation. Écoute le Store pour se mettre à jour.
 */
import { store } from "../core/Store.js";
import { escapeHTML, safeURL, showToast } from "../utils.js";

class AppUI {
    constructor() {
        this.init();
    }

    init() {
        // --- ÉCOUTEURS DU STORE (Flux réactif) ---
        store.addEventListener("config-updated", () => this.handleConfigUpdate());
        store.addEventListener("auth-updated", () => this.updateUI());

        // Initialisation statique
        document.addEventListener("DOMContentLoaded", () => {
            this.setupMobileMenu();
            this.setupContactForm();
            if (!navigator.onLine) document.body.classList.add("is-offline");

            // Si la config est déjà chargée (ex: rechargement à chaud), on met à jour
            if (store.state.config) this.handleConfigUpdate();
        });
    }

    /**
     * Orchestre la mise à jour complète suite à un changement de config.
     */
    async handleConfigUpdate() {
        const cfg = store.state.config;
        if (!cfg) return;

        this.applyTheme(cfg);
        this.updateIdentity(cfg);
        this.updateHero(cfg);
        this.updateUI(); // Dépend aussi de l'user
        
        // Initialisation visuelle (Maintenance, Polices, etc.)
        await this.initAppVisuals(cfg);
    }

    /**
     * Applique le thème SaaS (CSS Variables).
     */
    applyTheme(cfg) {
        if (!cfg?.theme?.colors) return;
        const { primaryHex, accentHex, lightHex, onPrimaryHex } = cfg.theme.colors;
        const root = document.documentElement;

        root.style.setProperty("--color-primary", primaryHex);
        root.style.setProperty("--color-accent", accentHex);
        root.style.setProperty("--color-primary-light", lightHex);
        root.style.setProperty("--color-on-primary", onPrimaryHex);
    }

    /**
     * Met à jour l'identité (Logos, Titres, SEO).
     */
    updateIdentity(cfg) {
        if (!cfg.identity) return;

        document.title = cfg.identity.name;
        const els = {
            navName: document.getElementById("nav-name"),
            footerCopyName: document.getElementById("footer-copy-name"),
            navLogo: document.getElementById("nav-logo"),
            pwaIcon: document.getElementById("pwa-banner-icon"),
            reviewIcon: document.getElementById("review-modal-icon")
        };

        if (els.navName) els.navName.innerText = cfg.identity.name;
        if (els.footerCopyName) els.footerCopyName.innerText = cfg.identity.name;

        // SEO
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) metaDesc.setAttribute("content", cfg.identity.description);

        // Logos
        if (cfg.identity.logoUrl) {
            if (els.pwaIcon) els.pwaIcon.src = cfg.identity.logoUrl;
            if (els.reviewIcon) els.reviewIcon.src = cfg.identity.logoUrl;
            if (els.navLogo) {
                els.navLogo.src = cfg.identity.logoUrl;
                els.navLogo.classList.remove("hidden");
            }
        }
    }

    /**
     * Met à jour la section Hero.
     */
    updateHero(cfg) {
        const els = {
            title: document.getElementById("hero-title"),
            desc: document.getElementById("hero-desc"),
            img: document.getElementById("hero-img")
        };

        if (els.title) els.title.innerText = cfg.identity.name;
        if (els.desc) els.desc.innerText = cfg.identity.description;
        if (els.img && cfg.identity.heroImg) {
            els.img.src = cfg.identity.heroImg;
        }
    }

    /**
     * Mise à jour globale basée sur l'état config + user.
     */
    updateUI() {
        const { config: cfg, user, role } = store.state;
        if (!cfg) return;

        const isAdmin = role === "admin" || role === "superadmin";

        // 1. Promo Banner
        this.updatePromoBanner(cfg);

        // 2. Navigation (Logout & Admin)
        this.updateNavigation(user, isAdmin);

        // 3. Section Fidélité
        this.updateLoyaltySection(cfg, user, isAdmin);

        // 4. CTA Dynamiques
        this.updateCTAs(cfg);

        // 5. Footer & Horaires
        this.updateFooterAndStatus(cfg);

        // 6. Pré-remplissage contact
        const contactField = document.getElementById("contact-field");
        if (contactField && user?.email && !contactField.value) {
            contactField.value = user.email;
        }
    }

    updatePromoBanner(cfg) {
        const banner = document.getElementById("promo-banner");
        const text = document.getElementById("promo-text");
        const navbar = document.getElementById("navbar");
        const fullMenu = document.getElementById("full-menu");

        if (banner && text) {
            if (cfg.promoPhrase) {
                text.innerText = cfg.promoPhrase;
                banner.classList.remove("hidden");
                if (navbar) navbar.style.top = "40px";
                fullMenu?.classList.add("mt-10");
            } else {
                banner.classList.add("hidden");
                if (navbar) navbar.style.top = "0";
                fullMenu?.classList.remove("mt-10");
            }
        }
    }

    updateNavigation(user, isAdmin) {
        const navLogoutBtn = document.getElementById("nav-logout-btn");
        const mobileLogoutBtn = document.getElementById("mobile-logout-btn");
        const navAdminBtn = document.getElementById("nav-admin-btn");
        const mobileAdminBtn = document.getElementById("mobile-admin-btn");
        const navFavoritesLink = document.getElementById("nav-favorites-link");
        const mobileFavoritesLink = document.getElementById("mobile-favorites-link");

        const displayAction = user ? "remove" : "add";
        [navLogoutBtn, mobileLogoutBtn].forEach(btn => btn?.classList[displayAction]("hidden"));

        const adminAction = (user && isAdmin) ? "remove" : "add";
        [navAdminBtn, mobileAdminBtn].forEach(btn => btn?.classList[adminAction]("hidden"));

        // Favoris : visibles dès qu'un utilisateur est connecté.
        const favAction = user ? "remove" : "add";
        [navFavoritesLink, mobileFavoritesLink].forEach(link => link?.classList[favAction]("hidden"));
    }

    updateLoyaltySection(cfg, user, isAdmin) {
        const btn = document.getElementById("loyalty-main-btn");
        const title = document.getElementById("loyalty-title");
        const desc = document.getElementById("loyalty-desc");

        if (!btn) return;

        if (user) {
            if (isAdmin) {
                if (title) title.innerText = "Espace Partenaire";
                if (desc) desc.innerText = "Scannez le QR Code d'un client pour créditer ses points.";
                btn.setAttribute("data-action", "open-admin-scanner");
                btn.innerHTML = '<i class="fas fa-camera mr-2"></i> Scanner Client';
            } else {
                if (title) title.innerText = cfg.loyalty?.programName || "Club Fidélité";
                if (desc) desc.innerText = "Gagnez des points à chaque commande !";
                btn.setAttribute("data-action", "open-client-card");
                btn.innerHTML = '<i class="fas fa-qrcode mr-2"></i> Ma Carte';
            }
        } else {
            btn.setAttribute("data-action", "toggle-auth-modal");
            btn.innerHTML = "Connexion";
        }
    }

    updateCTAs(cfg) {
        const mobileBtn = document.getElementById("mobile-cta-btn");
        const mobileIcon = document.getElementById("mobile-cta-icon");
        const desktopBtn = document.getElementById("cta-nav");
        const burgerCallBtn = document.getElementById("mobile-burger-call-btn");

        if (!cfg.features || cfg.features.enableOnlineOrder === false) {
            [mobileBtn, desktopBtn, burgerCallBtn].forEach(el => el?.classList.add("hidden"));
            return;
        }

        [mobileBtn, desktopBtn].forEach(el => el?.classList.remove("hidden"));

        const isClickCollect = cfg.features.enableClickAndCollect === true;
        const isDelivery = cfg.features.enableDelivery === true;
        // Commande native = click&collect OU livraison interne → toujours via le panier
        // (le mode collect/livraison est choisi dans le panier). La livraison native
        // prime sur le lien plateforme externe (UberEats), réservé au cas SANS flotte.
        const canOrderNative = isClickCollect || isDelivery;
        const hasExternalDelivery = !!cfg.deliveryUrl;
        const phone = cfg.contact?.phone ? cfg.contact.phone.replace(/\s/g, "") : "";

        if (canOrderNative) {
            this.#setupCtaAction(mobileBtn, mobileIcon, desktopBtn, "open-cart", "fas fa-shopping-bag", "Commander");
            burgerCallBtn?.classList.add("hidden");
        } else if (hasExternalDelivery) {
            // Pas de commande native, mais lien plateforme externe configuré.
            this.#setupCtaAction(mobileBtn, mobileIcon, desktopBtn, "open-delivery", "fas fa-motorcycle", "Livraison", cfg.deliveryUrl);
            burgerCallBtn?.classList.add("hidden");
        } else {
            this.#setupCtaAction(mobileBtn, mobileIcon, desktopBtn, "call-phone", "fas fa-phone animate-pulse", cfg.contact?.phone || "Appeler", null, phone);
            if (burgerCallBtn) {
                burgerCallBtn.href = `tel:${phone}`;
                burgerCallBtn.classList.remove("hidden");
            }
        }
    }

    #setupCtaAction(mobileBtn, mobileIcon, desktopBtn, action, icon, text, url = null, phone = null) {
        if (mobileBtn) {
            mobileBtn.setAttribute("data-action", action);
            if (url) mobileBtn.setAttribute("data-url", url);
            if (phone) mobileBtn.setAttribute("data-phone", phone);
            if (mobileIcon) mobileIcon.className = `${icon} text-2xl`;
        }
        if (desktopBtn) {
            desktopBtn.setAttribute("data-action", action);
            if (url) desktopBtn.setAttribute("data-url", url);
            if (phone) desktopBtn.setAttribute("data-phone", phone);
            desktopBtn.innerHTML = `<i class="${icon} mr-2"></i> ${text}`;
        }
    }

    updateFooterAndStatus(cfg) {
        // Adresses, téléphone, réseaux sociaux...
        this.updateContactInfo(cfg);
        this.updateHoursAndStatus(cfg);
    }

    updateContactInfo(cfg) {
        const phoneEl = document.getElementById("footer-phone");
        if (phoneEl && cfg.contact?.phone) {
            const clean = cfg.contact.phone.replace(/\s/g, "");
            phoneEl.innerHTML = `<a href="tel:${escapeHTML(clean)}" class="flex items-center gap-2"><i class="fas fa-phone text-accent"></i><span>${escapeHTML(cfg.contact.phone)}</span></a>`;
        }

        const addrEl = document.getElementById("footer-address");
        if (addrEl && cfg.contact?.address) {
            const a = cfg.contact.address;
            const full = `${a.street}, ${a.zip || ""} ${a.city || ""}`.trim();
            const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
            const mapLink = a.googleMapsUrl || (isApple ? `https://maps.apple.com/?q=${encodeURIComponent(full)}` : `https://maps.google.com/?q=${encodeURIComponent(full)}`);
            addrEl.innerHTML = `<a href="${safeURL(mapLink)}" target="_blank" rel="noopener noreferrer" class="flex items-start gap-2"><i class="fas ${isApple ? "fa-map" : "fa-location-dot"} mt-1 text-accent"></i><span>${escapeHTML(a.street || "")}<br>${escapeHTML(a.zip || "")} ${escapeHTML(a.city || "")}</span></a>`;
        }

        const socials = document.getElementById("socials-container");
        const s = cfg.contact?.socials;
        if (socials && s) {
            const parts = [];
            if (s.instagram) parts.push(`<a href="${safeURL(s.instagram)}" target="_blank" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform"><i class="fab fa-instagram bg-linear-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-transparent bg-clip-text text-2xl"></i></a>`);
            if (s.facebook) parts.push(`<a href="${safeURL(s.facebook)}" target="_blank" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform"><i class="fab fa-facebook text-[#1877F2] text-2xl"></i></a>`);
            if (s.tiktok) parts.push(`<a href="${safeURL(s.tiktok)}" target="_blank" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform group"><i class="fab fa-tiktok text-white group-hover:drop-shadow-[2px_2px_0_#ff0050] transition-all text-2xl"></i></a>`);
            socials.innerHTML = parts.join("");
        }
    }

    updateHoursAndStatus(cfg) {
        const list = document.getElementById("hours-list");
        const heroStatus = document.getElementById("hero-status");
        if (!list || !cfg.hours) return;

        const now = new Date();
        const todayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;

        list.innerHTML = cfg.hours.map((h, index) => {
            const isToday = index === todayIndex;
            const safeOpen = escapeHTML(h.open || "");
            const safeClose = escapeHTML(h.close || "");
            const safeBreakStart = escapeHTML(h.breakStart || "");
            const safeBreakEnd = escapeHTML(h.breakEnd || "");
            const hoursText = h.closed
                ? `<span class="text-red-500/50">Fermé</span>`
                : (h.hasBreak ? `${safeOpen}–${safeBreakStart} / ${safeBreakEnd}–${safeClose}` : `${safeOpen} – ${safeClose}`);
            if (isToday && heroStatus) {
                const status = this.getOpeningStatus(h);
                heroStatus.innerText = status.label;
                heroStatus.className = `inline-block px-3 py-1 mb-4 text-sm font-bold uppercase border rounded-full backdrop-blur-md text-white ${status.classes}`;
            }
            return `<li class="flex justify-between items-center py-2 ${isToday ? "text-white/90 font-medium" : "text-white/40"}">
                <span class="flex items-center gap-2">
                    ${isToday ? `<span class="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span>` : `<span class="w-1.5 h-1.5 inline-block"></span>`}
                    ${escapeHTML(h.day || "")}
                </span>
                <span class="tabular-nums text-xs">${hoursText}</span>
            </li>`;
        }).join("");
    }

    getOpeningStatus(h) {
        if (!h || h.closed) return { status: "ferme", label: "Fermé actuellement", classes: "border-red-500 bg-red-500/50" };
        const now = new Date();
        const cur = now.getHours() * 60 + now.getMinutes();
        const toMin = (str) => str.split(":").map(Number)[0] * 60 + str.split(":").map(Number)[1];
        const openMin = toMin(h.open);
        let closeMin = toMin(h.close);
        if (closeMin <= openMin) closeMin += 1440;

        if (h.hasBreak && h.breakStart && h.breakEnd) {
            const bStart = toMin(h.breakStart), bEnd = toMin(h.breakEnd);
            if (cur >= bStart && cur < bEnd) return { status: "ferme", label: `Fermé • Réouvre à ${h.breakEnd}`, classes: "border-red-500 bg-red-500/50" };
        }

        if (cur >= openMin && cur < closeMin) return { status: "ouvert", label: "Ouvert actuellement", classes: "border-green-500 bg-green-600/50" };
        return { status: "ferme", label: "Fermé actuellement", classes: "border-red-500 bg-red-500/50" };
    }

    setupMobileMenu() {
        const btn = document.getElementById("mobile-menu-btn");
        const overlay = document.getElementById("mobile-menu-overlay");
        const links = document.querySelectorAll(".mobile-link");

        if (btn && overlay) {
            btn.onclick = () => {
                const isClosed = overlay.classList.contains("hidden");
                if (isClosed) {
                    overlay.classList.remove("hidden");
                    setTimeout(() => overlay.classList.add("flex", "opacity-100"), 10);
                    btn.innerHTML = '<i class="fas fa-times"></i>';
                    document.body.style.overflow = "hidden";
                } else {
                    overlay.classList.remove("opacity-100");
                    setTimeout(() => { overlay.classList.add("hidden"); overlay.classList.remove("flex"); }, 300);
                    btn.innerHTML = '<i class="fas fa-bars"></i>';
                    document.body.style.overflow = "";
                }
            };
            links.forEach(l => l.addEventListener("click", () => !overlay.classList.contains("hidden") && btn.click()));
        }
    }

    setupContactForm() {
        const form = document.getElementById("contact-form");
        if (!form) return;
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            const btn = document.getElementById("btn-submit-form");
            const original = btn?.innerHTML;
            if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Envoi...'; btn.disabled = true; }
            fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
                .then(res => {
                    if (res.ok) { showToast("Message envoyé ! 👋", "success"); form.reset(); }
                    else showToast("Erreur d'envoi.", "error");
                })
                .catch(() => showToast("Pas de connexion.", "error"))
                .finally(() => { if (btn) { btn.innerHTML = original; btn.disabled = false; } });
        });
    }

    async initAppVisuals(cfg) {
        if (cfg.features?.maintenanceMode === true) {
            document.body.innerHTML = `<div class="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white text-center px-4"><i class="fas fa-tools text-6xl text-red-500 mb-6 animate-pulse"></i><h1 class="text-4xl font-black mb-4">${escapeHTML(cfg.identity?.name || "")}</h1><p class="text-gray-400">Maintenance en cours...</p></div>`;
            return;
        }
        document.body.classList.add(cfg.theme.fontFamily || "font-sans");
        
        const showLoyalty = cfg.features?.enableLoyaltyCard !== false;
        ["loyalty", "nav-loyalty-link", "mobile-link-loyalty"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = showLoyalty ? "block" : "none";
        });
    }

    switchView(viewName) {
        const fullMenu = document.getElementById("full-menu");
        const isMenu = viewName === "menu";
        fullMenu?.classList.toggle("hidden", !isMenu);
        document.body.style.overflow = isMenu ? "hidden" : "";
        if (viewName === "home") window.scrollTo({ top: 0, behavior: "smooth" });

        const navBtnHome = document.getElementById("nav-btn-home");
        const navBtnMenu = document.getElementById("nav-btn-menu");
        const navIndicator = document.getElementById("nav-indicator");

        if (navBtnHome && navBtnMenu && navIndicator) {
            navBtnHome.classList.toggle("is-active", viewName === "home");
            navBtnMenu.classList.toggle("is-active", viewName === "menu");
            navIndicator.style.transform = viewName === "home" ? "translateX(0)" : "translateX(200%)";
        }
    }
}

export const appUI = new AppUI();
