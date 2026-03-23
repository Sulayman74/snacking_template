// import "./bridge.js";
import "./snack-config.js";
import "./firebase-init.js";

// ============================================================================
// 🛠️ OUTIL DE DEBUG MAC : SIMULATEUR DE VIBRATIONS
// ============================================================================
if (
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
) {
  // On ne fait ça qu'en mode développement sur ton Mac !

  // On sauvegarde la vraie fonction (s'il y en a une)
  const originalVibrate = navigator.vibrate.bind(navigator);

  // On remplace la fonction par notre simulateur console
  navigator.vibrate = function (pattern) {
    // 1. On affiche le log stylé dans la console du Mac
    const texteLog = Array.isArray(pattern)
      ? `Pattern [${pattern.join(", ")}ms]`
      : `Secousse ${pattern}ms`;
    console.log(
      `%c📳 VIBRATION DÉTECTÉE : ${texteLog}`,
      "background: #222; color: #ffeb3b; padding: 4px 8px; border-radius: 4px; font-weight: bold;",
    );

    // 2. On essaie quand même d'exécuter la vraie fonction si on est sur mobile
    try {
      return originalVibrate(pattern);
    } catch (e) {
      return true; // Fait croire au code que ça a marché
    }
  };

  // Si l'API n'existe pas du tout (ex: Safari Desktop), on la simule !
  if (!("vibrate" in navigator)) {
    navigator.vibrate = function (pattern) {
      const texteLog = Array.isArray(pattern)
        ? `Pattern [${pattern.join(", ")}ms]`
        : `Secousse ${pattern}ms`;
      console.log(
        `%c📳 VIBRATION SIMULÉE (API Absente) : ${texteLog}`,
        "background: #ff5722; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: bold;",
      );
      return true;
    };
  }
}
// ============================================================================

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

  // 5. Retirer le Splash Screen
  // const splash = document.getElementById("splash-screen");
  // if (splash) {
  //   splash.classList.add("opacity-0");
  //   setTimeout(() => splash.remove(), 500);
  // }
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

    // 🌮 AFFICHER LE MENU PAR CATÉGORIES
    if (fullMenuContainer) {
      fullMenuContainer.innerHTML = "";
      const menuCategories = [
        { id: "tacos", title: "Tacos", icon: "🌮", items: [] },
        { id: "burgers", title: "Burgers", icon: "🍔", items: [] },
        { id: "wraps", title: "Wraps & Sandwichs", icon: "🌯", items: [] },
        { id: "sides", title: "Sides", icon: "🍟", items: [] },
        { id: "drinks", title: "Boissons", icon: "🥤", items: [] },
        { id: "deserts", title: "Desserts", icon: "🍰", items: [] },
      ];

      tousLesProduits.forEach((produit) => {
        const cat = menuCategories.find((c) => c.id === produit.categorieId);
        if (cat) cat.items.push(produit);
      });

      menuCategories
        .filter((c) => c.items.length > 0)
        .forEach((cat, catIndex) => {
          let sectionHTML = `
                <div class="mb-12 animate-fade-in-up" style="animation-fill-mode: both; animation-delay: ${catIndex * 200}ms;">
                    <div class="sticky top-0 z-30 bg-gray-200/95 backdrop-blur-md py-4 flex items-center mb-6 shadow-sm -mx-4 px-4 md:mx-0 md:shadow-none md:rounded-lg md:p-2">
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
    ? `onclick="openProductModal('${item.id || item.nom}')"`
    : `onclick="showToast('Produit momentanément indisponible', 'error')"`;

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
      tagHtml = `<span class="absolute top-3 right-3 z-10 ${cardBg} ${textColor} text-xs font-bold px-3 py-1.5 rounded-full uppercase shadow-lg tracking-wider">${tagText}</span>`;
    }
  }

  const devise = item.devise || cfg.identity.currency || "€";
  const prixAffiche = item.prix || item.price || 0;
  const nomAffiche = item.nom || item.name;

  // Création du Fallback minimaliste avec icône + gestion des images cassées (onerror)
  const imageUrl = item.image && item.image.trim() !== "" ? item.image : null;

  // Le bloc HTML de remplacement (juste une icône centrée, pas de texte lourd)
  const fallbackHtml = `
      <div class="absolute inset-0 flex items-center justify-center ${secondaryBg} z-0 transition duration-700 ${imageOpacity}">
          <i class="fas fa-hamburger text-6xl ${textOnPrimary} opacity-50"></i>
      </div>`;

  // Astuce : onerror affiche le div fallback caché juste en dessous si l'image est cassée en BDD
  const imageHtml = imageUrl
    ? `<img src="${imageUrl}" alt="${nomAffiche}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="absolute inset-0 w-full h-full object-cover transition duration-700 ${imageOpacity} z-0">
       <div style="display: none;" class="absolute inset-0 items-center justify-center ${secondaryBg} z-0 transition duration-700 ${imageOpacity}">
           <i class="fas fa-hamburger text-6xl ${textOnPrimary} opacity-50"></i>
       </div>`
    : fallbackHtml;

  return `
    <div class="${cardBg} rounded-2xl overflow-hidden group ${cardOpacity} transition-all duration-300 hover:shadow-2xl" ${clickAction}>
        <div class="h-48 relative overflow-hidden ${secondaryBg}">
            ${imageHtml}
            ${tagHtml}
        </div>
        <div class="p-5 flex flex-col justify-between h-[calc(100%-12rem)]">
            <div>
                <div class="flex justify-between items-start mb-2 gap-2">
                    <h2 class="text-lg font-bold ${textColor} leading-tight">${nomAffiche}</h2>
                    <span class="text-xl font-black ${priceColor} whitespace-nowrap">${parseFloat(prixAffiche).toFixed(2)}${devise}</span>
                </div>
                <p class="text-sm text-gray-200 mb-6 line-clamp-2">${item.description || ""}</p>
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

window.switchView = function (viewName) {
  const fullMenu = document.getElementById("full-menu");
  const mobileOverlay = document.getElementById("mobile-menu-overlay");
  const mobileBtnIcon = document.querySelector("#mobile-menu-btn i");

  const navIndicator = document.getElementById("nav-indicator");
  const btnHome = document.getElementById("nav-btn-home");
  const btnMenu = document.getElementById("nav-btn-menu");

  if (viewName === "menu") {
    // 1. Déplacement de la pilule avec précision (calculé sur 3 colonnes)
    if (navIndicator) {
      // On utilise 200% car elle se décale de 2 fois sa largeur
      navIndicator.style.transform = "translateX(200%)";
    }

    // 2. Gestion des états actifs (Couleurs + Animations)
    btnHome?.classList.replace("text-white", "text-gray-400");
    btnMenu?.classList.replace("text-gray-400", "text-white");

    // Ajout d'une classe pour déclencher l'animation de rebond sur l'icône
    btnMenu?.classList.add("nav-active");
    btnHome?.classList.remove("nav-active");

    fullMenu.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    // Fermeture propre du menu burger
    if (mobileOverlay && !mobileOverlay.classList.contains("hidden")) {
      mobileOverlay.classList.replace("opacity-100", "opacity-0");
      setTimeout(() => {
        mobileOverlay.classList.add("hidden");
        mobileOverlay.classList.remove("flex");
      }, 300);
      mobileBtnIcon?.classList.replace("fa-times", "fa-bars");
    }
  } else {
    // Retour à l'accueil
    if (navIndicator) navIndicator.style.transform = "translateX(0%)";

    btnHome?.classList.replace("text-gray-400", "text-white");
    btnMenu?.classList.replace("text-white", "text-gray-400");

    btnHome?.classList.add("nav-active");
    btnMenu?.classList.remove("nav-active");

    fullMenu.classList.add("hidden");
    document.body.style.overflow = "";

    if (viewName === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
};

// ============================================================================
// window.openProductModal = function (itemId) {
//   const cfg = window.snackConfig;
//   const item = menuGlobal.find((i) => i.id === itemId || i.nom === itemId);
//   if (!item) return;

//   const devise = item.devise || cfg.identity.currency || "€";
//   const prixAffiche = item.prix || item.price || 0;
//   const nomAffiche = item.nom || item.name;

//   document.getElementById("modal-img").src = item.image;
//   document.getElementById("modal-title").innerText = nomAffiche;
//   document.getElementById("modal-price").innerText =
//     parseFloat(prixAffiche).toFixed(2) + devise;
//   document.getElementById("modal-desc").innerText = item.description || "";

//   const tagsContainer = document.getElementById("modal-tags");
//   tagsContainer.innerHTML = "";
//   if (item.tags) {
//     let tagText = Array.isArray(item.tags) ? item.tags[0] : item.tags;
//     if (tagText) {
//       tagsContainer.innerHTML = `<span class="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm font-bold shadow-sm">${tagText}</span>`;
//     }
//   }

//   const allergenContainer = document.getElementById(
//     "modal-allergens-container",
//   );
//   const allergenesList = item.allergenes || item.allergens;
//   if (allergenesList && allergenesList.length > 0) {
//     allergenContainer.classList.remove("hidden");
//     document.getElementById("modal-allergens").innerText =
//       allergenesList.join(", ");
//   } else {
//     allergenContainer.classList.add("hidden");
//   }

//  const btn = document.getElementById("modal-cta");

//   // 1. SI LE PRODUIT EST ÉPUISÉ (Priorité absolue)
//   if (item.isAvailable === false) {
//     btn.innerHTML = `<i class="fas fa-ban mr-2"></i> Épuisé`;
//     btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-gray-500 cursor-not-allowed flex justify-center items-center gap-2`;
//     btn.removeAttribute("href");
//     btn.onclick = null; // On bloque le clic
//   }
//   // 2. SI LE RESTO EST EN MODE VITRINE (Pack Starter : Pas de commande)
//   else if (cfg.features && cfg.features.enableOnlineOrder === false) {
//     btn.innerHTML = `<i class="fas fa-times mr-2" aria-hidden="true" ></i> Fermer`;
//     btn.className = `w-full cursor-pointer py-4 rounded-xl font-bold text-gray-800 text-center shadow-md text-lg bg-gray-100 hover:bg-gray-200 transition-all mt-auto flex justify-center items-center gap-2`;
//     btn.removeAttribute("href");
//     // Le bouton sert juste à fermer la modale
//     btn.onclick = (e) => {
//         e.preventDefault();
//         closeProductModal();
//     };
//   }
//   // 3. SI LE RESTO FAIT DE LA LIVRAISON EXTERNE (UberEats, Deliveroo...)
//   else if (cfg.features && cfg.features.enableDelivery === true) {
//     btn.href = cfg.deliveryUrl || "#"; // Lien vers sa page UberEats (à rajouter dans Firestore si besoin)
//     btn.setAttribute("target", "_blank"); // Ouvre dans un nouvel onglet
//     btn.innerHTML = `<i class="fas fa-motorcycle mr-2"></i> Commander en livraison`;
//     const primaryBg = cfg.theme?.colors?.primary?.split(" ")[0] || "bg-red-600";
//     btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg ${primaryBg} hover:opacity-90 hover:-translate-y-1 transition-all mt-auto flex justify-center items-center gap-2`;
//     btn.onclick = null;
//   }
//   // 4. MODE PAR DÉFAUT : CLICK & COLLECT (Appel téléphonique)
//   else {
//     const phone = cfg.contact.phone ? cfg.contact.phone.replace(/\s/g, "") : "";
//     btn.href = `tel:${phone}`;
//     btn.removeAttribute("target");
//     btn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> Commander `;
//     btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-green-600 hover:bg-green-700 hover:-translate-y-1 transition-all mt-auto flex justify-center items-center gap-2`;
//     btn.onclick = null;
//   }

//   const backdrop = document.getElementById("product-modal-backdrop");
//   const sheet = document.getElementById("product-modal");

//   backdrop.classList.remove("hidden");

//   // ==========================================
//   // 🚀 LOGIQUE DE PARTAGE VIRAL (Web Share API)
//   // ==========================================
//   const shareBtn = document.getElementById("modal-share-btn");

//   // On vérifie si le téléphone supporte le partage natif (95% des mobiles récents)
//   if (
//     shareBtn &&
//     cfg.features &&
//     cfg.features.enableViralShare &&
//     navigator.share
//   ) {
//     shareBtn.classList.remove("hidden"); // On affiche le bouton

//     shareBtn.onclick = async () => {
//       try {
//         // 📳 Petit clic haptique pour la sensation d'app native !
//         if (typeof window.triggerVibration === "function")
//           window.triggerVibration("light");

//         await navigator.share({
//           title: `Découvre ${nomAffiche} chez ${cfg.identity.name} !`,
//           text: `Mec, regarde cette dinguerie : ${nomAffiche} à ${parseFloat(prixAffiche).toFixed(2)}${devise}. On teste ça quand ? 🤤🍔`,
//           url: window.location.href, // Envoie le lien de ton site
//         });

//         // 📳 Double vibration de succès si le partage a fonctionné
//         if (typeof window.triggerVibration === "function")
//           window.triggerVibration("success");
//       } catch (err) {
//         console.log("Le client a fermé le menu de partage ou erreur :", err);
//       }
//     };
//   } else if (shareBtn) {
//     // Si le navigateur (ex: un vieux PC) ne supporte pas le partage, on cache le bouton
//     shareBtn.classList.add("hidden");
//   }

//   setTimeout(() => {
//     backdrop.classList.remove("opacity-0");
//     sheet.classList.remove("translate-y-full"); // Mobile
//     sheet.classList.remove(
//       "md:opacity-0",
//       "md:pointer-events-none",
//       "md:scale-95",
//     ); // PC
//   }, 10);

//   document.body.style.overflow = "hidden";
// };

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
  navigator
    .clearAppBadge()
    .catch((error) => console.log("Erreur badge", error));
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
      const originalText = submitBtn.innerText;
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

// ====================================================================
// 🚀 MOTEUR E-COMMERCE (PANIER & CHECKOUT)
// ====================================================================

// --- 1. VARIABLES D'ÉTAT ---
let cart = JSON.parse(localStorage.getItem("snackCart")) || [];
let currentProduct = null;

// Au chargement de la page, on met à jour la bulle rouge
document.addEventListener("DOMContentLoaded", updateCartUI);

// --- 2. GESTION DU PRODUIT (Modale Choix) ---
// ============================================================================
// 🍔 GESTION DE LA MODALE PRODUIT (Unifiée & Feature Flags)
// ============================================================================

window.openProductModal = function (itemId) {
  const cfg = window.snackConfig;
  const item = menuGlobal.find((i) => i.id === itemId || i.nom === itemId);
  if (!item) return;

  // 1. Définition du produit (pour le panier)
  currentProduct = {
    id: item.id,
    nom: item.nom || item.name,
    prixBase: item.prix || item.price || 0,
    prixMenu: item.menuPriceAdd || 2.5, // Supplément menu (à ajuster si besoin)
    image: item.image,
    // 🎯 NOUVEAU : On lit la valeur de allowMenu (true par défaut si non spécifié)
    allowMenu: item.allowMenu !== false,
  };

  const devise = cfg.identity.currency || "€";

  // ==========================================
  // 2. REMPLIR LA MODALE & GÉRER L'IMAGE (FALLBACK)
  // ==========================================
  const modalImg = document.getElementById("modal-img");
  const imgContainer = modalImg.parentElement;

  const oldFallback = document.getElementById("modal-img-fallback");
  if (oldFallback) oldFallback.remove();

  const imageUrl =
    currentProduct.image && currentProduct.image.trim() !== ""
      ? currentProduct.image
      : null;

  const fallbackHTML = `
      <div id="modal-img-fallback" class="absolute inset-0 flex items-center justify-center bg-gray-50 rounded-t-3xl md:rounded-t-none md:rounded-l-3xl z-0">
          <i class="fas fa-hamburger text-6xl text-gray-300 opacity-50"></i>
      </div>
  `;

  if (imageUrl) {
    modalImg.style.display = "block";
    modalImg.src = imageUrl;
    modalImg.onerror = function () {
      this.style.display = "none";
      if (!document.getElementById("modal-img-fallback")) {
        imgContainer.insertAdjacentHTML("beforeend", fallbackHTML);
      }
    };
  } else {
    modalImg.style.display = "none";
    imgContainer.insertAdjacentHTML("beforeend", fallbackHTML);
  }

  document.getElementById("modal-title").innerText = currentProduct.nom;
  document.getElementById("modal-desc").innerText = item.description || "";

  // 3. Gérer les allergènes
  const allergenContainer = document.getElementById(
    "modal-allergens-container",
  );
  const allergenesList = item.allergenes || item.allergens;
  if (allergenesList && allergenesList.length > 0) {
    allergenContainer.classList.remove("hidden");
    document.getElementById("modal-allergens").innerText =
      allergenesList.join(", ");
  } else {
    allergenContainer.classList.add("hidden");
  }

  // ==========================================
  // 🚦 L'AIGUILLAGE MAGIQUE DES FEATURE FLAGS ET THÈMES
  // ==========================================
  const btn = document.getElementById("modal-cta");
  const optionsContainer = document.getElementById("modal-options-container");

  const isClickAndCollect =
    cfg.features && cfg.features.enableClickAndCollect === true;
  const isPhoneOrder = cfg.features && cfg.features.enableOnlineOrder === true;

  if (item.isAvailable === false) {
    // 🚫 1. PRODUIT ÉPUISÉ (Priorité absolue)
    if (optionsContainer) optionsContainer.classList.add("hidden");
    btn.innerHTML = `<i class="fas fa-ban mr-2"></i> Épuisé`;
    btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-gray-500 cursor-not-allowed flex justify-center items-center gap-2`;
    btn.removeAttribute("href");
    btn.onclick = null;
  } else if (isClickAndCollect) {
    // 🛒 2. MODE PANIER (Click & Collect = true) -> E-commerce pur

    if (optionsContainer) {
      if (currentProduct.allowMenu) {
        // ✅ MENU AUTORISÉ (Le client peut choisir Frites + Boisson)
        optionsContainer.classList.remove("hidden");

        // 🎨 Thème dynamique
        const accentColor = cfg.theme.colors.accent || "text-red-600";
        const lightBgColor = cfg.theme.colors.lightBg || "bg-gray-50";
        const bgFocusColor = accentColor.replace("text-", "focus:ring-");

        // 🥤 Récupère les vraies boissons depuis Firestore
        const boissonsDispo = menuGlobal.filter(
          (item) => item.categorieId === "drinks" && item.isAvailable !== false,
        );
        const listeBoissons =
          boissonsDispo.length > 0
            ? boissonsDispo
            : [{ nom: "Coca-Cola" }, { nom: "Eau" }];

        const drinksHTML = listeBoissons
          .map(
            (boisson, index) => `
                  <label class="flex items-center gap-3 p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition shadow-sm bg-white">
                      <input type="radio" name="boisson" value="${boisson.nom}" ${index === 0 ? "checked" : ""} class="w-5 h-5 ${accentColor} ${bgFocusColor}">
                      <span class="text-sm font-bold text-gray-700">${boisson.nom}</span>
                  </label>
              `,
          )
          .join("");

        // INJECTION DU HTML DANS LA MODALE
        optionsContainer.innerHTML = `
                  <h3 class="font-bold text-sm text-gray-900 mb-2 border-b pb-1">1. Choisissez votre formule</h3>
                  <div class="space-y-2 mb-4">
                      <label class="flex items-center justify-between p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition">
                          <div class="flex items-center gap-3">
                              <input type="radio" name="formule" value="seul" checked onchange="toggleDrinkSection()" class="w-4 h-4 ${accentColor} ${bgFocusColor}">
                              <span class="font-medium text-black text-sm">Seul</span>
                          </div>
                          <span id="modal-price-seul" class="text-black font-bold text-sm">${currentProduct.prixBase.toFixed(2)} ${devise}</span>
                      </label>
                      <label class="flex items-center justify-between p-3 border border-gray-200 rounded-xl cursor-pointer hover:${lightBgColor} transition">
                          <div class="flex items-center gap-3">
                              <input type="radio" name="formule" value="menu" onchange="toggleDrinkSection()" class="w-4 h-4 ${accentColor} ${bgFocusColor}">
                              <div>
                                  <span class="font-medium text-black text-sm block">En Menu</span>
                                  <span class="text-[10px] ${accentColor} uppercase font-bold">Frites + Boisson</span>
                              </div>
                          </div>
                          <span id="modal-price-menu" class="font-bold text-sm ${accentColor}">+ ${currentProduct.prixMenu.toFixed(2)} ${devise}</span>
                      </label>
                  </div>

                  <div id="drink-section" class="hidden opacity-0 transition-opacity duration-300">
                      <h4 class="font-bold text-sm text-gray-900 mb-2 border-b pb-1">2. Choix de la boisson</h4>
                      <div class="grid grid-cols-2 gap-2" id="drinks-container">
                          ${drinksHTML}
                      </div>
                  </div>
              `;

        if (typeof window.toggleDrinkSection === "function")
          window.toggleDrinkSection();
      } else {
        // 🚫 MENU NON AUTORISÉ (C'est un dessert, une boisson, etc.)
        optionsContainer.classList.add("hidden");
        optionsContainer.innerHTML = ""; // On nettoie pour éviter des bugs radio
        btn.innerHTML = `<span>Ajouter - ${currentProduct.prixBase.toFixed(2)} ${devise}</span>`;
      }
    }

    btn.removeAttribute("href");
    btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-gray-900 hover:bg-black hover:-translate-y-1 transition-all mt-auto flex justify-center items-center gap-2`;
    btn.onclick = window.confirmAddToCart;
  } else if (isPhoneOrder) {
    // ☎️ 3. MODE APPEL (ClickAndCollect = false) -> Commande par téléphone
    if (optionsContainer) optionsContainer.classList.add("hidden");

    const phone = cfg.contact.phone ? cfg.contact.phone.replace(/\s/g, "") : "";
    btn.href = `tel:${phone}`;
    btn.removeAttribute("target");
    btn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> Appeler pour commander`;
    btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-green-600 hover:bg-green-700 hover:-translate-y-1 transition-all mt-auto flex justify-center items-center gap-2`;
    btn.onclick = null;
  } else {
    // 🛑 4. MODE VITRINE PUR -> Juste consulter le menu
    if (optionsContainer) optionsContainer.classList.add("hidden");
    btn.innerHTML = `<i class="fas fa-times mr-2" aria-hidden="true" ></i> Fermer`;
    btn.className = `w-full cursor-pointer py-4 rounded-xl font-bold text-gray-800 text-center shadow-md text-lg bg-gray-100 hover:bg-gray-200 transition-all mt-auto flex justify-center items-center gap-2`;
    btn.removeAttribute("href");
    btn.onclick = (e) => {
      e.preventDefault();
      closeProductModal();
    };
  }

  // ==========================================
  // 🚀 LOGIQUE DE PARTAGE VIRAL (Web Share)
  // ==========================================
  const shareBtn = document.getElementById("modal-share-btn");

  if (shareBtn && cfg.features && cfg.features.enableViralShare) {
    shareBtn.classList.remove("hidden");
    shareBtn.onclick = async () => {
      if (typeof window.triggerVibration === "function")
        window.triggerVibration("light");
      const shareTitle = `Découvre ${currentProduct.nom} chez ${cfg.identity?.name || "nous"} !`;
      const shareText = `Mec, regarde cette dinguerie : ${currentProduct.nom} à ${currentProduct.prixBase.toFixed(2)}${devise}. On teste ça quand ? 🤤🍔`;
      const shareUrl = window.location.href;

      if (navigator.share) {
        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            url: shareUrl,
          });
          if (typeof window.triggerVibration === "function")
            window.triggerVibration("success");
        } catch (err) {
          console.log("Partage annulé ou fermé.");
        }
      } else if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(
            `${shareTitle}\n${shareText}\nLien : ${shareUrl}`,
          );
          if (typeof window.showToast === "function")
            window.showToast(
              "Lien copié dans le presse-papier ! 📋",
              "success",
            );
        } catch (err) {
          console.error("Erreur de copie");
        }
      }
    };
  } else if (shareBtn) {
    shareBtn.classList.add("hidden");
  }

  // Affichage de la Modale
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

// ============================================================================
// 🍹 BASCULE AFFICHAGE BOISSONS (Si l'option Menu est cochée)
// ============================================================================
window.toggleDrinkSection = function () {
  const formuleInput = document.querySelector('input[name="formule"]:checked');
  if (!formuleInput) return; // Sécurité si "allowMenu" est false

  const isMenu = formuleInput.value === "menu";
  const drinkSection = document.getElementById("drink-section");
  const btn = document.getElementById("modal-cta");
  const devise = window.snackConfig.identity.currency || "€";

  if (isMenu) {
    drinkSection.classList.remove("hidden");
    setTimeout(() => drinkSection.classList.remove("opacity-0"), 10);
    btn.innerHTML = `<span>Ajouter - ${(currentProduct.prixBase + currentProduct.prixMenu).toFixed(2)} ${devise}</span>`;
  } else {
    drinkSection.classList.add("opacity-0");
    setTimeout(() => drinkSection.classList.add("hidden"), 300);
    btn.innerHTML = `<span>Ajouter - ${currentProduct.prixBase.toFixed(2)} ${devise}</span>`;
  }
};

window.toggleDrinkSection = function () {
  const isMenu =
    document.querySelector('input[name="formule"]:checked').value === "menu";
  const drinkSection = document.getElementById("drink-section");
  const btn = document.getElementById("modal-cta");
  const devise = window.snackConfig.identity.currency || "€";

  if (isMenu) {
    drinkSection.classList.remove("hidden");
    setTimeout(() => drinkSection.classList.remove("opacity-0"), 10);
    btn.innerHTML = `<span>Ajouter - ${(currentProduct.prixBase + currentProduct.prixMenu).toFixed(2)} ${devise}</span>`;
  } else {
    drinkSection.classList.add("opacity-0");
    setTimeout(() => drinkSection.classList.add("hidden"), 300);
    btn.innerHTML = `<span>Ajouter - ${currentProduct.prixBase.toFixed(2)} ${devise}</span>`;
  }
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

window.confirmAddToCart = function () {
  // 🛡️ SÉCURITÉ : On cherche le bouton radio. S'il n'existe pas (car allowMenu = false), isMenu devient automatiquement false !
  const formuleInput = document.querySelector('input[name="formule"]:checked');
  const isMenu = formuleInput ? formuleInput.value === "menu" : false;

  let nomFinal = currentProduct.nom;
  let prixFinal = currentProduct.prixBase;
  let boissonChoisie = null;

  if (isMenu) {
    const boissonInput = document.querySelector(
      'input[name="boisson"]:checked',
    );
    if (!boissonInput) {
      window.showToast("🥤 Oups ! Veuillez choisir une boisson.", "error");
      return;
    }
    boissonChoisie = boissonInput.value;
    nomFinal = `Menu ${currentProduct.nom} (+ ${boissonChoisie})`;
    prixFinal += currentProduct.prixMenu;
  }

  const uniqueId = isMenu
    ? `${currentProduct.id}-menu-${Date.now()}`
    : `${currentProduct.id}-seul`;

  addToCart({
    id: uniqueId, // ID unique pour que le panier ne mélange pas les items
    productId: currentProduct.id, // 🎯 NOUVEAU : On garde le VRAI ID du produit pour les stats !
    nom: nomFinal,
    prix: prixFinal,
    image: currentProduct.image,
    type: isMenu ? "menu" : "seul",
    boisson: boissonChoisie,
    prixBase: currentProduct.prixBase,
    prixMenuAdd: isMenu ? currentProduct.prixMenu : 0,
  });

  closeProductModal();
};

// --- 3. GESTION DU PANIER (Logique) ---
function addToCart(itemData) {
  // Si on a bien reçu notre objet complet
  const existingItem = cart.find((item) => item.id === itemData.id);

  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    // On pousse tout l'objet dans le tableau du panier !
    cart.push({
      ...itemData,
      quantity: 1,
    });
  }
  if (typeof window.triggerVibration === "function") {
    window.triggerVibration("light");
  }

  saveCart();
  updateCartUI();
  window.showToast(`${itemData.nom} ajouté au panier ! 🍔`, "success");
}

function saveCart() {
  localStorage.setItem("snackCart", JSON.stringify(cart));
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
window.openCartModal = function () {
  renderCartItems();
  document
    .getElementById("cart-backdrop")
    .classList.remove("opacity-0", "pointer-events-none");
  document.getElementById("cart-modal").classList.remove("translate-y-full");
};

window.closeCartModal = function () {
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
      // 1. GESTION DU FALLBACK IMAGE
      const imageUrl =
        item.image && item.image.trim() !== "" ? item.image : null;

      const fallbackHtml = `
                <div class="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200">
                    <i class="fas fa-hamburger text-gray-300 text-xl" aria-hidden="true"></i>
                </div>`;

      // Si le lien casse (erreur 404), onerror cache l'image et affiche l'icône de secours
      const imageHtml = imageUrl
        ? `<div class="relative w-16 h-16 shrink-0">
                       <img src="${imageUrl}" alt="${item.nom}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="absolute inset-0 w-full h-full rounded-lg object-cover z-10">
                       <div style="display: none;" class="absolute inset-0 rounded-lg bg-gray-100 items-center justify-center border border-gray-200 z-0">
                           <i class="fas fa-hamburger text-gray-300 text-xl" aria-hidden="true"></i>
                       </div>
                   </div>`
        : fallbackHtml;

      // 2. INJECTION HTML 100% ACCESSIBLE
      container.innerHTML += `
                <div class="flex items-center gap-4 bg-white p-3 rounded-xl border" role="group" aria-label="Article du panier : ${item.nom}">
                    ${imageHtml}
                    <div class="flex-1">
                        <h2 class="font-bold text-gray-900">${item.nom}</h2>
                        <p class="text-red-600 font-bold" aria-label="Prix total pour cet article : ${(item.prix * item.quantity).toFixed(2)} euros">
                            ${(item.prix * item.quantity).toFixed(2)} €
                        </p>
                    </div>
                    <div class="flex items-center gap-3 bg-gray-50 rounded-lg p-1" aria-label="Gestion de la quantité">
                        
                        <button type="button" onclick="updateQuantity('${item.id}', -1)" aria-label="Retirer un exemplaire de ${item.nom}" class="w-8 h-8 text-gray-600 hover:bg-gray-200 rounded-md transition focus:outline-none focus:ring-2 focus:ring-red-500">
                            <i class="fas fa-minus text-xs" aria-hidden="true"></i>
                        </button>
                        
                        <span class="font-bold w-4 text-black text-center text-sm" aria-label="Quantité : ${item.quantity}" aria-live="polite">
                            ${item.quantity}
                        </span>
                        
                        <button type="button" onclick="updateQuantity('${item.id}', 1)" aria-label="Ajouter un exemplaire de ${item.nom}" class="w-8 h-8 text-gray-600 hover:bg-gray-200 rounded-md transition focus:outline-none focus:ring-2 focus:ring-red-500">
                            <i class="fas fa-plus text-xs" aria-hidden="true"></i>
                        </button>
                        
                    </div>
                </div>
            `;
    });
  }
  document.getElementById("cart-total-price").textContent =
    `${getCartTotal().toFixed(2)} €`;
}

