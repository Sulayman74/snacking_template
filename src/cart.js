/**
 * 🛒 PANIER — Pont de compatibilité (Phase 2 : SRP)
 * La logique est dans Store.js, le rendu est dans ui/CartUI.js
 */
import { store } from "./core/Store.js";
import { cartUI } from "./ui/CartUI.js";

// --- PONTS DE COMPATIBILITÉ (Legacy) ---
// Ces exports permettent au reste de l'application (checkout.js, etc.) 
// d'accéder au panier sans avoir à importer le Store.

Object.defineProperty(window, "cart", {
    get: () => store.state.cart,
    configurable: true
});

window.getCartTotal = () => {
    return store.state.cart.reduce((acc, item) => acc + (item.prix * item.quantity), 0);
};

window.openCartModal = () => cartUI.open();
window.closeCartModal = () => cartUI.close();

// Ces méthodes sont maintenant gérées par le Store, mais on garde les ponts si nécessaire
window.addToCart = (item) => store.addToCart(item);
window.updateQuantity = (id, delta) => store.updateQuantity(id, delta);
window.clearCart = () => store.clearCart();

// Note: updateCartUI et renderCartItems ne devraient plus être appelés manuellement 
// car CartUI écoute les événements du Store.
window.updateCartUI = () => cartUI.render();
window.renderCartItems = () => cartUI.render();
