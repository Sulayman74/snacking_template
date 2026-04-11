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
  if (!cfg || !cfg.theme) return;

  const { primary, accent, textOnPrimary, border, blurBg } = cfg.theme.colors;

  const primaryButtons = [
    "auth-submit-btn",
    "pwa-install-btn",
    "btn-review-google",
    "checkout-btn",
  ];
  primaryButtons.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.className = btn.className
        .replace(/bg-[a-z]+-\d+/g, "")
        .replace("text-white", "")
        .replace("text-black", "");
      btn.className += ` ${primary} ${textOnPrimary}`;
    }
  });

  const loyaltyCard = document.getElementById("loyalty-card");
  if (loyaltyCard && border) loyaltyCard.classList.add(border);

  const loyaltyIcon = document.querySelector("#loyalty .fa-gift");
  if (loyaltyIcon && accent) loyaltyIcon.classList.add(accent);
};

// ============================================================================
// 🎭 MISE À JOUR DE L'UI (SaaS — textes, logos, thème, horaires, SEO)
// ============================================================================
function updateUI(user) {
  const cfg = window.snackConfig;
  if (!cfg) return;

  const primaryBg = cfg.theme.colors.primary;
  const textOnPrimary = cfg.theme.colors.textOnPrimary;
  const accentText = cfg.theme.colors.accent;

  // Logos dans les modales
  const pwaIcon = document.getElementById("pwa-banner-icon");
  const reviewIcon = document.getElementById("review-modal-icon");
  const navLogo = document.getElementById("nav-logo");

  if (cfg.identity && cfg.identity.logoUrl) {
    if (pwaIcon) pwaIcon.src = cfg.identity.logoUrl;
    if (reviewIcon) reviewIcon.src = cfg.identity.logoUrl;
    if (navLogo) {
      navLogo.src = cfg.identity.logoUrl;
      navLogo.classList.remove("hidden");
    }
  }

  // Navbar & Hero
  const navName = document.getElementById("nav-name");
  if (navName) navName.innerText = cfg.identity.name;

  const heroTitle = document.getElementById("hero-title");
  if (heroTitle) heroTitle.innerText = cfg.identity.name;

  const heroDesc = document.getElementById("hero-desc");
  if (heroDesc) heroDesc.innerText = cfg.identity.description;

  const heroSection = document.getElementById("hero");
  if (heroSection && cfg.identity.heroImg) {
    heroSection.style.backgroundImage = `url('${cfg.identity.heroImg}')`;
  }

  // Bouton Déconnexion
  const navLogoutBtn = document.getElementById("nav-logout-btn");
  const mobileLogoutBtn = document.getElementById("mobile-logout-btn");
  if (user) {
    navLogoutBtn?.classList.remove("hidden");
    mobileLogoutBtn?.classList.remove("hidden");
  } else {
    navLogoutBtn?.classList.add("hidden");
    mobileLogoutBtn?.classList.add("hidden");
  }

  // Liens d'appel (Mobile CTA, Desktop CTA)
  const mobileCtaBtn = document.getElementById("mobile-cta-btn");
  const mobileCtaIcon = document.getElementById("mobile-cta-icon");
  const desktopCtaBtn = document.getElementById("cta-nav");
  const mobileBurgerCallBtn = document.getElementById("mobile-burger-call-btn");

  if (mobileCtaBtn)
    mobileCtaBtn.className = mobileCtaBtn.className
      .replace(/bg-\w+-\d+/g, "")
      .replace(/text-\w+-\d+/g, "")
      .replace("text-white", "")
      .replace("text-black", "");
  if (desktopCtaBtn)
    desktopCtaBtn.className = desktopCtaBtn.className
      .replace(/bg-\w+-\d+/g, "")
      .replace(/text-\w+-\d+/g, "")
      .replace("text-white", "")
      .replace("text-black", "");

  if (cfg.features && cfg.features.enableOnlineOrder === false) {
    if (mobileCtaBtn) mobileCtaBtn.classList.add("hidden");
    if (desktopCtaBtn) desktopCtaBtn.classList.add("hidden");
    if (mobileBurgerCallBtn) mobileBurgerCallBtn.classList.add("hidden");
  } else if (cfg.features) {
    if (mobileCtaBtn) mobileCtaBtn.classList.remove("hidden");
    if (desktopCtaBtn) desktopCtaBtn.classList.remove("hidden");

    const isDelivery = cfg.features.enableDelivery === true;
    const isClickAndCollect = cfg.features.enableClickAndCollect === true;
    const phoneClean = cfg.contact?.phone ? cfg.contact.phone.replace(/\s/g, "") : "";

    if (isClickAndCollect) {
      if (mobileCtaBtn && mobileCtaIcon) {
        mobileCtaBtn.setAttribute("data-action", "open-cart");
        mobileCtaBtn.removeAttribute("data-phone");
        mobileCtaBtn.removeAttribute("data-url");
        mobileCtaBtn.classList.add("bg-green-600", "text-white");
        mobileCtaIcon.className = "fas fa-shopping-bag text-2xl";
      }
      if (desktopCtaBtn) {
        desktopCtaBtn.setAttribute("data-action", "open-cart");
        desktopCtaBtn.removeAttribute("data-phone");
        desktopCtaBtn.removeAttribute("data-url");
        desktopCtaBtn.innerHTML = '<i class="fas fa-shopping-bag mr-2"></i> Commander';
        desktopCtaBtn.className = `ml-4 px-6 py-2 rounded-full font-bold shadow-lg transform hover:scale-105 transition bg-gray-900 text-white`;
      }
      if (mobileBurgerCallBtn) mobileBurgerCallBtn.classList.add("hidden");
    } else if (isDelivery) {
      if (mobileCtaBtn && mobileCtaIcon) {
        mobileCtaBtn.setAttribute("data-action", "open-delivery");
        mobileCtaBtn.setAttribute("data-url", cfg.deliveryUrl || "");
        mobileCtaBtn.removeAttribute("data-phone");
        mobileCtaBtn.classList.add(primaryBg.split(" ")[0], textOnPrimary);
        mobileCtaIcon.className = "fas fa-motorcycle text-2xl";
      }
      if (desktopCtaBtn) {
        desktopCtaBtn.setAttribute("data-action", "open-delivery");
        desktopCtaBtn.setAttribute("data-url", cfg.deliveryUrl || "");
        desktopCtaBtn.removeAttribute("data-phone");
        desktopCtaBtn.innerHTML = '<i class="fas fa-motorcycle mr-2"></i> Commander en livraison';
        desktopCtaBtn.className = `ml-4 px-6 py-2 rounded-full font-bold shadow-lg transform hover:scale-105 transition ${primaryBg} ${textOnPrimary}`;
      }
      if (mobileBurgerCallBtn) mobileBurgerCallBtn.classList.add("hidden");
    } else {
      if (mobileCtaBtn && mobileCtaIcon) {
        mobileCtaBtn.setAttribute("data-action", "call-phone");
        mobileCtaBtn.setAttribute("data-phone", phoneClean || "");
        mobileCtaBtn.removeAttribute("data-url");
        mobileCtaBtn.classList.add("bg-green-600", "text-white");
        mobileCtaIcon.className = "fas fa-phone text-2xl animate-pulse";
      }
      if (desktopCtaBtn) {
        desktopCtaBtn.setAttribute("data-action", "call-phone");
        desktopCtaBtn.setAttribute("data-phone", phoneClean || "");
        desktopCtaBtn.removeAttribute("data-url");
        desktopCtaBtn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> ${cfg.contact?.phone || "Appeler"}`;
        desktopCtaBtn.className = `ml-4 px-6 py-2 rounded-full font-bold shadow-lg transform hover:scale-105 transition bg-green-600 text-white`;
      }
      if (mobileBurgerCallBtn) {
        mobileBurgerCallBtn.href = phoneClean ? `tel:${phoneClean}` : "#";
        mobileBurgerCallBtn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> ${cfg.contact?.phone || "Appeler"}`;
        mobileBurgerCallBtn.classList.remove("hidden");
        mobileBurgerCallBtn.classList.add("flex", "items-center", "justify-center");
      }
    }
  }

  // Footer (Adresse & Tél)
  const findUs = document.getElementById("find-us");
  const oClock = document.getElementById("o-clock");
  if (findUs) findUs.classList.add(accentText);
  if (oClock) oClock.classList.add(accentText);

  const footerPhone = document.getElementById("footer-phone");
  if (footerPhone && cfg.contact.phone) {
    const phoneClean = cfg.contact.phone.replace(/\s/g, "");
    footerPhone.innerHTML = `
      <a href="tel:${phoneClean}" aria-label="Appeler le restaurant" class="flex items-center gap-2">
          <i class="fas fa-phone ${accentText}"></i>
          <span>${cfg.contact.phone}</span>
      </a>`;
  } else if (footerPhone) {
    footerPhone.innerText = "Téléphone non renseigné";
  }

  const footerAddr = document.getElementById("footer-address");
  if (footerAddr && cfg.contact.address) {
    const a = cfg.contact.address;
    if (a.street || a.city) {
      const fullAddr = `${a.street}, ${a.zip || ""} ${a.city || ""}`.trim();
      const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
      let mapLink = a.googleMapsUrl;
      if (!mapLink) {
        mapLink = isApple
          ? `https://maps.apple.com/?q=${encodeURIComponent(fullAddr)}`
          : `https://maps.google.com/?q=${encodeURIComponent(fullAddr)}`;
      }
      const iconClass = isApple ? "fa-map" : "fa-location-dot";
      footerAddr.innerHTML = `
        <a href="${mapLink}" target="_blank" class="flex items-start gap-2">
            <i class="fas ${iconClass} mt-1 ${accentText}"></i>
            <span>${a.street}<br>${a.zip || ""} ${a.city || ""}</span>
        </a>`;
    } else {
      footerAddr.innerText = "Adresse non renseignée dans la base.";
    }
  }

  // Réseaux Sociaux
  const socialsContainer = document.getElementById("socials-container");
  const s = cfg.contact.socials;
  if (socialsContainer && cfg.contact.socials) {
    socialsContainer.innerHTML = "";
    socialsContainer.className = "flex gap-5 text-3xl mt-4 pt-4 border-t border-gray-700/50";
    if (s.instagram) {
      socialsContainer.innerHTML += `
        <a href="https://instagram.com/${s.instagram.replace("@", "")}" target="_blank" aria-label="Notre page Instagram" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform duration-300">
            <i class="fab fa-instagram bg-linear-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-transparent bg-clip-text"></i>
        </a>`;
    }
    if (s.facebook) {
      socialsContainer.innerHTML += `
        <a href="https://facebook.com/${s.facebook}" target="_blank" aria-label="Notre page Facebook" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform duration-300">
            <i class="fab fa-facebook text-[#1877F2]"></i>
        </a>`;
    }
    if (s.tiktok) {
      socialsContainer.innerHTML += `
        <a href="https://tiktok.com/@${s.tiktok.replace("@", "")}" target="_blank" aria-label="Notre page Tiktok" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform duration-300 group">
            <i class="fab fa-tiktok text-white group-hover:drop-shadow-[2px_2px_0_#ff0050] transition-all"></i>
        </a>`;
    }
  }

  // Horaires
  const hoursList = document.getElementById("hours-list");
  const heroStatus = document.getElementById("hero-status");
  if (hoursList && cfg.hours && cfg.hours.length > 0) {
    hoursList.innerHTML = "";
    const todayIndex = new Date().getDay();
    const todayMap = todayIndex === 0 ? 6 : todayIndex - 1;

    cfg.hours.forEach((h, index) => {
      const isToday = index === todayMap;
      const li = document.createElement("li");
      const textColor = isToday
        ? `${accentText} font-bold hover:-translate-y-1 transition-transform duration-300`
        : "text-gray-200";
      li.className = textColor;
      li.innerHTML = `<span class="inline-block w-24">${h.day}</span> ${h.closed ? "Fermé" : h.open + " - " + h.close}`;
      hoursList.appendChild(li);

      if (isToday && heroStatus) {
        heroStatus.innerText = h.closed ? "Fermé" : `Ouvert : ${h.open} - ${h.close}`;
        heroStatus.className = h.closed
          ? "inline-block px-3 py-1 mb-4 text-sm font-bold uppercase border border-red-500 rounded-full backdrop-blur-md bg-red-500/50 text-white"
          : "inline-block px-3 py-1 mb-4 text-sm font-bold uppercase border border-green-500 rounded-full bg-green-600/50 backdrop-blur-md text-white";
      }
    });
  }

  // SEO Schema.org
  const existingScript = document.getElementById("seo-schema");
  if (existingScript) existingScript.remove();

  function buildOpeningHours(hoursArray) {
    const dayMap = {
      lundi: "Monday", mardi: "Tuesday", mercredi: "Wednesday",
      jeudi: "Thursday", vendredi: "Friday", samedi: "Saturday", dimanche: "Sunday",
    };
    return hoursArray
      .filter((h) => !h.closed)
      .map((h) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: dayMap[h.day.toLowerCase()],
        opens: h.open,
        closes: h.close,
      }));
  }

  const a = cfg.contact.address;
  const schemaData = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": window.location.origin + "#restaurant",
    name: cfg.identity.name,
    image: cfg.identity.heroImg,
    url: window.location.origin,
    telephone: cfg.contact.phone,
    hasMenu: window.location.href + "#menu",
    address: {
      "@type": "PostalAddress",
      streetAddress: a.street,
      addressLocality: a.city,
      postalCode: a.zip,
      addressCountry: "FR",
    },
    sameAs: [
      s?.instagram ? `https://instagram.com/${s.instagram.replace("@", "")}` : "",
      s?.facebook ? `https://facebook.com/${s.facebook}` : "",
      s?.tiktok ? `https://tiktok.com/@${s.tiktok.replace("@", "")}` : "",
    ].filter(Boolean),
    servesCuisine: "Fast Food",
    priceRange: "€",
    openingHoursSpecification: buildOpeningHours(cfg.hours),
  };

  const script = document.createElement("script");
  script.id = "seo-schema";
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(schemaData);
  document.head.appendChild(script);

  if (typeof window.applySaaSThemeToHTML === "function") {
    window.applySaaSThemeToHTML();
  }
}

