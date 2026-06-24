// 💳 Helper script to create a succeeded Stripe Payment Intent for E2E tests
const fs = require('node:fs');
const path = require('node:path');

const envFile = fs.existsSync(path.join(__dirname, '../../functions/.env.local'))
  ? path.join(__dirname, '../../functions/.env.local')
  : path.join(__dirname, '../../functions/.env');
const lines = fs.readFileSync(envFile, 'utf8').split('\n');
let stripeSecretKey = '';
for (const line of lines) {
  const m = line.match(/^STRIPE_SECRET_KEY=(.*)$/);
  if (m) stripeSecretKey = m[1].trim();
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
