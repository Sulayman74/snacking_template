// ============================================================================
// 🛒 PANIER — Logique, Affichage, Modal
// ============================================================================
// Dépendances : window.cart, window.showToast, window.triggerVibration

import { escapeHTML } from "./utils.js";

// Écouteur global de la réactivité du panier
document.addEventListener("cart-updated", () => {
  updateCartUI();

  const cartModal = document.getElementById("cart-modal");
  if (cartModal && !cartModal.classList.contains("translate-y-full")) {
    renderCartItems();
  }
});

document.addEventListener("DOMContentLoaded", updateCartUI);

function addToCart(itemData) {
  const existingItem = window.cart.find((item) => item.id === itemData.id);

  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    window.cart.push({ ...itemData, quantity: 1 });
  }

  window.triggerVibration?.("light");
  window.showToast(`${itemData.nom} ajouté au panier ! 🍔`, "success");
}

function updateQuantity(productId, delta) {
  const index = window.cart.findIndex((i) => i.id === productId);

  if (index !== -1) {
    window.triggerVibration?.("light");

    const newQuantity = window.cart[index].quantity + delta;

    if (newQuantity <= 0) {
      window.cart.splice(index, 1);
    } else {
      window.cart[index] = { ...window.cart[index], quantity: newQuantity };
    }
  }
}

function getCartTotal() {
  return window.cart.reduce((total, item) => total + item.prix * item.quantity, 0);
}

function updateCartUI() {
  // Plus besoin du "floating-cart-container" ou du "cart-badge" original !
  const mobileBadge = document.getElementById("mobile-cart-badge"); // Badge Mobile
  const desktopCtaBtn = document.getElementById("cta-nav"); // Bouton PC

  const totalItems = window.cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = getCartTotal().toFixed(2);

  if (totalItems > 0) {
    // 📱 MISE À JOUR MOBILE
    if (mobileBadge) {
        mobileBadge.textContent = totalItems;
        mobileBadge.classList.remove("hidden");
        // Petit effet de rebond dynamique
        mobileBadge.classList.add("scale-125");
        setTimeout(() => mobileBadge.classList.remove("scale-125"), 200);
    }

    // 💻 MISE À JOUR PC (Navbar CTA)
    if (desktopCtaBtn && desktopCtaBtn.getAttribute("data-action") === "open-cart") {
        desktopCtaBtn.innerHTML = `<i class="fas fa-shopping-bag mr-2"></i> ${totalAmount} €`;
    }

  } else {
    // 🛑 PANIER VIDE : On cache le badge et on reset le bouton PC
    if (mobileBadge) mobileBadge.classList.add("hidden");

    if (desktopCtaBtn && desktopCtaBtn.getAttribute("data-action") === "open-cart") {
        desktopCtaBtn.innerHTML = `<i class="fas fa-shopping-bag mr-2 "></i> Commander`;
    }
  }
}

function openCartModal() {
  renderCartItems();
  document
    .getElementById("cart-backdrop")
    .classList.remove("opacity-0", "pointer-events-none");
  document.getElementById("cart-modal").classList.remove("translate-y-full");
}

function closeCartModal() {
  document
    .getElementById("cart-backdrop")
    .classList.add("opacity-0", "pointer-events-none");
  document.getElementById("cart-modal").classList.add("translate-y-full");
}

function renderCartItems() {
  const container = document.getElementById("cart-items-container");
  container.innerHTML = "";

  if (window.cart.length === 0) {
    container.innerHTML = `<p class="text-center py-10 text-gray-500">Votre panier est vide.</p>`;
    document.getElementById("checkout-btn").disabled = true;
    document.getElementById("checkout-btn").classList.add("opacity-50");
  } else {
    document.getElementById("checkout-btn").disabled = false;
    document.getElementById("checkout-btn").classList.remove("opacity-50");

    window.cart.forEach((item) => {
      let detailsText = [];
      if (item.boisson) detailsText.push(`🥤 ${escapeHTML(item.boisson)}`);
      if (item.sauces && item.sauces.length > 0) {
        const safeSauces = item.sauces.map((s) => escapeHTML(s)).join(", ");
        detailsText.push(`🥣 ${safeSauces}`);
      }

      if (item.sansCrudites && item.sansCrudites.length > 0) {
        const safeCrudites = item.sansCrudites
          .map((c) => escapeHTML(c))
          .join(", ");
        detailsText.push(
          `<span class="text-red-600 font-black">⚠️ ${safeCrudites}</span>`,
        );
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
                <h2 class="font-bold text-gray-900 leading-tight truncate">${safeNom}</h2>
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

window.addToCart = addToCart;
window.updateQuantity = updateQuantity;
window.getCartTotal = getCartTotal;
window.updateCartUI = updateCartUI;
window.openCartModal = openCartModal;
window.closeCartModal = closeCartModal;
window.renderCartItems = renderCartItems;
