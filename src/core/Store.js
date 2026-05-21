/**
 * 🗄️ Store — Source de Vérité Unique (Flux Unidirectionnel)
 * Gère l'état de l'application de manière privée et émet des événements lors des changements.
 */
class Store extends EventTarget {
    #state = {
        cart: JSON.parse(localStorage.getItem("snackCart")) || [],
        config: null,
        menu: [],
        user: null,
        role: "client",
        // 🚚 LIVRAISON — état du tunnel de commande (mode + adresse + devis).
        // mode 'collect' par défaut → comportement legacy strictement inchangé.
        delivery: {
            mode: "collect",     // 'collect' | 'delivery'
            address: null,       // { adresse, lat, lng }
            quote: null          // { distanceKm, inRange, frais, prepMin, travelMin, totalMin }
        }
    };

    constructor() {
        super();
    }

    /**
     * Retourne une copie de l'état (lecture seule).
     */
    get state() {
        return Object.freeze({ ...this.#state });
    }

    // --- MÉTHODES DE MUTATION (Sert d'Actions/Reducers) ---

    setConfig(config) {
        this.#state.config = config;
        this.emit("config-updated");
    }

    setUser(user, role = "client") {
        this.#state.user = user;
        this.#state.role = role;
        this.emit("auth-updated");
    }

    setMenu(menu) {
        this.#state.menu = menu;
        this.emit("menu-updated");
    }

    // --- MÉTHODES PANIER (Logique métier centralisée) ---

    addToCart(itemData) {
        // On crée une nouvelle référence pour le panier pour respecter l'immutabilité conceptuelle
        const newCart = [...this.#state.cart];
        const existingItem = newCart.find(i => i.id === itemData.id);

        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            newCart.push({ ...itemData, quantity: 1 });
        }

        this.#state.cart = newCart;
        this.#persistCart();
        this.emit("cart-updated");
    }

    updateQuantity(productId, delta) {
        let newCart = [...this.#state.cart];
        const index = newCart.findIndex(i => i.id === productId);

        if (index !== -1) {
            const newQty = newCart[index].quantity + delta;

            if (newQty <= 0) {
                newCart.splice(index, 1);
            } else {
                newCart[index] = { ...newCart[index], quantity: newQty };
            }

            this.#state.cart = newCart;
            this.#persistCart();
            this.emit("cart-updated");
        }
    }

    clearCart() {
        this.#state.cart = [];
        this.#persistCart();
        this.emit("cart-updated");
    }

    // --- LIVRAISON (mode / adresse / devis) ---

    /** Bascule collect ⇄ delivery. Reset le devis car il dépend du mode. */
    setDeliveryMode(mode) {
        const next = mode === "delivery" ? "delivery" : "collect";
        this.#state.delivery = { ...this.#state.delivery, mode: next, quote: null };
        this.emit("delivery-updated");
    }

    setDeliveryAddress(address) {
        this.#state.delivery = { ...this.#state.delivery, address: address || null };
        this.emit("delivery-updated");
    }

    setDeliveryQuote(quote) {
        this.#state.delivery = { ...this.#state.delivery, quote: quote || null };
        this.emit("delivery-updated");
    }

    /** Remet le tunnel livraison à zéro (après commande validée). */
    resetDelivery() {
        this.#state.delivery = { mode: "collect", address: null, quote: null };
        this.emit("delivery-updated");
    }

    /** Frais de livraison effectifs (0 en collect ou hors zone). */
    getDeliveryFee() {
        const d = this.#state.delivery;
        if (d.mode !== "delivery" || !d.quote?.inRange) return 0;
        return Number(d.quote.frais) || 0;
    }

    // --- UPSELLING ---

    /**
     * Retourne jusqu'à `maxItems` suggestions d'upsell : produits du menu
     * dont la catégorie matche desserts/sides/boissons (FR/EN, sing/plur),
     * disponibles, et absents du panier (par productId/id).
     *
     * Match case-insensitive sur `categorieId` — ne dépend pas d'un flag
     * Firestore dédié (KISS, marche pour tous les snacks existants).
     */
    getUpsellSuggestions(maxItems = 3) {
        const menu = this.#state.menu || [];
        const cart = this.#state.cart || [];
        if (menu.length === 0) return [];

        const UPSELL_RE = /(drinks?|boissons?|sides?|accompagnements?|desserts?)/i;
        const cartProductIds = new Set(
            cart.map((i) => i.productId || (typeof i.id === "string" ? i.id.split("-")[0] : i.id))
        );

        return menu
            .filter((p) => p.isAvailable !== false)
            .filter((p) => typeof p.categorieId === "string" && UPSELL_RE.test(p.categorieId))
            .filter((p) => !cartProductIds.has(p.id))
            .slice(0, maxItems);
    }

    // --- HELPERS ---

    #persistCart() {
        localStorage.setItem("snackCart", JSON.stringify(this.#state.cart));
    }

    /**
     * Émet un événement personnalisé avec l'état actuel.
     */
    emit(eventName) {
        this.dispatchEvent(new CustomEvent(eventName, { 
            detail: { state: this.state } 
        }));
        
        // Compatibilité temporaire pour l'UI existante qui écoute sur document
        document.dispatchEvent(new CustomEvent(eventName, { 
            detail: { state: this.state } 
        }));
    }
}

export const store = new Store();

// 🔧 Debug helper — expose le store pour inspection console (`window.store.state`,
// `window.store.getUpsellSuggestions(10)`). Pas utilisé en interne, c'est juste
// un pont pour DevTools, cohérent avec window.snackConfig / window.db.
if (typeof window !== "undefined") window.store = store;
