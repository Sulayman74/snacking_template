// ============================================================================
// 🎨 UI — THÈME, VUES, TOASTS, SETUP
// ============================================================================
// Dépendances : window.snackConfig, window.cart (array Proxy from app.js)
//               window.menuGlobal (from app.js), window.chargerMenuComplet
//               window.startOrderTracking, window.triggerVibration (self)
//               window.setupPullToRefresh, window.setupSmartReviewPrompt (pwa.js)

// ============================================================================
// 🎨 LE PEINTRE GLOBAL (Application du Thème SaaS)
// ============================================================================
window.applySaaSThemeToHTML = () => {
  const cfg = window.snackConfig;
  if (!cfg?.theme?.colors) return;

  const { primaryHex, accentHex, lightHex, onPrimaryHex } = cfg.theme.colors;
  const root = document.documentElement;

  root.style.setProperty("--color-primary", primaryHex);
  root.style.setProperty("--color-accent", accentHex);
  root.style.setProperty("--color-primary-light", lightHex);
  root.style.setProperty("--color-on-primary", onPrimaryHex);
};

// ============================================================================
// 🎭 MISE À JOUR DE L'UI (SaaS — textes, logos, thème, horaires, SEO)
// ============================================================================
function updateUI(user, role = "client") {
  const cfg = window.snackConfig;
  if (!cfg) return;

  const isAdmin = role === "admin" || role === "superadmin";

  // 0. Promo Banner
  const promoBanner = document.getElementById("promo-banner");
  const promoText = document.getElementById("promo-text");
  const navbar = document.getElementById("navbar");

  const fullMenu = document.getElementById("full-menu");

  if (promoBanner && promoText) {
    if (cfg.promoPhrase) {
      promoText.innerText = cfg.promoPhrase;
      promoBanner.classList.remove("hidden");
      if (navbar) navbar.style.top = "40px"; // On décale la nav si promo
      fullMenu?.classList.add("mt-10");
    } else {
      promoBanner.classList.add("hidden");
      if (navbar) navbar.style.top = "0";
      fullMenu?.classList.remove("mt-10");
    }
  }

  // 1. Identité et Logos
  const pwaIcon = document.getElementById("pwa-banner-icon");
  const reviewIcon = document.getElementById("review-modal-icon");
  const navLogo = document.getElementById("nav-logo");
  const navName = document.getElementById("nav-name");
  const footerCopyName = document.getElementById("footer-copy-name");

  if (cfg.identity) {
    document.title = cfg.identity.name;
    if (navName) navName.innerText = cfg.identity.name;
    if (footerCopyName) footerCopyName.innerText = cfg.identity.name;

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", cfg.identity.description);

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor && cfg.theme.colors.primaryHex) {
      themeColor.setAttribute("content", cfg.theme.colors.primaryHex);
    }

    if (cfg.identity.logoUrl) {
      if (pwaIcon) pwaIcon.src = cfg.identity.logoUrl;
      if (reviewIcon) reviewIcon.src = cfg.identity.logoUrl;
      if (navLogo) {
        navLogo.src = cfg.identity.logoUrl;
        navLogo.classList.remove("hidden");
      }
    }
  }

  // 2. Hero Section
  const heroTitle = document.getElementById("hero-title");
  if (heroTitle) heroTitle.innerText = cfg.identity.name;

  const heroDesc = document.getElementById("hero-desc");
  if (heroDesc) heroDesc.innerText = cfg.identity.description;

  const heroImg = document.getElementById("hero-img");
  if (heroImg && cfg.identity.heroImg) {
    heroImg.src = cfg.identity.heroImg;
  }

  // 3. Boutons Navigation (Logout & Admin)
  const navLogoutBtn = document.getElementById("nav-logout-btn");
  const mobileLogoutBtn = document.getElementById("mobile-logout-btn");
  const navAdminBtn = document.getElementById("nav-admin-btn");
  const mobileAdminBtn = document.getElementById("mobile-admin-btn");

  if (user) {
    navLogoutBtn?.classList.remove("hidden");
    mobileLogoutBtn?.classList.remove("hidden");

    if (isAdmin) {
      navAdminBtn?.classList.remove("hidden");
      mobileAdminBtn?.classList.remove("hidden");
    } else {
      navAdminBtn?.classList.add("hidden");
      mobileAdminBtn?.classList.add("hidden");
    }
  } else {
    navLogoutBtn?.classList.add("hidden");
    mobileLogoutBtn?.classList.add("hidden");
    navAdminBtn?.classList.add("hidden");
    mobileAdminBtn?.classList.add("hidden");
  }

  // 4. Gestion de la Section Fidélité
  const loyaltyBtn = document.getElementById("loyalty-main-btn");
  const loyaltyTitle = document.getElementById("loyalty-title");
  const loyaltyDesc = document.getElementById("loyalty-desc");

  if (loyaltyBtn) {
    if (user) {
      if (isAdmin) {
        if (loyaltyTitle) loyaltyTitle.innerText = "Espace Partenaire";
        if (loyaltyDesc)
          loyaltyDesc.innerText =
            "Scannez le QR Code d'un client pour créditer ses points.";
        loyaltyBtn.setAttribute("data-action", "open-admin-scanner");
        loyaltyBtn.innerHTML =
          '<i class="fas fa-camera mr-2"></i> Scanner Client';
      } else {
        if (loyaltyTitle)
          loyaltyTitle.innerText = cfg.loyalty?.programName || "Club Fidélité";
        if (loyaltyDesc)
          loyaltyDesc.innerText = "Gagnez des points à chaque commande !";
        loyaltyBtn.setAttribute("data-action", "open-client-card");
        loyaltyBtn.innerHTML = '<i class="fas fa-qrcode mr-2"></i> Ma Carte';
      }
    } else {
      loyaltyBtn.setAttribute("data-action", "toggle-auth-modal");
      loyaltyBtn.innerHTML = "Connexion";
    }
  }

  // 5. Pré-remplissage du formulaire de contact si connecté
  const contactField = document.getElementById("contact-field");
  if (contactField && user?.email && !contactField.value) {
    contactField.value = user.email;
  }

  // 6. CTA Dynamiques
  updateCTAs(cfg);

  // 6. Footer & Hero Status (Calcul dynamique)
  updateFooterAndStatusUI(cfg);

  if (typeof window.applySaaSThemeToHTML === "function") {
    window.applySaaSThemeToHTML();
  }
}

