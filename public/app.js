// ============================================================================
// GESTION DU SERVICE WORKER (PWA) & MODE DEV
// ============================================================================
const isLocalhost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

if ("serviceWorker" in navigator) {
  if (!isLocalhost) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((registration) =>
          console.log("✅ Service Worker enregistré.", registration.scope),
        )
        .catch((error) => console.error("❌ Erreur Service Worker", error));
    });
  } else {
    console.log("🛠️ Mode Dev : Nettoyage des SW (Sauf Firebase)...");
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      for (let registration of registrations) {
        const swUrl = registration.active?.scriptURL || "";
        if (!swUrl.includes("firebase-messaging-sw")) {
          registration.unregister();
          console.log("🗑️ Ancien SW de cache supprimé.");
        }
      }
    });
  }
}

// ============================================================================
// 2. INITIALISATION DYNAMIQUE
// ============================================================================
let menuGlobal = [];

window.initAppVisuals = async () => {
  const cfg = window.snackConfig;
  if (!cfg) return;

  console.log("🚀 Initialisation du Dashboard SaaS...");

  // 1. Appliquer le thème global
  const body = document.body;
  if (cfg.theme.templateId === "neon-vibes") {
    body.classList.add("bg-gray-900", "text-white");
  } else {
    body.classList.add("bg-gray-50", "text-gray-900");
  }

// 2. Menu Burger, Étoiles & Formulaire
  if (typeof setupMobileMenu === 'function') setupMobileMenu();
  if (typeof setupReviews === 'function') setupReviews(); 
  if (typeof setupContactForm === 'function') setupContactForm(); // 👈 Nouvelle ligne !

  // 🍔 3. CHARGER LE MENU ET LES BEST SELLERS
  await window.chargerMenuComplet();
  
  // 4. Feature Flags (Fidélité & Commandes)
  const features = cfg.features || {};

  // --- SECTION FIDÉLITÉ ---
  const loyaltySection = document.getElementById("loyalty"); 
  const navLoyalty = document.getElementById("nav-loyalty-link"); 
  const mobileLoyalty = document.getElementById("mobile-link-loyalty"); 

  const showLoyalty = features.enableLoyaltyCard !== false;

  if (loyaltySection) loyaltySection.style.display = showLoyalty ? "block" : "none";
  if (navLoyalty) navLoyalty.style.display = showLoyalty ? "inline-block" : "none";
  if (mobileLoyalty) mobileLoyalty.style.display = showLoyalty ? "block" : "none";

  // --- BOUTON COMMANDER ---
  const desktopOrderBtn = document.getElementById("cta-nav"); 
  const mobileOrderBtn = document.getElementById("mobile-cta-btn"); 
  const showOrder = features.enableOnlineOrder !== false;

  if (desktopOrderBtn) desktopOrderBtn.style.display = showOrder ? "inline-block" : "none";
  if (mobileOrderBtn) mobileOrderBtn.style.display = showOrder ? "flex" : "none";

  // 5. Retirer le Splash Screen
  const splash = document.getElementById('splash-screen');
  if (splash) {
    splash.classList.add('opacity-0');
    setTimeout(() => splash.remove(), 500);
  }
};

