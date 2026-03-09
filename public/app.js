// ============================================================================
// GESTION DU SERVICE WORKER (PWA) & MODE DEV
// ============================================================================
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

if ('serviceWorker' in navigator) {
    if (!isLocalhost) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then((registration) => console.log('✅ Service Worker enregistré.', registration.scope))
                .catch((error) => console.error('❌ Erreur Service Worker', error));
        });
    } else {
        console.log("🛠️ Mode Dev : Nettoyage des SW (Sauf Firebase)...");
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) { 
                // 🪄 L'EXCEPTION : On ne tue pas le Service Worker de Firebase !
                const swUrl = registration.active?.scriptURL || "";
                if (!swUrl.includes('firebase-messaging-sw')) {
                    registration.unregister(); 
                    console.log("🗑️ Ancien SW de cache supprimé.");
                }
            }
        });
    }
}
// ============================================================================
// VARIABLE GLOBALE POUR LE MENU (Très important pour le Panier et Modal)
// ============================================================================
let menuGlobal = [];

window.switchView = function (viewName) {
  const fullMenu = document.getElementById("full-menu");
  const body = document.body;
  if (!fullMenu) return;

  if (viewName === "menu") {
    fullMenu.classList.remove("hidden");
    body.style.overflow = "hidden";
  } else {
    fullMenu.classList.add("hidden");
    body.style.overflow = "";
  }
};