function updateCTAs(cfg) {
  const mobileCtaBtn = document.getElementById("mobile-cta-btn");
  const mobileCtaIcon = document.getElementById("mobile-cta-icon");
  const desktopCtaBtn = document.getElementById("cta-nav");
  const mobileBurgerCallBtn = document.getElementById("mobile-burger-call-btn");

  if (!cfg.features || cfg.features.enableOnlineOrder === false) {
    mobileCtaBtn?.classList.add("hidden");
    desktopCtaBtn?.classList.add("hidden");
    mobileBurgerCallBtn?.classList.add("hidden");
    return;
  }

  mobileCtaBtn?.classList.remove("hidden");
  desktopCtaBtn?.classList.remove("hidden");

  const isClickAndCollect = cfg.features.enableClickAndCollect === true;
  const isDelivery = cfg.features.enableDelivery === true;
  const phoneClean = cfg.contact?.phone
    ? cfg.contact.phone.replace(/\s/g, "")
    : "";

  if (isClickAndCollect) {
    setupCtaAction(
      mobileCtaBtn,
      mobileCtaIcon,
      desktopCtaBtn,
      "open-cart",
      "fas fa-shopping-bag",
      "Commander",
    );
  } else if (isDelivery) {
    setupCtaAction(
      mobileCtaBtn,
      mobileCtaIcon,
      desktopCtaBtn,
      "open-delivery",
      "fas fa-motorcycle",
      "Livraison",
      cfg.deliveryUrl,
    );
  } else {
    setupCtaAction(
      mobileCtaBtn,
      mobileCtaIcon,
      desktopCtaBtn,
      "call-phone",
      "fas fa-phone animate-pulse",
      cfg.contact?.phone || "Appeler",
      null,
      phoneClean,
    );
    if (mobileBurgerCallBtn) {
      mobileBurgerCallBtn.href = `tel:${phoneClean}`;
      mobileBurgerCallBtn.classList.remove("hidden");
    }
  }
}

