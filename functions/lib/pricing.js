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
    Array.isArray(i.supplements) ? i.supplements.map((s) => s.productId || s.id).filter(Boolean) : []
  );
  const allProductIds = [...new Set([...mainIds, ...suppIds])];
  require_(allProductIds.length > 0, "Aucun produit identifiable dans le panier.");

  const refs = allProductIds.map((id) => db.collection("produits").doc(id));
  const snaps = await db.getAll(...refs);
  const products = new Map();
  snaps.forEach((s) => { if (s.exists) products.set(s.id, s.data()); });

  let expectedItemsCents = 0;
  const lines = [];
  for (const item of cartItems) {
    const product = products.get(item.productId);
    require_(!!product, `Produit introuvable : ${item.productId}.`);
    // Cloisonnement multi-tenant : le produit doit appartenir au snack commandé.
    require_(product.snackId === snackId, "Produit hors du restaurant ciblé.");

    // Validation des suppléments attachés à la ligne
    const itemSupplements = Array.isArray(item.supplements) ? item.supplements : [];
    const validatedSuppProducts = [];
    for (const supp of itemSupplements) {
      const sId = supp.productId || supp.id;
      const suppDoc = products.get(sId);
      require_(!!suppDoc, `Supplément introuvable : ${supp.nom || sId}.`);
      require_(suppDoc.snackId === snackId, "Supplément hors du restaurant ciblé.");
      validatedSuppProducts.push(suppDoc);
    }

    const paidCents = Math.round(Number(item.prix) * 100);
    const allowed = allowedUnitPriceCents(product, validatedSuppProducts);
    const ok = [...allowed].some((a) => Math.abs(a - paidCents) <= TOL);
    require_(ok, `Prix manipulé pour « ${item.nom} » (${item.prix} € non autorisé).`);

    const ttcCents = paidCents * item.quantity;
    expectedItemsCents += ttcCents;
    // tvaRate LU EN BASE (jamais du client) → ventilation TVA fiable (LOT A).
    lines.push({ productId: item.productId, ttcCents, tvaRate: normalizeTvaRate(product.tvaRate) });
  }

  // itemsCents : sous-total articles (centimes), prix validés → réutilisable (minOrder).
  // lines : ventilation par ligne (TTC + taux) pour le calcul tvaBreakdown (LOT A).
  return { itemsCents: expectedItemsCents, lines };
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
 * @returns {Promise<{itemsCents:number, lines:Array, fraisCents:number, totalCents:number, livraisonData:(Object|null), distanceKm:(number|null)}>}
 * @throws {HttpsError} prix manipulé / out-of-range / minimum non atteint / pause service.
 */
async function computeAuthoritativeOrder(snackData, snackId, cartItems, orderMode, livraison) {
  // 🛡️ Garde Pause Service / Coup de Feu
  if (snackData.servicePausedUntil) {
    const pausedUntilDate = snackData.servicePausedUntil.toDate ? snackData.servicePausedUntil.toDate() : new Date(snackData.servicePausedUntil);
    if (pausedUntilDate > new Date()) {
      throw new HttpsError("failed-precondition", "Le restaurant a temporairement suspendu la prise de commandes (cuisine en pause).");
    }
  }

  const { itemsCents, lines } = await priceCartItems(cartItems, snackId);

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
      lat: client.lat,
      lng: client.lng,
      distanceKm: hasDist ? Math.round(d * 10) / 10 : null,
      frais: isFiniteNum(dcfg.frais) ? dcfg.frais : 0, // frais issus de la config (jamais du client)
    };
    fraisCents = Math.round((livraisonData.frais || 0) * 100);
  }

  return { itemsCents, lines, fraisCents, totalCents: itemsCents + fraisCents, livraisonData, distanceKm };
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
