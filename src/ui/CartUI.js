/**
 * 🎨 CartUI — Gestion de l'affichage du Panier (SOLID: Présentation)
 */
import { store } from "../core/Store.js";
import "../components/SnackCartList.js"; // Import du Web Component Lit

class CartUI {
    constructor() {
        this.container = document.getElementById("cart-items-container");
        this.totalPriceEl = document.getElementById("cart-total-price");
        this.mobileBadge = document.getElementById("mobile-cart-badge");
        this.desktopCtaBtn = document.getElementById("cta-nav");
        this.cartModal = document.getElementById("cart-modal");
        this.cartBackdrop = document.getElementById("cart-backdrop");
        this.checkoutBtn = document.getElementById("checkout-btn");
        this.lastFocused = null;

        this.init();
    }

    init() {
        // Injection du Web Component (Une seule fois !)
        if (this.container) {
            this.container.innerHTML = "<snack-cart-list class='block h-full'></snack-cart-list>";
        }

        // Écoute les changements du Store pour mettre à jour les totaux et badges (UI périphérique)
        store.addEventListener("cart-updated", () => this.render());
        // Le mode/adresse de livraison change les frais → re-render du total.
        store.addEventListener("delivery-updated", () => this.updateTotal(store.state.cart));
        
        // Initialisation de l'affichage
        document.addEventListener("DOMContentLoaded", () => this.render());

        // Gestion du Focus Trap
        this.cartModal.addEventListener('keydown', (e) => this.handleFocusTrap(e));
    }

    render() {
        const { cart } = store.state;
        this.renderItems(cart);
        this.updateBadges(cart);
        this.updateTotal(cart);
        
        // Render lucide icons again
        if (window.lucide && this.desktopCtaBtn) {
            window.lucide.createIcons({ root: this.desktopCtaBtn });
        }
    }

    renderItems(cart) {
        // La liste des items est gérée par <snack-cart-list> de façon autonome.
        // CartUI s'occupe juste d'activer/désactiver le bouton de validation.
        if (this.checkoutBtn) {
            if (cart.length === 0) {
                this.checkoutBtn.disabled = true;
                this.checkoutBtn.classList.add("opacity-50");
            } else {
                this.checkoutBtn.disabled = false;
                this.checkoutBtn.classList.remove("opacity-50");
            }
        }
    }

    updateBadges(cart) {
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        const totalAmount = cart.reduce((total, item) => total + item.prix * item.quantity, 0).toFixed(2);

        if (totalItems > 0) {
            if (this.mobileBadge) {
                this.mobileBadge.textContent = totalItems;
                this.mobileBadge.classList.remove("hidden");
                this.mobileBadge.classList.add("scale-125");
                setTimeout(() => this.mobileBadge.classList.remove("scale-125"), 200);
            }

            if (this.desktopCtaBtn && this.desktopCtaBtn.getAttribute("data-action") === "open-cart") {
                this.desktopCtaBtn.innerHTML = `<i data-lucide="shopping-bag" class="mr-2"></i> ${totalAmount} €`;
            }
        } else {
            if (this.mobileBadge) this.mobileBadge.classList.add("hidden");
            if (this.desktopCtaBtn && this.desktopCtaBtn.getAttribute("data-action") === "open-cart") {
                this.desktopCtaBtn.innerHTML = `<i data-lucide="shopping-bag" class="mr-2"></i> Commander`;
            }
        }
    }

    updateTotal(cart) {
        // Total à payer = articles + frais de livraison éventuels (cf. cart.js).
        const total = typeof window.getCartTotal === "function"
            ? window.getCartTotal()
            : cart.reduce((sum, item) => sum + item.prix * item.quantity, 0);
        if (this.totalPriceEl) {
            this.totalPriceEl.textContent = `${total.toFixed(2)} €`;
        }
    }

    open() {
        this.lastFocused = document.activeElement;
        this.render();
        this.cartBackdrop.classList.remove("opacity-0", "pointer-events-none");
        this.cartModal.classList.remove("translate-y-full");
        // `inert` (best practice) gère focus + interactions + cache aux AT.
        this.cartModal.removeAttribute('inert');

        // Focus sur le premier élément interactif après l'animation d'ouverture
        setTimeout(() => {
            const firstFocusable = this.cartModal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (firstFocusable) firstFocusable.focus();
        }, 300);
    }

    close() {
        this.cartBackdrop.classList.add("opacity-0", "pointer-events-none");
        this.cartModal.classList.add("translate-y-full");
        // `inert` retire automatiquement le focus de tout descendant focusé,
        // ce qui supprime le warning A11Y déclenché par aria-hidden.
        this.cartModal.setAttribute('inert', '');

        // Restaure le focus sur l'ouvreur (WCAG 2.4.3 Focus Order).
        if (this.lastFocused && typeof this.lastFocused.focus === "function") {
            this.lastFocused.focus();
        }
    }

    handleFocusTrap(e) {
        const focusableElements = this.cartModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.key === 'Tab') {
            if (e.shiftKey) { // Shift + Tab
                if (document.activeElement === firstElement) {
                    lastElement.focus();
                    e.preventDefault();
                }
            } else { // Tab
                if (document.activeElement === lastElement) {
                    firstElement.focus();
                    e.preventDefault();
                }
            }
        }

        if (e.key === 'Escape') {
            this.close();
        }
    }
}

export const cartUI = new CartUI();
