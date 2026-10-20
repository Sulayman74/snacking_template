/**
 * 📊 productSalesInsights.js
 * Service pur (sans DOM, testable unitairement) d'analyse des ventes/non-ventes
 * pour faire le pont entre la comptabilité et les campagnes de push marketing.
 *
 * RÈGLE D'OR MÉTIER :
 * Les boissons, desserts, suppléments, extras et sauces sont STRICTEMENT EXCLUS.
 * Seuls les plats principaux (Burgers, Tacos, Pizzas, Sandwiches, Plats) sont
 * analysés et suggérés en push tracteur.
 */

export const EXCLUDED_CATEGORIES = new Set([
  "drinks",
  "boissons",
  "boisson",
  "drink",
  "desserts",
  "dessert",
  "supplements",
  "supplement",
  "extras",
  "extra",
  "sauces",
  "sauce",
  "sides",
  "accompagnements",
  "accompagnement",
]);

/**
 * Détermine si un produit est un plat principal éligible pour le push marketing.
 * @param {object} product - Document produit de la carte
 * @returns {boolean}
 */
export function isCoreProduct(product) {
  if (!product || typeof product !== "object") return false;
  // Ne jamais suggérer un produit épuisé ou masqué
  if (product.isAvailable === false) return false;

  const cat = String(product.categorieId || "").toLowerCase().trim();
  if (!cat || EXCLUDED_CATEGORIES.has(cat)) return false;

  return true;
}

/**
 * Extrait les identifiants ou noms des items d'une commande.
 * Gère à la fois commande.items (format standard) et commande.cartItems (format legacy).
 * @param {object} order - Document commande Firestore
 * @returns {Array<{productId?: string, nom?: string, quantity?: number}>}
 */
export function getOrderItems(order) {
  if (!order || typeof order !== "object") return [];
  const rawItems = Array.isArray(order.items)
    ? order.items
    : (Array.isArray(order.cartItems) ? order.cartItems : []);

  return rawItems.map((item) => ({
    productId: item.productId || (typeof item.id === "string" ? item.id.split("-")[0] : item.id),
    nom: item.nom || "",
    quantity: parseInt(item.quantity, 10) || 1,
    prix: parseFloat(item.prix || item.prixBase || 0),
  }));
}

/**
 * Analyse les ventes et non-ventes des plats principaux sur une série de commandes.
 *
 * @param {Array<object>} products - Liste complète des produits du snack (adminStore.state.products)
 * @param {Array<object>} orders - Commandes récentes (adminStore.state.sales ou historique)
 * @returns {{
 *   totalCoreProducts: number,
 *   stars: Array<object>,
 *   nonVentes: Array<object>,
 *   suggestions: Array<object>
 * }}
 */
