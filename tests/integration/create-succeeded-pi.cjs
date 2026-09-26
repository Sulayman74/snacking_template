// 💳 Helper script to create a succeeded Stripe Payment Intent for E2E tests
const path = require('node:path');
const { loadTestEnv } = require('./loadTestEnv.cjs');

// Clé TEST lue dans functions/.secret.local (ou l'env CI) — jamais en dur.
const stripeSecretKey = loadTestEnv();

const Stripe = require(path.join(__dirname, '../../functions/node_modules/stripe'));
const stripe = new Stripe(stripeSecretKey, { apiVersion: '2026-03-25.dahlia' });

async function main() {
  const pi = await stripe.paymentIntents.create({
    amount: 1200, // 12,00 €
    currency: 'eur',
    // finalizeOrder exige que le PI soit rattaché au snack commandé (comme le
    // fait createPaymentIntent en prod). SNACK_ID est fourni par `npm run test:e2e`.
    metadata: { snack_id: process.argv[2] || process.env.SNACK_ID || 'Ym1YiO4Ue5Fb5UXlxr06' },
    payment_method: 'pm_card_visa',
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
  });
  console.log(pi.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
