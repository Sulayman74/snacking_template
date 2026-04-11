// ============================================================================
// 🍔 MODALE PRODUIT — Options, Prix, Ajout panier
// ============================================================================
// Dépendances : window.menuGlobal, window.snackConfig, window.addToCart,
//               window.showToast, window.triggerVibration

let currentProduct = null;

function openProductModal(itemId) {
  window.history.pushState(null, null, "#modal");
  const cfg = window.snackConfig;
  const item = window.menuGlobal.find((i) => i.id === itemId || i.nom === itemId);
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
    tailleChoisie: null,
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
  } else {
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
                      ${item.tailles
                        .map(
                          (taille, index) => `
                          <label class="relative cursor-pointer group">
                              <input type="radio" name="taille_produit" value="${taille.nom}" data-prix="${taille.prix}" ${index === 0 ? "checked" : ""}  class="sr-only peer">
                              <div class="h-full p-4 border-2 border-gray-100 shadow-sm rounded-2xl peer-checked:${accentBorder} peer-checked:${accentLightBg} transition-all flex flex-col items-center justify-center text-center">
                                  <span class="font-bold text-gray-900 mb-1">${taille.nom}</span>
                                  <span class="font-black ${accentText} text-sm">${taille.prix.toFixed(2)} ${devise}</span>
                              </div>
                          </label>
                      `,
                        )
                        .join("")}
                      </div>
                      ${item.ingredients ? `<p class="text-sm text-gray-500 font-medium mt-3 bg-gray-50 p-3 rounded-xl border border-gray-100"><i class="fas fa-leaf mr-2 text-green-500"></i> ${item.ingredients.join(", ")}</p>` : ""}
                  </fieldset>
                  `;
        }
        // --- MODULE 2 : BURGERS / TACOS (Seul ou Menu) ---
        else if (currentProduct.allowMenu) {
          const boissonsDispo = window.menuGlobal.filter(
            (i) => i.categorieId === "drinks" && i.isAvailable !== false,
          );
          const listeBoissons =
            boissonsDispo.length > 0
              ? boissonsDispo
              : [{ nom: "Coca-Cola" }, { nom: "Eau" }];

          allOptionsHTML += `
                  <fieldset class="mb-8">
                      <legend class="text-lg font-black text-gray-900 mb-3 flex justify-between w-full items-center">
                      <span>1. Formule</span>
                      <span class="text-xs font-bold ${primaryBg} ${textOnPrimary} px-2 py-1 rounded uppercase tracking-wider">Obligatoire</span>
                      </legend>
                      <div class="grid grid-cols-2 gap-3">
                          <label class="relative cursor-pointer">
                              <input type="radio" name="formule" value="seul" checked class="sr-only peer">
                              <div class="h-full p-4 border-2 border-gray-100 shadow-sm rounded-2xl peer-checked:${accentBorder} peer-checked:${accentLightBg} hover:border-gray-300 hover:bg-gray-50 transition-all flex flex-col items-center justify-center text-center">
                                  <i class="fas fa-hamburger text-2xl text-gray-400 mb-2 peer-checked:${accentText}"></i>
                                  <span class="font-bold text-gray-900">Seul</span>
                                  <span class="font-black text-gray-500 mt-1">${currentProduct.prixBase.toFixed(2)} ${devise}</span>
                              </div>
                          </label>

                          <label class="relative cursor-pointer">
                              <input type="radio" name="formule" value="menu" class="sr-only peer">
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
                          ${listeBoissons
                            .map(
                              (boisson, index) => `
                              <label class="relative cursor-pointer">
                                  <input type="radio" name="boisson" value="${boisson.nom}" ${index === 0 ? "checked" : ""} class="sr-only peer">
                                  <div class="p-3 border-2 border-gray-100 shadow-sm rounded-xl peer-checked:${accentBorder} peer-checked:${accentLightBg} transition-all flex items-center gap-3">
                                      <div class="w-8 h-8 flex items-center justify-center peer-checked:${primaryBg} transition-colors">
                                          <i class="fas fa-glass-water shadow-sm ${accentText}"></i>
                                      </div>
                                      <span class="font-bold text-gray-800 text-sm leading-tight">${boisson.nom}</span>
                                  </div>
                              </label>
                          `,
                            )
                            .join("")}
                      </div>
                  </fieldset>
                  `;
        }

        // --- MODULE 3 : KEBABS (Crudités) ---
        if (item.hasCrudites) {
          const listeCrudites =
            Array.isArray(item.crudites) && item.crudites.length > 0
              ? item.crudites
              : ["Salade", "Tomate", "Oignon"];
          allOptionsHTML += `
                  <fieldset class="mb-8">
                      <legend class="text-lg font-black text-gray-900 mb-3 flex justify-between w-full items-center">
                      <span>Garniture</span>
                      <span class="text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded uppercase tracking-wider">Inclus</span>
                      </legend>
                      <p class="text-sm text-gray-500 mb-3 font-medium">Décochez pour retirer un ingrédient.</p>
                      <div class="flex flex-wrap gap-3">
                          ${listeCrudites
                            .map(
                              (c) => `
                              <label class="relative cursor-pointer group">
                                  <input type="checkbox" name="crudite" value="${c}" checked class="sr-only peer">
                                  <div class="px-4 py-2 border-2 rounded-full font-bold text-sm transition-all border-red-200 bg-red-50 text-red-800 line-through opacity-70 hover:opacity-100 peer-checked:border-green-500 peer-checked:bg-green-50 peer-checked:text-green-800 peer-checked:no-underline peer-checked:opacity-100 peer-checked:hover:bg-green-100">
                                      <i class="fas fa-check mr-1 peer-checked:inline-block hidden"></i>
                                      <i class="fas fa-times mr-1 peer-checked:hidden inline-block text-gray-400"></i>
                                      ${c}
                                  </div>
                              </label>
                          `,
                            )
                            .join("")}
                      </div>
                  </fieldset>
                  `;
        }
        // --- MODULE 4 : SAUCES ---
        if (item.choixSauces) {
          const sauces = item.choixSauces.liste || [
            "Blanche",
            "Algérienne",
            "Samouraï",
            "Mayonnaise",
          ];
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
                          ${sauces
                            .map(
                              (sauce) => `
                              <label class="relative cursor-pointer block">
                                  <input type="checkbox" name="sauce" value="${sauce}" data-max="${maxSauces}" class="sr-only peer sauce-checkbox">
                                  <div class="h-full p-4 border-2 border-gray-100 shadow-sm rounded-xl peer-checked:${accentBorder} peer-checked:${accentLightBg} transition-all flex items-center justify-center text-center">
                                      <span class="font-bold text-gray-800 text-sm leading-tight">${sauce}</span>
                                  </div>
                              </label>
                          `,
                            )
                            .join("")}
                      </div>
                  </fieldset>
                  `;
        }

        if (allOptionsHTML === "") {
          optionsContainer.classList.add("hidden");
        } else {
          optionsContainer.innerHTML = allOptionsHTML;
          toggleDrinkSection();
        }
      }
    } else {
      if (optionsContainer) optionsContainer.classList.add("hidden");
    }

    // 🎯 L'AIGUILLAGE DU BOUTON PRINCIPAL (LE CTA)
    if (cfg.features?.enableClickAndCollect) {
      btn.className = `w-full py-4 rounded-xl font-bold text-white text-center shadow-lg text-lg bg-gray-900 hover:bg-black hover:-translate-y-1 transition-all flex justify-center items-center gap-2`;
      btn.innerHTML = `<span>Ajouter - ${currentProduct.prixBase.toFixed(2)} ${devise}</span>`;
      btn.setAttribute("data-action", "add-to-cart");
    } else if (!cfg.features?.enableOnlineOrder) {
      btn.innerHTML = `<i class="fas fa-times mr-2" aria-hidden="true"></i> Fermer`;
      btn.className = `w-full py-4 rounded-full font-bold text-gray-800 text-center shadow-md text-lg bg-gray-100 hover:bg-gray-200 border ${accentBorder} hover:border-gray-400 transition-all flex justify-center items-center gap-2`;
      btn.setAttribute("data-action", "close-product-modal");
    } else if (cfg.features?.enableDelivery) {
      btn.innerHTML = `<i class="fas fa-motorcycle mr-2"></i> Commander en livraison`;
      btn.className = `w-full py-4 rounded-full font-bold ${textOnPrimary} text-center shadow-lg text-lg ${primaryBg} hover:opacity-90 hover:-translate-y-1 transition-all flex justify-center items-center gap-2`;
      btn.onclick = () => {
        if (
          cfg.deliveryUrl &&
          cfg.deliveryUrl.trim() !== "" &&
          cfg.deliveryUrl !== "#"
        ) {
          window.open(cfg.deliveryUrl, "_blank");
        } else {
          window.showToast("Le lien de livraison n'est pas configuré.", "error");
          window.triggerVibration?.("error");
        }
      };
    } else {
      const phone = cfg.contact?.phone
        ? cfg.contact.phone.replace(/\s/g, "")
        : "";
      btn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> Appeler pour commander`;
      btn.className = `w-full py-4 rounded-full font-bold ${textOnPrimary} text-center shadow-lg text-lg ${primaryBg} hover:-translate-y-1 transition-all flex justify-center items-center gap-2`;
      btn.onclick = () => {
        if (phone) {
          window.location.href = `tel:${phone}`;
        } else {
          window.showToast("Numéro non renseigné", "error");
          window.triggerVibration?.("error");
        }
      };
    }
  }

  // 🔗 LOGIQUE DU BOUTON PARTAGE VIRAL
  const shareBtn = document.getElementById("modal-share-btn");
  if (shareBtn) {
    if (cfg.features?.enableViralShare === true) {
      shareBtn.classList.remove("hidden");
      shareBtn.classList.add("flex");

      shareBtn.onclick = () => {
        if (navigator.share) {
          navigator
            .share({
              title: `Découvre le ${currentProduct.nom} !`,
              text: `Regarde ce que j'ai trouvé chez ${cfg.identity.name} : ${currentProduct.nom}`,
              url: window.location.href,
            })
            .then(() => console.log("Partage réussi"))
            .catch((error) => console.log("Erreur de partage", error));
        } else {
          window.showToast("Le partage n'est pas supporté ici", "error");
        }
      };
    } else {
      shareBtn.classList.add("hidden");
      shareBtn.classList.remove("flex");
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
}

