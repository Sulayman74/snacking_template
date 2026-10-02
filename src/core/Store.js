import { calculateUpsellScoring } from "./suggestionEngine.js";

// Téléphone de livraison retenu sur l'appareil (confort : pas de ressaisie).
const DELIVERY_PHONE_KEY = "snackDeliveryPhone";
const readSavedPhone = () => {
    try { return localStorage.getItem(DELIVERY_PHONE_KEY) || ""; } catch { return ""; }
};

/**
 * 🗄️ Store — Source de Vérité Unique (Flux Unidirectionnel)
 * Gère l'état de l'application de manière privée et émet des événements lors des changements.
 */
export class Store extends EventTarget {
    #state = {
        cart: JSON.parse(localStorage.getItem("snackCart")) || [],
        config: null,
        menu: [],
        user: null,
        role: "client",
        // ❤️ FAVORIS — articles personnalisés sauvegardés par le client (re-commande 1-tap).
        // Synchronisés en temps réel depuis users/{uid}.favorites (cf. favorites.js).
        favorites: [],
        // 🔁 RE-COMMANDE — dernière commande payée de l'utilisateur sur CE snack.
        // Chargée à la connexion (cf. reorder.js), null si aucun historique.
        lastOrder: null,
        // 🚚 LIVRAISON — état du tunnel de commande (mode + adresse + devis).
        // mode 'collect' par défaut → comportement legacy strictement inchangé.
        delivery: {
            mode: "collect",     // 'collect' | 'delivery'
            address: null,       // { adresse, lat, lng, type }
            quote: null,         // { distanceKm, inRange, frais, prepMin, travelMin, totalMin }
            contact: { complement: "", telephone: readSavedPhone() } // pour le livreur
        },
        // 🎯 INTENT CHECKOUT — flag éphémère posé quand un invité non connecté clique
        // "Commander" (mode auth classique). Consommé par onAuthStateChanged dans
        // firebase-init.js pour relancer le tunnel après connexion. Jamais persisté
        // en localStorage (l'intention ne survit pas à un reload, c'est voulu).
        pendingCheckout: false,
        // 🌍 LOCALISATION — Langue active de l'application (fr | en).
        locale: localStorage.getItem("snack_locale") || "fr",
        // 🕒 RETRAIT — « dès que possible » ou créneau « plus tard » (click & collect).
        pickup: { mode: "asap", atMs: null },
    };

    #favoritesIndex = {};

    constructor() {
        super();
    }

    /**
     * Retourne une copie de l'état (lecture seule).
     */
    get state() {
        return Object.freeze({ ...this.#state });
    }

    /**
     * Retourne l'index des favoris structuré par snackId et favId pour des lectures en O(1).
     */
    get favoritesIndex() {
        return this.#favoritesIndex;
    }

    // --- MÉTHODES DE MUTATION (Sert d'Actions/Reducers) ---

    setLocale(locale) {
        this.#state.locale = locale;
        this.emit("locale-updated");
    }

    setConfig(config) {
        this.#state.config = config;
        this.emit("config-updated");
    }

    setUser(user, role = "client") {
        this.#state.user = user;
        this.#state.role = role;
        this.emit("auth-updated");
    }

    /**
     * Pose ou consomme l'intention de relancer le checkout après connexion.
     * Appelé par checkout.js (poser, mode auth classique) et firebase-init.js
     * (consommer, dans onAuthStateChanged). Flag éphèmère : jamais persisté.
     * @param {boolean} value
     */
    setPendingCheckout(value) {
        this.#state.pendingCheckout = Boolean(value);
        // Pas d'emit : cet état est consommé par firebase-init, pas par l'UI.
    }

    /** Vrai si une intention de checkout est en attente de relance post-login. */
    get hasPendingCheckout() {
        return this.#state.pendingCheckout;
    }

    /**
     * @param {Array} menu
     * @param {{fromCache?: boolean}} [opts] - menu lu depuis le cache local : on ne
     *   corrige pas le panier sur une donnée peut-être périmée.
     */
    setMenu(menu, { fromCache = false } = {}) {
        this.#state.menu = menu;
        this.emit("menu-updated");
        if (!fromCache) this.reconcileCart();
    }

    /**
     * Aligne le panier sur le menu courant (prix changé, article épuisé ou retiré)
     * pour que le paiement ne soit pas refusé par le recalcul serveur. Émet
     * « cart-reconciled » ({removed, repriced}) quand quelque chose a changé.
     * @returns {{removed: string[], repriced: Array<{nom: string, prix: number}>}}
     */
    reconcileCart() {
        const result = { removed: [], repriced: [] };
        const cart = this.#state.cart || [];
        // Menu vide (chargement raté) : on ne vide pas le panier pour autant.
        if (cart.length === 0 || !(this.#state.menu || []).length) return result;

        const next = [];
        for (const item of cart) {
            const check = this.validateAgainstMenu(item);
            if (!check.ok) {
                result.removed.push(item.nom || "");
                continue;
            }
            if (check.reason === "reprice") {
                next.push({ ...item, prix: check.currentItem.prix, supplements: check.currentItem.supplements });
                result.repriced.push({ nom: item.nom || "", prix: check.currentItem.prix });
                continue;
            }
            next.push(item);
        }
        if (result.removed.length === 0 && result.repriced.length === 0) return result;

        this.#state.cart = next;
        this.#persistCart();
        this.emit("cart-updated");
        this.dispatchEvent(new CustomEvent("cart-reconciled", { detail: result }));
        return result;
    }

    /** Remplace la liste des favoris (source : snapshot temps réel de users/{uid}). */
    setFavorites(favorites) {
        this.#state.favorites = Array.isArray(favorites) ? favorites : [];
        
        // Reconstruction de l'index map en O(N)
        const newIndex = {};
        for (const fav of this.#state.favorites) {
            if (fav && fav.snackId && fav.favId) {
                if (!newIndex[fav.snackId]) {
                    newIndex[fav.snackId] = {};
                }
                newIndex[fav.snackId][fav.favId] = fav;
            }
        }
        this.#favoritesIndex = newIndex;

        this.emit("favorites-updated");
    }

    /** Remplace la dernière commande connue de l'utilisateur (source : reorder.js). */
    setLastOrder(order) {
        this.#state.lastOrder = order || null;
        this.emit("last-order-updated");
    }

    /**
     * Confronte un article re-commandé (favori, ancienne commande) au menu courant.
     * Courtoisie UX uniquement : la barrière de sécurité reste le recalcul serveur
     * de createPaymentIntent/finalizeOrder (functions/index.js, computeAuthoritativeOrder).
     *
     * Réplique le calcul de prix client (src/product-modal.js) : prix de base ou
     * prix de la taille choisie, + supplément menu (menuPriceAdd || 2.5) en formule.
     *
     * @param {Object} item - Article au format panier ({productId, prix, formule, taille, ...}).
     * @returns {{ok: boolean, reason: null|'missing'|'unavailable'|'reprice', currentItem: Object|null}}
     *   ok=false : ne pas ajouter (reason 'missing' ou 'unavailable').
     *   ok=true + reason 'reprice' : ajouter currentItem (prix courant) en prévenant.
     */
    validateAgainstMenu(item) {
        const menu = this.#state.menu || [];
        const productId =
            item?.productId || (typeof item?.id === "string" ? item.id.split("-")[0] : item?.id);
        const product = menu.find((p) => p.id === productId);

        if (!product) return { ok: false, reason: "missing", currentItem: null };
        if (product.isAvailable === false) return { ok: false, reason: "unavailable", currentItem: null };

        // Deux formats : panier (formule/taille) et commande persistée par le
        // serveur (type/tailleChoisie) — la re-commande relit `commandes`.
        const formule = item.formule || item.type || "seul";
        const tailleNom = item.taille || item.tailleChoisie || null;

        let base = Number(product.prix) || 0;
        if (tailleNom) {
            const taille = (product.tailles || []).find((t) => t.nom === tailleNom);
            // La taille mémorisée n'existe plus → on ne devine pas, on signale.
            if (!taille) return { ok: false, reason: "missing", currentItem: null };
            base = Number(taille.prix) || 0;
        }
        const menuAdd = formule === "menu" ? (Number(product.menuPriceAdd) || 2.5) : 0;

        // Suppléments au prix COURANT ; un supplément retiré/épuisé → article ignoré
        // (on ne sert pas silencieusement un burger sans son extra payé).
        const supplements = [];
        for (const s of Array.isArray(item.supplements) ? item.supplements : []) {
            const sp = menu.find((p) => p.id === (s.productId || s.id));
            if (!sp || sp.isAvailable === false) return { ok: false, reason: "unavailable", currentItem: null };
            supplements.push({ productId: sp.id, nom: sp.nom, prix: Number(sp.prix) || 0 });
        }
        const suppAdd = supplements.reduce((sum, s) => sum + s.prix, 0);
        const currentPrix = base + menuAdd + suppAdd;

        // Comparaison en centimes : pas d'arrondi flottant.
        const repriced =
            Math.round(currentPrix * 100) !== Math.round((Number(item.prix) || 0) * 100);

        return {
            ok: true,
            reason: repriced ? "reprice" : null,
            // Normalisé au format panier : le payload (orderPayload.js) relit
            // formule/taille/boisson ; le serveur lie le prix à ces options.
            currentItem: {
                ...item,
                formule,
                taille: tailleNom,
                boisson: item.boisson || item.boissonNom || null,
                supplements,
                prix: currentPrix,
                image: product.image || item.image,
            },
        };
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

    /**
     * Complément d'adresse et téléphone. Émet `delivery-contact-updated` (et non
     * `delivery-updated`) : le formulaire n'est pas re-rendu pendant la saisie.
     */
    setDeliveryContact({ complement, telephone } = {}) {
        const prev = this.#state.delivery.contact || { complement: "", telephone: "" };
        const contact = {
            complement: complement !== undefined ? String(complement).slice(0, 200) : prev.complement,
            telephone: telephone !== undefined ? String(telephone).slice(0, 25) : prev.telephone,
        };
        this.#state.delivery = { ...this.#state.delivery, contact };
        if (telephone !== undefined) {
            try { localStorage.setItem(DELIVERY_PHONE_KEY, contact.telephone); } catch { /* stockage indisponible */ }
        }
        this.emit("delivery-contact-updated");
    }

    /** Remet le tunnel livraison à zéro (après commande validée). Le téléphone est conservé. */
    resetDelivery() {
        const telephone = this.#state.delivery.contact?.telephone || "";
        this.#state.delivery = { mode: "collect", address: null, quote: null, contact: { complement: "", telephone } };
        this.emit("delivery-updated");
    }

    /** Frais de livraison effectifs (0 en collect ou hors zone). */
    getDeliveryFee() {
        const d = this.#state.delivery;
        if (d.mode !== "delivery" || !d.quote?.inRange) return 0;
        return Number(d.quote.frais) || 0;
    }

    // --- RETRAIT (dès que possible / plus tard) ---

    /** @param {{mode: "asap"|"slot", atMs?: number|null}} pickup */
    setPickup({ mode, atMs = null } = {}) {
        const slot = mode === "slot" && Number.isFinite(atMs);
        this.#state.pickup = { mode: slot ? "slot" : "asap", atMs: slot ? atMs : null };
        this.emit("pickup-updated");
    }

    resetPickup() {
        this.#state.pickup = { mode: "asap", atMs: null };
        this.emit("pickup-updated");
    }

    // --- UPSELLING ---

    /**
     * Retourne jusqu'à `maxItems` suggestions d'upsell : produits du menu
     * dont la catégorie matche desserts/sides/boissons (FR/EN, sing/plur),
     * disponibles, et absents du panier (par productId/id).
     *
     * Match case-insensitive sur `categorieId` — ne dépend pas d'un flag
     * Firestore dédié (KISS, marche pour tous les snacks existants).
     *
     * En `rushMode` (cuisine surchargée, décidé côté serveur via getKitchenLoad),
     * on limite aux produits PRÊTS À SERVIR (boissons/desserts) et on retire les
     * accompagnements/sides qui demandent de la cuisson. La partition lourd/léger
     * est une heuristique de catégorie ici (logique métier) — jamais dans l'UI.
     *
     * @param {number} maxItems - Nombre maximum de suggestions.
     * @param {Object} [opts]
     * @param {boolean} [opts.rushMode=false] - Si vrai, exclut les produits à cuisson.
     * @returns {Array<Object>} Produits suggérés.
     */
    getUpsellSuggestions(maxItems = 3, { rushMode = false } = {}) {
        return calculateUpsellScoring(
            this.#state.cart || [],
            this.#state.menu || [],
            {
                currentHour: new Date().getHours(),
                weatherCondition: (typeof window !== "undefined" && window.currentWeatherCondition) || "sunny",
                isRushMode: Boolean(rushMode),
                associationsMatrix: this.#state.associationsMatrix || {},
                maxItems
            }
        );
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
// un pont pour DevTools, cohérent avec window.snackConfig.
if (typeof window !== "undefined") window.store = store;
