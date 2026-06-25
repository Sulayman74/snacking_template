// 💳 Helper script to create a succeeded Stripe Payment Intent for E2E tests
const fs = require('node:fs');
const path = require('node:path');

let stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';

if (!stripeSecretKey) {
  const envFile = fs.existsSync(path.join(__dirname, '../../functions/.env.local'))
    ? path.join(__dirname, '../../functions/.env.local')
    : path.join(__dirname, '../../functions/.env');
  
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^STRIPE_SECRET_KEY=(.*)$/);
      if (m) stripeSecretKey = m[1].trim();
    }
  }
}

// Fallback sémantique de test pour la CI/CD
if (!stripeSecretKey) {
  stripeSecretKey = 'sk_test_51TG1RfIfiBxoqwsyO2yoMirsEnrFhIph722SR3E8LrHakSZCkj3ol6riBD19A7d4JSfSBHkRVSOcR9lUZL5yCN8s00dMYYurX9';
}

const Stripe = require(path.join(__dirname, '../../functions/node_modules/stripe'));
const stripe = new Stripe(stripeSecretKey, { apiVersion: '2026-03-25.dahlia' });

async function main() {
  const pi = await stripe.paymentIntents.create({
    amount: 1200, // 12,00 €
    currency: 'eur',
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
