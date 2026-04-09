// import "./bridge.js";
import "./firebase-init.js";
import "./snack-config.js";

import { escapeHTML } from "./utils.js";

// ==========================================
// 🎮 LE ROUTEUR D'ÉVÉNEMENTS CLIENT (Event Delegation)
// ==========================================
// 🚦 FUTURE MODULE : router.js (Le routeur d'événements - Event Delegation)
document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return; 

    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-id');

    switch(action) {

      case 'switch-home':
            if (typeof window.triggerVibration === "function") window.triggerVibration("light");
            switchView('home');
            break;
            
        case 'switch-menu':
            if (typeof window.triggerVibration === "function") window.triggerVibration("light");
            switchView('menu');
            break;
            
        case 'open-product-modal':
            openProductModal(id);
            break;
            
        case 'update-qty':
            const delta = parseInt(target.getAttribute('data-delta'));
            updateQuantity(id, delta);
            break;
            
        case 'error-toast':
            const message = target.getAttribute('data-message');
            window.showToast(message, "error");
            break;
        case 'open-cart':
            openCartModal();
            break;

        case 'close-cart':
            closeCartModal();
            break;

        case 'process-checkout':
            processCheckout();
            break;
    }
});

// ==========================================
// 💳 VARIABLES STRIPE GLOBALES
// ==========================================
let stripeElements = null;
let stripeInstance = null;
const stripePublicKey = "pk_test_51TG1RfIfiBxoqwsycKUz6o8Mxf5keYpRfFPCgbDE2GkQiz4USCS5tE0lQaO160YDBoXb6mDgWzgzvbosexR6ORKn002PFzjj7J"; // ⚠️ REMPLACE PAR TA CLÉ PUBLIQUE STRIPE (pk_test_...)

// ============================================================================
// 2. INITIALISATION DYNAMIQUE
// ============================================================================
let menuGlobal = [];

window.initAppVisuals = async () => {
  const cfg = window.snackConfig;
  if (!cfg) return;

  // =======================================================================
  // 🛑 LE COUPE-CIRCUIT (MODE MAINTENANCE)
  // =======================================================================
  if (cfg.features && cfg.features.maintenanceMode === true) {
    console.log("🛑 Site en maintenance ! Arrêt du chargement visuel.");

    // On efface littéralement tout le contenu de la page et on met un écran de blocage
    document.body.innerHTML = `
          <div class="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white px-4 text-center">
              <i class="fas fa-tools text-6xl text-red-500 mb-6 animate-pulse"></i>
              <h1 class="text-4xl font-black tracking-widest uppercase mb-4">${cfg.identity.name}</h1>
              <p class="text-gray-400 text-lg max-w-md">Notre site est actuellement en cours de mise à jour. Nous revenons très vite pour prendre vos commandes !</p>
          </div>
      `;
    // On stoppe l'exécution de TOUT le reste de la fonction (Pas de chargement de menu, etc.)
    return;
  }
  // =======================================================================

  // 1. Appliquer le thème global
  const body = document.body;
  if (cfg.theme.templateId === "classic") {
    body.classList.add("bg-gray-900", "text-white");
  } else {
    body.classList.add("bg-gray-50", "text-gray-900");
  }

  const fontClass = cfg.theme.fontFamily || "font-sans";
  body.classList.add(fontClass);

  // 2. Menu Burger, Étoiles & Formulaire
  if (typeof setupMobileMenu === "function") setupMobileMenu();
  if (typeof setupReviews === "function") setupReviews();
  if (typeof setupContactForm === "function") setupContactForm();
  if (typeof setupPullToRefresh === "function") setupPullToRefresh();
  if (typeof setupSmartReviewPrompt === "function") setupSmartReviewPrompt();

  // 🍔 3. CHARGER LE MENU ET LES BEST SELLERS
  await window.chargerMenuComplet();

  // 4. Feature Flags (Fidélité & Commandes)
  const features = cfg.features || {};

  // --- SECTION FIDÉLITÉ ---
  const loyaltySection = document.getElementById("loyalty");
  const navLoyalty = document.getElementById("nav-loyalty-link");
  const mobileLoyalty = document.getElementById("mobile-link-loyalty");

  const showLoyalty = features.enableLoyaltyCard !== false;

  if (loyaltySection)
    loyaltySection.style.display = showLoyalty ? "block" : "none";
  if (navLoyalty)
    navLoyalty.style.display = showLoyalty ? "inline-block" : "none";
  if (mobileLoyalty)
    mobileLoyalty.style.display = showLoyalty ? "block" : "none";

  // --- BOUTON COMMANDER ---
  const desktopOrderBtn = document.getElementById("cta-nav");
  const mobileOrderBtn = document.getElementById("mobile-cta-btn");
  const showOrder = features.enableOnlineOrder !== false;

  if (desktopOrderBtn)
    desktopOrderBtn.style.display = showOrder ? "inline-block" : "none";
  if (mobileOrderBtn)
    mobileOrderBtn.style.display = showOrder ? "flex" : "none";

  const floatingCartContainer = document.getElementById(
    "floating-cart-container",
  );
  const isCartActive = features && features.enableClickAndCollect === true;

  if (floatingCartContainer) {
    if (isCartActive) {
      floatingCartContainer.classList.remove("hidden"); // On affiche le panier
    } else {
      floatingCartContainer.classList.add("hidden"); // On cache le panier
    }
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

    const q = query(
      collection(db, "produits"),
      where("snackId", "==", snackId),
    );
    // On attend la réponse de Firebase (Pendant ce temps, les Skeletons HTML sont visibles)
    const snapshot = await getDocs(q);

    let tousLesProduits = [];
    menuGlobal = [];

    snapshot.forEach((doc) => {
      const item = { id: doc.id, ...doc.data() };
      tousLesProduits.push(item);
      menuGlobal.push(item);
    });

    const cfg = window.snackConfig;

    // 🏆 AFFICHER LES BEST SELLERS (Méthode Hybride)
    if (bestSellersContainer) {
      bestSellersContainer.innerHTML = "";

      const top3 = [...tousLesProduits]
        .sort((a, b) => {
          // 1. On vérifie si les produits ont un tag "Star", "Populaire" ou "Best"
          const aTags = Array.isArray(a.tags)
            ? a.tags.join(" ").toLowerCase()
            : (a.tags || "").toLowerCase();
          const bTags = Array.isArray(b.tags)
            ? b.tags.join(" ").toLowerCase()
            : (b.tags || "").toLowerCase();

          const isAStar =
            aTags.includes("star") ||
            aTags.includes("populaire") ||
            aTags.includes("nouveau");
          const isBStar =
            bTags.includes("star") ||
            bTags.includes("populaire") ||
            bTags.includes("nouveau");

          // 2. Priorité absolue au tag manuel !
          if (isAStar && !isBStar) return -1; // A passe devant
          if (!isAStar && isBStar) return 1; // B passe devant

          // 3. S'ils sont à égalité (tous les 2 tagués, ou aucun tagué),
          // l'algorithme tranche avec le nombre de ventes sur l'app.
          return (b.ventes || 0) - (a.ventes || 0);
        })
        .slice(0, 3);

      if (top3.length > 0) {
        top3.forEach((item, index) => {
          bestSellersContainer.innerHTML += `
                        <div class="animate-fade-in-up" style="animation-fill-mode: both; animation-delay: ${index * 150}ms;">
                            ${createProductCard(item, cfg)}
                        </div>`;
        });
      } else {
        bestSellersContainer.innerHTML =
          "<p class='text-gray-500'>Aucun best-seller.</p>";
      }
    }

    // 🌮 AFFICHER LE MENU PAR CATÉGORIES (Version 100% Dynamique SaaS)
    if (fullMenuContainer) {
      fullMenuContainer.innerHTML = "";

      // 🛑 ON A SUPPRIMÉ LE TABLEAU EN DUR ICI !

      // ✅ 1. ON SCANNE LES PRODUITS ET ON CRÉE LES CATÉGORIES À LA VOLÉE
      const categoriesMap = new Map();

      tousLesProduits.forEach((produit) => {
        if (!produit.categorieId) return; // Sécurité si un produit est mal configuré

        // Si on découvre une nouvelle catégorie, on la crée dans notre dictionnaire
        if (!categoriesMap.has(produit.categorieId)) {
          categoriesMap.set(produit.categorieId, {
            id: produit.categorieId,
            title: produit.categorieTitre || produit.categorieId, // Titre du produit
            icon: produit.icon || "🍽️", // Icône du produit (ou fallback)
            items: [],
          });
        }

        // 2. ON RANGE LE PRODUIT DANS SA CATÉGORIE
        categoriesMap.get(produit.categorieId).items.push(produit);
      });

      // 3. ON TRANSFORME LE DICTIONNAIRE EN TABLEAU
      let menuCategories = Array.from(categoriesMap.values());

      // 🎯 OPTIONNEL MAIS RECOMMANDÉ : FORCER L'ORDRE D'AFFICHAGE
      // Même si c'est dynamique, tu veux sûrement que les Tacos s'affichent avant les Desserts.
      const ordreVoulu = [
        "tacos",
        "burgers",
        "wraps",
        "pizzas",
        "sides",
        "drinks",
        "deserts",
      ];
      menuCategories.sort((a, b) => {
        let indexA = ordreVoulu.indexOf(a.id);
        let indexB = ordreVoulu.indexOf(b.id);
        if (indexA === -1) indexA = 999; // Si une nouvelle catégorie (ex: "sushis") apparaît, on la met à la fin
        if (indexB === -1) indexB = 999;
        return indexA - indexB;
      });

      // 4. ON AFFICHE LE HTML (Ton code existant ne change pas !)
      menuCategories
        .filter((c) => c.items.length > 0)
        .forEach((cat, catIndex) => {
          let sectionHTML = `
                <div class="mb-12 animate-fade-in-up" style="animation-fill-mode: both; animation-delay: ${catIndex * 200}ms;">
                    <div class="sticky top-0 z-30 bg-gray-300/80 backdrop-blur-md py-4 flex items-center mb-6 shadow-sm -mx-4 px-4 md:mx-1 md:shadow-none rounded-full md:p-2">
                        <span class="md:text-4xl text-lg text-black mr-1">${cat.icon}</span>
                        <h3 class="text-xl md:text-3xl font-bold font-oswald text-gray-800 uppercase tracking-wider">${cat.title}</h3>
                        <div class="flex-grow h-px ${cfg.theme.colors.primary} ml-4 opacity-50"></div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                `;

          cat.items.forEach((item) => {
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
  const cardBg =
    cfg.theme.templateId === "classic"
      ? "bg-gray-800"
      : "bg-white shadow-lg border text-black border-gray-100";
  const textColor =
    cfg.theme.templateId === "classic" ? "text-white" : "text-gray-900";
  const secondaryBg =
    cfg.theme.colors && cfg.theme.colors.lightBg
      ? cfg.theme.colors.lightBg
      : "bg-yellow-400";
  const priceColor = cfg.theme.colors.accent;
  const textOnPrimary = cfg.theme.colors.textOnPrimary || "bg-gray-500";

  const isAvailable = item.isAvailable !== false;
  const imageOpacity = isAvailable
    ? "group-hover:scale-110"
    : "opacity-50 grayscale";
  const cardOpacity = isAvailable
    ? "cursor-pointer"
    : "cursor-not-allowed opacity-70";
  const clickAction = isAvailable
    ? `data-action="open-product-modal" data-id="${item.id || item.nom}"`
    : `data-action="error-toast" data-message="Produit momentanément indisponible"`;

  let tagHtml = "";
  if (!isAvailable) {
    tagHtml = `<span class="absolute top-3 right-3 z-10 bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-full uppercase shadow-lg tracking-wider">Épuisé</span>`;
  } else if (item.tags) {
    let tagText = "";
    if (Array.isArray(item.tags) && item.tags.length > 0) {
      tagText = escapeHTML(item.tags[0]); // 👈 Nettoyé !
    } else if (typeof item.tags === "string" && item.tags.trim() !== "") {
     tagText = escapeHTML(item.tags);
    }
    if (tagText) {
      tagHtml = `<span class="absolute top-3 right-3 z-10 ${cardBg} ${textColor} text-xs font-bold px-3 py-1.5 rounded-full uppercase shadow-lg tracking-wider">${tagText}</span>`;
    }
  }

  const devise = item.devise || cfg.identity.currency || "€";
  const prixAffiche = item.prix || item.price || 0;
const nomAffiche = escapeHTML(item.nom || item.name);
const descriptionAffiche = escapeHTML(item.description || "");

  // Création du Fallback minimaliste avec icône + gestion des images cassées (onerror)
  const imageUrl = item.image && item.image.trim() !== "" ? item.image : null;

  // Le bloc HTML de remplacement (juste une icône centrée, pas de texte lourd)
  const fallbackHtml = `
      <div class="absolute inset-0 flex items-center justify-center ${secondaryBg} z-0 transition duration-700 ${imageOpacity}">
          <i class="fas fa-hamburger text-6xl text-black opacity-50"></i>
      </div>`;

  // Astuce : onerror affiche le div fallback caché juste en dessous si l'image est cassée en BDD
  const imageHtml = imageUrl
    ? `<img src="${imageUrl}" alt="${nomAffiche}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="absolute inset-0 w-full h-full object-cover transition duration-700 ${imageOpacity} z-0">
       <div style="display: none;" class="absolute inset-0 items-center justify-center ${secondaryBg} z-0 transition duration-700 ${imageOpacity}">
           <i class="fas fa-hamburger text-6xl text-black opacity-50"></i>
       </div>`
    : fallbackHtml;

  return `
    <div class="${cardBg} h-full flex flex-col rounded-2xl overflow-hidden group ${cardOpacity} transition-all duration-300 hover:shadow-2xl" ${clickAction}>
        
        <div class="h-48 shrink-0 relative overflow-hidden ${secondaryBg}">
            ${imageHtml}
            ${tagHtml}
        </div>
        
        <div class="p-5 flex-1 flex flex-col justify-between">
            <div>
                <div class="flex justify-between items-start mb-2 gap-2">
                    <h2 class="text-lg font-bold ${textColor} leading-tight">${nomAffiche}</h2>
                    <span class="text-xl font-black ${priceColor} whitespace-nowrap">${parseFloat(prixAffiche).toFixed(2)}${devise}</span>
                </div>
                <p class="text-sm text-gray-400 mb-6 line-clamp-2">${item.description || ""}</p>
            </div>
            
            <button class="w-full py-3 mt-auto rounded-xl border border-gray-300 dark:border-gray-600 ${textColor} hover:${isAvailable ? cfg.theme.colors.primary : ""} hover:border-transparent hover:text-white transition-all font-bold flex items-center justify-center gap-2">
                ${isAvailable ? '<i class="fas fa-eye"></i> Détails' : '<i class="fas fa-ban"></i> Indisponible'}
            </button>
        </div>
    </div>`;
}

// ============================================================================
// 🔍 4.5 MOTEUR DE RECHERCHE EN MÉMOIRE (0 FIRESTORE)
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("menu-search-input");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  const fullMenuContainer = document.getElementById("full-menu-container");
  const bestSellersContainer = document.getElementById("bestsellers-container");

  // On crée dynamiquement le conteneur des résultats juste avant le menu complet
  let searchResultsContainer = document.getElementById(
    "search-results-container",
  );
  if (!searchResultsContainer && fullMenuContainer) {
    searchResultsContainer = document.createElement("div");
    searchResultsContainer.id = "search-results-container";
    searchResultsContainer.className =
      "hidden grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12";
    fullMenuContainer.parentNode.insertBefore(
      searchResultsContainer,
      fullMenuContainer,
    );
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();
      const cfg = window.snackConfig;

      // Si on tape quelque chose
      if (searchTerm.length > 0) {
        clearSearchBtn.classList.remove("hidden");

        // 1. On cache les best-sellers et le menu normal
        if (fullMenuContainer) fullMenuContainer.classList.add("hidden");
        if (bestSellersContainer && bestSellersContainer.parentElement) {
          bestSellersContainer.parentElement.classList.add("hidden");
        }

        // 2. On affiche le conteneur de résultats
        searchResultsContainer.classList.remove("hidden");

        // 3. Le Filtre Magique (On cherche dans le tableau menuGlobal)
        const resultats = menuGlobal.filter((produit) => {
          const nom = produit.nom ? produit.nom.toLowerCase() : "";
          const desc = produit.description
            ? produit.description.toLowerCase()
            : "";
          const tags = produit.tags
            ? (Array.isArray(produit.tags)
                ? produit.tags.join(" ")
                : produit.tags
              ).toLowerCase()
            : "";

          return (
            nom.includes(searchTerm) ||
            desc.includes(searchTerm) ||
            tags.includes(searchTerm)
          );
        });

        // 4. On affiche les cartes produits (en réutilisant TA fonction !)
        if (resultats.length === 0) {
          searchResultsContainer.innerHTML = `
                        <div class="col-span-full text-center py-12">
                            <div class="text-6xl mb-4">🕵️‍♂️</div>
                            <h3 class="text-xl font-black text-gray-800">Aucun résultat</h3>
                            <p class="text-gray-500 mt-2">Nous n'avons rien trouvé pour "${e.target.value}"</p>
                        </div>
                    `;
        } else {
          // C'est ici la magie : on génère les cartes avec ton thème actuel !
          searchResultsContainer.innerHTML = resultats
            .map((item) => createProductCard(item, cfg))
            .join("");
        }
      } else {
        // Si la barre de recherche est VIDE : On remet tout à la normale !
        clearSearchBtn.classList.add("hidden");
        if (fullMenuContainer) fullMenuContainer.classList.remove("hidden");
        if (bestSellersContainer && bestSellersContainer.parentElement) {
          bestSellersContainer.parentElement.classList.remove("hidden");
        }
        searchResultsContainer.classList.add("hidden");
        searchResultsContainer.innerHTML = "";
      }
    });

    // Bouton "X" pour vider la recherche
    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      // On déclenche manuellement l'événement 'input' pour simuler une recherche vide
      searchInput.dispatchEvent(new Event("input"));
      searchInput.focus();
    });
  }
});

