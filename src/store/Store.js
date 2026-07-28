import { get, set } from 'idb-keyval';

/**
 * src/store/Store.js
 * State Management ultra-léger basé sur l'API native EventTarget.
 * Approche KISS : Pas de framework lourd, performance brute et prédictibilité.
 */

class SnackStore extends EventTarget {
  constructor() {
    super();
    // État centralisé de l'application (privé)
    this._state = {
      menu: [],         // Liste des produits (provenant de Firestore)
      cart: [],         // Contenu du panier
      searchQuery: '',  // Chaîne de recherche pour filtrer le menu
      loading: false    // Indicateur de chargement global
    };
    
    // Initialisation asynchrone du panier
    this.initCartFromStorage();
  }

  /**
   * Getter pour accéder à l'état en lecture seule.
   * Empêche les mutations directes hors du Store.
   */
  get state() {
    return this._state;
  }

  // ==========================================
  // ACTIONS : MUTATIONS DE L'ÉTAT
  // ==========================================

  /**
   * Met à jour le menu et notifie les composants connectés
   * @param {Array} products 
   */
  setMenu(products) {
    this._state.menu = products;
    this._emit('menu-changed', this._state.menu);
  }

  /**
   * Modifie l'état de chargement
   * @param {boolean} isLoading 
   */
  setLoading(isLoading) {
    this._state.loading = isLoading;
    this._emit('loading-changed', this._state.loading);
  }

  /**
   * Ajoute un produit au panier ou incrémente sa quantité
   * @param {Object} product 
   */
  addToCart(product) {
    const existingItem = this._state.cart.find(item => item.id === product.id);
    
    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      this._state.cart.push({ ...product, quantity: 1 });
    }

    this._emit('cart-updated', this._state.cart);
    this._syncStorage();
  }

  /**
   * Supprime complètement un produit du panier
   * @param {string} productId 
   */
  removeFromCart(productId) {
    this._state.cart = this._state.cart.filter(item => item.id !== productId);
    this._emit('cart-updated', this._state.cart);
    this._syncStorage();
  }

  /**
   * Met à jour précisément la quantité d'un produit dans le panier
   * @param {string} productId 
   * @param {number} quantity 
   */
  updateQuantity(productId, quantity) {
    const item = this._state.cart.find(item => item.id === productId);
    
    if (item) {
      item.quantity = quantity;
      if (item.quantity <= 0) {
        this.removeFromCart(productId);
        return;
      }
    }

    this._emit('cart-updated', this._state.cart);
    this._syncStorage();
  }

  /**
   * Met à jour le filtre de recherche
   * @param {string} query 
   */
  setSearchQuery(query) {
    this._state.searchQuery = query;
    this._emit('search-changed', this._state.searchQuery);
  }

  // ==========================================
  // MÉTHODES UTILITAIRES INTERNES
  // ==========================================

  /**
   * Déclenche un CustomEvent natif pour notifier les écouteurs
   * @param {string} eventName 
   * @param {*} detail 
   */
  _emit(eventName, detail) {
    const event = new CustomEvent(eventName, { detail });
    this.dispatchEvent(event);
  }

  /**
   * Sauvegarde asynchrone dans IndexedDB (Non bloquant pour l'UI)
   */
  _syncStorage() {
    set('snack_cart', this._state.cart).catch(e => console.error("Erreur de sauvegarde IndexedDB", e));
  }

  /**
   * Initialise le panier au chargement de l'application depuis IndexedDB
   */
  async initCartFromStorage() {
    try {
      const storedCart = await get('snack_cart');
      if (storedCart) {
        this._state.cart = storedCart;
        this._emit('cart-updated', this._state.cart);
      }
    } catch (e) {
      console.error("Impossible de récupérer le panier depuis IndexedDB", e);
    }
  }
}

// Export d'une instance unique (Singleton Pattern)
export const store = new SnackStore();
