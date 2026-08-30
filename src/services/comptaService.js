// ============================================================================
// 🧾 COMPTA NETTE — logique PURE (aucun I/O), testable sans Firebase (LOT D).
// ============================================================================
// Calcule le CA NET et la ventilation TVA depuis l'AGRÉGAT serveur (somme des
// champs persistés au LOT A/B). Zéro recalcul fragile : on LIT les montants déjà
// figés par finalizeOrder/refundOrder (sources serveur de confiance).
//
// ⚠️ CONVENTION D'UNITÉS (héritée du modèle de données) :
//   - `total` (CA brut TTC, somme de commande.total) est en EUROS.
//   - TOUS les autres champs (commission, stripeFee, refund*, tva*/ht*) sont en
//     CENTIMES (cf. LOT A/B). On convertit en euros ICI, au calcul d'affichage.
//
// 🧱 NON-RÉGRESSION (Read-Old/Write-New) : les commandes pré-LOT A n'ont ni
// `tvaBreakdown` ni `commission`/`stripeFee`. L'agrégation serveur `sum()` ignore
// simplement les champs absents → ces commandes legacy ne polluent PAS la TVA ni
// les frais (elles restent dans le CA brut TTC, mais hors ventilation). À signaler
// côté UI (transparence périmètre).

/** Centimes → euros. */
const centsToEuros = (cents) => (Number(cents) || 0) / 100;
/** Arrondi monétaire à 2 décimales (évite les flottants 0.1+0.2). */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Calcule le résumé compta (CA brut → net + ventilation TVA) depuis l'agrégat
 * serveur. Toutes les sorties monétaires sont en EUROS (number, arrondi 2 déc.).
 *
 * @param {object} [agg] - Agrégat serveur (sommes sur la plage filtrée).
 * @param {number} [agg.count] - Nombre de commandes.
 * @param {number} [agg.total] - CA brut TTC, en EUROS (somme de commande.total).
 * @param {number} [agg.commission] - Commission plateforme brute, en CENTIMES.
 * @param {number} [agg.stripeFee] - Frais Stripe réels, en CENTIMES.
 * @param {number} [agg.refundTotal] - Total remboursé au client, en CENTIMES.
 * @param {number} [agg.refundCommission] - Commission rendue (prorata), en CENTIMES.
 * @param {object} [agg.tva] - Sommes de ventilation, en CENTIMES (ht/tva par taux + livraison).
 * @returns {{
 *   count:number, caBrutTtc:number, avg:number,
 *   commission:number, commissionNette:number, stripeFee:number, refundTotal:number,
 *   caNet:number, tvaParTaux:Array<{rate:number, ht:number, tva:number}>, tvaCollectee:number
 * }}
 */
function computeComptaSummary(agg = {}) {
  const caBrutTtc = Number(agg.total) || 0; // déjà en euros
  const count = Number(agg.count) || 0;

  const commission = centsToEuros(agg.commission);
  const stripeFee = centsToEuros(agg.stripeFee);
  const refundTotal = centsToEuros(agg.refundTotal);
  const refundCommission = centsToEuros(agg.refundCommission);
  // Commission réellement gardée par la plateforme = brute − rendue sur remboursements.
  const commissionNette = commission - refundCommission;

  // 💶 CA NET (vue restaurateur) : ce qu'il garde réellement.
  //   net = brut TTC − remboursé − commission nette − frais Stripe (NON remboursés).
  const caNet = caBrutTtc - refundTotal - commissionNette - stripeFee;

  // 🧾 Ventilation TVA par taux. La livraison (taux fixe 10 %) est repliée dans le
  // bucket 10 %. Montants en euros. NB : TVA COLLECTÉE (brute) — non réduite des
  // remboursements ici (proratisation par taux hors périmètre LOT D ; les
  // remboursements pèsent sur le CA net global ci-dessus). Cf. §8.3 : libeller
  // « collectée », jamais « à payer ».
  const t = agg.tva || {};
  const r55 = { ht: centsToEuros(t.ht5_5), tva: centsToEuros(t.tva5_5) };
  const r10 = {
    ht: centsToEuros((Number(t.ht10) || 0) + (Number(t.htLiv) || 0)),
    tva: centsToEuros((Number(t.tva10) || 0) + (Number(t.tvaLiv) || 0)),
  };
  const r20 = { ht: centsToEuros(t.ht20), tva: centsToEuros(t.tva20) };

  const tvaParTaux = [
    { rate: 5.5, ...r55 },
    { rate: 10, ...r10 },
    { rate: 20, ...r20 },
  ]
    .filter((x) => x.ht > 0 || x.tva > 0)
    .map((x) => ({ rate: x.rate, ht: round2(x.ht), tva: round2(x.tva) }));

  const tvaCollectee = r55.tva + r10.tva + r20.tva;

  return {
    count,
    caBrutTtc: round2(caBrutTtc),
    avg: round2(count > 0 ? caBrutTtc / count : 0),
    commission: round2(commission),
    commissionNette: round2(commissionNette),
    stripeFee: round2(stripeFee),
    refundTotal: round2(refundTotal),
    caNet: round2(caNet),
    tvaParTaux,
    tvaCollectee: round2(tvaCollectee),
  };
}