function switchView (viewName, ignoreHistory = false) {
  // 1. Sélection des éléments
  const fullMenu = document.getElementById("full-menu");
  const mobileOverlay = document.getElementById("mobile-menu-overlay");
  const mobileBtnIcon = document.querySelector("#mobile-menu-btn i");
  const navIndicator = document.getElementById("nav-indicator");
  const btnHome = document.getElementById("nav-btn-home");
  const btnMenu = document.getElementById("nav-btn-menu");

  // 2. Nettoyage global (Reset des états UI & A11y)
  const btns = [btnHome, btnMenu];
  btns.forEach(btn => {
    if (!btn) return;
    btn.classList.remove("is-active", "text-white");
    btn.classList.add("text-gray-200"); // Meilleur contraste que gray-400 pour Lighthouse
    btn.setAttribute("aria-selected", "false");
  });

  if (viewName === "menu") {
    // --- MODE MENU ---
    if (navIndicator) navIndicator.style.transform = "translateX(200%)";
    
    // UI & Accessibilité
    btnMenu?.classList.add("is-active", "text-white");
    btnMenu?.classList.remove("text-gray-200");
    btnMenu?.setAttribute("aria-selected", "true");

    // Affichage de la vue
    fullMenu?.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    // Historique PWA
    if (!ignoreHistory) {
      window.history.pushState({ overlay: 'menu' }, 'Menu', '#menu');
    }

    // Fermeture du menu burger si ouvert
    if (mobileOverlay && !mobileOverlay.classList.contains("hidden")) {
      mobileOverlay.classList.replace("opacity-100", "opacity-0");
      setTimeout(() => {
        mobileOverlay.classList.add("hidden");
        mobileOverlay.classList.remove("flex");
      }, 300);
      mobileBtnIcon?.classList.replace("fa-times", "fa-bars");
    }

  } else {
    // --- MODE ACCUEIL ---
    if (navIndicator) navIndicator.style.transform = "translateX(0%)";
    
    // UI & Accessibilité
    btnHome?.classList.add("is-active", "text-white");
    btnHome?.classList.remove("text-gray-200");
    btnHome?.setAttribute("aria-selected", "true");

    fullMenu?.classList.add("hidden");
    document.body.style.overflow = "";

    // Nettoyage de l'URL
    if (!ignoreHistory && window.location.hash === '#menu') {
      window.history.back(); 
    }

    if (viewName === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
};

/**
 * 💡 BONUS : Gestion du bouton "Précédent" du téléphone (Android/iOS Swipe)
 * Indispensable pour un score A11y parfait et une UX native.
 */
window.addEventListener('popstate', (event) => {
  if (window.location.hash !== '#menu') {
    // Si l'utilisateur fait "retour" alors que le menu est ouvert, on ferme proprement
    window.switchView('home', true); 
  }
});

if ("clearAppBadge" in navigator) {
  navigator
    .clearAppBadge()
    .catch((error) => console.log("Erreur badge", error));
}

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

  stars.forEach((star) => {
    star.addEventListener("click", (e) => {
      const val = parseInt(e.target.getAttribute("data-value"));
      if (typeof window.triggerVibration === "function")
        window.triggerVibration("light");

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
      const googleReviewLink =
        cfg?.reviews?.googleMapsReviewLink ||
        cfg?.contact?.address?.googleMapsUrl ||
        null;

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
            if (feedbackText)
              feedbackText.innerHTML = `<span class="text-green-600 font-bold">Merci pour votre amour ! ❤️</span>`;
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
      const originalText = submitBtn.textContent;
      submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Envoi...`;
      submitBtn.disabled = true;

      try {
        // On envoie les données silencieusement en arrière-plan
        const response = await fetch(contactForm.action, {
          method: contactForm.method,
          body: new FormData(contactForm),
          headers: {
            Accept: "application/json",
          },
        });

        if (response.ok) {
          // 🎉 SUCCÈS : On vide le formulaire !
          contactForm.reset();
          if (typeof window.triggerVibration === "function")
            window.triggerVibration("success");
          // On remet le champ caché à sa valeur par défaut
          const sourceAvisInput = document.getElementById("source-avis");
          if (sourceAvisInput) sourceAvisInput.value = "contact_direct";

          // On éteint les étoiles si elles étaient allumées
          const stars = document.querySelectorAll("#interactive-stars i");
          stars.forEach((s) => {
            s.classList.remove("fas", "text-yellow-400", "scale-110");
            s.classList.add("far", "text-gray-300");
          });
          const feedback = document.getElementById("rating-feedback");
          if (feedback) feedback.textContent = "";

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
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    });
  }
}
// ============================================================================
// 🪄 AUTO-REMPLISSAGE DU FORMULAIRE DE CONTACT (UX)
// ============================================================================
window.prefillContactForm = function(user) {
    const contactField = document.getElementById("contact-field");

    if (!contactField) return; // Sécurité : si on n'est pas sur la page, on s'arrête

    if (user) {
        // Le client est connecté : on cherche son email (ou son téléphone s'il existe)
        const contactInfo = user.email || user.phoneNumber || "";

        if (contactInfo) {
            contactField.value = contactInfo;
            
            // 🔒 Bonus UX : On verrouille le champ pour éviter les fautes de frappe
            contactField.setAttribute("readonly", "true");
            
            // On joue avec tes classes Tailwind pour montrer que c'est grisé
            contactField.classList.remove("bg-gray-50", "text-black", "focus:ring-2");
            contactField.classList.add("bg-gray-200", "text-gray-500", "cursor-not-allowed");
        }
    } else {
        // 🔓 Le client est déconnecté : on vide et on déverrouille le champ
        contactField.value = "";
        contactField.removeAttribute("readonly");
        
        // On remet tes classes Tailwind d'origine
        contactField.classList.remove("bg-gray-200", "text-gray-500", "cursor-not-allowed");
        contactField.classList.add("bg-gray-50", "text-black", "focus:ring-2");
    }
};
// ==========================================
// 👀 GESTION DE L'ŒIL DU MOT DE PASSE
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const togglePasswordBtn = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('auth-password');
    const eyeIcon = document.getElementById('eye-icon');

    if (togglePasswordBtn && passwordInput && eyeIcon) {
        togglePasswordBtn.addEventListener('click', () => {
            // 1. On vérifie l'état actuel
            const isPassword = passwordInput.getAttribute('type') === 'password';
            
            // 2. On inverse le type (text <-> password)
            passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
            
            // 3. On change l'icône FontAwesome (œil ouvert <-> œil barré)
            if (isPassword) {
                eyeIcon.classList.remove('fa-eye');
                eyeIcon.classList.add('fa-eye-slash');
            } else {
                eyeIcon.classList.remove('fa-eye-slash');
                eyeIcon.classList.add('fa-eye');
            }
        });
    }
});

// ==========================================
// 🆘 RÉINITIALISATION DU MOT DE PASSE
// ==========================================
window.resetPassword = async () => {
    const emailInput = document.getElementById("auth-email").value.trim();

    // 1. On vérifie que le client a bien tapé son email
    if (!emailInput) {
        window.showToast("Veuillez d'abord taper votre adresse email dans le champ.", "error");
        document.getElementById("auth-email").focus(); // On met le curseur dans le champ
        if (typeof window.triggerVibration === "function") window.triggerVibration("error");
        return;
    }

    try {
        // 2. On demande à Firebase d'envoyer l'email magique
        const { sendPasswordResetEmail } = window.authTools;
        await sendPasswordResetEmail(window.auth, emailInput);
        
        // 3. Succès !
        window.showToast("Un email de réinitialisation vous a été envoyé ! 📧", "success");
        if (typeof window.triggerVibration === "function") window.triggerVibration("success");
        
    } catch (error) {
        console.error("Erreur reset password :", error);
        // Gestion des erreurs fréquentes
        if (error.code === 'auth/user-not-found') {
            window.showToast("Aucun compte n'est lié à cette adresse email.", "error");
        } else if (error.code === 'auth/invalid-email') {
            window.showToast("L'adresse email n'est pas valide.", "error");
        } else {
            window.showToast("Une erreur est survenue.", "error");
        }
    }
};

// ==========================================
    // 🚀 2. CONNEXION AVEC GOOGLE (FIREBASE)
    // ==========================================
    const btnGoogleLogin = document.getElementById('btn-google-login');
    
    if (btnGoogleLogin) {
        btnGoogleLogin.addEventListener('click', async () => {
            try {
                // On prépare le fournisseur Google
                const provider = new window.authTools.GoogleAuthProvider();
                
                // On lance la popup (ou la redirection sur mobile)
                const result = await window.authTools.signInWithPopup(window.auth, provider);
                const user = result.user;

                // 🎯 VÉRIFICATION FIRESTORE : On s'assure qu'il est bien dans notre base "users"
                const { doc, getDoc, setDoc, serverTimestamp } = window.fs;
                const userRef = doc(window.db, "users", user.uid);
                const userSnap = await getDoc(userRef);

                // Si c'est sa toute première connexion, on crée son profil !
                if (!userSnap.exists()) {
                    await setDoc(userRef, {
                        email: user.email,
                        nom: user.displayName || "Gourmand",
                        points: 0,
                        snackId: window.snackConfig?.identity?.id || "Ym1YiO4Ue5Fb5UXlxr06", // Ton Snack ID
                        dateCreation: serverTimestamp(),
                        role: "client"
                    });
                }

                // Succès !
                if (typeof window.showToast === 'function') {
                    window.showToast("Connexion Google réussie ! 🍔", "success");
                }
                
                // On ferme la modale
                if (typeof window.toggleAuthModal === 'function') {
                    window.toggleAuthModal();
                }

            } catch (error) {
                console.error("❌ Erreur Google Auth:", error);
                if (typeof window.showToast === 'function') {
                    window.showToast("Erreur lors de la connexion Google.", "error");
                }
            }
        });
    }

// ============================================================================
// 📳 MOTEUR DE RETOUR HAPTIQUE (VIBRATIONS PWA)
// ============================================================================
window.triggerVibration = function (type = "light") {
  // 🛡️ SÉCURITÉ : On vérifie si le navigateur supporte les vibrations
  if (!("vibrate" in navigator)) return;

  try {
    switch (type) {
      case "light":
        // Un tout petit clic physique (pour les boutons normaux)
        navigator.vibrate(40);
        break;
      case "success":
        // Double tape rapide (Ex: Scan QR Code réussi, Formulaire envoyé)
        navigator.vibrate([100, 50, 100]);
        break;
      case "error":
        // 3 petits coups rapides (Ex: Erreur de scan, Formulaire vide)
        navigator.vibrate([50, 50, 50, 50, 50]);
        break;
      case "jackpot":
        // Grosse vibration festive (Ex: Le client gagne son menu gratuit !)
        navigator.vibrate([200, 100, 200, 100, 500]);
        break;
    }
  } catch (e) {
    // On ignore silencieusement si le navigateur bloque l'action
    console.log("Vibration bloquée par le navigateur.");
  }
};

// ============================================================================
// 📲 GESTION DE L'INSTALLATION PWA (A2HS)
// ============================================================================
let deferredPrompt;
const installBanner = document.getElementById("pwa-install-banner");
const installBtn = document.getElementById("pwa-install-btn");
const closeBtn = document.getElementById("pwa-close-btn");

// Le navigateur annonce qu'il est prêt à installer l'app
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // On bloque la mini-bannière moche par défaut
  deferredPrompt = e; // On sauvegarde l'événement

  // On affiche notre magnifique bannière après 3 secondes (le temps que le client regarde le menu)
  setTimeout(() => {
    if (installBanner) {
      installBanner.classList.remove("translate-y-32", "opacity-0");
      if (typeof window.triggerVibration === "function")
        window.triggerVibration("light");
    }
  }, 3000);
});

if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (deferredPrompt) {
      installBanner.classList.add("translate-y-32", "opacity-0"); // On cache la bannière
      deferredPrompt.prompt(); // On lance la vraie pop-up d'installation du téléphone
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`Résultat de l'installation : ${outcome}`);
      deferredPrompt = null;
      if (
        outcome === "accepted" &&
        typeof window.triggerVibration === "function"
      ) {
        window.triggerVibration("success");
      }
    }
  });
}

if (closeBtn) {
  closeBtn.addEventListener("click", () => {
    installBanner.classList.add("translate-y-32", "opacity-0");
  });
}

// ============================================================================
// 🔄 PULL-TO-REFRESH NATIF
// ============================================================================
function setupPullToRefresh() {
  const scrollArea = document.getElementById("full-menu");
  const ptrIndicator = document.getElementById("ptr-indicator");
  const ptrIcon = document.getElementById("ptr-icon");
  let touchStartY = 0;
  let isPulling = false;

  if (!scrollArea || !ptrIndicator) return;

  // Le doigt touche l'écran
  scrollArea.addEventListener(
    "touchstart",
    (e) => {
      if (scrollArea.scrollTop === 0) {
        touchStartY = e.touches[0].clientY;
        isPulling = true;
        ptrIndicator.style.transition = "none"; // Suit le doigt parfaitement
      }
    },
    { passive: true },
  );

  // Le doigt glisse
  scrollArea.addEventListener(
    "touchmove",
    (e) => {
      if (!isPulling) return;
      const pullDistance = e.touches[0].clientY - touchStartY;

      // Si on tire vers le bas et qu'on est tout en haut du menu
      if (pullDistance > 0 && scrollArea.scrollTop === 0) {
        // Fait descendre la petite bulle (max 60px)
        const translateY = Math.min(pullDistance / 2, 60);
        ptrIndicator.style.transform = `translate(-50%, calc(-100% + ${translateY}px))`;

        // L'icône tourne selon la force du tirage
        ptrIcon.style.transform = `rotate(${Math.min(pullDistance * 2, 180)}deg)`;

        // Si on tire assez fort, on prévient l'utilisateur que c'est prêt à lâcher
        if (translateY >= 50 && ptrIcon.classList.contains("fa-arrow-down")) {
          ptrIcon.classList.replace("fa-arrow-down", "fa-arrow-up");
          if (typeof window.triggerVibration === "function")
            window.triggerVibration("light");
        }
      }
    },
    { passive: true },
  );

  // Le doigt lâche l'écran
  scrollArea.addEventListener("touchend", async () => {
    if (!isPulling) return;
    isPulling = false;
    ptrIndicator.style.transition = "transform 0.3s ease-out"; // Remet l'animation

    // Si on a tiré assez fort, on rafraîchit !
    if (ptrIcon.classList.contains("fa-arrow-up")) {
      ptrIcon.className = "fas fa-spinner fa-spin text-red-600 text-xl"; // Ça charge !
      if (typeof window.triggerVibration === "function")
        window.triggerVibration("success");

      // 🔄 On recharge les données depuis Firebase
      await window.chargerMenuComplet();
    }

    // On remet la bulle à sa place
    ptrIndicator.style.transform = "translate(-50%, -100%)";
    setTimeout(() => {
      ptrIcon.className = "fas fa-arrow-down text-gray-400 text-xl"; // Reset
    }, 300);
  });
}
// ============================================================================
// ⭐ SMART APP REVIEW PROMPT (SEO Booster)
// ==========================================
function setupSmartReviewPrompt() {
  // 1. Si le client a déjà noté l'app, on ne l'embête plus jamais !
  if (localStorage.getItem("hasRatedApp") === "true") return;
  // L'envoie vers Google
  const cfg = window.snackConfig;
  if (!cfg || !cfg.features || cfg.features.enableSmartReview !== true) {
    return;
  }

  // 2. On compte ses visites
  let visits = parseInt(localStorage.getItem("appVisits") || "0");
  visits++;
  localStorage.setItem("appVisits", visits);

  // 3. LE DÉCLENCHEUR : À la Nème visite (Tu peux changer ce chiffre)
  if (visits === 3) {
    // On attend 5 secondes après l'ouverture pour ne pas bloquer sa lecture du menu
    setTimeout(() => {
      const modal = document.getElementById("app-review-modal");
      if (modal) {
        modal.classList.remove("hidden");
        setTimeout(() => {
          modal.classList.remove("opacity-0");
          modal.querySelector(".bg-white").classList.remove("scale-95");
        }, 10);

        // 📳 Petite vibration double pour attirer son attention
        if (typeof window.triggerVibration === "function")
          window.triggerVibration("success");
      }
    }, 5000);
  }

  // --- GESTION DES BOUTONS ---
  const btnGoogle = document.getElementById("btn-review-google");
  const btnContact = document.getElementById("btn-review-contact");
  const btnLater = document.getElementById("btn-review-later");
  const modal = document.getElementById("app-review-modal");

  const closeModal = () => {
    modal.classList.add("opacity-0");
    modal.querySelector(".bg-white").classList.add("scale-95");
    setTimeout(() => modal.classList.add("hidden"), 300);
  };

  if (btnGoogle) {
    btnGoogle.addEventListener("click", () => {
      // Mémorise qu'il a cliqué
      localStorage.setItem("hasRatedApp", "true");

      const googleLink =
        cfg?.reviews?.googleMapsReviewLink ||
        cfg?.contact?.address?.googleMapsUrl;
      if (googleLink) window.open(googleLink, "_blank");

      closeModal();
    });
  }

  if (btnContact) {
    btnContact.addEventListener("click", () => {
      // Mémorise qu'il a cliqué
      localStorage.setItem("hasRatedApp", "true");
      closeModal();

      // Le fait glisser doucement vers ton formulaire de contact Formspree
      document
        .getElementById("contact")
        ?.scrollIntoView({ behavior: "smooth" });
      const sourceAvisInput = document.getElementById("source-avis");
      if (sourceAvisInput)
        sourceAvisInput.value = "Suggestion depuis le prompt PWA";
    });
  }

  if (btnLater) {
    btnLater.addEventListener("click", () => {
      // On remet le compteur à zéro. Il sera redemandé dans 3 visites.
      localStorage.setItem("appVisits", "0");
      closeModal();
    });
  }
}

// --- 1. VARIABLES D'ÉTAT ---
// ====================================================================
// 🚀 MOTEUR E-COMMERCE (PANIER & CHECKOUT)
// ====================================================================

// 📦 FUTURE MODULE : cart.js (Le "Cerveau" : Logique d'état et données pures)
// Ce module ne devra contenir AUCUN document.getElementById()
// --------------------------------------------------------------------

let cartData = JSON.parse(localStorage.getItem("snackCart")) || [];
let cartUpdateTimeout;

let cart = new Proxy(cartData, {
    set(target, property, value) {
        target[property] = value;
        
        // Anti-spam : On regroupe les multiples mises à jour (ex: Array.push change la valeur ET la length)
        clearTimeout(cartUpdateTimeout);
        cartUpdateTimeout = setTimeout(() => {
            localStorage.setItem("snackCart", JSON.stringify(target));
            // LE MÉGAPHONE 📣 : On annonce à l'application que le panier a changé
            document.dispatchEvent(new CustomEvent('cart-updated', { detail: target }));
        }, 10);
        
        return true;
    }
});

let currentProduct = null;

// 🎨 FUTURE MODULE : ui.js (Les "Muscles" : Manipulation du DOM)
// Ce module écoutera les événements pour mettre à jour l'affichage
// --------------------------------------------------------------------

// Écouteur global de la réactivité du panier
document.addEventListener('cart-updated', () => {
    updateCartUI(); // Met à jour la bulle rouge
    
    // On ne redessine l'intérieur du panier que si la modale est ouverte (Optimisation de performance)
    const cartModal = document.getElementById("cart-modal");
    if (cartModal && !cartModal.classList.contains("translate-y-full")) {
        renderCartItems();
    }
});

// Au chargement de la page, on met à jour la bulle rouge une première fois
document.addEventListener("DOMContentLoaded", updateCartUI);

// ============================================================================
// 🍹 BASCULE AFFICHAGE BOISSONS (Sécurisée pour Pizzas & Burgers)
// ============================================================================
window.toggleDrinkSection = function () {
  const formuleInput = document.querySelector('input[name="formule"]:checked');
  const drinkSection = document.getElementById("drink-section");
  const btn = document.getElementById("modal-cta");
  const devise = window.snackConfig?.identity?.currency || "€";

  // 🛑 LE BOUCLIER ANTI-CRASH :
  // S'il n'y a pas de bouton "formule" (Ex: c'est une Pizza), on cache les boissons et on s'arrête là !
  if (!formuleInput) {
    if (drinkSection) {
      drinkSection.classList.add("opacity-0");
      setTimeout(() => drinkSection.classList.add("hidden"), 300);
    }
    return;
  }

  const isMenu = formuleInput.value === "menu";

  if (isMenu) {
    if (drinkSection) {
      drinkSection.classList.remove("hidden");
      setTimeout(() => drinkSection.classList.remove("opacity-0"), 10);
    }
    if (btn)
      btn.innerHTML = `<span>Ajouter - ${(currentProduct.prixBase + currentProduct.prixMenu).toFixed(2)} ${devise}</span>`;
  } else {
    if (drinkSection) {
      drinkSection.classList.add("opacity-0");
      setTimeout(() => drinkSection.classList.add("hidden"), 300);
    }
    if (btn)
      btn.innerHTML = `<span>Ajouter - ${currentProduct.prixBase.toFixed(2)} ${devise}</span>`;
  }
};
// ============================================================================
// 🍔 MOTEUR DE MODALE UNIVERSEL (Pizzas, Kebabs, Burgers, Boissons)
// ============================================================================

function openProductModal (itemId) {
  window.history.pushState(null, null, '#modal')
  const cfg = window.snackConfig;
  const item = menuGlobal.find((i) => i.id === itemId || i.nom === itemId);
  if (!item) return;

  // 🎨 Extraction et création des couleurs dynamiques SaaS
  const accentText = cfg.theme.colors.accent || "text-red-600";
  const primaryBg = cfg.theme.colors.primary || "bg-blue-600";
  const textOnPrimary = cfg.theme.colors.textOnPrimary || "bg-gray-500";
  const primaryText = primaryBg.replace("bg-", "text-");
  const accentBg = accentText.replace("text-", "bg-").replace("600", "500");
  const accentLightBg = accentText.replace("text-", "bg-").replace("600", "50");
  const accentBorder = accentText
    .replace("text-", "border-")
    .replace("600", "500");
  const primaryBorder = accentText
    .replace("text-", "border-")
    .replace("600", "500");
  const primaryRing = accentText
    .replace("text-", "border-")
    .replace("600", "500");
  const accentRing = accentText.replace("text-", "ring-").replace("600", "500");

  // 1. Initialisation du produit en mémoire
  currentProduct = {
    id: item.id,
    nom: item.nom || item.name,
    prixBase: item.prix || item.price || 0,
    prixMenu: item.menuPriceAdd || 2.5,
    image: item.image,
    allowMenu: item.allowMenu !== false,
    tailleChoisie: null, // Sera rempli si c'est une pizza
  };

  const devise = cfg.identity.currency || "€";

  // 2. Gestion de l'Image et des Textes
  const modalImg = document.getElementById("modal-img");
  const imgContainer = modalImg.parentElement;
  const oldFallback = document.getElementById("modal-img-fallback");
  if (oldFallback) oldFallback.remove();

  if (currentProduct.image && currentProduct.image.trim() !== "") {
    modalImg.style.display = "block";
    modalImg.src = currentProduct.image;
    modalImg.onerror = function () {
      this.style.display = "none";
      if (!document.getElementById("modal-img-fallback")) {
        imgContainer.insertAdjacentHTML(
          "beforeend",
          `<div id="modal-img-fallback" class="absolute inset-0 flex items-center justify-center bg-gray-50 rounded-t-3xl md:rounded-t-none md:rounded-l-3xl z-0"><i class="fas fa-hamburger text-6xl text-black opacity-50"></i></div>`,
        );
      }
    };
  } else {
    modalImg.style.display = "none";
    imgContainer.insertAdjacentHTML(
      "beforeend",
      `<div id="modal-img-fallback" class="absolute inset-0 flex items-center justify-center bg-gray-50 rounded-t-3xl md:rounded-t-none md:rounded-l-3xl z-0"><i class="fas fa-hamburger text-6xl text-black opacity-50"></i></div>`,
    );
  }

  document.getElementById("modal-title").textContent = currentProduct.nom;
  document.getElementById("modal-desc").textContent = item.description || "";

  // 3. Allergènes
  const allergenContainer = document.getElementById(
    "modal-allergens-container",
  );
  if (item.allergenes && item.allergenes.length > 0) {
    allergenContainer.classList.remove("hidden");
    document.getElementById("modal-allergens").textContent =
      item.allergenes.join(", ");
  } else {
    allergenContainer.classList.add("hidden");
  }

  // 4. L'AIGUILLAGE MAGIQUE DES OPTIONS
  const btn = document.getElementById("modal-cta");
  const optionsContainer = document.getElementById("modal-options-container");

if (item.isAvailable === false) {
    if (optionsContainer) optionsContainer.classList.add("hidden");
    btn.innerHTML = `<i class="fas fa-ban mr-2"></i> Épuisé`;
    btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-gray-500 cursor-not-allowed flex justify-center items-center gap-2`;
    btn.onclick = null;
  } 
  else {
      // 🛒 SI CLICK & COLLECT EST ACTIVÉ : ON GÉNÈRE LES OPTIONS (SAUCES, TAILLES, ETC.)
      if (cfg.features?.enableClickAndCollect) {
          if (optionsContainer) {
              optionsContainer.classList.remove("hidden");
              let allOptionsHTML = "";

              // --- MODULE 1 : PIZZAS (Tailles) ---
              if (item.tailles && item.tailles.length > 0) {
                  currentProduct.allowMenu = false;
                  currentProduct.prixBase = item.tailles[0].prix;
                  currentProduct.tailleChoisie = item.tailles[0].nom;

                  allOptionsHTML += `
                  <fieldset class="mb-8">
                      <legend class="text-lg font-black text-gray-900 mb-3 flex justify-between w-full items-center">
                      <span>1. Choisissez la taille</span>
                      <span class="text-xs font-bold ${primaryBg} ${textOnPrimary} px-2 py-1 rounded uppercase tracking-wider">Obligatoire</span>
                      </legend>
                      <div class="grid grid-cols-2 gap-3">
                      ${item.tailles.map((taille, index) => `
                          <label class="relative cursor-pointer group">
                              <input type="radio" name="taille_produit" value="${taille.nom}" data-prix="${taille.prix}" ${index === 0 ? "checked" : ""} onchange="updateProductSize(this)" class="sr-only peer">
                              <div class="h-full p-4 border-2 border-gray-100 shadow-sm rounded-2xl peer-checked:${accentBorder} peer-checked:${accentLightBg} transition-all flex flex-col items-center justify-center text-center">
                                  <span class="font-bold text-gray-900 mb-1">${taille.nom}</span>
                                  <span class="font-black ${accentText} text-sm">${taille.prix.toFixed(2)} ${devise}</span>
                              </div>
                          </label>
                      `).join("")}
                      </div>
                      ${item.ingredients ? `<p class="text-sm text-gray-500 font-medium mt-3 bg-gray-50 p-3 rounded-xl border border-gray-100"><i class="fas fa-leaf mr-2 text-green-500"></i> ${item.ingredients.join(", ")}</p>` : ""}
                  </fieldset>
                  `;
              }
              // --- MODULE 2 : BURGERS / TACOS (Seul ou Menu) ---
              else if (currentProduct.allowMenu) {
                  const boissonsDispo = menuGlobal.filter((i) => i.categorieId === "drinks" && i.isAvailable !== false);
                  const listeBoissons = boissonsDispo.length > 0 ? boissonsDispo : [{ nom: "Coca-Cola" }, { nom: "Eau" }];

                  allOptionsHTML += `
                  <fieldset class="mb-8">
                      <legend class="text-lg font-black text-gray-900 mb-3 flex justify-between w-full items-center">
                      <span>1. Formule</span>
                      <span class="text-xs font-bold ${primaryBg} ${textOnPrimary} px-2 py-1 rounded uppercase tracking-wider">Obligatoire</span>
                      </legend>
                      <div class="grid grid-cols-2 gap-3">
                          <label class="relative cursor-pointer">
                              <input type="radio" name="formule" value="seul" checked onchange="toggleDrinkSection()" class="sr-only peer">
                              <div class="h-full p-4 border-2 border-gray-100 shadow-sm rounded-2xl peer-checked:${accentBorder} peer-checked:${accentLightBg} hover:border-gray-300 hover:bg-gray-50 transition-all flex flex-col items-center justify-center text-center">
                                  <i class="fas fa-hamburger text-2xl text-gray-400 mb-2 peer-checked:${accentText}"></i>
                                  <span class="font-bold text-gray-900">Seul</span>
                                  <span class="font-black text-gray-500 mt-1">${currentProduct.prixBase.toFixed(2)} ${devise}</span>
                              </div>
                          </label>

                          <label class="relative cursor-pointer">
                              <input type="radio" name="formule" value="menu" onchange="toggleDrinkSection()" class="sr-only peer">
                              <div class="h-full p-4 border-2 border-gray-100 shadow-sm rounded-2xl peer-checked:${accentBorder} peer-checked:${accentLightBg} hover:border-gray-300 hover:bg-gray-50 transition-all flex flex-col items-center justify-center text-center relative overflow-hidden">
                                  <div class="absolute -right-6 -top-6 w-16 h-16 ${accentBg} rounded-full opacity-10"></div>
                                  <div class="flex gap-1 mb-2">
                                      <i class="fas fa-hamburger text-xl text-gray-400 peer-checked:${accentText}"></i>
                                      <i class="fas fa-plus text-xs text-gray-300 ml-2 mt-1 ${primaryText}"></i>
                                      <i class="fas fa-fries text-xl text-gray-400 peer-checked:${accentText}"></i>
                                  </div>
                                  <span class="font-bold text-gray-900">En Menu</span>
                                  <span class="font-black ${accentText} mt-1">+ ${currentProduct.prixMenu.toFixed(2)} ${devise}</span>
                              </div>
                          </label>
                      </div>
                  </fieldset>

                  <fieldset id="drink-section" class="mb-8 hidden opacity-0 transition-all duration-300 transform translate-y-4">
                      <legend class="text-lg font-black text-gray-900 mb-3 flex justify-between w-full items-center">
                      <span>2. Votre Boisson</span>
                      <span class="text-xs font-bold ${primaryBg} ${textOnPrimary} px-2 py-1 rounded uppercase tracking-wider shadow-sm">Choix requis</span>
                      </legend>
                      <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                          ${listeBoissons.map((boisson, index) => `
                              <label class="relative cursor-pointer">
                                  <input type="radio" name="boisson" value="${boisson.nom}" ${index === 0 ? "checked" : ""} class="sr-only peer">
                                  <div class="p-3 border-2 border-gray-100 shadow-sm rounded-xl peer-checked:${accentBorder} peer-checked:${accentLightBg} transition-all flex items-center gap-3">
                                      <div class="w-8 h-8 flex items-center justify-center peer-checked:${primaryBg} transition-colors">
                                          <i class="fas fa-glass-water shadow-sm ${accentText}"></i>
                                      </div>
                                      <span class="font-bold text-gray-800 text-sm leading-tight">${boisson.nom}</span>
                                  </div>
                              </label>
                          `).join("")}
                      </div>
                  </fieldset>
                  `;
              }

              // --- MODULE 3 : KEBABS (Crudités) ---
              if (item.hasCrudites) {
                  const listeCrudites = Array.isArray(item.crudites) && item.crudites.length > 0 ? item.crudites : ["Salade", "Tomate", "Oignon"];
                  allOptionsHTML += `
                  <fieldset class="mb-8">
                      <legend class="text-lg font-black text-gray-900 mb-3 flex justify-between w-full items-center">
                      <span>Garniture</span>
                      <span class="text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded uppercase tracking-wider">Inclus</span>
                      </legend>
                      <p class="text-sm text-gray-500 mb-3 font-medium">Décochez pour retirer un ingrédient.</p>
                      <div class="flex flex-wrap gap-3">
                          ${listeCrudites.map((c) => `
                              <label class="relative cursor-pointer group">
                                  <input type="checkbox" name="crudite" value="${c}" checked class="sr-only peer">
                                  <div class="px-4 py-2 border-2 rounded-full font-bold text-sm transition-all border-red-200 bg-red-50 text-red-800 line-through opacity-70 hover:opacity-100 peer-checked:border-green-500 peer-checked:bg-green-50 peer-checked:text-green-800 peer-checked:no-underline peer-checked:opacity-100 peer-checked:hover:bg-green-100">
                                      <i class="fas fa-check mr-1 peer-checked:inline-block hidden"></i>
                                      <i class="fas fa-times mr-1 peer-checked:hidden inline-block text-gray-400"></i>
                                      ${c}
                                  </div>
                              </label>
                          `).join("")}
                      </div>
                  </fieldset>
                  `;
              }
              // --- MODULE 4 : SAUCES ---
              if (item.choixSauces) {
                  const sauces = item.choixSauces.liste || ["Blanche", "Algérienne", "Samouraï", "Mayonnaise"];
                  const maxSauces = item.choixSauces.max || 2;
                  allOptionsHTML += `
                  <fieldset class="mb-8">
                      <legend class="text-lg font-black text-gray-900 mb-3 flex justify-between w-full items-center">
                      <span>Sauces</span>
                      <span class="text-xs font-bold bg-gray-900 text-white px-3 py-1 rounded-full uppercase tracking-wider shadow-sm">
                          <span id="sauce-counter-ui">0</span> / ${maxSauces} max
                      </span>
                      </legend>
                      <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                          ${sauces.map((sauce) => `
                              <label class="relative cursor-pointer block">
                                  <input type="checkbox" name="sauce" value="${sauce}" onchange="checkSauceLimit(event, ${maxSauces})" class="sr-only peer sauce-checkbox">
                                  <div class="h-full p-4 border-2 border-gray-100 shadow-sm rounded-xl peer-checked:${accentBorder} peer-checked:${accentLightBg} transition-all flex items-center justify-center text-center">
                                      <span class="font-bold text-gray-800 text-sm leading-tight">${sauce}</span>
                                  </div>
                              </label>
                          `).join("")}
                      </div>
                  </fieldset>
                  `;
              }

              if (allOptionsHTML === "") {
                  optionsContainer.classList.add("hidden");
              } else {
                  optionsContainer.innerHTML = allOptionsHTML;
                  if (typeof window.toggleDrinkSection === "function") window.toggleDrinkSection();
              }
          }
      } 
      // 🛑 SI PAS DE CLICK & COLLECT : ON CACHE TOUTES LES OPTIONS
      else {
          if (optionsContainer) optionsContainer.classList.add("hidden");
      }

      // ==========================================
      // 🎯 L'AIGUILLAGE DU BOUTON PRINCIPAL (LE CTA)
      // ==========================================

      // 🛒 SCÉNARIO 1 : MODE PANIER (CLICK & COLLECT)
      if (cfg.features?.enableClickAndCollect) {
          btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-gray-900 hover:bg-black hover:-translate-y-1 transition-all flex justify-center items-center gap-2`;
          btn.innerHTML = `<span>Ajouter - ${currentProduct.prixBase.toFixed(2)} ${devise}</span>`;
          btn.onclick = window.confirmAddToCart;
      }
      
      // 🏪 Scénario 2 : MODE VITRINE (Pas de commande en ligne du tout)
      else if (!cfg.features?.enableOnlineOrder) {
          btn.innerHTML = `<i class="fas fa-times mr-2" aria-hidden="true"></i> Fermer`;
          btn.className = `w-full py-4 rounded-full font-bold text-gray-800 text-center shadow-md text-lg bg-gray-100 hover:bg-gray-200 border ${accentBorder} hover:border-gray-400 transition-all flex justify-center items-center gap-2`;
          btn.onclick = window.closeProductModal;
      }
      
      // 🏍️ Scénario 3 : LIVRAISON EXTERNE (UberEats, Deliveroo...)
      else if (cfg.features?.enableDelivery) {
          btn.innerHTML = `<i class="fas fa-motorcycle mr-2"></i> Commander en livraison`;
          btn.className = `w-full py-4 rounded-full font-bold ${textOnPrimary} text-center shadow-lg text-lg ${primaryBg} hover:opacity-90 hover:-translate-y-1 transition-all flex justify-center items-center gap-2`;
          btn.onclick = () => {
              if (cfg.deliveryUrl && cfg.deliveryUrl.trim() !== "" && cfg.deliveryUrl !== "#") {
                  window.open(cfg.deliveryUrl, "_blank");
              } else {
                  window.showToast("Le lien de livraison n'est pas configuré.", "error");
                  if (typeof window.triggerVibration === "function") window.triggerVibration("error");
              }
          };
      }
      
      // 📞 Scénario 4 : PAR DÉFAUT (Lance l'appel téléphonique natif)
      else {
          const phone = cfg.contact?.phone ? cfg.contact.phone.replace(/\s/g, "") : "";
          btn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> Appeler pour commander`;
          btn.className = `w-full py-4 rounded-full font-bold ${textOnPrimary} text-center shadow-lg text-lg ${primaryBg} hover:-translate-y-1 transition-all flex justify-center items-center gap-2`;
          btn.onclick = () => {
              if (phone) {
                  window.location.href = `tel:${phone}`;
              } else {
                  window.showToast("Numéro non renseigné", "error");
                  if (typeof window.triggerVibration === "function") window.triggerVibration("error");
              }
          };
      }
  }

  // 5. Affichage final
  const backdrop = document.getElementById("product-modal-backdrop");
  const sheet = document.getElementById("product-modal");
  backdrop.classList.remove("hidden");
  setTimeout(() => {
    backdrop.classList.remove("opacity-0");
    sheet.classList.remove(
      "translate-y-full",
      "md:opacity-0",
      "md:pointer-events-none",
      "md:scale-95",
    );
  }, 10);
  document.body.style.overflow = "hidden";
};

// ==========================================
// 🛠️ LES PETITS SCRIPTS ASSISTANTS (UX & A11y)
// ==========================================

// Helper 1 : Gérer les sauces + Mettre à jour le compteur visuel
window.checkSauceLimit = function (event, max) {
  const checkedBoxes = document.querySelectorAll(".sauce-checkbox:checked");
  const counterUI = document.getElementById("sauce-counter-ui");

  // Mise à jour visuelle du compteur
  if (counterUI) {
    counterUI.textContent = checkedBoxes.length;
    if (checkedBoxes.length === max) {
      counterUI.parentElement.classList.replace("bg-gray-900", "bg-green-600");
    } else {
      counterUI.parentElement.classList.replace("bg-green-600", "bg-gray-900");
    }
  }

  // Blocage si on dépasse
  if (checkedBoxes.length > max) {
    event.target.checked = false;
    if (counterUI) counterUI.textContent = max; // On remet au max visuellement
    window.showToast(`Maximum ${max} sauces autorisées !`, "error");
    if (typeof window.triggerVibration === "function")
      window.triggerVibration("error");
  } else {
    if (typeof window.triggerVibration === "function")
      window.triggerVibration("light");
  }
};

// Helper 2 : Mettre à jour le prix de la pizza en direct
window.updateProductSize = function (radioBtn) {
  const nouveauPrix = parseFloat(radioBtn.getAttribute("data-prix"));
  currentProduct.prixBase = nouveauPrix;
  currentProduct.tailleChoisie = radioBtn.value;

  const devise = window.snackConfig.identity.currency || "€";
  document.getElementById("modal-cta").innerHTML =
    `<span>Ajouter - ${nouveauPrix.toFixed(2)} ${devise}</span>`;
  if (typeof window.triggerVibration === "function")
    window.triggerVibration("light");
};

// ============================================================================
// 🍹 BASCULE AFFICHAGE BOISSONS (Avec animations Tailwind)
// ============================================================================
window.toggleDrinkSection = function () {
  const formuleInput = document.querySelector('input[name="formule"]:checked');
  const drinkSection = document.getElementById("drink-section");
  const btn = document.getElementById("modal-cta");
  const devise = window.snackConfig?.identity?.currency || "€";

  if (!formuleInput) {
    if (drinkSection) {
      drinkSection.classList.remove("translate-y-0", "opacity-100");
      drinkSection.classList.add("translate-y-4", "opacity-0");
      setTimeout(() => drinkSection.classList.add("hidden"), 300);
    }
    return;
  }

  const isMenu = formuleInput.value === "menu";
  if (typeof window.triggerVibration === "function")
    window.triggerVibration("light");

  if (isMenu) {
    if (drinkSection) {
      drinkSection.classList.remove("hidden");
      // L'animation a besoin d'un micro-délai pour que le display:block soit appliqué par le navigateur avant de transitionner l'opacité
      setTimeout(() => {
        drinkSection.classList.remove("translate-y-4", "opacity-0");
        drinkSection.classList.add("translate-y-0", "opacity-100");
      }, 20);
    }
    if (btn)
      btn.innerHTML = `<span>Ajouter - ${(currentProduct.prixBase + currentProduct.prixMenu).toFixed(2)} ${devise}</span>`;
  } else {
    if (drinkSection) {
      drinkSection.classList.remove("translate-y-0", "opacity-100");
      drinkSection.classList.add("translate-y-4", "opacity-0");
      setTimeout(() => drinkSection.classList.add("hidden"), 300);
    }
    if (btn)
      btn.innerHTML = `<span>Ajouter - ${currentProduct.prixBase.toFixed(2)} ${devise}</span>`;
  }
};

// ==========================================
// 🛒 LA VALIDATION ET L'AJOUT AU PANIER
// ==========================================
window.confirmAddToCart = function () {
  const formuleInput = document.querySelector('input[name="formule"]:checked');
  const isMenu = formuleInput ? formuleInput.value === "menu" : false;

  let nomFinal = currentProduct.nom;
  let prixFinal = currentProduct.prixBase;
  let boissonChoisie = null;

  // 🍕 Gestion du nom de la Pizza
  if (currentProduct.tailleChoisie) {
    nomFinal += `${currentProduct.tailleChoisie}`;
  }

  // 🍔 Gestion du Burger en Menu
  if (isMenu) {
    const boissonInput = document.querySelector(
      'input[name="boisson"]:checked',
    );
    if (!boissonInput)
      return window.showToast("🥤 Veuillez choisir une boisson.", "error");
    boissonChoisie = boissonInput.value;
    nomFinal = `Menu ${currentProduct.nom}`;
    prixFinal += currentProduct.prixMenu;
  }

  // 🥣 Capture des Sauces
  const saucesCheckboxes = document.querySelectorAll(".sauce-checkbox:checked");
  const saucesChoisies = Array.from(saucesCheckboxes).map((cb) => cb.value);

  // 🚫 Capture des Crudités enlevées (S-T-O)
  const cruditesCheckboxes = document.querySelectorAll('input[name="crudite"]');
  const cruditesEnlevees = [];
  cruditesCheckboxes.forEach((cb) => {
    if (!cb.checked) cruditesEnlevees.push(`Sans ${cb.value}`);
  });

  // 🧬 Génération d'un ID de panier unique pour ne pas mélanger 2 kebabs avec des sauces différentes
  const optionsString = [
    ...saucesChoisies,
    ...cruditesEnlevees,
    boissonChoisie,
    currentProduct.tailleChoisie,
  ]
    .filter(Boolean)
    .join("-");
  const uniqueId = `${currentProduct.id}-${isMenu ? "menu" : "seul"}-${optionsString.replace(/[\s\(\)]/g, "")}`;

  addToCart({
    id: uniqueId,
    productId: currentProduct.id,
    nom: nomFinal,
    prix: prixFinal,
    image: currentProduct.image,
    type: isMenu ? "menu" : "seul",
    boisson: boissonChoisie,
    sauces: saucesChoisies,
    sansCrudites: cruditesEnlevees,
    tailleChoisie: currentProduct.tailleChoisie,
    prixBase: currentProduct.prixBase,
    prixMenuAdd: isMenu ? currentProduct.prixMenu : 0,
  });

  closeProductModal();
};

// Fermeture de la modale unifiée
window.closeProductModal = function () {
  const backdrop = document.getElementById("product-modal-backdrop");
  const sheet = document.getElementById("product-modal");

  sheet.classList.add(
    "translate-y-full",
    "md:opacity-0",
    "md:pointer-events-none",
    "md:scale-95",
  );
  backdrop.classList.add("opacity-0");

  setTimeout(() => {
    backdrop.classList.add("hidden");
    document.body.style.overflow = "";
  }, 300);
};

// --- 3. GESTION DU PANIER (Logique) ---
// 📦 FUTURE MODULE : cart.js
function addToCart(itemData) {
  const existingItem = cart.find((item) => item.id === itemData.id);

  if (existingItem) {
    existingItem.quantity += 1; // 🪄 Déclenche le Proxy automatiquement !
  } else {
    cart.push({ ...itemData, quantity: 1 }); // 🪄 Déclenche le Proxy automatiquement !
  }
  
  if (typeof window.triggerVibration === "function") window.triggerVibration("light");
  window.showToast(`${itemData.nom} ajouté au panier ! 🍔`, "success");
  
}

// 📦 FUTURE MODULE : cart.js
function updateQuantity(productId, delta) {
  const index = cart.findIndex((i) => i.id === productId);

  if (index !== -1) {
    if (typeof window.triggerVibration === "function") window.triggerVibration("light");
    
    const newQuantity = cart[index].quantity + delta;
    
    if (newQuantity <= 0) {
      // 🪄 Le 'splice' retire le tiroir : Le Proxy le voit !
      cart.splice(index, 1); 
    } else {
      // 🪄 L'ASTUCE : On remplace TOUT l'objet à cet index.
      // Le Proxy le voit et déclenche la mise à jour UI instantanément !
      cart[index] = { ...cart[index], quantity: newQuantity };
    }
  }
}

function getCartTotal() {
  return cart.reduce((total, item) => total + item.prix * item.quantity, 0);
}

function updateCartUI() {
  const badge = document.getElementById("cart-badge");
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  if (totalItems > 0) {
    badge.textContent = totalItems;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  // try {
  //   if (
  //     window.AppBridge &&
  //     typeof window.AppBridge.sendToNative === "function"
  //   ) {
  //     window.AppBridge.sendToNative("update_cart_badge", { count: totalItems });
  //   }
  // } catch (e) {
  //   console.error("Bridge non disponible", e);
  // }
}

// --- 4. AFFICHAGE DU PANIER (Modale Panier) ---
function openCartModal() {
  renderCartItems();
  document
    .getElementById("cart-backdrop")
    .classList.remove("opacity-0", "pointer-events-none");
  document.getElementById("cart-modal").classList.remove("translate-y-full");
};

function closeCartModal() {
  document
    .getElementById("cart-backdrop")
    .classList.add("opacity-0", "pointer-events-none");
  document.getElementById("cart-modal").classList.add("translate-y-full");
};

function renderCartItems() {
  const container = document.getElementById("cart-items-container");
  container.innerHTML = "";

  if (cart.length === 0) {
    container.innerHTML = `<p class="text-center py-10 text-gray-500">Votre panier est vide.</p>`;
    document.getElementById("checkout-btn").disabled = true;
    document.getElementById("checkout-btn").classList.add("opacity-50");
  } else {
    document.getElementById("checkout-btn").disabled = false;
    document.getElementById("checkout-btn").classList.remove("opacity-50");

    cart.forEach((item) => {
      // 🎯 LA MAGIE EST ICI : On crée le sous-titre dynamique
      let detailsText = [];
      if (item.boisson) detailsText.push(`🥤 ${escapeHTML(item.boisson)}`);
      if (item.sauces && item.sauces.length > 0) {
    const safeSauces = item.sauces.map(s => escapeHTML(s)).join(", ");
    detailsText.push(`🥣 ${safeSauces}`);
}

if (item.sansCrudites && item.sansCrudites.length > 0) {
    const safeCrudites = item.sansCrudites.map(c => escapeHTML(c)).join(", ");
    detailsText.push(`<span class="text-red-600 font-black">⚠️ ${safeCrudites}</span>`);
}

      const detailsHTML =
        detailsText.length > 0
          ? `<div class="text-[11px] text-gray-500 mt-1 leading-snug flex flex-wrap gap-x-2 gap-y-1">${detailsText.join(" <span class='text-gray-300'>|</span> ")}</div>`
          : "";

      const imageUrl =
        item.image && item.image.trim() !== "" ? item.image : null;
      const fallbackHtml = `<div class="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200"><i class="fas fa-hamburger text-gray-300 text-xl" aria-hidden="true"></i></div>`;
     const safeNom = escapeHTML(item.nom);
      const imageHtml = imageUrl
        ? `<div class="relative w-16 h-16 shrink-0"><img src="${imageUrl}" alt="${safeNom}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="absolute inset-0 w-full h-full rounded-lg object-cover z-10"><div style="display: none;" class="absolute inset-0 rounded-lg bg-gray-100 items-center justify-center border border-gray-200 z-0"><i class="fas fa-hamburger text-gray-300 text-xl" aria-hidden="true"></i></div></div>`
        : fallbackHtml;

      container.innerHTML += `
        <div class="flex items-center gap-4 bg-white p-3 rounded-xl border" role="group">
            ${imageHtml}
            <div class="flex-1 min-w-0">
                <h2 class="font-bold text-gray-900 leading-tight truncate">${safeNom  }</h2>
                ${detailsHTML} <p class="text-red-600 font-bold mt-1">${(item.prix * item.quantity).toFixed(2)} €</p>
            </div>
            <div class="flex items-center gap-3 bg-gray-50 rounded-lg p-1">
                <button type="button" data-action="update-qty" data-id="${item.id}" data-delta="-1" class="w-8 h-8 text-gray-600 hover:bg-gray-200 rounded-md transition"><i class="fas fa-minus text-xs"></i></button>
                <span class="font-bold w-4 text-black text-center text-sm">${item.quantity}</span>
                <button type="button" data-action="update-qty" data-id="${item.id}" data-delta="1" class="w-8 h-8 text-gray-600 hover:bg-gray-200 rounded-md transition"><i class="fas fa-plus text-xs"></i></button>
            </div>
        </div>
      `;
    });
  }
  document.getElementById("cart-total-price").textContent =
    `${getCartTotal().toFixed(2)} €`;
}

