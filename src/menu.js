// ============================================================================
// 🍔 MENU — Chargement Firestore, Rendu HTML, Recherche
// ============================================================================
// Dépendances : window.menuGlobal, window.snackConfig, window.fs, window.db

import { escapeHTML } from "./utils.js";

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
      tagText = escapeHTML(item.tags[0]);
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

  const imageUrl = item.image && item.image.trim() !== "" ? item.image : null;

  const fallbackHtml = `
      <div class="absolute inset-0 flex items-center justify-center ${secondaryBg} z-0 transition duration-700 ${imageOpacity}">
          <i class="fas fa-hamburger text-6xl text-black opacity-50"></i>
      </div>`;

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
    const snapshot = await getDocs(q);

    let tousLesProduits = [];
    window.menuGlobal.length = 0;

    snapshot.forEach((doc) => {
      const item = { id: doc.id, ...doc.data() };
      tousLesProduits.push(item);
      window.menuGlobal.push(item);
    });

    const cfg = window.snackConfig;

    // 🏆 AFFICHER LES BEST SELLERS (Méthode Hybride)
    if (bestSellersContainer) {
      bestSellersContainer.innerHTML = "";

      const top3 = [...tousLesProduits]
        .sort((a, b) => {
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

          if (isAStar && !isBStar) return -1;
          if (!isAStar && isBStar) return 1;

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

      const categoriesMap = new Map();

      tousLesProduits.forEach((produit) => {
        if (!produit.categorieId) return;

        if (!categoriesMap.has(produit.categorieId)) {
          categoriesMap.set(produit.categorieId, {
            id: produit.categorieId,
            title: produit.categorieTitre || produit.categorieId,
            icon: produit.icon || "🍽️",
            items: [],
          });
        }

        categoriesMap.get(produit.categorieId).items.push(produit);
      });

      let menuCategories = Array.from(categoriesMap.values());

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
        if (indexA === -1) indexA = 999;
        if (indexB === -1) indexB = 999;
        return indexA - indexB;
      });

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
// 🔍 MOTEUR DE RECHERCHE EN MÉMOIRE (0 FIRESTORE)
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("menu-search-input");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  const fullMenuContainer = document.getElementById("full-menu-container");
  const bestSellersContainer = document.getElementById("bestsellers-container");

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

      if (searchTerm.length > 0) {
        clearSearchBtn.classList.remove("hidden");

        if (fullMenuContainer) fullMenuContainer.classList.add("hidden");
        if (bestSellersContainer && bestSellersContainer.parentElement) {
          bestSellersContainer.parentElement.classList.add("hidden");
        }

        searchResultsContainer.classList.remove("hidden");

        const resultats = window.menuGlobal.filter((produit) => {
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

        if (resultats.length === 0) {
          searchResultsContainer.innerHTML = `
                        <div class="col-span-full text-center py-12">
                            <div class="text-6xl mb-4">🕵️‍♂️</div>
                            <h3 class="text-xl font-black text-gray-800">Aucun résultat</h3>
                            <p class="text-gray-500 mt-2">Nous n'avons rien trouvé pour "${e.target.value}"</p>
                        </div>
                    `;
        } else {
          searchResultsContainer.innerHTML = resultats
            .map((item) => createProductCard(item, cfg))
            .join("");
        }
      } else {
        clearSearchBtn.classList.add("hidden");
        if (fullMenuContainer) fullMenuContainer.classList.remove("hidden");
        if (bestSellersContainer && bestSellersContainer.parentElement) {
          bestSellersContainer.parentElement.classList.remove("hidden");
        }
        searchResultsContainer.classList.add("hidden");
        searchResultsContainer.innerHTML = "";
      }
    });

    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
      searchInput.focus();
    });
  }
});