// ============================================================================
// 3. MOTEUR D'AFFICHAGE DU MENU (Catégories + Best Sellers)
// ============================================================================
window.chargerMenuComplet = async () => {
    const fullMenuContainer = document.getElementById("full-menu-container");
    const bestSellersContainer = document.getElementById("bestsellers-container"); 
    const spinner = document.getElementById("loading-spinner");
    const snackId = window.snackConfig?.identity?.id;

    if (!snackId) return;
    if (spinner) spinner.classList.remove("hidden");

    try {
        const { query, collection, where, getDocs } = window.fs;
        const db = window.db;

        const q = query(collection(db, "produits"), where("snackId", "==", snackId));
        const snapshot = await getDocs(q);

        let tousLesProduits = [];
        menuGlobal = []; 

        snapshot.forEach(doc => {
            const item = { id: doc.id, ...doc.data() };
            tousLesProduits.push(item);
            menuGlobal.push(item); 
        });

        const cfg = window.snackConfig;

        // 🏆 AFFICHER LES BEST SELLERS
        if (bestSellersContainer) {
            bestSellersContainer.innerHTML = "";
            const top3 = [...tousLesProduits]
                .sort((a, b) => (b.ventes || 0) - (a.ventes || 0))
                .slice(0, 3);

            if (top3.length > 0) {
                top3.forEach((item, index) => {
                    bestSellersContainer.innerHTML += `
                        <div class="animate-fade-in-up" style="animation-fill-mode: both; animation-delay: ${index * 150}ms;">
                            ${createProductCard(item, cfg)}
                        </div>`;
                });
            } else {
                bestSellersContainer.innerHTML = "<p class='text-gray-500'>Aucun best-seller.</p>";
            }
        }

        // 🌮 AFFICHER LE MENU PAR CATÉGORIES
        if (fullMenuContainer) {
            fullMenuContainer.innerHTML = "";
            const menuCategories = [
                { id: "tacos", title: "Nos Tacos", icon: "🌮", items: [] },
                { id: "burgers", title: "Burgers", icon: "🍔", items: [] },
                { id: "wraps", title: "Wraps & Sandwichs", icon: "🌯", items: [] },
                { id: "sides", title: "A côté", icon: "🍟", items: [] },
                { id: "drinks", title: "Boissons & Douceurs", icon: "🥤", items: [] }
            ];

            tousLesProduits.forEach(produit => {
                const cat = menuCategories.find(c => c.id === produit.categorieId);
                if (cat) cat.items.push(produit);
            });

            menuCategories.filter(c => c.items.length > 0).forEach((cat, catIndex) => {
                let sectionHTML = `
                <div class="mb-12 animate-fade-in-up" style="animation-fill-mode: both; animation-delay: ${catIndex * 200}ms;">
                    <div class="sticky top-0 z-30 bg-gray-50/95 backdrop-blur-md py-4 flex items-center gap-4 mb-6 shadow-sm -mx-4 px-4 md:mx-0 md:shadow-none md:bg-gray-800/90 md:backdrop-blur md:rounded-lg md:p-2">
                        <span class="text-4xl shadow-sm bg-white dark:bg-gray-800 rounded-full p-2">${cat.icon}</span>
                        <h3 class="text-3xl font-bold font-oswald text-gray-800 dark:text-white uppercase tracking-wider">${cat.title}</h3>
                        <div class="flex-grow h-px bg-gray-200 dark:bg-gray-700 ml-4"></div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                `;

                cat.items.forEach(item => {
                    sectionHTML += createProductCard(item, cfg);
                });

                sectionHTML += `</div></div>`;
                fullMenuContainer.innerHTML += sectionHTML;
            });
        }
    } catch (error) {
        console.error("🔥 Erreur lors du rendu du menu :", error);
    } finally {
        if (spinner) spinner.classList.add("hidden");
    }
};

// ============================================================================
// 4. COMPOSANTS UI (Cartes, Modals, Vues)
// ============================================================================
function createProductCard(item, cfg) {
  const cardBg = cfg.theme.templateId === "neon-vibes" ? "bg-gray-800" : "bg-white shadow-lg border text-black border-gray-100";
  const textColor = cfg.theme.templateId === "neon-vibes" ? "text-white" : "text-gray-900";
  const secondaryBg = (cfg.theme.colors && cfg.theme.colors.secondary) ? cfg.theme.colors.secondary : "bg-yellow-400";
  const priceColor = secondaryBg.replace("bg-", "text-");

  const isAvailable = item.isAvailable !== false;
  const imageOpacity = isAvailable ? "group-hover:scale-110" : "opacity-50 grayscale";
  const cardOpacity = isAvailable ? "cursor-pointer" : "cursor-not-allowed opacity-70";
  const clickAction = isAvailable ? `onclick="openProductModal('${item.id || item.nom}')"` : `onclick="showToast('Produit momentanément indisponible', 'error')"`;
  
  let tagHtml = "";
  if (!isAvailable) {
      tagHtml = `<span class="absolute top-3 right-3 z-10 bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-full uppercase shadow-lg tracking-wider">Épuisé</span>`;
  } else if (item.tags) {
      let tagText = "";
      if (Array.isArray(item.tags) && item.tags.length > 0) {
          tagText = item.tags[0];
      } else if (typeof item.tags === "string" && item.tags.trim() !== "") {
          tagText = item.tags;
      }
      if (tagText) {
          tagHtml = `<span class="absolute top-3 right-3 z-10 ${secondaryBg} text-black text-xs font-bold px-3 py-1.5 rounded-full uppercase shadow-lg tracking-wider">${tagText}</span>`;
      }
  }

  const devise = item.devise || cfg.identity.currency || "€";
  const prixAffiche = item.prix || item.price || 0;
  const nomAffiche = item.nom || item.name;

  return `
    <div class="${cardBg} rounded-2xl overflow-hidden group ${cardOpacity} transition-all duration-300 hover:shadow-2xl" ${clickAction}>
        <div class="h-48 relative overflow-hidden">
            <img src="${item.image}" alt="${nomAffiche}" loading="lazy" class="w-full h-full object-cover transition duration-700 ${imageOpacity}">
            ${tagHtml}
        </div>
        <div class="p-5 flex flex-col justify-between h-[calc(100%-12rem)]">
            <div>
                <div class="flex justify-between items-start mb-2 gap-2">
                    <h4 class="text-lg font-bold ${textColor} leading-tight">${nomAffiche}</h4>
                    <span class="text-xl font-black ${priceColor} whitespace-nowrap">${parseFloat(prixAffiche).toFixed(2)}${devise}</span>
                </div>
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-6 line-clamp-2">${item.description || ""}</p>
            </div>
            
            <button class="w-full py-3 mt-auto rounded-xl border border-gray-300 dark:border-gray-600 ${textColor} hover:${isAvailable ? (cfg.theme.colors.primary || 'bg-red-600') : ''} hover:border-transparent hover:text-white transition-all font-bold flex items-center justify-center gap-2">
                ${isAvailable ? '<i class="fas fa-eye"></i> Détails' : '<i class="fas fa-ban"></i> Indisponible'}
            </button>
        </div>
    </div>`;
}