// --- 5. L'ENVOI FINAL (Firebase Checkout) ---


// ==========================================
// 💳 PROCESSUS DE COMMANDE & CLICK&COLLECT (STRIPE )
// ==========================================
// 💳 FUTURE MODULE : stripe-service.js (Logique d'encaissement isolée)
async function processCheckout(){
    const cfg = window.snackConfig;
    if (cart.length === 0) return window.showToast("Votre panier est vide", "error");

    if (!cfg?.features?.enableClickAndCollect) {
         return window.showToast("La commande en ligne est désactivée.", "error");
    }

    const currentUser = window.auth?.currentUser;
    const btn = document.getElementById("checkout-btn");

    if (!currentUser) {
        window.showToast("Veuillez vous connecter pour commander", "error");
        if (typeof window.toggleAuthModal === "function") window.toggleAuthModal();
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Connexion banque...`;
    btn.disabled = true;

    try {
        if (typeof Stripe === "undefined") {
            throw new Error("Stripe n'est pas chargé !");
        }

        if (!stripeInstance) {
            stripeInstance = Stripe(stripePublicKey); 
        }

        const totalAmount = getCartTotal();

        // 1. Fermer le panier pour éviter les conflits de z-index
        if (typeof window.closeCartModal === "function") window.closeCartModal();

        // 2. Mettre à jour et ouvrir la modale Stripe EN PREMIER, pour que le DOM soit prêt
        document.getElementById("payment-amount-display").textContent = `Total : ${totalAmount.toFixed(2)} €`;
        
        // On rend la modale visible mais avec un spinner de chargement dans la zone Stripe
        const paymentContainer = document.getElementById("payment-element");
        paymentContainer.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i></div>';
        
        if (typeof window.openPaymentSheet === "function") window.openPaymentSheet();

        // 3. Demander le PaymentIntent à la Cloud Function
        const { httpsCallable, functions } = window.fs;
        const createPaymentIntent = httpsCallable(functions, "createPaymentIntent");

// On crée une phrase type : "2x Tacos XL, 1x Frites"
const ticketSummary = cart.map(item => `${item.quantity}x ${item.nom}`).join(', ');

const response = await createPaymentIntent({ 
    amount: Math.round(totalAmount * 100), 
    currency: "eur",
    // On envoie les infos au serveur (Cloud Function)
    description: `Commande Web - ${cfg.identity.name}`,
    metadata: {
        // Stripe limite à 500 caractères, donc on coupe si c'est trop long
        ticket: ticketSummary.substring(0, 500),
        clientEmail: currentUser.email
    }
});

        const clientSecret = response.data.clientSecret;

        // 4. Créer et injecter le formulaire Stripe MAINTENANT que la div est visible
        const appearance = { theme: 'stripe' }; 
        stripeElements = stripeInstance.elements({ appearance, clientSecret });

        const paymentElement = stripeElements.create("payment");
        
        // On nettoie notre spinner et on monte le formulaire
        paymentContainer.innerHTML = "";
        paymentElement.mount("#payment-element");

    } catch (error) {
        console.error("❌ Erreur préparation paiement :", error);
        window.showToast("Erreur de connexion sécurisée au paiement.", "error");
        // Si erreur, on referme la modale Stripe pour ne pas bloquer l'utilisateur
        if (typeof window.closePaymentSheet === "function") window.closePaymentSheet();
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// ==========================================
// 💳 GESTION VISUELLE DE LA MODALE STRIPE
// ==========================================

window.openPaymentSheet = () => {
    const sheet = document.getElementById("payment-bottom-sheet");
    const content = document.getElementById("payment-sheet-content");
    
    if (!sheet) return console.error("❌ Modale Stripe introuvable dans le HTML !");
    
    // On l'affiche
    sheet.classList.remove("hidden");
    sheet.classList.add("flex");
    
    // On anime le tiroir qui monte
    setTimeout(() => {
        sheet.classList.remove("opacity-0");
        content.classList.remove("translate-y-full");
    }, 10);
};

window.closePaymentSheet = () => {
    const sheet = document.getElementById("payment-bottom-sheet");
    const content = document.getElementById("payment-sheet-content");
    
    if (!sheet) return;

    // On anime le tiroir qui descend
    sheet.classList.add("opacity-0");
    content.classList.add("translate-y-full");
    
    // On cache complètement après l'animation
    setTimeout(() => {
        sheet.classList.add("hidden");
        sheet.classList.remove("flex");
        
        // 🧹 NETTOYAGE CRITIQUE : On vide le formulaire Stripe pour le prochain client
        const paymentElementDiv = document.getElementById("payment-element");
        if (paymentElementDiv) paymentElementDiv.innerHTML = ""; 
        stripeElements = null;
    }, 300);
};

// ==========================================
// 💳 1. SOUMISSION DU PAIEMENT (AU CLIC)
// ==========================================
window.submitStripePayment = async () => {
    const submitPaymentBtn = document.getElementById("submit-payment-btn");
    
    // Sécurité : on vérifie que le formulaire Stripe a bien fini de charger
    if (!stripeInstance || !stripeElements) {
        window.showToast("Veuillez patienter, connexion sécurisée en cours...", "error");
        return;
    }

    const btnOriginalText = submitPaymentBtn.innerHTML;
    submitPaymentBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Vérification banque...`;
    submitPaymentBtn.disabled = true;

    try {
        // 🚀 STRIPE PREND LE RELAIS ICI : Il vérifie la carte (CVC, provision, fraude...)
        const { error, paymentIntent } = await stripeInstance.confirmPayment({
            elements: stripeElements,
            confirmParams: {
                // On pourrait demander le nom ou l'email ici si besoin
            },
            redirect: 'if_required' // 🛑 CRUCIAL : Empêche Stripe de changer de page !
        });

        if (error) {
            // ❌ La carte a un problème (Refusée, code faux, etc.)
            const messageContainer = document.getElementById("payment-message");
            messageContainer.textContent = error.message; // Affiche l'erreur renvoyée par la banque
            messageContainer.classList.remove("hidden");
            if (typeof window.triggerVibration === "function") window.triggerVibration("error");
            
        } else if (paymentIntent && paymentIntent.status === 'succeeded') {
            // ✅ VICTOIRE ! LE PAIEMENT EST PASSÉ !
            window.showToast("Paiement validé ! 🎉", "success");
            
            // 1. ON FERME LE TIROIR DE PAIEMENT
            if (typeof window.closePaymentSheet === "function") window.closePaymentSheet();
            
            // 2. 💥 ON ENVOIE LA COMMANDE EN CUISINE (Dans Firestore)
            if (typeof window.finalizeOrderInFirestore === "function") {
                await window.finalizeOrderInFirestore(paymentIntent.id); 
            }
        }

    } catch (err) {
         console.error("Erreur critique au moment du paiement :", err);
         window.showToast("Une erreur est survenue avec le terminal de paiement.", "error");
    } finally {
        // Quoi qu'il arrive, on rend le bouton cliquable à nouveau
        submitPaymentBtn.innerHTML = btnOriginalText;
        submitPaymentBtn.disabled = false;
    }
};

// ==========================================
// 🧑‍🍳 2. ENVOI EN CUISINE (APRÈS PAIEMENT RÉUSSI)
// ==========================================
// 🔥 FUTURE MODULE : firebase-service.js (Interactions directes avec la Base de Données)
window.finalizeOrderInFirestore = async (stripePaymentId) => {
    const currentSnackId = window.snackConfig?.identity?.id || "Ym1YiO4Ue5Fb5UXlxr06";
    const currentUser = window.auth?.currentUser;
    const { addDoc, collection, serverTimestamp, updateDoc, doc } = window.fs;

    try {
        // On formate le panier
        const orderItems = cart.map(item => ({
            id: item.id,
            productId: item.productId || item.id.split("-")[0],
            nom: item.nom,
            type: item.type || "seul",
            boissonNom: item.boisson || null,
            sauces: item.sauces || [], 
            sansCrudites: item.sansCrudites || [],
            tailleChoisie: item.tailleChoisie || null,
            prixBase: item.prixBase || item.prix,
            prixMenuAdd: item.prixMenuAdd || 0,
            quantity: item.quantity,
        }));

        // On crée le ticket de caisse officiel
        const newOrder = {
            snackId: currentSnackId,
            userId: currentUser.uid,
            clientNom: currentUser.displayName || currentUser.email.split("@")[0],
            clientEmail: currentUser.email,
            date: serverTimestamp(),
            statut: "en_attente_client", // Le chef peut s'y mettre !
            items: orderItems,
            total: getCartTotal(),
            paiement: {
                methode: "carte_bancaire",
                statut: "paye", // 💰 C'est payé !
                stripeSessionId: stripePaymentId, // La preuve d'achat pour la compta
            },
        };

        // On envoie le tout dans le cloud Firebase !
        const docRef = await addDoc(collection(window.db, "commandes"), newOrder);
        
        // Bonus: on met à jour la date de dernière commande du client
        await updateDoc(doc(window.db, "users", currentUser.uid), { lastOrderDate: serverTimestamp() });

        // On vide le panier du client
        // On vide le panier en retirant tous les éléments depuis l'index 0
        cart.splice(0, cart.length); // 🪄 Le Proxy mettra l'UI à jour tout seul et videra le localStorage !
        if (typeof window.triggerVibration === "function") window.triggerVibration("jackpot");

        // 🎯 MAGIE FINALE : On lance le Tracking pour rassurer le client !
        if (window.snackConfig?.features?.enableClickAndCollect) {
            localStorage.setItem("activeOrderId", docRef.id);
            if (typeof window.startOrderTracking === "function") window.startOrderTracking(docRef.id);
        }

    } catch(err) {
        console.error("Erreur Firebase après paiement :", err);
        window.showToast("Paiement réussi, mais erreur d'envoi du ticket. Contactez le restaurant.", "error");
    }
};

// ==========================================
// 🎟️ GESTION DE L'UI DE LA MODALE TRACKING
// ==========================================
window.openTrackingModal = () => {
  const modal = document.getElementById("order-tracking-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector(".bg-white").classList.remove("scale-95");
  }, 10);
};