function setupCtaAction(
  mobileBtn,
  mobileIcon,
  desktopBtn,
  action,
  iconClass,
  text,
  url = null,
  phone = null,
) {
  if (mobileBtn) {
    mobileBtn.setAttribute("data-action", action);
    if (url) mobileBtn.setAttribute("data-url", url);
    if (phone) mobileBtn.setAttribute("data-phone", phone);
    if (mobileIcon) mobileIcon.className = `${iconClass} text-2xl`;
  }
  if (desktopBtn) {
    desktopBtn.setAttribute("data-action", action);
    if (url) desktopBtn.setAttribute("data-url", url);
    if (phone) desktopBtn.setAttribute("data-phone", phone);
    desktopBtn.innerHTML = `<i class="${iconClass} mr-2"></i> ${text}`;
  }
}

// 🕒 HELPER : Vérifie le statut d'ouverture (avec coupure)
function getOpeningStatus(h) {
  if (!h || h.closed)
    return {
      status: "ferme",
      label: "Fermé actuellement",
      classes: "border-red-500 bg-red-500/50",
    };

  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();

  const toMin = (str) => {
    const [hh, mm] = str.split(":").map(Number);
    return hh * 60 + mm;
  };

  const openMin = toMin(h.open);
  let closeMin = toMin(h.close);
  if (closeMin <= openMin) closeMin += 24 * 60; // passage minuit

  // ── Pendant la coupure ──────────────────────────────────────────────────
  if (h.hasBreak && h.breakStart && h.breakEnd) {
    const breakStart = toMin(h.breakStart);
    const breakEnd = toMin(h.breakEnd);

    if (cur >= breakStart && cur < breakEnd) {
      const remaining = breakEnd - cur;
      if (remaining <= 30) {
        return {
          status: "bientot-ouvert",
          label: `Ouvre bientôt : ${h.breakEnd}`,
          classes: "border-yellow-500 bg-yellow-500/50 animate-pulse",
        };
      }
      return {
        status: "ferme",
        label: `Fermé • Réouvre à ${h.breakEnd}`,
        classes: "border-red-500 bg-red-500/50",
      };
    }
  }

  // ── Ouvert ──────────────────────────────────────────────────────────────
  if (cur >= openMin && cur < closeMin) {
    // Bientôt fermé (coupure imminente ?)
    if (h.hasBreak && h.breakStart) {
      const breakStart = toMin(h.breakStart);
      if (breakStart > cur && breakStart - cur <= 30) {
        return {
          status: "bientot-ferme",
          label: `Ferme bientôt : ${h.breakStart}`,
          classes: "border-orange-500 bg-orange-500/50 animate-pulse",
        };
      }
    }
    // Bientôt fermé (fermeture du soir)
    if (closeMin - cur <= 30) {
      return {
        status: "bientot-ferme",
        label: `Ferme bientôt : ${h.close}`,
        classes: "border-orange-500 bg-orange-500/50 animate-pulse",
      };
    }
    return {
      status: "ouvert",
      label: h.hasBreak
        ? `Ouvert : ${h.open}–${h.breakStart} / ${h.breakEnd}–${h.close}`
        : `Ouvert : ${h.open} - ${h.close}`,
      classes: "border-green-500 bg-green-600/50",
    };
  }

  // ── Bientôt ouvert (ouverture du matin) ─────────────────────────────────
  if (openMin - cur > 0 && openMin - cur <= 30) {
    return {
      status: "bientot-ouvert",
      label: `Ouvre bientôt : ${h.open}`,
      classes: "border-yellow-500 bg-yellow-500/50 animate-pulse",
    };
  }

  return {
    status: "ferme",
    label: "Fermé actuellement",
    classes: "border-red-500 bg-red-500/50",
  };
}