// ============================================================================
// 🍹 BASCULE AFFICHAGE BOISSONS
// ============================================================================
function toggleDrinkSection() {
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

  window.triggerVibration?.("light");

  if (isMenu) {
    if (drinkSection) {
      drinkSection.classList.remove("hidden");
      setTimeout(() => {
        drinkSection.classList.remove("translate-y-4", "opacity-0");
        drinkSection.classList.add("translate-y-0", "opacity-100");
      }, 20);
    }
    if (btn) {
      btn.innerHTML = `<span>Ajouter - ${(currentProduct.prixBase + currentProduct.prixMenu).toFixed(2)} ${devise}</span>`;
    }
  } else {
    if (drinkSection) {
      drinkSection.classList.remove("translate-y-0", "opacity-100");
      drinkSection.classList.add("translate-y-4", "opacity-0");
      setTimeout(() => drinkSection.classList.add("hidden"), 300);
    }
    if (btn) {
      btn.innerHTML = `<span>Ajouter - ${currentProduct.prixBase.toFixed(2)} ${devise}</span>`;
    }
  }
}

// ============================================================================
// 🛠️ HELPERS (Sauces, Tailles)
// ============================================================================
function checkSauceLimit(event, max) {
  const checkedBoxes = document.querySelectorAll(".sauce-checkbox:checked");
  const counterUI = document.getElementById("sauce-counter-ui");

  if (counterUI) {
    counterUI.textContent = checkedBoxes.length;
    if (checkedBoxes.length === max) {
      counterUI.parentElement.classList.replace("bg-gray-900", "bg-green-600");
    } else {
      counterUI.parentElement.classList.replace("bg-green-600", "bg-gray-900");
    }
  }

  if (checkedBoxes.length > max) {
    event.target.checked = false;
    if (counterUI) counterUI.textContent = max;
    window.showToast(`Maximum ${max} sauces autorisées !`, "error");
    window.triggerVibration?.("error");
  } else {
    window.triggerVibration?.("light");
  }
}

