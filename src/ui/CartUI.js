/**
 * 🎨 CartUI — Gestion de l'affichage du Panier (SOLID: Présentation)
 */
import { formatCustomizationDetails } from "../utils.js";
import { store } from "../core/Store.js";

class CartUI {
    constructor() {
        this.container = document.getElementById("cart-items-container");
        this.totalPriceEl = document.getElementById("cart-total-price");
        this.mobileBadge = document.getElementById("mobile-cart-badge");
        this.desktopCtaBtn = document.getElementById("cta-nav");
        this.cartModal = document.getElementById("cart-modal");
        this.cartBackdrop = document.getElementById("cart-backdrop");
        this.checkoutBtn = document.getElementById("checkout-btn");
        this.template = document.getElementById("cart-item-template");
        this.progressBar = document.getElementById("cart-progress-bar");
        this.lastFocused = null;

        this.init();
    }

    init() {
        // Écoute les changements du Store
        store.addEventListener("cart-updated", () => this.render());
        // Le mode/adresse de livraison change les frais → re-render du total + barre.
        store.addEventListener("delivery-updated", () => {
            this.updateTotal(store.state.cart);
            this.updateProgressBar(store.state.cart);
        });
        // L'état favori (cœur) des lignes dépend de la liste des favoris.
        store.addEventListener("favorites-updated", () => this.render());
        
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
        this.updateProgressBar(cart);
    }

    /**
     * Nudge panier moyen : barre de progression vers le minimum de commande en
     * LIVRAISON. N'affiche rien hors livraison, sans minimum, panier vide, ou une
     * fois le seuil atteint (le conteneur `empty:hidden` se masque seul).
     * @param {Array<Object>} cart - Lignes du panier.
     */
    updateProgressBar(cart) {
        if (!this.progressBar) return;
        const cfg = store.state.config || window.snackConfig;
        const delivery = store.state.delivery || { mode: "collect" };
        const minOrder = Number(cfg?.delivery?.minOrder) || 0;

        const subtotal = typeof window.getCartSubtotal === "function"
            ? window.getCartSubtotal()
            : cart.reduce((sum, item) => sum + item.prix * item.quantity, 0);

        // Conditions d'affichage : mode livraison, minimum défini, panier non vide,
        // et seuil pas encore atteint (sinon on masque → pas de bruit visuel).
        const remaining = minOrder - subtotal;
        if (delivery.mode !== "delivery" || minOrder <= 0 || cart.length === 0 || remaining <= 0) {
            this.progressBar.innerHTML = "";
            return;
        }

        const pct = Math.min(100, Math.round((subtotal / minOrder) * 100));
        this.progressBar.innerHTML = `
            <div class="rounded-xl bg-surface-3 p-3">
              <p class="text-sm font-medium text-text mb-2">Plus que <span class="font-bold text-primary">${remaining.toFixed(2)} €</span> pour commander en livraison 🛵</p>
              <div class="h-2 w-full rounded-full bg-line overflow-hidden">
                <div class="h-full rounded-full bg-primary transition-all duration-300" style="width:${pct}%"></div>
              </div>
            </div>`;
    }

    renderItems(cart) {
        if (!this.container) return;
        this.container.innerHTML = "";

        if (cart.length === 0) {
            this.container.innerHTML = `<p class="text-center py-10 text-text-muted">Votre panier est vide.</p>`;
            if (this.checkoutBtn) {
                this.checkoutBtn.disabled = true;
                this.checkoutBtn.classList.add("opacity-50");
            }
            return;
        }

        if (this.checkoutBtn) {
            this.checkoutBtn.disabled = false;
            this.checkoutBtn.classList.remove("opacity-50");
        }

        const fragment = document.createDocumentFragment();

        cart.forEach(item => {
            const clone = this.template.content.cloneNode(true);
            
            // Image
            const img = clone.querySelector(".cart-item-image");
            const fallback = clone.querySelector(".cart-item-fallback");
            if (item.image && item.image.trim() !== "") {
                img.src = item.image;
                img.alt = item.nom;
                img.onerror = () => {
                    img.style.display = 'none';
                    fallback.style.display = 'flex';
                };
            } else {
                img.style.display = 'none';
                fallback.style.display = 'flex';
            }

            // Textes
            clone.querySelector(".cart-item-name").textContent = item.nom;
            clone.querySelector(".cart-item-price").textContent = `${(item.prix * item.quantity).toFixed(2)} €`;
            clone.querySelector(".cart-item-quantity").textContent = item.quantity;

            // Détails (Sauces, boissons, etc.)
            const detailsContainer = clone.querySelector(".cart-item-details");
            const details = this.getDetailsHTML(item);
            if (details) {
                detailsContainer.innerHTML = details; // On utilise innerHTML car details contient des icônes/balises sécurisées par escapeHTML avant
            } else {
                detailsContainer.remove();
            }

            // Actions
            clone.querySelector(".cart-item-minus").onclick = () => store.updateQuantity(item.id, -1);
            clone.querySelector(".cart-item-plus").onclick = () => store.updateQuantity(item.id, 1);

            // Cœur "favori" — enregistre l'article personnalisé pour le re-commander.
            const favBtn = clone.querySelector(".cart-item-fav");
            if (favBtn) {
                this.applyFavState(favBtn, item);
                favBtn.onclick = async () => {
                    await window.favoritesService?.toggle(item);
                    this.applyFavState(favBtn, item);
                };
            }

            fragment.appendChild(clone);
        });

        this.container.appendChild(fragment);
    }

    getDetailsHTML(item) {
        // Délègue au formateur partagé (DRY — même rendu que l'écran Favoris).
        return formatCustomizationDetails(item);
    }

    /** Reflète l'état favori (cœur plein/vide) du bouton d'une ligne panier. */
    applyFavState(favBtn, item) {
        const isFav = window.favoritesService?.isFavorite(item);
        const icon = favBtn.querySelector("svg, [data-lucide]");
        favBtn.setAttribute("aria-pressed", isFav ? "true" : "false");
        favBtn.setAttribute("aria-label", isFav ? "Retirer des favoris" : "Ajouter aux favoris");
        if (isFav) {
            favBtn.classList.add("text-red-500");
            favBtn.classList.remove("text-gray-300");
            icon?.classList.add("fill-current"); // cœur plein (Lucide = contour, rempli via fill-current)
        } else {
            favBtn.classList.add("text-gray-300");
            favBtn.classList.remove("text-red-500");
            icon?.classList.remove("fill-current");
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
        // Évite le warning "aria-hidden on focused descendant" et remplace
        // proprement l'usage déprécié de aria-hidden sur conteneurs interactifs.
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
