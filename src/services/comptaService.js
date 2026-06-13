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

export { computeComptaSummary, centsToEuros, round2 };