window.updateUI = updateUI;

// ============================================================================
// 🎛️ INITIALISATION VISUELLE (appelée par onAuthStateChanged)
// ============================================================================
window.initAppVisuals = async () => {
  const cfg = window.snackConfig;
  if (!cfg) {
    console.error("❌ initAppVisuals: snackConfig manquant — features désactivées");
    return;
  }

  // Mode maintenance
  if (cfg.features && cfg.features.maintenanceMode === true) {
    console.log("🛑 Site en maintenance ! Arrêt du chargement visuel.");
    document.body.innerHTML = `
      <div class="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white px-4 text-center">
          <i class="fas fa-tools text-6xl text-red-500 mb-6 animate-pulse"></i>
          <h1 class="text-4xl font-black tracking-widest uppercase mb-4">${cfg.identity.name}</h1>
          <p class="text-gray-400 text-lg max-w-md">Notre site est actuellement en cours de mise à jour. Nous revenons très vite pour prendre vos commandes !</p>
      </div>`;
    return;
  }

  // Thème global
  const body = document.body;
  if (cfg.theme.templateId === "classic") {
    body.classList.add("bg-gray-900", "text-white");
  } else {
    body.classList.add("bg-gray-50", "text-gray-900");
  }
  body.classList.add(cfg.theme.fontFamily || "font-sans");

  // Menu (seulement si pas encore chargé)
  if (window.menuGlobal.length === 0) {
    await window.chargerMenuComplet();
  }

  // Feature Flags (Fidélité)
  const features = cfg.features || {};
  const loyaltySection = document.getElementById("loyalty");
  const navLoyalty = document.getElementById("nav-loyalty-link");
  const mobileLoyalty = document.getElementById("mobile-link-loyalty");
  const showLoyalty = features.enableLoyaltyCard !== false;

  if (loyaltySection) loyaltySection.style.display = showLoyalty ? "block" : "none";
  if (navLoyalty) navLoyalty.style.display = showLoyalty ? "inline-block" : "none";
  if (mobileLoyalty) mobileLoyalty.style.display = showLoyalty ? "block" : "none";

  // Reprise du tracking (snackConfig garanti chargé ici)
  const activeOrderId = localStorage.getItem("activeOrderId");
  if (activeOrderId && features.enableClickAndCollect) {
    window.startOrderTracking(activeOrderId);
  }
};

