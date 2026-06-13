// 🧾 Tests unitaires — compta nette (LOT D), logique pure sans Firebase.
import { describe, it, expect } from "vitest";
import { computeComptaSummary, computeOrderRow } from "../../src/services/comptaService.js";

describe("computeComptaSummary — CA net", () => {
  it("agrégat vide → tout à zéro (aucune division par 0)", () => {
    const s = computeComptaSummary();
    expect(s).toMatchObject({ count: 0, caBrutTtc: 0, avg: 0, caNet: 0, tvaCollectee: 0 });
    expect(s.tvaParTaux).toEqual([]);
  });

  it("CA net = brut − remboursé − commission nette − frais Stripe (unités €/centimes respectées)", () => {
    // total en EUROS ; le reste en CENTIMES.
    const s = computeComptaSummary({
      count: 2,
      total: 100, // 100,00 € brut TTC
      commission: 800, // 8,00 €
      stripeFee: 175, // 1,75 €
      refundTotal: 0,
      refundCommission: 0,
    });
    // 100 − 0 − 8 − 1.75 = 90.25
    expect(s.caNet).toBe(90.25);
    expect(s.commission).toBe(8);
    expect(s.stripeFee).toBe(1.75);
    expect(s.avg).toBe(50);
  });

  it("un remboursement fait BOUGER le CA net (trou n°1) + commission nette = brute − rendue", () => {
    const base = { count: 1, total: 50, commission: 400, stripeFee: 100 };
    const sansRefund = computeComptaSummary(base);
    const avecRefund = computeComptaSummary({
      ...base,
      refundTotal: 2000, // 20,00 € rendus au client
      refundCommission: 160, // 1,60 € de commission rendue
    });
    // net sans refund : 50 − 0 − 4 − 1 = 45
    expect(sansRefund.caNet).toBe(45);
    // net avec refund : 50 − 20 − (4 − 1.6) − 1 = 50 − 20 − 2.4 − 1 = 26.6
    expect(avecRefund.caNet).toBe(26.6);
    expect(avecRefund.caNet).toBeLessThan(sansRefund.caNet); // le refund a bougé le net
    expect(avecRefund.commissionNette).toBe(2.4);
    expect(avecRefund.refundTotal).toBe(20);
  });

  it("ventilation TVA : une boisson alcoolisée (20 %) ressort en HT/TVA distincts (trou n°2)", () => {
    const s = computeComptaSummary({
      count: 1,
      total: 18,
      tva: {
        ht10: 1000, tva10: 100, // 11,00 € TTC @10 → ht 10,00 / tva 1,00
        ht20: 583, tva20: 117, // 7,00 € TTC @20 → ht 5,83 / tva 1,17
      },
    });
    const r10 = s.tvaParTaux.find((x) => x.rate === 10);
    const r20 = s.tvaParTaux.find((x) => x.rate === 20);
    expect(r10).toEqual({ rate: 10, ht: 10, tva: 1 });
    expect(r20).toEqual({ rate: 20, ht: 5.83, tva: 1.17 });
    expect(s.tvaCollectee).toBe(2.17); // 1,00 + 1,17
  });

  it("la livraison (10 %) est repliée dans le bucket 10 %", () => {
    const s = computeComptaSummary({
      total: 13,
      tva: { ht10: 1000, tva10: 100, htLiv: 273, tvaLiv: 27 }, // frais 3,00 € @10
    });
    const r10 = s.tvaParTaux.find((x) => x.rate === 10);
    expect(r10.ht).toBe(12.73); // 10,00 + 2,73
    expect(r10.tva).toBe(1.27); // 1,00 + 0,27
  });

  it("commandes legacy (pas de tvaBreakdown/commission) → 0 TVA, restent dans le CA brut", () => {
    // Agrégat où seules des commandes legacy existent : total présent, champs A/B absents.
    const s = computeComptaSummary({ count: 3, total: 75 });
    expect(s.caBrutTtc).toBe(75);
    expect(s.tvaCollectee).toBe(0); // aucune TVA fausse introduite (trou n°3)
    expect(s.tvaParTaux).toEqual([]);
    expect(s.caNet).toBe(75); // pas de commission/frais → net = brut
  });

  it("seuls les taux présents apparaissent dans tvaParTaux", () => {
    const s = computeComptaSummary({ total: 11, tva: { ht10: 1000, tva10: 100 } });
    expect(s.tvaParTaux).toHaveLength(1);
    expect(s.tvaParTaux[0].rate).toBe(10);
  });
});

describe("computeOrderRow — ligne d'export ventilé (LOT E)", () => {
  it("réconciliation : Σ(HT+TVA par taux) + frais livraison === TTC + net correct", () => {
    const order = {
      total: 18, // 11 € @10 + 7 € @20
      mode: "delivery",
      commission: 0,
      stripeFee: 45, // 0,45 €
      tvaBreakdown: {
        "10": { ttc: 1100, ht: 1000, tva: 100 },
        "20": { ttc: 700, ht: 583, tva: 117 },
        livraison: null,
      },
      refund: { total: 0, commission: 0 },
    };
    const r = computeOrderRow(order);
    expect(r.ventilated).toBe(true);
    expect(r.mode).toBe("delivery");
    // Réconciliation (acceptance LOT E)
    const somme = r.ht5_5 + r.tva5_5 + r.ht10 + r.tva10 + r.ht20 + r.tva20 + r.fraisLivraison;
    expect(somme).toBeCloseTo(r.ttc, 2);
    expect(r.ht20).toBe(5.83);
    expect(r.tva20).toBe(1.17);
    // net = 18 − 0 − 0 − 0,45
    expect(r.net).toBe(17.55);
  });

  it("la livraison apparaît en colonne dédiée (frais), pas fondue dans le 10 %", () => {
    const order = {
      total: 21,
      mode: "delivery",
      tvaBreakdown: {
        "10": { ttc: 1100, ht: 1000, tva: 100 },
        livraison: { rate: 10, ttc: 1000, ht: 909, tva: 91 },
      },
    };
    const r = computeOrderRow(order);
    expect(r.ht10).toBe(10); // articles seuls
    expect(r.fraisLivraison).toBe(10); // livraison TTC à part
    const somme = r.ht10 + r.tva10 + r.fraisLivraison;
    expect(somme).toBeCloseTo(r.ttc, 2); // 10 + 1 + 10 = 21
  });

  it("un remboursement réduit le net de la ligne", () => {
    const order = { total: 20, commission: 0, stripeFee: 0, refund: { total: 1000, commission: 0 } };
    const r = computeOrderRow(order);
    expect(r.refunded).toBe(10);
    expect(r.net).toBe(10); // 20 − 10
  });

  it("commande legacy (sans tvaBreakdown) → ventilated=false, HT/TVA à 0, net=TTC", () => {
    const r = computeOrderRow({ total: 12 });
    expect(r.ventilated).toBe(false);
    expect(r.ht10).toBe(0);
    expect(r.tva10).toBe(0);
    expect(r.ttc).toBe(12);
    expect(r.net).toBe(12);
  });
});
