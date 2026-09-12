/**
 * 🍔 suggestionEngine.js — Moteur de suggestion prédictif (KISS & SOLID).
 *
 * Fonction pure sans effets de bord :
 * Score = w1*Lift + w2*Context (Heure + Météo) + w3*Marge - Pénalités
 */

const DEFAULT_UPSELL_CATEGORIES = /(drinks?|boissons?|sides?|accompagnements?|desserts?|glaces?|cafes?|coffee)/i;
const COOKING_CATEGORIES = /(sides?|accompagnements?|frites?|cuisson)/i;

/**
 * Calcule et ordonne les suggestions d'upsell pour le panier courant.
 *
 * @param {Array<Object>} cart - Produits actuellement au panier.
 * @param {Array<Object>} menu - Catalogue complet du restaurant.
 * @param {Object} [options]
 * @param {number} [options.currentHour] - Heure courante (0-23).
 * @param {string} [options.weatherCondition] - 'sunny', 'hot', 'cold', 'rainy', etc.
 * @param {boolean} [options.isRushMode] - Si vrai, filtre les produits nécessitant cuisson.
 * @param {Object} [options.associationsMatrix] - Matrice de co-occurrence { [productId]: { [suggestedId]: score } }.
 * @param {number} [options.maxItems=3] - Nombre maximum de suggestions.
 * @param {RegExp} [options.categoryFilter] - Filtre de catégorie éligible (par défaut boissons/sides/desserts).
 * @returns {Array<Object>} Top suggestions classées par score décroissant.
 */
export function calculateUpsellScoring(cart = [], menu = [], options = {}) {
    const {
        currentHour = new Date().getHours(),
        weatherCondition = "sunny",
        isRushMode = false,
        associationsMatrix = {},
        maxItems = 3,
        categoryFilter = DEFAULT_UPSELL_CATEGORIES
    } = options;

    if (!Array.isArray(menu) || menu.length === 0) return [];

    // 1. Détection des IDs déjà au panier pour éviter les doublons
    const cartProductIds = new Set(
        (Array.isArray(cart) ? cart : []).map((item) =>
            item.productId || (typeof item.id === "string" ? item.id.split("-")[0] : item.id)
        )
    );

    // 2. Filtrage dur d'éligibilité
    const eligible = menu.filter((product) => {
        if (!product || product.isAvailable === false) return false;
        if (cartProductIds.has(product.id)) return false;

        // Restriction de catégorie éligible à l'upsell
        const cat = typeof product.categorieId === "string" ? product.categorieId : "";
        if (categoryFilter && !categoryFilter.test(cat)) return false;

        // Rush mode : exclusion des produits de cuisson
        if (isRushMode) {
            if (product.requiresCooking === true) return false;
            if (COOKING_CATEGORIES.test(cat) && product.requiresCooking !== false) return false;
        }

        return true;
    });

    if (eligible.length === 0) return [];

    // 3. Calcul du score multi-factoriel
    const scored = eligible.map((product) => {
        let score = 10; // Score de base pour chaque candidat éligible
        const cat = typeof product.categorieId === "string" ? product.categorieId : "";

        // A. Lift (Matrice de co-occurrence / Affinité produit)
        let maxLift = 0;
        cartProductIds.forEach((cartId) => {
            const pairScore = associationsMatrix?.[cartId]?.[product.id];
            if (typeof pairScore === "number" && pairScore > maxLift) {
                maxLift = pairScore;
            }
        });
        score += maxLift * 40; // Impact jusqu'à +40 pts

        // B. Contexte horaire
        if (currentHour >= 11 && currentHour <= 14) {
            // Déjeuner : boissons & cafés & formules
            if (/(boissons?|drinks?|desserts?|cafes?|coffee)/i.test(cat)) score += 20;
        } else if (currentHour >= 18 && currentHour <= 22) {
            // Soirée : accompagnements, sides, sauces, desserts à partager
            if (/(sides?|accompagnements?|tenders|sauces?)/i.test(cat)) score += 25;
            if (/(desserts?)/i.test(cat)) score += 15;
        } else if (currentHour >= 22 || currentHour < 5) {
            // Nuit : desserts sucrés, boissons
            if (/(desserts?|glaces?|sucre)/i.test(cat)) score += 30;
        }

        // C. Contexte météo (exploite les conditions de weatherInsights)
        const cond = String(weatherCondition || "").toLowerCase();
        if (["hot", "sunny"].includes(cond)) {
            if (/(boissons?|drinks?|glaces?|fraicheur)/i.test(cat)) score += 25;
        } else if (["cold", "rainy", "snowy"].includes(cond)) {
            if (/(boisson-chaude|chaud|fromage|cheese|soupe)/i.test(cat)) score += 25;
        }

        // D. Marge / Attractivité prix
        const prix = typeof product.prix === "number" ? product.prix : 0;
        const marginRate = typeof product.marginRate === "number" ? product.marginRate : 0.65;
        const estimatedMargin = prix * marginRate;
        score += Math.min(estimatedMargin * 3, 15);

        return { product, score };
    });

    // 4. Tri décroissant et sélection des Top N
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxItems).map((entry) => entry.product);
}
