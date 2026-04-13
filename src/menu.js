// ============================================================================
// 🍔 MENU — Chargement Firestore, Rendu HTML, Recherche
// ============================================================================
// Dépendances : window.menuGlobal, window.snackConfig, window.fs, window.db

import { escapeHTML } from "./utils.js";

// Verrou pour éviter les conflits entre clic manuel et Scroll Spy
let isManualScrolling = false;

function createProductCard(item, cfg, isLarge = false) {
  const isClassic = cfg.theme.templateId === "classic";
  const cardBg = isClassic ? "bg-gray-800" : "bg-white";
  const textColor = isClassic ? "text-white" : "text-gray-900";
  const secondaryTextColor = isClassic ? "text-gray-400" : "text-gray-500";

  const isAvailable = item.isAvailable !== false;
  const clickAction = isAvailable
    ? `data-action="open-product-modal" data-id="${item.id || item.nom}"`
    : `data-action="error-toast" data-message="Produit momentanément indisponible"`;

  const devise = item.devise || cfg.identity.currency || "€";
  const prixAffiche = parseFloat(item.prix || item.price || 0).toFixed(2);
  const nomAffiche = escapeHTML(item.nom || item.name);
  const descriptionAffiche = escapeHTML(item.description || "");
  const categoryAffiche = escapeHTML(item.categorieTitre || item.categorieId || "");
  const imageUrl = item.image && item.image.trim() !== "" ? item.image : null;

  const searchTerms = `${nomAffiche} ${descriptionAffiche} ${categoryAffiche}`.toLowerCase();

  let badgeHtml = "";
  if (!isAvailable) {
    badgeHtml = `<span class="bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-md uppercase">Épuisé</span>`;
  } else if (item.tags) {
    const tag = Array.isArray(item.tags) ? item.tags[0] : item.tags;
    if (tag) badgeHtml = `<span class="bg-primary text-on-primary text-[10px] font-black px-2 py-1 rounded-md uppercase">${escapeHTML(tag)}</span>`;
  }

  const fallbackIcon = `<div class="w-full h-full flex items-center justify-center bg-gray-100 text-primary/30"><i class="fas fa-hamburger text-3xl"></i></div>`;

  const layoutClass = isLarge 
    ? `flex-col min-w-[280px] md:min-w-0 snap-center` 
    : `flex md:flex-col items-center gap-4 p-3 md:p-0 border border-gray-100 md:border-transparent`;
  
  const imgClass = isLarge
    ? `w-full h-48`
    : `w-24 h-24 md:w-full md:h-48 rounded-2xl md:rounded-none`;

  const infoPadding = isLarge ? `p-5` : `flex-1 md:p-4`;

  return `
    <div class="${cardBg} flex ${layoutClass} rounded-3xl md:rounded-2xl overflow-hidden group transition-all duration-300 hover:shadow-xl shadow-sm" 
         ${clickAction} 
         data-search="${searchTerms}">
        
        <div class="${imgClass} shrink-0 relative overflow-hidden bg-gray-100">
            ${imageUrl 
              ? `<img src="${imageUrl}" alt="${nomAffiche}" loading="lazy" 
                  onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
                  class="w-full h-full object-cover transition duration-500 group-hover:scale-110 ${!isAvailable ? 'grayscale opacity-50' : ''}">
                 <div style="display: none;" class="w-full h-full items-center justify-center bg-gray-100 text-primary/30">${fallbackIcon}</div>`
              : fallbackIcon
            }
            ${!isAvailable ? '<div class="absolute inset-0 bg-black/20 backdrop-blur-[1px]"></div>' : ''}
        </div>

        <div class="${infoPadding} flex flex-col justify-between h-full w-full">
            <div>
                <div class="flex items-center gap-2 mb-1">
                    ${badgeHtml}
                    <h3 class="text-base md:text-lg font-bold ${textColor} leading-tight line-clamp-1">${nomAffiche}</h3>
                </div>
                <p class="text-xs ${secondaryTextColor} line-clamp-2 md:mb-4">${descriptionAffiche}</p>
            </div>

            <div class="flex items-center justify-between mt-2 md:mt-auto">
                <span class="text-lg font-black text-primary">${prixAffiche}${devise}</span>
                <button class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gray-900 text-white flex items-center justify-center hover:scale-110 active:scale-95 transition-transform">
                    <i class="fas ${isAvailable ? 'fa-plus' : 'fa-ban text-xs'}"></i>
                </button>
            </div>
        </div>
    </div>`;
}

