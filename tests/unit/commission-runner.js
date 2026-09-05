const assert = require("node:assert");

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

console.log("🧪 Exécution des tests unitaires de commission & durée d'essai...");

// Test 1: Période d'essai active (1 mois par défaut) -> 0 € commission
const now = new Date();
const fee1 = calculateApplicationFee({
  stripeAccountId: "acct_123",
  createdAt: now,
  trialPeriodMonths: 1,
  pricingPlan: "starter",
  totalCents: 2000,
});
assert.strictEqual(fee1, 0, "Test 1 échoué : la commission doit être 0 pendant l'essai.");
console.log("  ✅ Test 1 (Essai actif -> 0 €) : OK");

// Test 2: Essai expiré (2 mois), plan Starter, commande 20 € -> 1,60 € (160c)
const past = new Date();
past.setMonth(past.getMonth() - 2);
const fee2 = calculateApplicationFee({
  stripeAccountId: "acct_123",
  createdAt: past,
  trialPeriodMonths: 1,
  pricingPlan: "starter",
  totalCents: 2000,
});
assert.strictEqual(fee2, 160, "Test 2 échoué : 8% sur 20€ doit donner 160c.");
console.log("  ✅ Test 2 (Starter expiré 20€ -> 8% = 1.60€) : OK");

// Test 3: Essai expiré, plan Starter, petite commande 4 € -> min 50c (0.50€)
const fee3 = calculateApplicationFee({
  stripeAccountId: "acct_123",
  createdAt: past,
  trialPeriodMonths: 1,
  pricingPlan: "starter",
  totalCents: 400,
});
assert.strictEqual(fee3, 50, "Test 3 échoué : le minimum de 50c doit s'appliquer.");
console.log("  ✅ Test 3 (Starter expiré 4€ -> Min 0.50€) : OK");

// Test 4: Essai expiré (2 mois), plan PRO -> 0 € commission transactionnelle
const fee4 = calculateApplicationFee({
  stripeAccountId: "acct_123",
  createdAt: past,
  trialPeriodMonths: 1,
  pricingPlan: "pro",
  totalCents: 5000,
});
assert.strictEqual(fee4, 0, "Test 4 échoué : le plan PRO doit avoir 0 € de commission transactionnelle.");
console.log("  ✅ Test 4 (Pro expiré -> 0 € transaction) : OK");

// Test 5: Essai de 3 mois personnalisé, 2 mois écoulés -> 0 € commission
const fee5 = calculateApplicationFee({
  stripeAccountId: "acct_123",
  createdAt: past,
  trialPeriodMonths: 3,
  pricingPlan: "starter",
  totalCents: 2000,
});
assert.strictEqual(fee5, 0, "Test 5 échoué : essai de 3 mois non expiré.");
console.log("  ✅ Test 5 (Essai 3 mois non expiré -> 0 €) : OK");

console.log("🎉 TOUS LES TESTS SONT VALIDÉS AVEC SUCCÈS !");