function updateFooterAndStatusUI(cfg) {
  const findUs = document.getElementById("find-us");
  const oClock = document.getElementById("o-clock");
  if (findUs) findUs.classList.add("text-accent");
  if (oClock) oClock.classList.add("text-accent");

  // Phone
  const footerPhone = document.getElementById("footer-phone");
  if (footerPhone && cfg.contact?.phone) {
    const phoneClean = cfg.contact.phone.replace(/\s/g, "");
    footerPhone.innerHTML = `<a href="tel:${phoneClean}" class="flex items-center gap-2"><i class="fas fa-phone text-accent"></i><span>${cfg.contact.phone}</span></a>`;
  }

  // Address
  const footerAddr = document.getElementById("footer-address");
  if (footerAddr && cfg.contact?.address) {
    const a = cfg.contact.address;
    const fullAddr = `${a.street}, ${a.zip || ""} ${a.city || ""}`.trim();
    const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
    const mapLink =
      a.googleMapsUrl ||
      (isApple
        ? `https://maps.apple.com/?q=${encodeURIComponent(fullAddr)}`
        : `https://maps.google.com/?q=${encodeURIComponent(fullAddr)}`);
    const iconClass = isApple ? "fa-map" : "fa-location-dot";
    footerAddr.innerHTML = `<a href="${mapLink}" target="_blank" class="flex items-start gap-2"><i class="fas ${iconClass} mt-1 text-accent"></i><span>${a.street}<br>${a.zip || ""} ${a.city || ""}</span></a>`;
  }

  // Socials
  const socialsContainer = document.getElementById("socials-container");
  const s = cfg.contact?.socials;
  if (socialsContainer && s) {
    socialsContainer.innerHTML = "";
    if (s.instagram)
      socialsContainer.innerHTML += `<a href="${s.instagram}" target="_blank" class="hover:-translate-y-1 transition-transform"><i class="fab fa-instagram bg-linear-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-transparent bg-clip-text text-2xl"></i></a>`;
    if (s.facebook)
      socialsContainer.innerHTML += `<a href="${s.facebook}" target="_blank" class="hover:-translate-y-1 transition-transform"><i class="fab fa-facebook text-[#1877F2] text-2xl"></i></a>`;
    if (s.tiktok)
      socialsContainer.innerHTML += `<a href="${s.tiktok}" target="_blank" class="hover:-translate-y-1 transition-transform group"><i class="fab fa-tiktok text-white group-hover:drop-shadow-[2px_2px_0_#ff0050] transition-all text-2xl"></i></a>`;
  }

  // Horaires & Hero Status
  const hoursList = document.getElementById("hours-list");
  const heroStatus = document.getElementById("hero-status");
  if (hoursList && cfg.hours) {
    const now = new Date();
    const todayIndex = now.getDay();
    const todayMap = todayIndex === 0 ? 6 : todayIndex - 1;

    hoursList.innerHTML = cfg.hours
      .map((h, index) => {
        const isToday = index === todayMap;
        const textColor = isToday ? "text-accent font-bold" : "text-gray-300";
        const hoursText = h.closed
          ? `<span class="text-red-500/50">Fermé</span>`
          : h.hasBreak
            ? `${h.open}–${h.breakStart} <span class="text-white/20 mx-1">/</span> ${h.breakEnd}–${h.close}`
            : `${h.open} – ${h.close}`;

        if (isToday && heroStatus) {
          const statusInfo = getOpeningStatus(h);
          heroStatus.innerText = statusInfo.label;
          heroStatus.className = `inline-block px-3 py-1 mb-4 text-sm font-bold uppercase border rounded-full backdrop-blur-md text-white ${statusInfo.classes}`;
        }

        return `<li class="flex justify-between items-center py-2 ${isToday ? "text-white/90 font-medium" : "text-white/40"}">
      <span class="flex items-center gap-2">
        ${isToday ? `<span class="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span>` : `<span class="w-1.5 h-1.5 inline-block"></span>`}
        ${h.day}
      </span>
      <span class="tabular-nums text-xs">${hoursText}</span>
    </li>`;
      })
      .join("");
  }
}

// ============================================================================
// 📱 MENU BURGER (Mobile)
// ============================================================================
function setupMobileMenu() {
  const mobileBtn = document.getElementById("mobile-menu-btn");
  const mobileOverlay = document.getElementById("mobile-menu-overlay");
  const mobileLinks = document.querySelectorAll(".mobile-link");

  if (mobileBtn && mobileOverlay) {
    mobileBtn.onclick = () => {
      const isClosed = mobileOverlay.classList.contains("hidden");
      if (isClosed) {
        mobileOverlay.classList.remove("hidden");
        setTimeout(
          () => mobileOverlay.classList.add("flex", "opacity-100"),
          10,
        );
        mobileBtn.innerHTML = '<i class="fas fa-times"></i>';
        document.body.style.overflow = "hidden";
      } else {
        mobileOverlay.classList.remove("opacity-100");
        setTimeout(() => {
          mobileOverlay.classList.add("hidden");
          mobileOverlay.classList.remove("flex");
        }, 300);
        mobileBtn.innerHTML = '<i class="fas fa-bars"></i>';
        document.body.style.overflow = "";
      }
    };

    mobileLinks.forEach((link) => {
      link.addEventListener("click", () => {
        if (!mobileOverlay.classList.contains("hidden")) mobileBtn.click();
      });
    });
  }
}

window.updateUI = updateUI;

window.initAppVisuals = async () => {
  const cfg = window.snackConfig;
  if (!cfg) return;

  if (cfg.features?.maintenanceMode === true) {
    document.body.innerHTML = `<div class="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white text-center px-4"><i class="fas fa-tools text-6xl text-red-500 mb-6 animate-pulse"></i><h1 class="text-4xl font-black mb-4">${cfg.identity.name}</h1><p class="text-gray-400">Maintenance en cours...</p></div>`;
    return;
  }

  document.body.classList.add(cfg.theme.fontFamily || "font-sans");
  if (window.menuGlobal.length === 0) await window.chargerMenuComplet();

  const showLoyalty = cfg.features?.enableLoyaltyCard !== false;
  const sections = ["loyalty", "nav-loyalty-link", "mobile-link-loyalty"];
  sections.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = showLoyalty ? "block" : "none";
  });
};

window.switchView = (viewName) => {
  const fullMenu = document.getElementById("full-menu");
  const isMenu = viewName === "menu";
  fullMenu?.classList.toggle("hidden", !isMenu);
  document.body.style.overflow = isMenu ? "hidden" : "";
  if (viewName === "home") window.scrollTo({ top: 0, behavior: "smooth" });

  // Mise à jour de la navigation mobile (active & pilule)
  const navBtnHome = document.getElementById("nav-btn-home");
  const navBtnMenu = document.getElementById("nav-btn-menu");
  const navIndicator = document.getElementById("nav-indicator");

  if (navBtnHome && navBtnMenu && navIndicator) {
    navBtnHome.classList.toggle("is-active", viewName === "home");
    navBtnMenu.classList.toggle("is-active", viewName === "menu");

    if (viewName === "home") {
      navIndicator.style.transform = "translateX(0)";
    } else if (viewName === "menu") {
      navIndicator.style.transform = "translateX(200%)";
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  setupMobileMenu();
  if (!navigator.onLine) document.body.classList.add("is-offline");

  // ============================================================================
  // 📬 FORMULAIRE CONTACT — Envoi en arrière-plan (pas de navigation)
  // ============================================================================
  const contactForm = document.getElementById("contact-form");
  if (contactForm) {
    contactForm.addEventListener("submit", (e) => {
      e.preventDefault();

      const btn = document.getElementById("btn-submit-form");
      const originalText = btn?.innerHTML;
      if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Envoi...';
        btn.disabled = true;
      }

      fetch(contactForm.action, {
        method: "POST",
        body: new FormData(contactForm),
        headers: { Accept: "application/json" },
      })
        .then((res) => {
          if (res.ok) {
            window.showToast("Message envoyé ! On vous répond bientôt. 👋", "success");
            contactForm.reset();
          } else {
            window.showToast("Erreur lors de l'envoi. Réessayez.", "error");
          }
        })
        .catch(() => window.showToast("Pas de connexion. Réessayez.", "error"))
        .finally(() => {
          if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
          }
        });
    });
  }
});