window.switchView = function (viewName) {
  const fullMenu = document.getElementById("full-menu");
  if (viewName === "menu") {
    fullMenu.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  } else {
    fullMenu.classList.add("hidden");
    document.body.style.overflow = "";
  }
};

// ============================================================================
// GESTION DU MODAL PRODUIT (Responsive Mobile & Desktop)
// ============================================================================
window.openProductModal = function (itemId) {
  const cfg = window.snackConfig;
  const item = menuGlobal.find((i) => i.id === itemId || i.nom === itemId);
  if (!item) return;

  const devise = item.devise || cfg.identity.currency || "€";
  const prixAffiche = item.prix || item.price || 0;
  const nomAffiche = item.nom || item.name;

  document.getElementById("modal-img").src = item.image;
  document.getElementById("modal-title").innerText = nomAffiche;
  document.getElementById("modal-price").innerText = parseFloat(prixAffiche).toFixed(2) + devise;
  document.getElementById("modal-desc").innerText = item.description || "";

  const tagsContainer = document.getElementById("modal-tags");
  tagsContainer.innerHTML = "";
  if (item.tags) {
      let tagText = Array.isArray(item.tags) ? item.tags[0] : item.tags;
      if (tagText) {
        tagsContainer.innerHTML = `<span class="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm font-bold shadow-sm">${tagText}</span>`;
      }
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
    btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-gray-500 cursor-not-allowed flex justify-center items-center gap-2`;
    btn.removeAttribute("href");
  } else {
    const phone = cfg.contact.phone ? cfg.contact.phone.replace(/\s/g, "") : "";
    btn.href = `tel:${phone}`;
    btn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> Commander au ${cfg.contact.phone || ""}`;
    btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-green-600 hover:bg-green-700 hover:-translate-y-1 transition-all mt-auto flex justify-center items-center gap-2`;
  }

  const backdrop = document.getElementById("product-modal-backdrop");
  const sheet = document.getElementById("product-modal");
  
  backdrop.classList.remove("hidden");
  
  setTimeout(() => {
    backdrop.classList.remove("opacity-0");
    sheet.classList.remove("translate-y-full"); // Mobile
    sheet.classList.remove("md:opacity-0", "md:pointer-events-none", "md:scale-95"); // PC
  }, 10);
  
  document.body.style.overflow = "hidden";
};

window.closeProductModal = function () {
  const backdrop = document.getElementById("product-modal-backdrop");
  const sheet = document.getElementById("product-modal");
  
  sheet.classList.add("translate-y-full"); // Mobile
  sheet.classList.add("md:opacity-0", "md:pointer-events-none", "md:scale-95"); // PC
  backdrop.classList.add("opacity-0");
  
  setTimeout(() => {
    backdrop.classList.add("hidden");
    document.body.style.overflow = "";
  }, 300);
};

if ("clearAppBadge" in navigator) {
  navigator.clearAppBadge().catch((error) => console.log("Erreur badge", error));
}

window.showToast = function (message, type = "success") {
  const snackbar = document.getElementById("snackbar");
  if (!snackbar) return;
  const msgEl = document.getElementById("snackbar-message");
  const iconEl = document.getElementById("snackbar-icon");

  msgEl.innerText = message;
  iconEl.className =
    type === "error"
      ? "fas fa-exclamation-circle text-red-500 text-xl"
      : "fas fa-check-circle text-green-400 text-xl";

  snackbar.classList.remove("translate-y-24", "opacity-0");
  setTimeout(() => snackbar.classList.add("translate-y-24", "opacity-0"), 3000);
};

function setupMobileMenu() {
    const mobileBtn = document.getElementById("mobile-menu-btn");
    const mobileOverlay = document.getElementById("mobile-menu-overlay");
    const mobileLinks = document.querySelectorAll(".mobile-link");

    if (mobileBtn && mobileOverlay) {
        const icon = mobileBtn.querySelector("i");
        
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

// ============================================================================
// GESTION DES ÉTOILES (AVIS CLIENT INTELLIGENT)
// ============================================================================
function setupReviews() {
    const stars = document.querySelectorAll("#interactive-stars i");
    const feedbackText = document.getElementById("rating-feedback");
    const sourceAvisInput = document.getElementById("source-avis");
    const contactSection = document.getElementById("contact");

    stars.forEach(star => {
        star.addEventListener("click", (e) => {
            const val = parseInt(e.target.getAttribute("data-value"));
            
            // 1. On colore les étoiles
            stars.forEach((s, index) => {
                if (index < val) {
                    s.classList.remove("far", "text-gray-300");
                    s.classList.add("fas", "text-yellow-400", "scale-110");
                } else {
                    s.classList.remove("fas", "text-yellow-400", "scale-110");
                    s.classList.add("far", "text-gray-300");
                }
            });

            // 2. LOGIQUE MARKETING (Google Maps vs Formulaire Interne)
            const cfg = window.snackConfig;
            
            // Sécurité : On cherche le lien Google (s'il n'y est pas, on évite le crash)
            const googleReviewLink = cfg?.reviews?.googleMapsReviewLink || cfg?.contact?.address?.googleMapsUrl || null;

            if (val >= 4) {
                // 🌟 SCÉNARIO GAGNANT : Direction Google Maps
                if (feedbackText) {
                    feedbackText.innerHTML = `<span class="text-green-600 font-bold">Top ! On va sur Google... 🚀</span>`;
                }
                
                setTimeout(() => {
                    if (googleReviewLink) {
                        window.open(googleReviewLink, "_blank");
                    } else {
                        // Fallback si tu as oublié de mettre ton lien Google dans Firestore
                        if (feedbackText) feedbackText.innerHTML = `<span class="text-green-600 font-bold">Merci pour votre amour ! ❤️</span>`;
                    }
                }, 1000);

            } else {
                // 🛑 SCÉNARIO CRITIQUE : Interception vers le formulaire privé
                if (feedbackText) {
                    feedbackText.innerHTML = `<span class="text-orange-500 font-bold">Dites-nous tout ci-dessous 👇</span>`;
                }
                
                if (sourceAvisInput) {
                    sourceAvisInput.value = `Note : ${val}/5`;
                }
                
                setTimeout(() => {
                    if (contactSection) {
                        // Fait glisser la page doucement jusqu'au formulaire
                        contactSection.scrollIntoView({ behavior: "smooth" });
                    }
                }, 500);
            }
        });
    });
}
// ============================================================================
// GESTION DU FORMULAIRE DE CONTACT (AJAX / Formspree)
// ============================================================================
function setupContactForm() {
    const contactForm = document.getElementById("contact-form");
    const submitBtn = document.getElementById("btn-submit-form");

    if (contactForm && submitBtn) {
        contactForm.addEventListener("submit", async (e) => {
            e.preventDefault(); // 🛑 Bloque la redirection vers Formspree

            // UX : On montre que ça charge
            const originalText = submitBtn.innerText;
            submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Envoi...`;
            submitBtn.disabled = true;

            try {
                // On envoie les données silencieusement en arrière-plan
                const response = await fetch(contactForm.action, {
                    method: contactForm.method,
                    body: new FormData(contactForm),
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                if (response.ok) {
                    // 🎉 SUCCÈS : On vide le formulaire !
                    contactForm.reset();
                    
                    // On remet le champ caché à sa valeur par défaut
                    const sourceAvisInput = document.getElementById("source-avis");
                    if (sourceAvisInput) sourceAvisInput.value = "contact_direct";

                    // On éteint les étoiles si elles étaient allumées
                    const stars = document.querySelectorAll("#interactive-stars i");
                    stars.forEach(s => {
                        s.classList.remove("fas", "text-yellow-400", "scale-110");
                        s.classList.add("far", "text-gray-300");
                    });
                    const feedback = document.getElementById("rating-feedback");
                    if (feedback) feedback.innerText = "";

                    // Notification
                    window.showToast("Message envoyé avec succès ! Merci.", "success");
                } else {
                    window.showToast("Oups, une erreur est survenue.", "error");
                }
            } catch (error) {
                console.error("Erreur d'envoi du formulaire :", error);
                window.showToast("Erreur de connexion.", "error");
            } finally {
                // On remet le bouton à son état normal
                submitBtn.innerText = originalText;
                submitBtn.disabled = false;
            }
        });
    }
}