// ============================================================================
// INITIALISATION PRINCIPALE (Async pour attendre la BDD)
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof snackConfig === "undefined") {
    console.error("Config introuvable !");
    return;
  }
  const cfg = snackConfig;
  const body = document.body;

  // ------------------------------------------------------------
  //  CHARGEMENT DES VRAIES DONNÉES DEPUIS FIRESTORE ! 🚀
  // ------------------------------------------------------------
  
  // 🛡️ SÉCURITÉ : On recrée l'objet menu au cas où tu l'as effacé du mock
  if (!cfg.menu) cfg.menu = {};
  if (!cfg.menu.categories) cfg.menu.categories = [];

  // On vérifie si la fonction Firestore est bien chargée
  if (typeof window.chargerMenuDepuisDB === 'function') {
      const dataDB = await window.chargerMenuDepuisDB();
      if (dataDB && dataDB.categories && dataDB.categories.length > 0) {
          // On sauvegarde les données brutes pour le modal
          menuGlobal = dataDB.brut; 
          // 🪄 MAGIE : On remplace le menu par les vraies données !
          cfg.menu.categories = dataDB.categories; 
      }
  } else {
      console.warn("⚠️ Firestore non branché, utilisation du mock par défaut.");
      // Fallback de sécurité
      cfg.menu.categories.forEach(cat => {
          if (cat.items) menuGlobal.push(...cat.items);
      });
  }

  // 🛡️ SÉCURITÉ 2 : Si la base est vide ET le mock est vide, on arrête tout
  if (cfg.menu.categories.length === 0) {
      console.error("❌ Aucun produit à afficher. Vérifiez Firestore !");
      document.getElementById("full-menu-container").innerHTML = "<p class='text-center text-xl mt-10'>Menu indisponible pour le moment.</p>";
      return; // On arrête le script ici pour ne pas casser la suite
  }

  // ------------------------------------------------------------
  // 1. THÈME & IDENTITÉ
  // ------------------------------------------------------------
  document.title = cfg.identity.name;

  if (cfg.theme.templateId === "neon-vibes") {
    body.classList.add("bg-gray-900", "text-white");
    const nav = document.getElementById("navbar");
    if (nav) nav.classList.add("bg-gray-900/90", "backdrop-blur");
  } else {
    body.classList.add("bg-gray-50", "text-gray-900");
    const nav = document.getElementById("navbar");
    if (nav) nav.classList.add("bg-white/90", "backdrop-blur", "shadow-sm");
  }

  document.getElementById("nav-name").innerText = cfg.identity.name;
  document.getElementById("hero-title").innerText = cfg.identity.name;
  document.getElementById("hero-desc").innerText = cfg.identity.description;

  const heroSection = document.getElementById("hero");
  if (heroSection) {
    const bgImage = cfg.theme.heroImage || "assets/heroImg.webp";
    heroSection.style.backgroundImage = `url('${bgImage}')`;
  }

  const primaryBtns = [
    document.getElementById("cta-nav"),
    document.getElementById("cta-hero"),
    document.getElementById("btn-submit-form"),
  ];
  primaryBtns.forEach((btn) => {
    if (btn) btn.className += ` ${cfg.theme.colors.primary} text-white`;
  });

  if (cfg.identity.logoUrl) {
    const logo = document.getElementById("nav-logo");
    if (logo) {
      logo.src = cfg.identity.logoUrl;
      logo.classList.remove("hidden");
    }
  }

  // ------------------------------------------------------------
  // 2. GÉNÉRATION "BEST SELLERS" (Accueil)
  // ------------------------------------------------------------
  const bestSellersContainer = document.getElementById("bestsellers-container");
  if (bestSellersContainer) {
    let count = 0;
    cfg.menu.categories.forEach((cat) => {
      cat.items.forEach((item) => {
        // On utilise la vraie info isBestSeller de la base de données !
        if ((item.isBestSeller || count < 3) && count < 3) {
          bestSellersContainer.innerHTML += createProductCard(item, cfg);
          count++;
        }
      });
    });
  }

  // ------------------------------------------------------------
  // 3. GÉNÉRATION "CARTE COMPLÈTE" (Galerie)
  // ------------------------------------------------------------
  const fullMenuContainer = document.getElementById("full-menu-container");
  if (fullMenuContainer) {
    cfg.menu.categories.forEach((cat) => {
      // Sécurité : On ne dessine pas les catégories vides
      if (!cat.items || cat.items.length === 0) return;

      const catDiv = document.createElement("div");
      const borderColor = cfg.theme.colors.secondary.replace("bg-", "border-");

      catDiv.innerHTML = `
                <div class="flex items-center gap-3 mb-6 sticky top-0 bg-transparent backdrop-blur py-4 z-10">
                    <span class="text-3xl">${cat.icon || ""}</span>
                    <h3 class="text-2xl font-bold uppercase border-b-2 ${borderColor} pb-2 ${cfg.theme.templateId === 'neon-vibes' ? 'text-black' : 'text-white'}">
                        ${cat.title}
                    </h3>
                </div>
                <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    ${cat.items.map((item) => createProductCard(item, cfg)).join("")}
                </div>`;
      fullMenuContainer.appendChild(catDiv);
    });
  }

  // ------------------------------------------------------------
  // 4. SMART CTA, MENUS ET AUTRES FONCTIONS INTACTES
  // ------------------------------------------------------------
  const ctaBtn = document.getElementById("mobile-cta-btn");
  const ctaIcon = document.getElementById("mobile-cta-icon");

  if (ctaBtn && ctaIcon) {
    if (cfg.features.enableDelivery === true) {
      ctaBtn.href = cfg.deliveryUrl || "#";
      ctaIcon.className = "fas fa-motorcycle text-2xl";
    } else {
      const phone = cfg.contact.phone.replace(/\s/g, "");
      ctaBtn.href = `tel:${phone}`;
      ctaBtn.removeAttribute("target");
      ctaBtn.classList.remove(cfg.theme.colors.primary.split(" ")[0]);
      ctaBtn.classList.add("bg-green-600");
      ctaIcon.className = "fas fa-phone text-2xl animate-pulse";
    }
  }

  const mobileBtn = document.getElementById("mobile-menu-btn");
  const mobileOverlay = document.getElementById("mobile-menu-overlay");
  const mobileLinks = document.querySelectorAll(".mobile-link");

  if (mobileBtn && mobileOverlay) {
    const icon = mobileBtn.querySelector("i");
    mobileBtn.addEventListener("click", () => {
      const isClosed = mobileOverlay.classList.contains("hidden");
      if (isClosed) {
        mobileOverlay.classList.remove("hidden");
        setTimeout(() => {
          mobileOverlay.classList.remove("opacity-0");
          mobileOverlay.classList.add("flex", "opacity-100");
        }, 10);
        icon.classList.remove("fa-bars");
        icon.classList.add("fa-times");
        body.style.overflow = "hidden";
      } else {
        mobileOverlay.classList.remove("opacity-100");
        mobileOverlay.classList.add("opacity-0");
        setTimeout(() => {
          mobileOverlay.classList.remove("flex");
          mobileOverlay.classList.add("hidden");
        }, 300);
        icon.classList.remove("fa-times");
        icon.classList.add("fa-bars");
        body.style.overflow = "";
      }
    });

    mobileLinks.forEach((link) => {
      link.addEventListener("click", () => mobileBtn.click());
    });
  }

  if (cfg.features.enableLoyaltyCard) {
    const loyaltySection = document.getElementById("loyalty");
    const navLoyaltyLink = document.getElementById("nav-loyalty-link");
    const mobileLoyaltyLink = document.getElementById("mobile-link-loyalty");

    if (loyaltySection) loyaltySection.classList.remove("hidden");
    if (navLoyaltyLink) navLoyaltyLink.classList.remove("hidden");
    if (mobileLoyaltyLink) mobileLoyaltyLink.classList.remove("hidden");
    
    const loyaltyTitle = document.getElementById("loyalty-title");
    if (loyaltyTitle && cfg.loyalty) {
        loyaltyTitle.innerText = cfg.loyalty.programName;
    }
  }

  const mobileHomeBtn = document.getElementById("mobile-link-home");
  if (mobileHomeBtn) {
    mobileHomeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      switchView("home");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (cfg.form && cfg.form.enable) {
    const contactSection = document.getElementById("contact");
    if (contactSection) {
      contactSection.classList.remove("hidden");
      document.getElementById("form-title").innerText = cfg.form.title;
      document.getElementById("form-desc").innerText = cfg.form.description;
      document.getElementById("contact-form").action = cfg.form.formspreeUrl;
    }
  }

  if (cfg.reviews && cfg.reviews.enable) {
    const reviewSection = document.getElementById("reviews");
    if (reviewSection) reviewSection.classList.remove("hidden");

    const starsContainer = document.getElementById("interactive-stars");
    const feedbackText = document.getElementById("rating-feedback");

    if (starsContainer) {
      const stars = starsContainer.querySelectorAll("i");
      stars.forEach((star) => {
        star.addEventListener("click", function () {
          const val = parseInt(this.getAttribute("data-value"));
          stars.forEach((s) => {
            const sVal = parseInt(s.getAttribute("data-value"));
            if (sVal <= val) {
              s.classList.remove("far", "text-gray-300");
              s.classList.add("fas", "text-yellow-400");
            } else {
              s.classList.remove("fas", "text-yellow-400");
              s.classList.add("far", "text-gray-300");
            }
          });

          if (val >= 4) {
            feedbackText.innerHTML = `<span class="text-green-600 font-bold">Top ! On va sur Google... 🚀</span>`;
            setTimeout(() => window.open(cfg.reviews.googleMapsReviewLink, "_blank"), 1000);
          } else {
            feedbackText.innerHTML = `<span class="text-orange-500 font-bold">Dites-nous tout ci-dessous 👇</span>`;
            const sourceAvis = document.getElementById("source-avis");
            if (sourceAvis) sourceAvis.value = `Note: ${val}/5`;
            setTimeout(() => document.getElementById("contact").scrollIntoView({ behavior: "smooth" }), 500);
          }
        });
      });
    }
  }

  const footerAddr = document.getElementById("footer-address");
  if (footerAddr) {
    const fullAddr = `${cfg.contact.address.street}, ${cfg.contact.address.city}`;
    const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);

    let mapLink = cfg.contact.address.googleMapsUrl || 
      (isApple ? `http://maps.apple.com/?q=${encodeURIComponent(fullAddr)}` : `https://www.google.com/maps/search/?api=1&query=$${encodeURIComponent(fullAddr)}`);

    const iconClass = isApple ? "fa-map" : "fa-location-dot";

    footerAddr.innerHTML = `
            <a href="${mapLink}" target="_blank" class="flex items-start gap-2 hover:text-red-500 group">
                <i class="fas ${iconClass} mt-1 text-red-600 group-hover:text-red-500"></i>
                <span>${cfg.contact.address.street}<br>${cfg.contact.address.zip} ${cfg.contact.address.city}</span>
            </a>`;
  }
  document.getElementById("footer-phone").innerText = cfg.contact.phone;

  const hoursList = document.getElementById("hours-list");
  if (hoursList) {
    const todayIndex = new Date().getDay(); 
    const todayMap = todayIndex === 0 ? 6 : todayIndex - 1; 

    cfg.hours.forEach((h, index) => {
      const isToday = index === todayMap;
      const li = document.createElement("li");
      const textColor = cfg.theme.colors.secondary.replace("bg-", "text-");

      li.className = isToday ? `font-bold ${textColor}` : "";
      li.innerHTML = `<span class="inline-block w-24">${h.day}</span> ${h.closed ? "Fermé" : h.open + " - " + h.close}`;
      hoursList.appendChild(li);

      if (isToday) {
        const badge = document.getElementById("hero-status");
        if (badge) {
          if (h.closed) {
            badge.innerText = "Fermé Aujourd'hui";
            badge.classList.add("bg-red-500");
          } else {
            badge.innerText = `Ouvert : ${h.open} - ${h.close}`;
            badge.classList.add("bg-green-600");
          }
        }
      }
    });
  }

  setTimeout(() => {
    body.classList.remove("loading");
    body.classList.add("loaded");
  }, 100);
});