function updateProductSize(radioBtn) {
  const nouveauPrix = parseFloat(radioBtn.getAttribute("data-prix"));
  currentProduct.prixBase = nouveauPrix;
  currentProduct.tailleChoisie = radioBtn.value;

  const devise = window.snackConfig.identity.currency || "€";
  document.getElementById("modal-cta").innerHTML =
    `<span>Ajouter - ${nouveauPrix.toFixed(2)} ${devise}</span>`;
  window.triggerVibration?.("light");
}

// ============================================================================
// 🛒 VALIDATION ET AJOUT AU PANIER
// ============================================================================
function confirmAddToCart() {
  const formuleInput = document.querySelector('input[name="formule"]:checked');
  const isMenu = formuleInput ? formuleInput.value === "menu" : false;

  let nomFinal = currentProduct.nom;
  let prixFinal = currentProduct.prixBase;
  let boissonChoisie = null;

  if (currentProduct.tailleChoisie) {
    nomFinal += `${currentProduct.tailleChoisie}`;
  }

  if (isMenu) {
    const boissonInput = document.querySelector('input[name="boisson"]:checked');
    if (!boissonInput)
      return window.showToast("🥤 Veuillez choisir une boisson.", "error");
    boissonChoisie = boissonInput.value;
    nomFinal = `Menu ${currentProduct.nom}`;
    prixFinal += currentProduct.prixMenu;
  }

  const saucesCheckboxes = document.querySelectorAll(".sauce-checkbox:checked");
  const saucesChoisies = Array.from(saucesCheckboxes).map((cb) => cb.value);

  const cruditesCheckboxes = document.querySelectorAll('input[name="crudite"]');
  const cruditesEnlevees = [];
  cruditesCheckboxes.forEach((cb) => {
    if (!cb.checked) cruditesEnlevees.push(`Sans ${cb.value}`);
  });

  const optionsString = [
    ...saucesChoisies,
    ...cruditesEnlevees,
    boissonChoisie,
    currentProduct.tailleChoisie,
  ]
    .filter(Boolean)
    .join("-");
  const uniqueId = `${currentProduct.id}-${isMenu ? "menu" : "seul"}-${optionsString.replace(/[\s\(\)]/g, "")}`;

  window.addToCart({
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
}

// ============================================================================
// ❌ FERMETURE MODALE
// ============================================================================
function closeProductModal() {
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
}

window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;
window.toggleDrinkSection = toggleDrinkSection;
window.checkSauceLimit = checkSauceLimit;
window.updateProductSize = updateProductSize;
window.confirmAddToCart = confirmAddToCart;