window.closeTrackingModal = () => {
  const modal = document.getElementById("order-tracking-modal");
  modal.classList.add("opacity-0");
  modal.querySelector(".bg-white").classList.add("scale-95");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
};


// ==========================================
// 📡 LE RADAR DU CLIENT (MISE À JOUR AVEC L'UI)
// ==========================================
let unsubscribeClientRadar = null;

window.notifyArrival = async (orderId) => {
  try {
    const btn = document.getElementById("tracking-action-btn");
    btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Préparation en cuisine...`;
    // On bascule la commande en "nouvelle" pour alerter le chef !
    await window.fs.updateDoc(window.fs.doc(window.db, "commandes", orderId), {
      statut: "nouvelle",
    });
    window.showToast("C'est noté ! Le chef lance la cuisson 🔥", "success");
  } catch (e) {
    console.error(e);
  }
};

// 🔥 FUTURE MODULE : firebase-service.js (Interactions directes avec la Base de Données)
window.startOrderTracking = (orderId) => {
  const trackingBadge = document.getElementById("order-tracking-badge");
  const badgeText = document.getElementById("badge-text");

  // Éléments de la Modale
  const orderIdText = document.getElementById("tracking-order-id");
  const iconContainer = document.getElementById("tracking-icon-container");
  const icon = document.getElementById("tracking-icon");
  const title = document.getElementById("tracking-title");
  const subtitle = document.getElementById("tracking-subtitle");
  const actionBtn = document.getElementById("tracking-action-btn");

  // 1. On affiche le badge et l'ID de commande (les 4 derniers caractères pour faire "Ticket")
  if (trackingBadge) trackingBadge.classList.remove("hidden");
  if (orderIdText)
    orderIdText.textContent = "#" + orderId.slice(-4).toUpperCase();

  if (unsubscribeClientRadar) unsubscribeClientRadar();
  console.log("🟢 Radar Client ACTIVÉ :", orderId);

  // 2. Écoute Firebase
  unsubscribeClientRadar = window.fs.onSnapshot(
    window.fs.doc(window.db, "commandes", orderId),
    (docSnap) => {
      if (docSnap.exists()) {
        const commande = docSnap.data();

        // ⚪ STATUT 1 : EN ATTENTE DU CLIENT (Nouveau !)
        if (commande.statut === "en_attente_client") {
          trackingBadge.className =
            "hidden md:flex fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-full shadow-xl font-black items-center gap-3 z-[60] transition-all hover:scale-105";
          badgeText.textContent = "En attente de votre arrivée";

          iconContainer.className =
            "w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500";
          icon.className =
            "fas fa-car text-5xl text-gray-500 transition-transform duration-500 animate-pulse";
          title.textContent = "Commande reçue !";
          title.className = "text-3xl font-black text-gray-900 tracking-tight";
          subtitle.innerHTML =
            "Cliquez ci-dessous quand vous êtes <b>à 5 minutes</b> pour qu'on lance la cuisson.";

          // On transforme le bouton pour l'action !
          if (actionBtn) {
            actionBtn.innerHTML =
              "<i class='fas fa-car mr-2' aria-hidden='true'></i> Je suis à 5 min / Sur place";
            actionBtn.className =
              "w-full bg-blue-600 text-white font-black py-4 rounded-xl text-lg shadow-lg hover:bg-blue-700 transition active:scale-95";

            // 🤖 MISE À JOUR POUR LES ROBOTS
            actionBtn.setAttribute(
              "aria-label",
              "Signaler mon arrivée au restaurant pour lancer la cuisson",
            );
            actionBtn.onclick = () => window.notifyArrival(orderId);
          }
        }
        // 🟡 STATUT 2 : NOUVELLE (En préparation par le chef)
        else if (commande.statut === "nouvelle") {
          trackingBadge.className =
            "hidden md:flex fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-white px-6 py-3 rounded-full shadow-[0_10px_25px_rgba(234,179,8,0.5)] font-black items-center gap-3 z-[60] transition-all hover:scale-105 animate-bounce";
          badgeText.textContent = "Commande en cours";

          iconContainer.className =
            "w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500";
          icon.className =
            "fas fa-fire text-5xl text-yellow-500 transition-transform duration-500 animate-pulse";
          title.textContent = "En cuisine !";
          title.className = "text-3xl font-black text-gray-900 tracking-tight";
          subtitle.textContent = "Le chef prépare votre commande.";

          // On remet le bouton en mode "Fermeture" normal
          if (actionBtn) {
            actionBtn.textContent = "Super, j'attends !";
            actionBtn.className =
              "w-full bg-gray-900 text-white font-black py-4 rounded-xl text-lg shadow-lg hover:bg-black transition active:scale-95";

            // 🤖 ON REMET LE LABEL INITIAL POUR LES ROBOTS
            actionBtn.setAttribute(
              "aria-label",
              "Fermer la fenêtre de suivi de commande",
            );
            actionBtn.onclick = window.closeTrackingModal;
          }
        }

        // 🟢 STATUT : PRÊTE
        else if (commande.statut === "prete") {
          // Le badge devient Vert et vibre !
          trackingBadge.className =
            "hidden md:flex fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-8 py-4 rounded-full shadow-[0_10px_30px_rgba(22,163,74,0.6)] font-black items-center gap-3 z-[60] transition-all hover:scale-105 animate-pulse";
          badgeText.textContent = "C'EST PRÊT !";

          // La modale passe au vert
          iconContainer.className =
            "w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500 scale-110";
          icon.className =
            "fas fa-check text-5xl text-green-600 transition-transform duration-500";
          title.textContent = "C'est prêt !";
          title.className = "text-4xl font-black text-green-600 tracking-tight";
          subtitle.textContent = "Présentez-vous au comptoir pour la récupérer.";

          // 🪄 LE BOUTON FINAL !
          if (actionBtn) {
            actionBtn.innerHTML =
              "<i class='fas fa-running mr-2' aria-hidden='true'></i> J'arrive au comptoir !";
            actionBtn.className =
              "w-full bg-green-600 text-white font-black py-4 rounded-xl text-lg shadow-lg hover:bg-green-700 transition active:scale-95";
            actionBtn.setAttribute(
              "aria-label",
              "Fermer la fenêtre. Commande prête à être retirée.",
            );
            actionBtn.onclick = window.closeTrackingModal;
          }

          // Alertes système
          window.showToast("🔔 DING ! Votre commande est PRÊTE !", "success");
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

          // On ouvre la modale automatiquement pour être sûr qu'il le voie !
          openTrackingModal();
        }

        // ⚪ STATUT : TERMINÉE (L'archive)
        else if (commande.statut === "terminee") {
          window.showToast("Bon appétit ! À bientôt.", "success");

          // 1. On oublie la commande en cours
          localStorage.removeItem("activeOrderId");

          // 2. On cache le bouton jaune qui flotte
          if (trackingBadge) {
            trackingBadge.className = "hidden";
          }

          // 3. ON FERME LA MODALE DE SUIVI
          if (typeof window.closeTrackingModal === "function") {
            window.closeTrackingModal();
          }

          // 4. On coupe l'écouteur Firebase pour ne pas facturer pour rien
          if (unsubscribeClientRadar) {
            unsubscribeClientRadar();
            unsubscribeClientRadar = null;
          }
        }
      }
    },
  );
};

// ==========================================
// 🔄 AUTOMATISATION : PAUSE / REPRISE DU RADAR
// ==========================================
document.addEventListener("visibilitychange", () => {
  const activeOrderId = localStorage.getItem("activeOrderId");

  // Si Le client n'a pas de commande en cours, on ne fait rien
  if (!activeOrderId) return;

  if (document.hidden) {
    // 🛑 Le client a quitté l'onglet ou verrouillé son téléphone : On coupe Firestore !
    if (unsubscribeClientRadar) {
      unsubscribeClientRadar();
      unsubscribeClientRadar = null;
      console.log("🔴 Radar Client EN PAUSE (Économie de requêtes).");
    }
  } else {
    // 🟢 Le client rouvre l'onglet pour vérifier où en est son Tacos : On rallume Firestore !
    if (window.snackConfig?.features?.enableClickAndCollect) {
      console.log("📡 Reprise du tracking pour la commande :", activeOrderId);
      startOrderTracking(activeOrderId);
    }
  }
});

// À l'ouverture initiale de l'application
document.addEventListener("DOMContentLoaded", () => {
  const activeOrderId = localStorage.getItem("activeOrderId");
  if (activeOrderId && window.snackConfig?.features?.enableClickAndCollect) {
    startOrderTracking(activeOrderId);
  }
});

// ============================================================================
// 🔙 GESTION NATIVE DU BOUTON RETOUR (SWIPE BACK iOS / ANDROID)
// ============================================================================

// 1. On écoute le geste "Retour" du téléphone
window.addEventListener('popstate', (event) => {
    // Le client a fait "Retour". On ferme TOUS les overlays actifs !
    
    // Ferme le Menu (si la barre d'url n'a plus #menu)
    if (window.location.hash !== '#menu') {
        const fullMenu = document.getElementById("full-menu");
        if (fullMenu && !fullMenu.classList.contains("hidden")) {
            // On appelle switchView('home') en lui disant de ne pas retoucher à l'historique
            window.switchView('home', true); 
        }
    }

    // Ferme la Modale Produit
    if (typeof window.closeProductModal === "function") window.closeProductModal(true);
    
    // Ferme le Panier
    if (typeof window.closeCartModal === "function") window.closeCartModal(true);
    
    // Ferme le tracking de commande
    if (typeof window.closeTrackingModal === "function") window.closeTrackingModal(true);
});

