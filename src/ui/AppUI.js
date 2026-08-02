/**
 * 🎨 AppUI — Gestion de l'UI globale (SaaS, Thème, Navigation)
 * SOLID: Présentation. Écoute le Store pour se mettre à jour.
 */
import { store } from "../core/Store.js";
import { escapeHTML, safeURL, showToast } from "../utils.js";

/**
 * Garantit la présence d'un <link> de police web, sans doublon (idempotent).
 * Couvre le cas "police changée à chaud" quand le <link> build-time n'existe pas.
 * @param {string|null} href - URL de la feuille de police (Google Fonts). Null/absent => no-op.
 */
function ensureFontLink(href) {
    if (!href) return;
    if (document.querySelector(`link[data-font-link][href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-font-link", "");
    document.head.appendChild(link);
}

class AppUI {
    constructor() {
        this.init();
    }

    init() {
        // --- ÉCOUTEURS DU STORE (Flux réactif) ---
        store.addEventListener("config-updated", () => this.handleConfigUpdate());
        store.addEventListener("auth-updated", () => this.updateUI());

        // Initialisation statique robuste
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => this.onDOMReady());
        } else {
            this.onDOMReady();
        }
    }

    onDOMReady() {
        this.setupMobileMenu();
        this.setupContactForm();
        if (!navigator.onLine) document.body.classList.add("is-offline");

        // Si la config est déjà chargée (ex: rechargement à chaud), on met à jour
        if (store.state.config) this.handleConfigUpdate();
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

        // Fallbacks pour le Shadow DOM (Contournement du :host généré par Tailwind v4 @theme)
        root.style.setProperty("--theme-primary", primaryHex);
        root.style.setProperty("--theme-accent", accentHex);
        root.style.setProperty("--theme-primary-light", lightHex);
        root.style.setProperty("--theme-on-primary", onPrimaryHex);

        // 🌈 Active les overrides CSS par thème ([data-theme="belly"] .app-bg, futurs réglages).
        if (cfg.theme.colorPalette) root.dataset.theme = cfg.theme.colorPalette;

        // 🔤 Police — surcharge UNIQUEMENT si Firestore a un fontKey explicite (override admin).
        // Sinon on laisse la valeur posée au build (snacks-seo.json) pour éviter tout FOUT.
        const fonts = cfg.theme.fonts;
        if (fonts?.key) {
            root.style.setProperty("--font-body", fonts.body);
            root.style.setProperty("--font-display", fonts.display || fonts.body);
            // Charge le <link> au runtime si pas déjà injecté au build (changement admin à chaud).
            // display=swap évite le FOIT (cf. SAAS_FONTS).
            ensureFontLink(fonts.href);
        }
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
        const navLoyaltyCardBtn = document.getElementById("nav-loyalty-card-btn");
        const mobileLoyaltyCardBtn = document.getElementById("mobile-loyalty-card-btn");

        const displayAction = user ? "remove" : "add";
        [navLogoutBtn, mobileLogoutBtn].forEach(btn => btn?.classList[displayAction]("hidden"));

        const adminAction = (user && isAdmin) ? "remove" : "add";
        [navAdminBtn, mobileAdminBtn].forEach(btn => btn?.classList[adminAction]("hidden"));

        // Favoris + accès rapide carte fidélité : visibles dès qu'un utilisateur est connecté.
        const favAction = user ? "remove" : "add";
        [navFavoritesLink, mobileFavoritesLink, navLoyaltyCardBtn, mobileLoyaltyCardBtn]
            .forEach(el => el?.classList[favAction]("hidden"));
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
                btn.innerHTML = '<i data-lucide="camera" class="mr-2"></i> Scanner Client';
            } else {
                if (title) title.innerText = cfg.loyalty?.programName || "Club Fidélité";
                if (desc) desc.innerText = "Gagnez des points à chaque commande !";
                btn.setAttribute("data-action", "open-client-card");
                btn.innerHTML = '<i data-lucide="qr-code" class="mr-2"></i> Ma Carte';
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
            this.#setupCtaAction(mobileBtn, mobileIcon, desktopBtn, "open-cart", "shopping-bag", "Commander");
            burgerCallBtn?.classList.add("hidden");
        } else if (hasExternalDelivery) {
            // Pas de commande native, mais lien plateforme externe configuré.
            this.#setupCtaAction(mobileBtn, mobileIcon, desktopBtn, "open-delivery", "bike", "Livraison", cfg.deliveryUrl);
            burgerCallBtn?.classList.add("hidden");
        } else {
            this.#setupCtaAction(mobileBtn, mobileIcon, desktopBtn, "call-phone", "phone", cfg.contact?.phone || "Appeler", null, phone, "animate-pulse");
            if (burgerCallBtn) {
                burgerCallBtn.href = `tel:${phone}`;
                burgerCallBtn.classList.remove("hidden");
            }
        }
    }

    #setupCtaAction(mobileBtn, mobileIcon, desktopBtn, action, iconName, text, url = null, phone = null, iconExtra = "") {
        if (mobileBtn) {
            mobileBtn.setAttribute("data-action", action);
            if (url) mobileBtn.setAttribute("data-url", url);
            if (phone) mobileBtn.setAttribute("data-phone", phone);
            window.swapIcon?.(mobileIcon, iconName, `text-2xl ${iconExtra}`.trim());
        }
        if (desktopBtn) {
            desktopBtn.setAttribute("data-action", action);
            if (url) desktopBtn.setAttribute("data-url", url);
            if (phone) desktopBtn.setAttribute("data-phone", phone);
            desktopBtn.innerHTML = `<i data-lucide="${iconName}" class="mr-2 ${iconExtra}"></i> ${text}`;
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
            phoneEl.innerHTML = `<a href="tel:${escapeHTML(clean)}" class="flex items-center gap-2"><i data-lucide="phone" class="text-accent"></i><span>${escapeHTML(cfg.contact.phone)}</span></a>`;
        }

        const addrEl = document.getElementById("footer-address");
        if (addrEl && cfg.contact?.address) {
            const a = cfg.contact.address;
            const full = `${a.street}, ${a.zip || ""} ${a.city || ""}`.trim();
            const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
            const mapLink = a.googleMapsUrl || (isApple ? `https://maps.apple.com/?q=${encodeURIComponent(full)}` : `https://maps.google.com/?q=${encodeURIComponent(full)}`);
            addrEl.innerHTML = `<a href="${safeURL(mapLink)}" target="_blank" rel="noopener noreferrer" class="flex items-start gap-2"><i data-lucide="${isApple ? "map" : "map-pin"}" class="mt-1 text-accent" aria-hidden="true"></i><span>${escapeHTML(a.street || "")}<br>${escapeHTML(a.zip || "")} ${escapeHTML(a.city || "")}</span></a>`;
        }

        const socials = document.getElementById("socials-container");
        const s = cfg.contact?.socials;
        if (socials && s) {
            const parts = [];
            if (s.instagram) parts.push(`<a href="${safeURL(s.instagram)}" target="_blank" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="text-[#E4405F] text-2xl w-[1em] h-[1em] inline-block align-[-0.125em]"><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg></a>`);
            if (s.facebook) parts.push(`<a href="${safeURL(s.facebook)}" target="_blank" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="text-[#1877F2] text-2xl w-[1em] h-[1em] inline-block align-[-0.125em]"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg></a>`);
            if (s.tiktok) parts.push(`<a href="${safeURL(s.tiktok)}" target="_blank" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform group"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="text-on-dark group-hover:drop-shadow-[2px_2px_0_#ff0050] transition-all text-2xl w-[1em] h-[1em] inline-block align-[-0.125em]"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg></a>`);
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
                ? `<span class="text-danger/50">Fermé</span>`
                : (h.hasBreak ? `${safeOpen}–${safeBreakStart} / ${safeBreakEnd}–${safeClose}` : `${safeOpen} – ${safeClose}`);
            if (isToday && heroStatus) {
                const status = this.getOpeningStatus(h);
                heroStatus.innerText = status.label;
                heroStatus.className = `inline-block px-3 py-1 mb-4 text-sm font-bold uppercase border rounded-full backdrop-blur-md text-on-dark ${status.classes}`;
            }
            return `<li class="flex justify-between items-center py-2 ${isToday ? "text-on-dark/90 font-medium" : "text-on-dark/40"}">
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
                    btn.innerHTML = '<i data-lucide="x"></i>';
                    document.body.style.overflow = "hidden";
                } else {
                    overlay.classList.remove("opacity-100");
                    setTimeout(() => { overlay.classList.add("hidden"); overlay.classList.remove("flex"); }, 300);
                    btn.innerHTML = '<i data-lucide="menu"></i>';
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
            if (btn) { btn.innerHTML = '<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Envoi...'; btn.disabled = true; }
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
            document.body.innerHTML = `<div class="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white text-center px-4"><i data-lucide="wrench" class="text-6xl text-red-500 mb-6 animate-pulse"></i><h1 class="text-4xl font-black mb-4">${escapeHTML(cfg.identity?.name || "")}</h1><p class="text-gray-400">Maintenance en cours...</p></div>`;
            return;
        }
        // 🔤 La police est désormais pilotée par --font-body (appliqué dans applyTheme),
        // hérité par <body>. Plus de classList.add bugué (accumulation, jamais de remove).

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
