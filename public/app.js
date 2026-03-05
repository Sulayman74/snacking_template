// 1. Service Worker (PWA)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.log(err));
}

// 2. Fonction globale pour changer de vue (Accueil <-> Carte)
window.switchView = function (viewName) {
  const fullMenu = document.getElementById("full-menu");
  const body = document.body;
  if (!fullMenu) return;

  if (viewName === "menu") {
    fullMenu.classList.remove("hidden");
    body.style.overflow = "hidden"; // Bloque le scroll
  } else {
    fullMenu.classList.add("hidden");
    body.style.overflow = ""; // Réactive le scroll
  }
};

document.addEventListener("DOMContentLoaded", () => {
  // ------------------------------------------------------------
  // SÉCURITÉ : Vérif Config
  // ------------------------------------------------------------
  if (typeof snackConfig === "undefined") {
    console.error("Config introuvable !");
    return;
  }
  const cfg = snackConfig;
  const body = document.body;

  // ------------------------------------------------------------
  // 1. THÈME & IDENTITÉ (Le retour des couleurs !)
  // ------------------------------------------------------------
  document.title = cfg.identity.name;

  // Fond global & Nav
  if (cfg.theme.templateId === "neon-vibes") {
    body.classList.add("bg-gray-900", "text-white");
    const nav = document.getElementById("navbar");
    if (nav) nav.classList.add("bg-gray-900/90", "backdrop-blur");
  } else {
    body.classList.add("bg-gray-50", "text-gray-900");
    const nav = document.getElementById("navbar");
    if (nav) nav.classList.add("bg-white/90", "backdrop-blur", "shadow-sm");
  }

  // Textes Hero
  document.getElementById("nav-name").innerText = cfg.identity.name;
  document.getElementById("hero-title").innerText = cfg.identity.name;
  document.getElementById("hero-desc").innerText = cfg.identity.description;

  // IMAGE HERO (C'était le bug manquant !)
  const heroSection = document.getElementById("hero");
  if (heroSection) {
    const bgImage = cfg.theme.heroImage || "assets/heroImg.webp";
    heroSection.style.backgroundImage = `url('${bgImage}')`;
  }

  // COULEURS DES BOUTONS (C'était aussi manquant)
  const primaryBtns = [
    document.getElementById("cta-nav"),
    document.getElementById("cta-hero"),
    document.getElementById("btn-submit-form"), // Bouton formulaire
  ];
  primaryBtns.forEach((btn) => {
    if (btn) {
      // On ajoute la couleur primaire définie dans la config (ex: bg-red-600)
      btn.className += ` ${cfg.theme.colors.primary} text-white`;
    }
  });

  // Logo
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
        const isPop = item.tags && item.tags.includes("Populaire");
        // On affiche si c'est Populaire OU si on a moins de 3 items au total
        if ((isPop || count < 3) && count < 3) {
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
      const catDiv = document.createElement("div");
      // Récupère la couleur secondaire pour la bordure (ex: border-yellow-400)
      const borderColor = cfg.theme.colors.secondary.replace("bg-", "border-");

      catDiv.innerHTML = `
                <div class="flex items-center gap-3 mb-6 sticky top-0 bg-white/95 backdrop-blur py-4 z-10">
                    <span class="text-3xl">${cat.icon || ""}</span>
                    <h3 class="text-2xl font-bold uppercase border-b-2 ${borderColor} pb-2 text-black">
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
  // 4. SMART CTA (Uber vs Téléphone)
  // ------------------------------------------------------------
  const ctaBtn = document.getElementById("mobile-cta-btn");
  const ctaIcon = document.getElementById("mobile-cta-icon");

  if (ctaBtn && ctaIcon) {
    if (cfg.features.enableDelivery === true) {
      // Mode Livraison
      ctaBtn.href = cfg.deliveryUrl || "#";
      ctaIcon.className = "fas fa-motorcycle text-2xl";
    } else {
      // Mode Téléphone
      const phone = cfg.contact.phone.replace(/\s/g, "");
      ctaBtn.href = `tel:${phone}`;
      ctaBtn.removeAttribute("target");
      // Force le vert pour l'appel
      ctaBtn.classList.remove(cfg.theme.colors.primary.split(" ")[0]); // Retire le rouge
      ctaBtn.classList.add("bg-green-600");
      ctaIcon.className = "fas fa-phone text-2xl animate-pulse";
    }
  }

  // ------------------------------------------------------------
  // 5. MENU MOBILE (Le Burger !)
  // ------------------------------------------------------------
  const mobileBtn = document.getElementById("mobile-menu-btn");
  const mobileOverlay = document.getElementById("mobile-menu-overlay");
  const mobileLinks = document.querySelectorAll(".mobile-link");

  if (mobileBtn && mobileOverlay) {
    const icon = mobileBtn.querySelector("i");

    // Clic sur le bouton burger
    mobileBtn.addEventListener("click", () => {
      const isClosed = mobileOverlay.classList.contains("hidden");
      if (isClosed) {
        // Ouvrir
        mobileOverlay.classList.remove("hidden");
        setTimeout(() => {
          mobileOverlay.classList.remove("opacity-0");
          mobileOverlay.classList.add("flex", "opacity-100");
        }, 10);
        icon.classList.remove("fa-bars");
        icon.classList.add("fa-times");
        body.style.overflow = "hidden";
      } else {
        // Fermer
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

    // Fermer quand on clique sur un lien
    mobileLinks.forEach((link) => {
      link.addEventListener("click", () => mobileBtn.click());
    });
  }
  // --- NAVIGATION MOBILE (Tab Bar iOS) ---
  const mobileHomeBtn = document.getElementById("mobile-link-home");
  if (mobileHomeBtn) {
    mobileHomeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      switchView("home");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // ------------------------------------------------------------
  // 6. LOGIQUE AVIS & FORMULAIRE
  // ------------------------------------------------------------
  // Activation Formulaire
  if (cfg.form && cfg.form.enable) {
    const contactSection = document.getElementById("contact");
    if (contactSection) {
      contactSection.classList.remove("hidden");
      document.getElementById("form-title").innerText = cfg.form.title;
      document.getElementById("form-desc").innerText = cfg.form.description;
      document.getElementById("contact-form").action = cfg.form.formspreeUrl;
    }
  }

  // Activation Avis
  if (cfg.reviews && cfg.reviews.enable) {
    const reviewSection = document.getElementById("reviews");
    if (reviewSection) reviewSection.classList.remove("hidden");

    // Logique Etoiles
    const starsContainer = document.getElementById("interactive-stars");
    const feedbackText = document.getElementById("rating-feedback");

    if (starsContainer) {
      const stars = starsContainer.querySelectorAll("i");
      stars.forEach((star) => {
        star.addEventListener("click", function () {
          const val = parseInt(this.getAttribute("data-value"));

          // Colorier
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

          // Action
          if (val >= 4) {
            feedbackText.innerHTML = `<span class="text-green-600 font-bold">Top ! On va sur Google... 🚀</span>`;
            setTimeout(
              () => window.open(cfg.reviews.googleMapsReviewLink, "_blank"),
              1000,
            );
          } else {
            feedbackText.innerHTML = `<span class="text-orange-500 font-bold">Dites-nous tout ci-dessous 👇</span>`;
            const sourceAvis = document.getElementById("source-avis");
            if (sourceAvis) sourceAvis.value = `Note: ${val}/5`;
            setTimeout(
              () =>
                document
                  .getElementById("contact")
                  .scrollIntoView({ behavior: "smooth" }),
              500,
            );
          }
        });
      });
    }
  }

  // ------------------------------------------------------------
  // 7. FOOTER GPS & HORAIRES
  // ------------------------------------------------------------
  const footerAddr = document.getElementById("footer-address");
  if (footerAddr) {
    const fullAddr = `${cfg.contact.address.street}, ${cfg.contact.address.city}`;
    // Détection Mac/iOS pour Apple Plans
    const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);

    // Construction lien
    let mapLink;
    if (cfg.contact.address.googleMapsUrl) {
      mapLink = cfg.contact.address.googleMapsUrl;
    } else {
      const query = encodeURIComponent(fullAddr);
      mapLink = isApple
        ? `http://maps.apple.com/?q=${query}`
        : `https://www.google.com/maps/search/?api=1&query=${query}`;
    }

    const iconClass = isApple ? "fa-map" : "fa-location-dot";

    footerAddr.innerHTML = `
            <a href="${mapLink}" target="_blank" class="flex items-start gap-2 hover:text-red-500 group">
                <i class="fas ${iconClass} mt-1 text-red-600 group-hover:text-red-500"></i>
                <span>${cfg.contact.address.street}<br>${cfg.contact.address.zip} ${cfg.contact.address.city}</span>
            </a>`;
  }
  document.getElementById("footer-phone").innerText = cfg.contact.phone;

  // Horaires
  const hoursList = document.getElementById("hours-list");
  if (hoursList) {
    const todayIndex = new Date().getDay(); // 0=Dimanche
    const todayMap = todayIndex === 0 ? 6 : todayIndex - 1; // 0=Lundi pour notre tableau

    cfg.hours.forEach((h, index) => {
      const isToday = index === todayMap;
      const li = document.createElement("li");
      // Couleur secondaire pour le jour actuel
      const textColor = cfg.theme.colors.secondary.replace("bg-", "text-");

      li.className = isToday ? `font-bold ${textColor}` : "";
      li.innerHTML = `<span class="inline-block w-24">${h.day}</span> ${h.closed ? "Fermé" : h.open + " - " + h.close}`;
      hoursList.appendChild(li);

      // Badge Hero
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

  // ------------------------------------------------------------
  // FINAL : AFFICHER LE SITE
  // ------------------------------------------------------------
  setTimeout(() => {
    body.classList.remove("loading");
    body.classList.add("loaded");
  }, 100);
});

// Helper: Création carte produit (Mise à jour)
function createProductCard(item, cfg) {
  const cardBg =
    cfg.theme.templateId === "neon-vibes"
      ? "bg-gray-800"
      : "bg-white shadow-lg border border-gray-100";
  const textColor =
    cfg.theme.templateId === "neon-vibes" ? "text-white" : "text-gray-900";
  const priceColor = cfg.theme.colors.secondary.replace("bg-", "text-");

  const tagHtml =
    item.tags && item.tags.length > 0
      ? `<span class="absolute top-2 right-2 ${cfg.theme.colors.secondary} text-black text-xs font-bold px-2 py-1 rounded-full uppercase shadow-md">${item.tags[0]}</span>`
      : "";

  // NOTEZ LE ONCLICK ICI 👇
  return `
    <div class="${cardBg} rounded-xl overflow-hidden group cursor-pointer" onclick="openProductModal('${item.id}')">
        <div class="h-48 relative overflow-hidden">
            <img src="${item.image}" alt="${item.name}" class="w-full h-full object-cover transition duration-500 group-hover:scale-110">
            ${tagHtml}
        </div>
        <div class="p-5">
            <div class="flex justify-between items-start mb-2">
                <h4 class="text-lg font-bold ${textColor}">${item.name}</h4>
                <span class="text-xl font-bold ${priceColor}">${item.price.toFixed(2)}${cfg.identity.currency}</span>
            </div>
            <p class="text-sm text-gray-400 mb-4 line-clamp-2">${item.description || ""}</p>
            
            <button class="w-full py-3 rounded-lg border border-gray-500 ${textColor} hover:${cfg.theme.colors.primary} hover:border-transparent hover:text-white transition font-bold flex items-center justify-center gap-2">
                <i class="fas fa-eye"></i> Voir le détail
            </button>
        </div>
    </div>`;
}

// --- GESTION DU MODAL PRODUIT ---

window.openProductModal = function (itemId) {
  const cfg = snackConfig;
  let item = null;

  // 1. On cherche l'item dans la config grâce à son ID
  for (const cat of cfg.menu.categories) {
    const found = cat.items.find((i) => i.id === itemId);
    if (found) {
      item = found;
      break;
    }
  }

  if (!item) return; // Sécurité

  // 2. On remplit le HTML
  document.getElementById("modal-img").src = item.image;
  document.getElementById("modal-title").innerText = item.name;
  document.getElementById("modal-price").innerText =
    item.price.toFixed(2) + cfg.identity.currency;
  document.getElementById("modal-desc").innerText = item.description;

  // Tags
  const tagsContainer = document.getElementById("modal-tags");
  tagsContainer.innerHTML = "";
  if (item.tags) {
    item.tags.forEach((tag) => {
      tagsContainer.innerHTML += `<span class="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm font-bold">${tag}</span>`;
    });
  }

  // Allergènes
  const allergenContainer = document.getElementById(
    "modal-allergens-container",
  );
  if (item.allergens && item.allergens.length > 0) {
    allergenContainer.classList.remove("hidden");
    document.getElementById("modal-allergens").innerText =
      item.allergens.join(", ");
  } else {
    allergenContainer.classList.add("hidden");
  }

  // Bouton d'action (Appel)
  const btn = document.getElementById("modal-cta");
  const phone = cfg.contact.phone.replace(/\s/g, "");
  btn.href = `tel:${phone}`;
  // On peut changer le texte pour "Commander le [Nom du produit]"
  btn.innerHTML = `<i class="fas fa-phone mr-2"></i> Commander "${item.name}"`;
  // Appliquer la couleur primaire
  btn.className = `block w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg hover:scale-[1.02] transition-transform ${cfg.theme.colors.primary}`;

  // 3. Animation d'ouverture
  const backdrop = document.getElementById("product-modal-backdrop");
  const sheet = document.getElementById("product-modal");

  // Afficher backdrop
  backdrop.classList.remove("hidden");
  setTimeout(() => backdrop.classList.remove("opacity-0"), 10); // Fade in

  // Monter le menton
  sheet.classList.remove("translate-y-full");

  // Bloquer le scroll derrière
  document.body.style.overflow = "hidden";
};

window.closeProductModal = function () {
  const backdrop = document.getElementById("product-modal-backdrop");
  const sheet = document.getElementById("product-modal");

  // Descendre le menton
  sheet.classList.add("translate-y-full");

  // Fade out backdrop
  backdrop.classList.add("opacity-0");

  // Cacher après l'animation (300ms)
  setTimeout(() => {
    backdrop.classList.add("hidden");
    document.body.style.overflow = ""; // Réactiver le scroll
  }, 300);
};
// ------------------------------------------------------------
// EFFACER LE BADGE DE NOTIFICATION A L'OUVERTURE
// ------------------------------------------------------------
if ("clearAppBadge" in navigator) {
  navigator.clearAppBadge().catch((error) => {
    console.log("Erreur lors de la suppression du badge", error);
  });
}