window.updateQuantity = function (productId, delta) {
  const item = cart.find((i) => i.id === productId);

  if (typeof window.triggerVibration === "function") {
    window.triggerVibration("light");
  }
  
  if (item) {
    item.quantity += delta;
    if (item.quantity <= 0) cart = cart.filter((i) => i.id !== productId);
    saveCart();
    updateCartUI();
    renderCartItems();
  }
};

// --- 5. L'ENVOI FINAL (Firebase Checkout) ---

// ==========================================
// 💳 PROCESSUS DE COMMANDE & CLICK&COLLECT
// ==========================================
window.processCheckout = async () => {
  if (cart.length === 0)
    return window.showToast("Votre panier est vide", "error");

  const btn = document.getElementById("checkout-btn");
  const originalText = btn.innerHTML;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Envoi en cuisine...`;
  btn.disabled = true;

  try {
    const currentSnackId =
      window.snackConfig?.identity?.id || "Ym1YiO4Ue5Fb5UXlxr06";
    const currentUser = window.auth?.currentUser;

    // Sécurité : On force la connexion pour commander (ou on gère les invités)
    if (!currentUser) {
      window.showToast("Veuillez vous connecter pour commander", "error");
      window.toggleAuthModal();
      btn.innerHTML = originalText;
      btn.disabled = false;
      return;
    }

    // 1. Formatage du Panier pour Firestore
    const orderItems = cart.map((item) => {
      const prixUnitaire = item.prix || 0;
      return {
        id: item.id,
        productId: item.productId || item.id.split("-")[0], // 🎯 On l'envoie à Firebase
        nom: item.nom,
        image: item.image || "",
        type: item.type || "seul",
        boissonNom: item.boisson || null,
        prixBase: item.prixBase || prixUnitaire,
        prixMenuAdd: item.prixMenuAdd || 0,
        prixTotalLigne: prixUnitaire * item.quantity,
        quantity: item.quantity,
      };
    });

    const { addDoc, collection, serverTimestamp } = window.fs;

    // 2. Création du Document Commande
    const newOrder = {
      snackId: currentSnackId,
      userId: currentUser.uid,
      clientNom: currentUser.displayName || currentUser.email.split("@")[0],
      clientEmail: currentUser.email,
      date: serverTimestamp(),
      statut: "en_attente_client",
      items: orderItems,
      total: getCartTotal(),
      paiement: {
        methode: "sur_place",
        statut: "en_attente",
        stripeSessionId: null,
      },
    };

    // 3. Envoi dans le Cloud Firebase
    const docRef = await addDoc(collection(window.db, "commandes"), newOrder);

    // 4. Vider le panier
    cart.length = 0; // 1. Vide la variable
    if (typeof saveCart === "function") saveCart(); // 2. Vide le localStorage (très important !)
    if (typeof updateCartUI === "function") updateCartUI(); // 3. Enlève le badge rouge

    // Ferme la modale du panier
    if (typeof window.closeCartModal === "function") {
      window.closeCartModal();
    } else if (typeof window.toggleCartModal === "function") {
      window.toggleCartModal();
    }

    if (typeof window.triggerVibration === "function") {
      window.triggerVibration("jackpot");
    }
    window.showToast("🎉 Commande envoyée en cuisine !", "success");

    // 5. 🎯 LA MAGIE CLICK & COLLECT : On mémorise la commande !
    if (window.snackConfig?.features?.enableClickAndCollect) {
      localStorage.setItem("activeOrderId", docRef.id);
      startOrderTracking(docRef.id);
    }
  } catch (error) {
    console.error("❌ Erreur Checkout :", error);
    window.showToast("Erreur lors de la commande.", "error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
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

// La fameuse fonction "Toggle" (Ouvre si c'est fermé, ferme si c'est ouvert)
window.toggleCartModal = () => {
  const modal = document.getElementById("cart-modal");
  if (modal) {
    // Si le panier est caché en bas (translate-y-full), on l'ouvre
    if (modal.classList.contains("translate-y-full")) {
      window.openCartModal();
    } else {
      window.closeCartModal();
    }
  }
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
    orderIdText.innerText = "#" + orderId.slice(-4).toUpperCase();

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
          badgeText.innerText = "En attente de votre arrivée";

          iconContainer.className =
            "w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500";
          icon.className =
            "fas fa-car text-5xl text-gray-500 transition-transform duration-500 animate-pulse";
          title.innerText = "Commande reçue !";
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
          badgeText.innerText = "Commande en cours";

          iconContainer.className =
            "w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500";
          icon.className =
            "fas fa-fire text-5xl text-yellow-500 transition-transform duration-500 animate-pulse";
          title.innerText = "En cuisine !";
          title.className = "text-3xl font-black text-gray-900 tracking-tight";
          subtitle.innerText = "Le chef prépare votre commande.";

          // On remet le bouton en mode "Fermeture" normal
          if (actionBtn) {
            actionBtn.innerHTML = "Super, j'attends !";
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
          badgeText.innerText = "C'EST PRÊT !";

          // La modale passe au vert
          iconContainer.className =
            "w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500 scale-110";
          icon.className =
            "fas fa-check text-5xl text-green-600 transition-transform duration-500";
          title.innerText = "C'est prêt !";
          title.className = "text-4xl font-black text-green-600 tracking-tight";
          subtitle.innerText = "Présentez-vous au comptoir pour la récupérer.";

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