// ============================================================================
// CRÉATION DES CARTES PRODUITS (Avec logique de Stock !)
// ============================================================================
function createProductCard(item, cfg) {
  const cardBg = cfg.theme.templateId === "neon-vibes" ? "bg-gray-800" : "bg-white shadow-lg border text-black border-gray-100";
  const textColor = cfg.theme.templateId === "neon-vibes" ? "text-white" : "text-gray-900";
  const priceColor = cfg.theme.colors.secondary.replace("bg-", "text-");

  // 🛡️ Logique de stock
  const isAvailable = item.isAvailable !== false; // true par défaut
  const imageOpacity = isAvailable ? "group-hover:scale-110" : "opacity-50 grayscale";
  const cardOpacity = isAvailable ? "cursor-pointer" : "cursor-not-allowed opacity-70";
  const clickAction = isAvailable ? `onclick="openProductModal('${item.id || item.nom}')"` : `onclick="showToast('Produit momentanément indisponible', 'error')"`;
  
  // Tag personnalisé
  let tagHtml = "";
  if (!isAvailable) {
      tagHtml = `<span class="absolute top-2 right-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full uppercase shadow-md">Épuisé</span>`;
  } else if (item.tags && item.tags.length > 0) {
      tagHtml = `<span class="absolute top-2 right-2 ${cfg.theme.colors.secondary} text-black text-xs font-bold px-2 py-1 rounded-full uppercase shadow-md">${item.tags[0]}</span>`;
  }

  // Prix avec fallback devise
  const devise = item.devise || cfg.identity.currency;
  const prixAffiche = item.prix || item.price || 0;
  const nomAffiche = item.nom || item.name;

  return `
    <div class="${cardBg} rounded-xl overflow-hidden group ${cardOpacity}" ${clickAction}>
        <div class="h-48 relative overflow-hidden">
            <img src="${item.image}" alt="${nomAffiche}" class="w-full h-full object-cover transition duration-500 ${imageOpacity}">
            ${tagHtml}
        </div>
        <div class="p-5">
            <div class="flex justify-between items-start mb-2">
                <h4 class="text-lg font-bold ${textColor}">${nomAffiche}</h4>
                <span class="text-xl font-bold ${priceColor}">${prixAffiche.toFixed(2)}${devise}</span>
            </div>
            <p class="text-sm text-gray-400 mb-4 line-clamp-2">${item.description || ""}</p>
            
            <button class="w-full py-3 rounded-lg border border-gray-500 ${textColor} hover:${isAvailable ? cfg.theme.colors.primary : ''} hover:border-transparent hover:text-white transition font-bold flex items-center justify-center gap-2">
                ${isAvailable ? '<i class="fas fa-eye"></i> Voir le détail' : '<i class="fas fa-ban"></i> Indisponible'}
            </button>
        </div>
    </div>`;
}

