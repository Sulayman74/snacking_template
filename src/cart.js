/**
 * 🛒 PANIER — Pont de compatibilité (Phase 2 : SRP)
 * La logique est dans Store.js, le rendu est dans ui/CartUI.js
 */
import { cartUI } from "./ui/CartUI.js";

// Exportation globale pour compatibilité avec le reste de l'app (Phase 3 viendra nettoyer cela)
window.openCartModal = () => cartUI.open();
window.closeCartModal = () => cartUI.close();

// Ces méthodes sont maintenant gérées par le Store, mais on garde les ponts si nécessaire
window.addToCart = (item) => {
    import("./core/Store.js").then(({ store }) => {
        store.addToCart(item);
    });
};

window.updateQuantity = (id, delta) => {
    import("./core/Store.js").then(({ store }) => {
        store.updateQuantity(id, delta);
    });
};

// Note: updateCartUI et renderCartItems ne devraient plus être appelés manuellement 
// car CartUI écoute les événements du Store.
window.updateCartUI = () => cartUI.render();
window.renderCartItems = () => cartUI.render();
