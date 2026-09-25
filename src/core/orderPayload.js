/**
 * 🧾 orderPayload.js — Sérialisation du panier pour createPaymentIntent/finalizeOrder.
 *
 * Module pur (sans Firebase/DOM) : le serveur (functions/lib/pricing.js) revalide
 * chaque prix unitaire contre la base, suppléments compris. Tout champ qui entre
 * dans `prix` doit donc être transmis, sinon le serveur rejette « Prix manipulé ».
 */
export function buildOrderItemsPayload(cart = []) {
  return cart.map((item) => ({
    id: item.id,
    productId: item.productId || (typeof item.id === "string" ? item.id.split("-")[0] : null),
    nom: item.nom,
    type: item.formule || item.type || "seul",
    boissonNom: item.boisson || null,
    sauces: item.sauces || [],
    sansCrudites: item.sansCrudites || [],
    tailleChoisie: item.taille || item.tailleChoisie || null,
    supplements: (Array.isArray(item.supplements) ? item.supplements : []).map((s) => ({
      productId: s.productId || s.id,
      nom: s.nom,
      prix: s.prix,
    })),
    prix: item.prix || item.prixBase || 0,
    prixBase: item.prixBase || item.prix,
    prixMenuAdd: item.prixMenuAdd || 0,
    quantity: item.quantity,
    viaUpsell: item.viaUpsell === true,
  }));
}
