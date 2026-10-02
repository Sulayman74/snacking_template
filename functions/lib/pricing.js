// ============================================================================
// 💶 PRICING — recalcul/validation AUTORITATIF des montants (anti-fraude F1)
// ============================================================================
// Source de vérité UNIQUE (DRY) : createPaymentIntent (montant du PI, AVANT débit) ET
// finalizeOrder (montant de la commande). Le prix client n'est JAMAIS de confiance ;
// tout est recalculé depuis les produits en base + la config livraison du snack.

const { HttpsError } = require("firebase-functions/v2/https");
const { db } = require("./admin");
const { require_ } = require("./validation");
const { normalizeTvaRate } = require("./tva");
const { haversineKm, numberOrNull, isFiniteNum } = require("./geo");
const { getOrderingState, snackTimezone } = require("./openingHours");

// --- Anti-fraude prix : recalcul depuis la base, jamais le prix du client ------
// Ensemble des prix unitaires LÉGITIMES d'un produit (en centimes) :
//   - base : `prix` (produit simple) OU chaque `tailles[].prix` (produit taillé)
//   - +menu : base + (menuPriceAdd || 2.5), réplique exacte du calcul client
//             (src/product-modal.js : prixMenu = menuPriceAdd || 2.5).
//   - +suppléments : somme des prix unitaires des suppléments autorisés en base.
// On inclut toujours la variante menu : elle ne fait qu'AUGMENTER le prix, donc
// l'autoriser ne peut pas baisser le plancher anti-fraude.
function allowedUnitPriceCents(product, supplementProducts = []) {
  const cents = (e) => Math.round(Number(e) * 100);
  const menuAdd = product.menuPriceAdd || 2.5; // 0/undefined → 2.5 (cf. client)
  const suppAdd = (Array.isArray(supplementProducts) ? supplementProducts : [])
    .reduce((sum, s) => sum + (Number(s?.prix) || 0), 0);
  const suppCents = cents(suppAdd);

  const bases =
    Array.isArray(product.tailles) && product.tailles.length > 0
      ? product.tailles.map((t) => Number(t.prix))
      : [Number(product.prix)];

  const set = new Set();
  for (const b of bases) {
    if (!Number.isFinite(b)) continue;
    set.add(cents(b) + suppCents);
    set.add(cents(b + menuAdd) + suppCents);
  }
  return set;
}

function assertAvailable(product, label) {
  if (product.isAvailable === false) {
    throw new HttpsError("failed-precondition", `« ${label} » est épuisé.`);
  }
}

// 🛡️ Le snack accepte-t-il les commandes en ligne dans ce mode ? Réplique serveur
// des gardes de SnackCheckout.processCheckout (contournables par appel direct).
// Seuls les flags EXPLICITEMENT coupés bloquent (=== false) : un snack legacy sans
// le champ reste commandable, comme avant l'introduction du flag.
function assertSnackAcceptsOrders(snackData, orderMode) {
  if (snackData.maintenanceMode === true) {
    throw new HttpsError("failed-precondition", "Le restaurant est momentanément indisponible.");
  }
  if (snackData.enableOnlineOrder === false) {
    throw new HttpsError("failed-precondition", "La commande en ligne est désactivée pour ce restaurant.");
  }
  if (orderMode === "delivery" && snackData.enableDelivery === false) {
    throw new HttpsError("failed-precondition", "La livraison est désactivée pour ce restaurant.");
  }
  if (orderMode !== "delivery" && snackData.enableClickAndCollect === false) {
    throw new HttpsError("failed-precondition", "Le Click & Collect est désactivé pour ce restaurant.");
  }
}

// 🕐 Horaires d'ouverture + heure limite de commande (lastOrderMinutesBeforeClose),
// évalués dans le fuseau du snack (Functions = UTC). Horaires absents/mal formés
// → on ne bloque pas (cf. lib/openingHours).
function assertSnackIsOpen(snackData, now) {
  const state = getOrderingState(snackData.hours, now, snackTimezone(snackData), snackData.lastOrderMinutesBeforeClose);
  if (state.accepting) return;
  let reopening = "";
  if (state.nextOpenTime && state.nextOpenDayOffset === 0) reopening = ` Réouverture à ${state.nextOpenTime}.`;
  else if (state.nextOpenTime && state.nextOpenDayOffset === 1) reopening = ` Réouverture demain à ${state.nextOpenTime}.`;
  const why = state.reason === "cutoff"
    ? `Les commandes en ligne sont closes pour ce service (fermeture à ${state.closeTime}).`
    : "Le restaurant est fermé.";
  throw new HttpsError("failed-precondition", `${why}${reopening}`);
}