// ============================================================================
// GESTION DU MODAL PRODUIT (Relié à la BDD)
// ============================================================================
window.openProductModal = function (itemId) {
  const cfg = snackConfig;
  
  // 🔍 On cherche le produit dans notre variable globale chargée depuis Firebase
  const item = menuGlobal.find(i => (i.id === itemId || i.nom === itemId));
  if (!item) return;

  const devise = item.devise || cfg.identity.currency;
  const prixAffiche = item.prix || item.price;
  const nomAffiche = item.nom || item.name;

  document.getElementById("modal-img").src = item.image;
  document.getElementById("modal-title").innerText = nomAffiche;
  document.getElementById("modal-price").innerText = prixAffiche.toFixed(2) + devise;
  document.getElementById("modal-desc").innerText = item.description || "";

  const tagsContainer = document.getElementById("modal-tags");
  tagsContainer.innerHTML = "";
  if (item.tags) {
    item.tags.forEach((tag) => {
      tagsContainer.innerHTML += `<span class="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm font-bold">${tag}</span>`;
    });
  }

  const allergenContainer = document.getElementById("modal-allergens-container");
  const allergenesList = item.allergenes || item.allergens;
  if (allergenesList && allergenesList.length > 0) {
    allergenContainer.classList.remove("hidden");
    document.getElementById("modal-allergens").innerText = allergenesList.join(", ");
  } else {
    allergenContainer.classList.add("hidden");
  }

  const btn = document.getElementById("modal-cta");
  if (item.isAvailable === false) {
      btn.innerHTML = `<i class="fas fa-ban mr-2"></i> Épuisé`;
      btn.className = `block w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-gray-500 cursor-not-allowed`;
      btn.removeAttribute('href');
  } else {
      const phone = cfg.contact.phone.replace(/\s/g, "");
      btn.href = `tel:${phone}`;
      btn.innerHTML = `<i class="fas fa-phone mr-2"></i> Commander "${nomAffiche}"`;
      btn.className = `block w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg hover:scale-[1.02] transition-transform ${cfg.theme.colors.primary}`;
  }

  const backdrop = document.getElementById("product-modal-backdrop");
  const sheet = document.getElementById("product-modal");
  backdrop.classList.remove("hidden");
  setTimeout(() => backdrop.classList.remove("opacity-0"), 10);
  sheet.classList.remove("translate-y-full");
  document.body.style.overflow = "hidden";
};

window.closeProductModal = function () {
  const backdrop = document.getElementById("product-modal-backdrop");
  const sheet = document.getElementById("product-modal");
  sheet.classList.add("translate-y-full");
  backdrop.classList.add("opacity-0");
  setTimeout(() => {
    backdrop.classList.add("hidden");
    document.body.style.overflow = "";
  }, 300);
};

if ("clearAppBadge" in navigator) {
  navigator.clearAppBadge().catch((error) => console.log("Erreur badge", error));
}

window.showToast = function(message, type = 'success') {
    const snackbar = document.getElementById('snackbar');
    if (!snackbar) return;
    const msgEl = document.getElementById('snackbar-message');
    const iconEl = document.getElementById('snackbar-icon');

    msgEl.innerText = message;
    iconEl.className = type === 'error' ? 'fas fa-exclamation-circle text-red-500 text-xl' : 'fas fa-check-circle text-green-400 text-xl';

    snackbar.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => snackbar.classList.add('translate-y-24', 'opacity-0'), 3000);
};

setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('opacity-0');
        setTimeout(() => splash.remove(), 500);
    }
}, 800);