window.chargerMenuComplet = async () => {
  const fullMenuContainer = document.getElementById("full-menu-container");
  const bestSellersContainer = document.getElementById("bestsellers-container");
  const categoriesNav = document.getElementById("menu-categories-nav");
  const scrollContainer = document.getElementById("full-menu");
  const snackId = window.snackConfig?.identity?.id;

  if (!snackId) return;

  try {
    const { query, collection, where, getDocs } = window.fs;
    const snapshot = await getDocs(query(collection(window.db, "produits"), where("snackId", "==", snackId)));

    let tousLesProduits = [];
    window.menuGlobal.length = 0;
    snapshot.forEach((doc) => {
      const item = { id: doc.id, ...doc.data() };
      tousLesProduits.push(item);
      window.menuGlobal.push(item);
    });

    const cfg = window.snackConfig;

    if (bestSellersContainer) {
      const top3 = [...tousLesProduits].sort((a, b) => (b.ventes || 0) - (a.ventes || 0)).slice(0, 3);
      if (top3.length > 0) {
        bestSellersContainer.innerHTML = top3.map(item => `<div>${createProductCard(item, cfg, true)}</div>`).join("");
      } else {
        bestSellersContainer.innerHTML = "<p class='text-gray-400 col-span-full text-center py-10'>Découvrez nos produits ci-dessous.</p>";
      }
    }

    if (fullMenuContainer) {
        const categoriesMap = new Map();
        tousLesProduits.forEach(p => {
          if (!p.categorieId) return;
          if (!categoriesMap.has(p.categorieId)) {
            const rawTitle = p.categorieTitre || p.categorieId;
            const cleanTitle = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
            categoriesMap.set(p.categorieId, { id: p.categorieId, title: cleanTitle, icon: p.icon || "🍽️", items: [] });
          }
          categoriesMap.get(p.categorieId).items.push(p);
        });

        const menuCategories = Array.from(categoriesMap.values()).sort((a, b) => {
          const ordre = ["tacos", "burgers", "wraps", "pizzas", "sides", "drinks", "deserts"];
          return (ordre.indexOf(a.id) === -1 ? 99 : ordre.indexOf(a.id)) - (ordre.indexOf(b.id) === -1 ? 99 : ordre.indexOf(b.id));
        });

        // Helper pour mettre à jour l'UI des boutons
        const updateActivePill = (catId) => {
            if (!categoriesNav) return;
            const activeBtn = categoriesNav.querySelector(`[data-target="cat-${catId}"]`);
            if (activeBtn) {
                categoriesNav.querySelectorAll('.cat-pill').forEach(b => {
                    b.classList.remove('bg-gray-900', 'text-white', 'border-primary');
                    b.classList.add('bg-gray-100', 'text-gray-600');
                });
                activeBtn.classList.add('bg-gray-900', 'text-white', 'border-primary');
                activeBtn.classList.remove('bg-gray-100', 'text-gray-600');
                activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        };

        if (categoriesNav) {
          categoriesNav.innerHTML = menuCategories.map(cat => `
            <button data-target="cat-${cat.id}" class="cat-pill whitespace-nowrap px-4 py-2 rounded-xl bg-gray-100 text-gray-600 font-bold text-sm transition-all active:scale-95 flex items-center gap-2 border-2 border-transparent">
                <span>${cat.icon}</span>
                <span>${cat.title}</span>
            </button>
          `).join("");

          categoriesNav.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
              const targetId = btn.getAttribute('data-target');
              const targetEl = document.getElementById(targetId);
              
              if (targetEl && scrollContainer) {
                // On active immédiatement le bouton pour un feedback visuel instantané
                isManualScrolling = true;
                const catId = targetId.replace('cat-', '');
                updateActivePill(catId);

                // Calcul précis du scroll
                const headerHeight = document.querySelector('#full-menu .sticky')?.offsetHeight || 120;
                const targetPos = (targetEl.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top) + scrollContainer.scrollTop - headerHeight - 10;
                
                scrollContainer.scrollTo({ top: targetPos, behavior: 'smooth' });

                // On libère le Scroll Spy après l'animation (environ 600ms)
                setTimeout(() => { isManualScrolling = false; }, 800);
              }
            });
          });
        }

        fullMenuContainer.innerHTML = menuCategories.map(cat => `
          <div id="cat-${cat.id}" class="menu-section mb-10 pt-4" data-cat-id="${cat.id}" style="scroll-margin-top: 140px;">
              <div class="flex items-center gap-3 mb-6">
                  <span class="text-2xl">${cat.icon}</span>
                  <h2 class="text-2xl font-black text-gray-900 uppercase tracking-tight">${cat.title}</h2>
                  <div class="flex-1 h-px bg-gray-100"></div>
                  <span class="text-xs font-bold text-gray-400">${cat.items.length} items</span>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  ${cat.items.map(item => createProductCard(item, cfg, false)).join("")}
              </div>
          </div>
        `).join("");

        const observerOptions = {
          root: scrollContainer,
          rootMargin: '-130px 0px -70% 0px',
          threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
          if (isManualScrolling) return; // Ne pas interférer pendant un clic

          const isAtBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 50;
          if (isAtBottom) return;

          entries.forEach(entry => {
            if (entry.isIntersecting) {
              updateActivePill(entry.target.getAttribute('data-cat-id'));
            }
          });
        }, observerOptions);

        fullMenuContainer.querySelectorAll('.menu-section').forEach(section => observer.observe(section));

        scrollContainer.addEventListener('scroll', () => {
            if (isManualScrolling) return;
            const isAtBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 20;
            if (isAtBottom && menuCategories.length > 0) {
                updateActivePill(menuCategories[menuCategories.length - 1].id);
            }
        }, { passive: true });
    }

    window.dispatchEvent(new CustomEvent("snack:menu:ready"));
  } catch (error) {
    console.error("🔥 Erreur Menu :", error);
  }
};

// ============================================================================
// 🔍 RECHERCHE & UX
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("menu-search-input");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  const fullMenuContainer = document.getElementById("full-menu-container");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim();
      clearSearchBtn.classList.toggle("hidden", term.length === 0);

      const items = fullMenuContainer?.querySelectorAll('[data-id]');
      if (!items) return;
      
      items.forEach(card => {
        const searchPool = card.getAttribute('data-search') || "";
        const isMatch = searchPool.includes(term);
        card.style.display = isMatch ? "" : "none";
      });

      fullMenuContainer.querySelectorAll('.menu-section').forEach(section => {
        const visibleCards = section.querySelectorAll('[data-id]:not([style*="display: none"])');
        section.style.display = visibleCards.length > 0 ? "" : "none";
      });
    });

    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
      searchInput.focus();
    });
  }
});