/**
 * Décompose UNE commande en ligne d'export comptable ventilé (LOT E). Lit les
 * champs persistés (centimes) et renvoie des EUROS (2 déc.). Les articles 10 %
 * et la livraison (10 %) restent DISTINCTS (colonne `fraisLivraison` à part),
 * contrairement à l'affichage dashboard qui les replie.
 *
 * Réconciliation (commande ventilée) :
 *   ht5_5+tva5_5 + ht10+tva10 + ht20+tva20 + fraisLivraison === ttc
 * (invariant LOT A : Σ tvaBreakdown.*.ttc === total).
 *
 * @param {object} [order] - Document commande Firestore.
 * @returns {{
 *   ttc:number, mode:('collect'|'delivery'), ventilated:boolean,
 *   ht5_5:number, tva5_5:number, ht10:number, tva10:number, ht20:number, tva20:number,
 *   fraisLivraison:number, commission:number, stripeFee:number, refunded:number, net:number
 * }}
 */
function computeOrderRow(order = {}) {
  const o = order || {};
  const tb = o.tvaBreakdown || null;
  const ventilated = !!tb && typeof tb === "object";
  const bucket = (b) =>
    b && typeof b === "object"
      ? { ht: centsToEuros(b.ht), tva: centsToEuros(b.tva), ttc: centsToEuros(b.ttc) }
      : { ht: 0, tva: 0, ttc: 0 };

  const r55 = bucket(tb && tb["5.5"]);
  const r10 = bucket(tb && tb["10"]);
  const r20 = bucket(tb && tb["20"]);
  const liv = bucket(tb && tb.livraison);

  const ttc = round2(Number(o.total) || 0); // euros
  const commission = centsToEuros(o.commission);
  const stripeFee = centsToEuros(o.stripeFee);
  const refund = o.refund || {};
  const refunded = centsToEuros(refund.total);
  const refundCommission = centsToEuros(refund.commission);
  // Net restaurateur = brut TTC − remboursé − commission nette − frais Stripe.
  const net = ttc - refunded - (commission - refundCommission) - stripeFee;

  return {
    ttc,
    mode: o.mode === "delivery" ? "delivery" : "collect",
    ventilated,
    ht5_5: round2(r55.ht), tva5_5: round2(r55.tva),
    ht10: round2(r10.ht), tva10: round2(r10.tva),
    ht20: round2(r20.ht), tva20: round2(r20.tva),
    fraisLivraison: round2(liv.ttc),
    commission: round2(commission),
    stripeFee: round2(stripeFee),
    refunded: round2(refunded),
    net: round2(net),
  };
}

// Durée de la franchise (commission 0 %) en mois — ALIGNÉE sur la règle serveur
// (functions/index.js : 0 % les 6 premiers mois, puis 8 %).
const FRANCHISE_MONTHS = 2;
const COMMISSION_RATE_PCT = 8;

/**
 * Statut de franchise d'un snack (commission 0 % les 6 premiers mois). Réplique
 * EXACTEMENT le calcul serveur (diff en mois calendaires depuis createdAt). Sert
 * au badge positif « Franchise 0 % · encore N mois » (§8.2).
 * @param {*} createdAt - Timestamp Firestore | Date | ms | ISO | null.
 * @param {Date} [now] - injecté pour les tests (défaut : maintenant).
 * @returns {{active:boolean, monthsRemaining:number, feeRatePct:number}}
 */
function franchiseInfo(createdAt, now = new Date()) {
  const d = createdAt?.toDate ? createdAt.toDate() : createdAt != null ? new Date(createdAt) : null;
  if (!d || isNaN(d.getTime())) {
    // Sans date de création connue : on NE prétend pas à une franchise.
    return { active: false, monthsRemaining: 0, feeRatePct: COMMISSION_RATE_PCT };
  }
  const diffMonths = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  const active = diffMonths < FRANCHISE_MONTHS;
  return {
    active,
    monthsRemaining: active ? Math.max(0, FRANCHISE_MONTHS - diffMonths) : 0,
    feeRatePct: active ? 0 : COMMISSION_RATE_PCT,
  };
}

/**
 * Variation en % d'une métrique vs la période précédente. Renvoie null si la base
 * est nulle (pas de % significatif) → l'UI affiche « — » plutôt qu'un ∞ trompeur.
 * @param {number} current
 * @param {number} previous
 * @returns {number|null} variation arrondie à 0,1 % (signée), ou null.
 */
function pctDelta(current, previous) {
  const prev = Number(previous) || 0;
  if (prev === 0) return null;
  return Math.round(((Number(current) || 0) - prev) / prev * 1000) / 10;
}

export {
  computeComptaSummary,
  computeOrderRow,
  franchiseInfo,
  pctDelta,
  centsToEuros,
  round2,
  FRANCHISE_MONTHS,
};