// Prix unitaire ATTENDU (centimes) pour la ligne TELLE QUE DÉCLARÉE : taille
// choisie (ou prix simple), + menu si type "menu" (menuPriceAdd || 2.5, cf. client),
// + suppléments. Lier le prix aux options empêche de payer un « Senior seul » en
// déclarant « Mega en menu » (le ticket cuisine affiche les options déclarées).
function expectedUnitPriceCents(product, item, supplementProducts = []) {
  const cents = (e) => Math.round(Number(e) * 100);
  const tailles = Array.isArray(product.tailles) && product.tailles.length > 0 ? product.tailles : null;
  let base = Number(product.prix);
  if (tailles) {
    const taille = tailles.find((t) => t.nom === item.tailleChoisie);
    require_(!!taille, `Taille invalide pour « ${product.nom} ».`);
    base = Number(taille.prix);
  }
  require_(Number.isFinite(base), `Prix indisponible pour « ${product.nom} ».`);
  const menuAdd = item.type === "menu" ? (product.menuPriceAdd || 2.5) : 0;
  const suppAdd = supplementProducts.reduce((sum, sp) => sum + (Number(sp.prix) || 0), 0);
  return cents(base + menuAdd) + cents(suppAdd);
}

const optStr = (v, max) => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);
const strList = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : []).filter((x) => typeof x === "string").slice(0, maxItems).map((x) => x.slice(0, maxLen));

// Ligne de commande PERSISTÉE : reconstruite depuis la base (nom, suppléments,
// prix validé) + options bornées. Jamais le payload client brut (sinon on paie
// une canette et la cuisine lit « Menu XXL »). Champs = ceux lus par KDS, compta,
// re-commande et agrégations.
function buildOrderLine(item, product, supplementProducts, unitCents) {
  const isMenu = item.type === "menu";
  return {
    id: optStr(item.id, 300) || item.productId,
    productId: item.productId,
    nom: isMenu ? `Menu ${product.nom}` : product.nom,
    type: isMenu ? "menu" : "seul",
    tailleChoisie: optStr(item.tailleChoisie, 50),
    boissonNom: isMenu ? optStr(item.boissonNom, 100) : null,
    sauces: strList(item.sauces, 15, 50),
    sansCrudites: strList(item.sansCrudites, 15, 50),
    supplements: supplementProducts.map((sp) => ({ productId: sp.id, nom: sp.nom, prix: Number(sp.prix) || 0 })),
    prix: unitCents / 100,
    quantity: item.quantity,
    viaUpsell: item.viaUpsell === true,
  };
}

