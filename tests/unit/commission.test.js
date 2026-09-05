import { describe, it, expect } from "vitest";

function calculateApplicationFee({ stripeAccountId, createdAt, trialPeriodMonths = 1, pricingPlan = "starter", totalCents, commissionRate = 0.08, minFeeCents = 50 }) {
  let applicationFeeAmount = 0;
  if (stripeAccountId) {
    const trialMonths = typeof trialPeriodMonths === 'number' ? trialPeriodMonths : 1;
    const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
    const now = new Date();
    const diffMonths = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
    if (diffMonths >= trialMonths) {
      const plan = pricingPlan || "starter";
      if (plan === "starter") {
        applicationFeeAmount = Math.max(minFeeCents, Math.round(totalCents * commissionRate));
      } else if (plan === "pro") {
        applicationFeeAmount = 0;
      }
    }
  }
  return applicationFeeAmount;
}

describe("Logic encaissement commission Stripe Connect", () => {
  it("0 € de commission pendant la période d'essai (1 mois par défaut)", () => {
    const now = new Date();
    const fee = calculateApplicationFee({
      stripeAccountId: "acct_123",
      createdAt: now,
      trialPeriodMonths: 1,
      pricingPlan: "starter",
      totalCents: 2000,
    });
    expect(fee).toBe(0);
  });

  it("Après 1 mois d'essai en Starter : 8 % de commission (min 0,50 €)", () => {
    const past = new Date();
    past.setMonth(past.getMonth() - 2); // Il y a 2 mois
    
    // Pour une commande de 20 € (2000c), 8% = 160c (1.60 €)
    const fee20 = calculateApplicationFee({
      stripeAccountId: "acct_123",
      createdAt: past,
      trialPeriodMonths: 1,
      pricingPlan: "starter",
      totalCents: 2000,
    });
    expect(fee20).toBe(160);

    // Pour une petite commande de 4 € (400c), 8% = 32c -> minimum de 50c (0,50 €)
    const feeSmall = calculateApplicationFee({
      stripeAccountId: "acct_123",
      createdAt: past,
      trialPeriodMonths: 1,
      pricingPlan: "starter",
      totalCents: 400,
    });
    expect(feeSmall).toBe(50);
  });

  it("Après 1 mois d'essai en Formule PRO (79 €/mois) : 0 € de commission à la transaction", () => {
    const past = new Date();
    past.setMonth(past.getMonth() - 2);
    
    const fee = calculateApplicationFee({
      stripeAccountId: "acct_123",
      createdAt: past,
      trialPeriodMonths: 1,
      pricingPlan: "pro",
      totalCents: 5000,
    });
    expect(fee).toBe(0);
  });

  it("Durée d'essai personnalisée (ex: 3 mois)", () => {
    const past2Months = new Date();
    past2Months.setMonth(past2Months.getMonth() - 2); // Il y a 2 mois (essai de 3 mois non expiré)

    const fee = calculateApplicationFee({
      stripeAccountId: "acct_123",
      createdAt: past2Months,
      trialPeriodMonths: 3,
      pricingPlan: "starter",
      totalCents: 2000,
    });
    expect(fee).toBe(0);
  });
});
