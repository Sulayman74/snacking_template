// ============================================================================
// 🧾 VENTILATION TVA — logique PURE (aucun I/O), testable sans Firebase.
// ============================================================================
// Restauration FR : 3 taux (5,5 / 10 / 20). Défaut snacking = 10 %. Frais de
// livraison facturés au client = 10 %. Tout est en CENTIMES (jamais d'euros ici).
// La ventilation par poste est OBLIGATOIRE fiscalement (CGI art. 268 bis) : sans
// elle, le fisc applique 20 % sur toute la vente.

const ALLOWED_RATES = [5.5, 10, 20];
const DEFAULT_RATE = 10;
const LIVRAISON_RATE = 10;

/**
 * Normalise un taux de TVA produit vers un preset autorisé (défaut 10).
 * @param {*} rate
 * @returns {number} 5.5 | 10 | 20
 */
function normalizeTvaRate(rate) {
  const r = Number(rate);
  return ALLOWED_RATES.includes(r) ? r : DEFAULT_RATE;
}

/**
 * Décompose un montant TTC (centimes) en HT + TVA pour un taux donné.
 * @param {number} ttcCents - montant TTC en centimes.
 * @param {number} rate - taux de TVA (ex. 10 pour 10 %).
 * @returns {{ttc:number, ht:number, tva:number}} centimes (ht + tva === ttc).
 */
function splitTtc(ttcCents, rate) {
  const ttc = Math.round(Number(ttcCents) || 0);
  const ht = Math.round(ttc / (1 + rate / 100));
  return { ttc, ht, tva: ttc - ht };
}

/**
 * Ventile les lignes du panier (TTC + taux par ligne) + les frais de livraison
 * par taux de TVA. Un bucket n'est présent que si applicable.
 * @param {Array<{ttcCents:number, tvaRate:number}>} lines - lignes articles (TTC déjà validé serveur).
 * @param {number} [fraisCents=0] - frais de livraison TTC (0 si collect), taux fixe 10 %.
 * @returns {{["5.5"]?:{ttc,ht,tva}, ["10"]?:{ttc,ht,tva}, ["20"]?:{ttc,ht,tva}, livraison:({rate:number,ttc,ht,tva}|null)}}
 */
function ventilateTva(lines, fraisCents = 0) {
  const byRate = new Map();
  for (const line of lines || []) {
    const ttc = Math.round(Number(line?.ttcCents) || 0);
    if (ttc <= 0) continue;
    const rate = normalizeTvaRate(line?.tvaRate);
    byRate.set(rate, (byRate.get(rate) || 0) + ttc);
  }

  const breakdown = {};
  for (const [rate, ttc] of byRate) {
    breakdown[String(rate)] = splitTtc(ttc, rate);
  }

  const frais = Math.round(Number(fraisCents) || 0);
  breakdown.livraison = frais > 0 ? { rate: LIVRAISON_RATE, ...splitTtc(frais, LIVRAISON_RATE) } : null;

  return breakdown;
}

/**
 * Somme des TTC de tous les buckets (articles + livraison). Sert d'invariant de
 * réconciliation : doit égaler le total de la commande (centimes).
 * @param {object} breakdown - sortie de ventilateTva.
 * @returns {number} centimes.
 */
function sumBreakdownTtc(breakdown) {
  let sum = 0;
  for (const [key, bucket] of Object.entries(breakdown || {})) {
    if (key === "livraison") continue;
    sum += Math.round(Number(bucket?.ttc) || 0);
  }
  if (breakdown?.livraison) sum += Math.round(Number(breakdown.livraison.ttc) || 0);
  return sum;
}

module.exports = {
  ALLOWED_RATES,
  DEFAULT_RATE,
  LIVRAISON_RATE,
  normalizeTvaRate,
  splitTtc,
  ventilateTva,
  sumBreakdownTtc,
};