export function analyzeProductSales(products = [], orders = []) {
  const coreProducts = (Array.isArray(products) ? products : []).filter(isCoreProduct);
  if (coreProducts.length === 0) {
    return {
      totalCoreProducts: 0,
      stars: [],
      nonVentes: [],
      suggestions: [],
    };
  }

  // Dictionnaire de statistiques par produit
  const productStats = new Map();
  coreProducts.forEach((p) => {
    productStats.set(p.id, {
      product: p,
      unitsSold: 0,
      revenue: 0,
      orderCount: 0,
      lastSoldDate: null,
    });
  });

  // Parcours des commandes pour accumuler les ventes
  const safeOrders = Array.isArray(orders) ? orders : [];
  safeOrders.forEach((order) => {
    const orderDate = order.date?.toDate ? order.date.toDate() : (order.date ? new Date(order.date) : null);
    const items = getOrderItems(order);

    items.forEach((item) => {
      // Correspondance par ID ou par nom exact si l'ID diffère
      let stat = productStats.get(item.productId);
      if (!stat && item.nom) {
        stat = Array.from(productStats.values()).find(
          (s) => s.product.nom && s.product.nom.toLowerCase().trim() === item.nom.toLowerCase().trim()
        );
      }

      if (stat) {
        stat.unitsSold += item.quantity;
        stat.revenue += item.prix * item.quantity;
        stat.orderCount += 1;
        if (orderDate && (!stat.lastSoldDate || orderDate > stat.lastSoldDate)) {
          stat.lastSoldDate = orderDate;
        }
      }
    });
  });

  const allStats = Array.from(productStats.values());

  // 1. Les Stars : Plats les plus vendus (unitsSold > 0, triés par volume décroissant)
  const stars = allStats
    .filter((s) => s.unitsSold > 0)
    .sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue)
    .map((s) => ({
      id: s.product.id,
      nom: s.product.nom,
      image: s.product.image || "",
      prix: s.product.prix,
      categorieId: s.product.categorieId,
      unitsSold: s.unitsSold,
      revenue: Math.round(s.revenue * 100) / 100,
      orderCount: s.orderCount,
    }));

  // 2. Les Non-Ventes : Plats avec 0 vente sur la période analysée
  const nonVentes = allStats
    .filter((s) => s.unitsSold === 0)
    .sort((a, b) => (parseFloat(b.product.prix) || 0) - (parseFloat(a.product.prix) || 0))
    .map((s) => ({
      id: s.product.id,
      nom: s.product.nom,
      image: s.product.image || "",
      prix: s.product.prix,
      categorieId: s.product.categorieId,
      unitsSold: 0,
      revenue: 0,
      orderCount: 0,
    }));

  // 3. Génération des Suggestions Actionnables pour le Marketing Push
  const suggestions = [];

  // Suggestion A : Relance d'une Non-Vente phare (dormante)
  if (nonVentes.length > 0) {
    const sleeper = nonVentes[0];
    suggestions.push({
      id: `suggestion-sleeper-${sleeper.id}`,
      productId: sleeper.id,
      productName: sleeper.nom,
      productPrice: sleeper.prix,
      productImage: sleeper.image,
      type: "sleeper",
      badge: "💤 Relancer une non-vente",
      badgeColor: "amber",
      diagnostic: `0 commande récente sur ce plat phare.`,
      reason: `Vos clients ne l'ont pas commandé récemment. Un coup de projecteur en soirée réveille la demande sans cannibaliser vos stars.`,
      push: {
        title: `🔥 Envie de changer ? Découvrez notre ${sleeper.nom} !`,
        message: `Préparé avec soin pour votre soirée. Commandez-le chaud en Click & Collect ou livraison !`,
        target: "inactive", // Cible les inactifs ou tous pour tester la relance
      },
    });
  }

  // Suggestion B : Pousser la Star du moment (Locomotive de chiffre)
  if (stars.length > 0) {
    const star = stars[0];
    suggestions.push({
      id: `suggestion-star-${star.id}`,
      productId: star.id,
      productName: star.nom,
      productPrice: star.prix,
      productImage: star.image,
      type: "star",
      badge: "⭐ Locomotive de vente",
      badgeColor: "emerald",
      diagnostic: `${star.unitsSold} ventes récentes (${star.revenue.toFixed(2)} € générés).`,
      reason: `C'est votre n°1 incontesté ! Idéal à envoyer le vendredi soir ou en veille de week-end pour déclencher un pic de commandes rapide.`,
      push: {
        title: `⭐ Le favori de la maison : ${star.nom}`,
        message: `Craquez pour notre best-seller du moment ! Vos papilles vous remercieront. Prêt en 15 min.`,
        target: "all", // Accessible à tout le monde
      },
    });
  }

  // Suggestion C : Opportunité Heure Creuse (2e star ou 2e non-vente pour un format flash)
  const flashCandidate = stars[1] || nonVentes[1] || stars[0];
  if (flashCandidate && flashCandidate.id !== suggestions[0]?.productId) {
    suggestions.push({
      id: `suggestion-flash-${flashCandidate.id}`,
      productId: flashCandidate.id,
      productName: flashCandidate.nom,
      productPrice: flashCandidate.prix,
      productImage: flashCandidate.image,
      type: "flash",
      badge: "⚡ Boost Heure Creuse",
      badgeColor: "orange",
      diagnostic: `Produit attractif pour lancer le service avant le rush.`,
      reason: `Programmez une alerte flash à 18h30 pour remplir la cuisine avant le coup de feu de 20h.`,
      push: {
        title: `⚡ Envie d'un bon ${flashCandidate.nom} ?`,
        message: `Commandez dès maintenant pour être servi(e) en priorité avant le rush du soir !`,
        target: "active", // Cible les clients chauds
      },
    });
  }

  return {
    totalCoreProducts: coreProducts.length,
    stars,
    nonVentes,
    suggestions,
  };
}
