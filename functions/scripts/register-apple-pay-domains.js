#!/usr/bin/env node
/**
 * 🍏 Rattrapage : enregistre le domaine Apple Pay / Google Pay de chaque snack sur
 * le compte Stripe qui encaisse ses paiements.
 *
 * Pourquoi : le webhook `account.updated` n'enregistre les domaines qu'au PREMIER
 * passage d'un compte connecté à charges_enabled. Un compte déjà actif avant cette
 * logique (ou un nouveau domaine) n'est jamais rattrapé → Apple Pay n'apparaît pas
 * (« domain … is not registered for Apple Pay »).
 *
 * Pour chaque snack : domaine = lib/tenantOrigins (site déployé, sinon champ `domaine`),
 * compte = snack.stripeAccountId (charge directe) ou compte plateforme (pas de Connect).
 * Idempotent (un domaine déjà enregistré est ignoré).
 *
 * Usage (depuis la racine du repo, Node 24) :
 *   export STRIPE_SECRET_KEY=$(gcloud secrets versions access latest --secret=STRIPE_SECRET_KEY --project=snacking-template)
 *   npm run stripe:apple-pay-domains            # dry-run : état actuel, n'écrit rien
 *   npm run stripe:apple-pay-domains:apply      # enregistre les domaines manquants
 *
 * Auth Firestore (une fois) : gcloud auth application-default login
 * Override projet : --project=<id>
 */

const admin = require("firebase-admin");
const Stripe = require("stripe");
const { resolveSnackOrigin } = require("../lib/tenantOrigins");
const { registerApplePayDomains } = require("../lib/wallets");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const projectArg = args.find((a) => a.startsWith("--project="));
const PROJECT_ID = projectArg ? projectArg.split("=")[1] : "snacking-template";

/** État du domaine sur un compte : "active" | "inactive" | "absent". */
async function domainStatus(stripe, domain, stripeAccount) {
  const list = await stripe.paymentMethodDomains.list(
    { domain_name: domain, limit: 1 },
    stripeAccount ? { stripeAccount } : undefined
  );
  const d = list.data[0];
  if (!d) return "absent";
  return d.apple_pay?.status === "active" ? "active" : `inactive (${d.apple_pay?.status_details?.error_message || d.apple_pay?.status || "?"})`;
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!/^(sk|rk)_(test|live)_/.test(key || "")) {
    console.error("🚨 STRIPE_SECRET_KEY absente (cf. en-tête du script).");
    process.exit(1);
  }
  const stripe = Stripe(key);
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  console.log(`\n🍏 Domaines Apple Pay — projet=${PROJECT_ID} Stripe=${key.includes("_live_") ? "LIVE" : "TEST"} mode=${APPLY ? "APPLY ✍️" : "DRY-RUN 👀"}\n`);

  const snacks = await db.collection("snacks").get();
  for (const doc of snacks.docs) {
    const data = doc.data() || {};
    const domain = new URL(resolveSnackOrigin(doc.id, data)).hostname;
    const account = data.stripeAccountId || null;
    const label = `${doc.id} (${data.identity?.name || data.nom || "?"}) → ${domain} sur ${account || "compte plateforme"}`;

    let status;
    try {
      status = await domainStatus(stripe, domain, account);
    } catch (e) {
      console.log(`❌ ${label} : lecture impossible (${e.message})`);
      continue;
    }
    if (status === "active") {
      console.log(`✅ ${label} : déjà actif`);
      continue;
    }
    if (!APPLY) {
      console.log(`⏳ ${label} : ${status} → sera enregistré avec --apply`);
      continue;
    }
    if (account) {
      const r = await registerApplePayDomains(stripe, account, [domain]);
      console.log(`${r.failed.length ? "❌" : "✅"} ${label} : ${JSON.stringify(r)}`);
    } else {
      try {
        await stripe.paymentMethodDomains.create({ domain_name: domain });
        console.log(`✅ ${label} : enregistré`);
      } catch (e) {
        console.log(`❌ ${label} : ${e.message}`);
      }
    }
  }
  console.log(APPLY ? "\nTerminé." : "\nDry-run terminé (rien n'a été écrit).");
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