// Vérifie que CHAQUE prix unitaire facturé correspond à un prix réel du produit en
// base (anti-fraude) et calcule le sous-total articles + la ventilation TVA. La
// couverture par l'encaissement Stripe est vérifiée par l'appelant (finalizeOrder),
// car createPaymentIntent appelle ce helper AVANT tout débit (le montant n'existe
// pas encore). Lève une HttpsError si une manipulation de prix est détectée.
async function priceCartItems(cartItems, snackId) {
  const TOL = 1; // ±1 centime (arrondis flottants)

  // Lecture groupée de tous les produits principaux et suppléments
  const mainIds = cartItems.map((i) => i.productId).filter(Boolean);
  const suppIds = cartItems.flatMap((i) =>
    Array.isArray(i.supplements) ? i.supplements.map((s) => s?.productId || s?.id).filter(Boolean) : []
  );
  const allProductIds = [...new Set([...mainIds, ...suppIds])];
  require_(allProductIds.length > 0, "Aucun produit identifiable dans le panier.");

  const refs = allProductIds.map((id) => db.collection("produits").doc(id));
  const snaps = await db.getAll(...refs);
  const products = new Map();
  snaps.forEach((s) => { if (s.exists) products.set(s.id, s.data()); });

  let expectedItemsCents = 0;
  const lines = [];
  const orderItems = [];
  for (const item of cartItems) {
    const product = products.get(item.productId);
    require_(!!product, `Produit introuvable : ${item.productId}.`);
    // Cloisonnement multi-tenant : le produit doit appartenir au snack commandé.
    require_(product.snackId === snackId, "Produit hors du restaurant ciblé.");
    // Stock : un panier resté en localStorage peut contenir un produit épuisé
    // depuis (le client ne revalide qu'à l'ouverture de la modale).
    assertAvailable(product, item.nom || product.nom);

    // Validation des suppléments attachés à la ligne
    const itemSupplements = Array.isArray(item.supplements) ? item.supplements : [];
    require_(itemSupplements.length <= 20, "Trop de suppléments sur un article.");
    const validatedSuppProducts = [];
    for (const supp of itemSupplements) {
      // Stocké tel quel dans la commande (items) et affiché au KDS → borné.
      require_(supp && typeof supp === "object" && !Array.isArray(supp), "Supplément invalide.");
      require_(supp.nom === undefined || (typeof supp.nom === "string" && supp.nom.length <= 100), "Nom de supplément invalide.");
      const sId = supp.productId || supp.id;
      const suppDoc = products.get(sId);
      require_(!!suppDoc, `Supplément introuvable : ${supp.nom || sId}.`);
      require_(suppDoc.snackId === snackId, "Supplément hors du restaurant ciblé.");
      assertAvailable(suppDoc, supp.nom || suppDoc.nom);
      validatedSuppProducts.push({ ...suppDoc, id: sId });
    }

    require_(
      item.type === undefined || item.type === null || item.type === "seul" || item.type === "menu",
      "Formule invalide."
    );
    const paidCents = Math.round(Number(item.prix) * 100);
    const expectedCents = expectedUnitPriceCents(product, item, validatedSuppProducts);
    // Message neutre : le cas réel est un prix changé par le restaurateur pendant
    // que le panier attendait (le client corrige son panier et repaie).
    if (Math.abs(expectedCents - paidCents) > TOL) {
      throw new HttpsError(
        "failed-precondition",
        `Le prix de « ${product.nom} » a changé. Votre panier a été mis à jour : vérifiez-le avant de payer.`,
        { reason: "price-changed", productId: item.productId }
      );
    }

    // Prix persisté = prix SERVEUR (pas l'arrondi client à ±1c).
    const ttcCents = expectedCents * item.quantity;
    expectedItemsCents += ttcCents;
    // tvaRate LU EN BASE (jamais du client) → ventilation TVA fiable (LOT A).
    lines.push({ productId: item.productId, ttcCents, tvaRate: normalizeTvaRate(product.tvaRate) });
    orderItems.push(buildOrderLine(item, product, validatedSuppProducts, expectedCents));
  }

  // itemsCents : sous-total articles (centimes), prix validés → réutilisable (minOrder).
  // lines : ventilation par ligne (TTC + taux) pour le calcul tvaBreakdown (LOT A).
  // orderItems : lignes à PERSISTER dans la commande (reconstruites serveur).
  return { itemsCents: expectedItemsCents, lines, orderItems };
}

/**
 * Recalcule et VALIDE le total d'une commande à partir de sources SERVEUR de
 * confiance (prix produits en base, config livraison du snack). Source de vérité
 * UNIQUE (DRY) consommée par createPaymentIntent (montant du PaymentIntent, fixé
 * AVANT débit → anti charge orpheline F1) ET finalizeOrder (montant de la commande).
 * Lève une HttpsError si fraude prix / adresse hors-zone / panier sous le minimum / pause service.
 * @param {Object} snackData - Document snacks/{snackId} (config livraison incluse).
 * @param {string} snackId - Clé multi-tenant.
 * @param {Array<Object>} cartItems - Articles du panier (prix recalculés en base).
 * @param {"collect"|"delivery"} orderMode - Mode de la commande.
 * @param {Object|null} livraison - Adresse client {lat,lng,adresse} (mode delivery).
 * @param {{enforceOpeningHours?:boolean, beforePayment?:boolean, now?:Date}} [options] - Horaires contrôlés si
 *   enforceOpeningHours ; pause cuisine contrôlée si beforePayment (createPaymentIntent).
 * @returns {Promise<{itemsCents:number, lines:Array, fraisCents:number, totalCents:number, livraisonData:(Object|null), distanceKm:(number|null)}>}
 * @throws {HttpsError} prix manipulé / out-of-range / minimum non atteint / pause service.
 */
