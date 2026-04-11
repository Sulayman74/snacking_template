// ============================================================================
// 🗄️ STATE — Panier réactif & Menu global
// ============================================================================

let menuGlobal = [];
window.menuGlobal = menuGlobal;

let cartData = JSON.parse(localStorage.getItem("snackCart")) || [];
let cartUpdateTimeout;

let cart = new Proxy(cartData, {
  set(target, property, value) {
    target[property] = value;

    // Anti-spam : on regroupe les multiples mises à jour
    clearTimeout(cartUpdateTimeout);
    cartUpdateTimeout = setTimeout(() => {
      localStorage.setItem("snackCart", JSON.stringify(target));
      document.dispatchEvent(
        new CustomEvent("cart-updated", { detail: target }),
      );
    }, 10);

    return true;
  },
});
window.cart = cart;
