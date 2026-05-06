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
        role: "client"
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