async function computeAuthoritativeOrder(snackData, snackId, cartItems, orderMode, livraison, options = {}) {
  const { enforceOpeningHours = false, beforePayment = false, now = new Date() } = options;
  assertSnackAcceptsOrders(snackData, orderMode);
  // Horaires : contrôlés AVANT débit (createPaymentIntent) uniquement. À la
  // finalisation, un client qui a payé à 21:59:50 ne doit pas être remboursé
  // parce que finalizeOrder s'exécute à 22:00:02.
  if (enforceOpeningHours) assertSnackIsOpen(snackData, now);

  // 🛡️ Garde Pause Service / Coup de Feu — AVANT débit seulement : un client en
  // train de payer quand le chef met la pause n'est pas remboursé pour autant.
  if (beforePayment && snackData.servicePausedUntil) {
    const pausedUntilDate = snackData.servicePausedUntil.toDate ? snackData.servicePausedUntil.toDate() : new Date(snackData.servicePausedUntil);
    if (pausedUntilDate > now) {
      throw new HttpsError("failed-precondition", "Le restaurant a temporairement suspendu la prise de commandes (cuisine en pause).");
    }
  }

  const { itemsCents, lines, orderItems } = await priceCartItems(cartItems, snackId);

  let livraisonData = null;
  let distanceKm = null;
  let fraisCents = 0;

  if (orderMode === "delivery") {
    const dcfg = snackData.delivery || {};
    const resto = { lat: numberOrNull(snackData.restaurantLat), lng: numberOrNull(snackData.restaurantLng) };
    const client = { lat: livraison.lat, lng: livraison.lng };
    const d = haversineKm(resto, client);
    const hasDist = Number.isFinite(d);
    distanceKm = hasDist ? d : null;

    // 🛡️ REJET HORS-ZONE — autorité serveur sur la zone. On n'enforce que si un
    // rayon est configuré et la distance calculable (resto non géocodé / rayon
    // absent → permissif, cohérent avec le quoteDelivery client). Borne <= radiusKm.
    const radiusKm = Number(dcfg.radiusKm);
    if (Number.isFinite(radiusKm) && radiusKm > 0 && hasDist && d > radiusKm) {
      throw new HttpsError("out-of-range", "Adresse hors de la zone de livraison de ce restaurant.");
    }

    // 🛡️ PANIER MINIMUM — uniquement en livraison, sur le SOUS-TOTAL articles.
    const minOrder = Number(dcfg.minOrder);
    if (Number.isFinite(minOrder) && minOrder > 0 && itemsCents < Math.round(minOrder * 100)) {
      throw new HttpsError(
        "failed-precondition",
        `Minimum de commande pour la livraison : ${minOrder.toFixed(2)} €.`
      );
    }

    livraisonData = {
      adresse: (livraison.adresse || "").toString().slice(0, 300),
      // Précisions pour le livreur (étage, code, bâtiment) + contact : validés en
      // amont (assertLivraisonInput), nettoyés ici avant persistance.
      complement: typeof livraison.complement === "string" ? livraison.complement.trim().slice(0, 200) || null : null,
      telephone: typeof livraison.telephone === "string" ? livraison.telephone.trim().slice(0, 25) || null : null,
      lat: client.lat,
      lng: client.lng,
      distanceKm: hasDist ? Math.round(d * 10) / 10 : null,
      frais: isFiniteNum(dcfg.frais) ? dcfg.frais : 0, // frais issus de la config (jamais du client)
    };
    fraisCents = Math.round((livraisonData.frais || 0) * 100);
  }

  return { itemsCents, lines, orderItems, fraisCents, totalCents: itemsCents + fraisCents, livraisonData, distanceKm };
}

/**
 * Rembourse (best-effort) une charge devenue ORPHELINE : le PaymentIntent a réussi
 * (client débité) mais la commande est rejetée APRÈS débit (prix manipulé entre la
 * création du PI et la finalisation, panier divergent…). Évite de laisser de l'argent
 * encaissé sans contrepartie (F1). Idempotent (clé), no-op si déjà remboursé, et ne
 * masque JAMAIS l'erreur de validation d'origine (on log seulement en cas d'échec).
 * @param {import("stripe").Stripe} stripe - Client Stripe.
 * @param {Object} paymentIntent - PI récupéré (latest_charge éventuellement expandé).
 * @param {string|null} stripeAccountId - Compte connecté (charge directe) ou null.
 * @returns {Promise<void>}
 */
async function refundOrphanChargeBestEffort(stripe, paymentIntent, stripeAccountId) {
  try {
    const charge = paymentIntent.latest_charge;
    const alreadyRefunded =
      charge && typeof charge === "object" &&
      (charge.refunded === true || Number(charge.amount_refunded) > 0);
    if (alreadyRefunded) return;

    const opts = { idempotencyKey: `orphan_refund_${paymentIntent.id}` };
    if (stripeAccountId) opts.stripeAccount = stripeAccountId;
    await stripe.refunds.create({ payment_intent: paymentIntent.id }, opts);
    console.warn(`↩️ Charge orpheline remboursée (PI ${paymentIntent.id}) : commande rejetée après débit.`);
  } catch (refundErr) {
    console.error(`❌ Échec remboursement auto charge orpheline (PI ${paymentIntent.id}) :`, refundErr);
  }
}

module.exports = {
  allowedUnitPriceCents,
  priceCartItems,
  computeAuthoritativeOrder,
  refundOrphanChargeBestEffort,
};