// ============================================================================
// 🔀 CHANGEMENT DE VUE (Home ↔ Menu)
// ============================================================================
function switchView(viewName, ignoreHistory = false) {
  const fullMenu = document.getElementById("full-menu");
  const mobileOverlay = document.getElementById("mobile-menu-overlay");
  const mobileBtnIcon = document.querySelector("#mobile-menu-btn i");
  const navIndicator = document.getElementById("nav-indicator");
  const btnHome = document.getElementById("nav-btn-home");
  const btnMenu = document.getElementById("nav-btn-menu");

  const btns = [btnHome, btnMenu];
  btns.forEach((btn) => {
    if (!btn) return;
    btn.classList.remove("is-active", "text-white");
    btn.classList.add("text-gray-200");
    btn.setAttribute("aria-selected", "false");
  });

  if (viewName === "menu") {
    if (navIndicator) navIndicator.style.transform = "translateX(200%)";

    btnMenu?.classList.add("is-active", "text-white");
    btnMenu?.classList.remove("text-gray-200");
    btnMenu?.setAttribute("aria-selected", "true");

    fullMenu?.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    const floatingCart = document.getElementById("floating-cart-container");
    if (floatingCart && window.cart?.length > 0) floatingCart.classList.remove("hidden");

    if (!ignoreHistory) {
      window.history.pushState({ overlay: "menu" }, "Menu", "#menu");
    }

    if (mobileOverlay && !mobileOverlay.classList.contains("hidden")) {
      mobileOverlay.classList.replace("opacity-100", "opacity-0");
      setTimeout(() => {
        mobileOverlay.classList.add("hidden");
        mobileOverlay.classList.remove("flex");
      }, 300);
      mobileBtnIcon?.classList.replace("fa-times", "fa-bars");
    }
  } else {
    if (navIndicator) navIndicator.style.transform = "translateX(0%)";

    btnHome?.classList.add("is-active", "text-white");
    btnHome?.classList.remove("text-gray-200");
    btnHome?.setAttribute("aria-selected", "true");

    fullMenu?.classList.add("hidden");
    document.body.style.overflow = "";

    const floatingCart = document.getElementById("floating-cart-container");
    if (floatingCart) floatingCart.classList.add("hidden");

    if (!ignoreHistory && window.location.hash === "#menu") {
      window.history.back();
    }

    if (viewName === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
}

window.switchView = switchView;

// ============================================================================
// 🍞 TOAST NOTIFICATION
// ============================================================================
window.showToast = function (message, type = "success") {
  const snackbar = document.getElementById("snackbar");
  if (!snackbar) return;
  const msgEl = document.getElementById("snackbar-message");
  const iconEl = document.getElementById("snackbar-icon");

  msgEl.textContent = message;
  iconEl.className =
    type === "error"
      ? "fas fa-exclamation-circle text-red-500 text-xl"
      : "fas fa-check-circle text-green-400 text-xl";

  snackbar.classList.remove("translate-y-24", "opacity-0");
  setTimeout(() => snackbar.classList.add("translate-y-24", "opacity-0"), 3000);
};

// ============================================================================
// 📳 RETOUR HAPTIQUE (Vibrations)
// ============================================================================
window.triggerVibration = function (type = "light") {
  if (!("vibrate" in navigator)) return;
  try {
    switch (type) {
      case "light": navigator.vibrate(40); break;
      case "success": navigator.vibrate([100, 50, 100]); break;
      case "error": navigator.vibrate([50, 50, 50, 50, 50]); break;
      case "jackpot": navigator.vibrate([200, 100, 200, 100, 500]); break;
    }
  } catch (e) {
    console.log("Vibration bloquée par le navigateur.");
  }
};

// ============================================================================
// 📱 MENU BURGER (Mobile)
// ============================================================================
function setupMobileMenu() {
  const mobileBtn = document.getElementById("mobile-menu-btn");
  const mobileOverlay = document.getElementById("mobile-menu-overlay");
  const mobileLinks = document.querySelectorAll(".mobile-link");

  if (mobileBtn && mobileOverlay) {
    mobileBtn.replaceWith(mobileBtn.cloneNode(true));
    const newMobileBtn = document.getElementById("mobile-menu-btn");
    const newIcon = newMobileBtn.querySelector("i");

    newMobileBtn.addEventListener("click", () => {
      const isClosed = mobileOverlay.classList.contains("hidden");
      if (isClosed) {
        mobileOverlay.classList.remove("hidden");
        setTimeout(() => {
          mobileOverlay.classList.remove("opacity-0");
          mobileOverlay.classList.add("flex", "opacity-100");
        }, 10);
        newIcon.classList.remove("fa-bars");
        newIcon.classList.add("fa-times");
        document.body.style.overflow = "hidden";
      } else {
        mobileOverlay.classList.remove("opacity-100");
        mobileOverlay.classList.add("opacity-0");
        setTimeout(() => {
          mobileOverlay.classList.remove("flex");
          mobileOverlay.classList.add("hidden");
        }, 300);
        newIcon.classList.remove("fa-times");
        newIcon.classList.add("fa-bars");
        document.body.style.overflow = "";
      }
    });

    mobileLinks.forEach((link) => {
      link.addEventListener("click", () => {
        if (!mobileOverlay.classList.contains("hidden")) {
          newMobileBtn.click();
        }
      });
    });
  }
}

window.setupMobileMenu = setupMobileMenu;

// ============================================================================
// ⭐ AVIS CLIENTS (Étoiles Interactives)
// ============================================================================
function setupReviews() {
  const stars = document.querySelectorAll("#interactive-stars i");
  const feedbackText = document.getElementById("rating-feedback");
  const sourceAvisInput = document.getElementById("source-avis");
  const contactSection = document.getElementById("contact");

  stars.forEach((star) => {
    star.addEventListener("click", (e) => {
      const val = parseInt(e.target.getAttribute("data-value"));
      if (typeof window.triggerVibration === "function")
        window.triggerVibration("light");

      stars.forEach((s, index) => {
        if (index < val) {
          s.classList.remove("far", "text-gray-300");
          s.classList.add("fas", "text-yellow-400", "scale-110");
        } else {
          s.classList.remove("fas", "text-yellow-400", "scale-110");
          s.classList.add("far", "text-gray-300");
        }
      });

      const cfg = window.snackConfig;
      const googleReviewLink =
        cfg?.reviews?.googleMapsReviewLink ||
        cfg?.contact?.address?.googleMapsUrl ||
        null;

      if (val >= 4) {
        if (feedbackText) {
          feedbackText.innerHTML = `<span class="text-green-600 font-bold">Top ! On va sur Google... 🚀</span>`;
        }
        setTimeout(() => {
          if (googleReviewLink) {
            window.open(googleReviewLink, "_blank");
          } else if (feedbackText) {
            feedbackText.innerHTML = `<span class="text-green-600 font-bold">Merci pour votre amour ! ❤️</span>`;
          }
        }, 1000);
      } else {
        if (feedbackText) {
          feedbackText.innerHTML = `<span class="text-orange-500 font-bold">Dites-nous tout ci-dessous 👇</span>`;
        }
        if (sourceAvisInput) sourceAvisInput.value = `Note : ${val}/5`;
        setTimeout(() => {
          if (contactSection) contactSection.scrollIntoView({ behavior: "smooth" });
        }, 500);
      }
    });
  });
}

window.setupReviews = setupReviews;

// ============================================================================
// 📬 FORMULAIRE DE CONTACT (AJAX / Formspree)
// ============================================================================
function setupContactForm() {
  const contactForm = document.getElementById("contact-form");
  const submitBtn = document.getElementById("btn-submit-form");

  if (contactForm && submitBtn) {
    contactForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const originalText = submitBtn.textContent;
      submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Envoi...`;
      submitBtn.disabled = true;

      try {
        const response = await fetch(contactForm.action, {
          method: "POST",
          body: new FormData(contactForm),
          headers: { Accept: "application/json" },
        });

        if (response.ok) {
          contactForm.reset();
          if (typeof window.triggerVibration === "function")
            window.triggerVibration("success");
          const sourceAvisInput = document.getElementById("source-avis");
          if (sourceAvisInput) sourceAvisInput.value = "contact_direct";

          const stars = document.querySelectorAll("#interactive-stars i");
          stars.forEach((s) => {
            s.classList.remove("fas", "text-yellow-400", "scale-110");
            s.classList.add("far", "text-gray-300");
          });
          const feedback = document.getElementById("rating-feedback");
          if (feedback) feedback.textContent = "";

          window.showToast("Message envoyé avec succès ! Merci.", "success");
        } else {
          window.showToast("Oups, une erreur est survenue.", "error");
        }
      } catch (error) {
        console.error("Erreur d'envoi du formulaire :", error);
        window.showToast("Erreur de connexion.", "error");
      } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    });
  }
}

window.setupContactForm = setupContactForm;

// ============================================================================
// 🪄 AUTO-REMPLISSAGE DU FORMULAIRE DE CONTACT (UX)
// ============================================================================
window.prefillContactForm = function (user) {
  const contactField = document.getElementById("contact-field");
  if (!contactField) return;

  if (user) {
    const contactInfo = user.email || user.phoneNumber || "";
    if (contactInfo) {
      contactField.value = contactInfo;
      contactField.setAttribute("readonly", "true");
      contactField.classList.remove("bg-gray-50", "text-black", "focus:ring-2");
      contactField.classList.add("bg-gray-200", "text-gray-500", "cursor-not-allowed");
    }
  } else {
    contactField.value = "";
    contactField.removeAttribute("readonly");
    contactField.classList.remove("bg-gray-200", "text-gray-500", "cursor-not-allowed");
    contactField.classList.add("bg-gray-50", "text-black", "focus:ring-2");
  }
};

// ============================================================================
// 🚀 LANCEMENT DES SETUPS AU CHARGEMENT DU DOM
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  setupMobileMenu();
  setupReviews();
  setupContactForm();
  window.setupPullToRefresh?.();
  window.setupSmartReviewPrompt?.();
});
