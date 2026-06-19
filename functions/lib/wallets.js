// ============================================================================
// 🍏 WALLETS — enregistrement du domaine Apple Pay par COMPTE CONNECTÉ
// ============================================================================
// Le tunnel paiement utilise le Stripe Payment Element avec
// `automatic_payment_methods: { enabled: true }` (cf. functions/domains/payment.js).
// Les wallets (Google Pay / Link) s'affichent alors automatiquement — SAUF
// Apple Pay, qui exige l'ENREGISTREMENT DU DOMAINE chez Stripe.
//
// Architecture : charges DIRECTES sur le compte connecté (createPaymentIntent
// passe `{ stripeAccount }` + `application_fee_amount`). Le « merchant of record »
// Apple Pay est donc CHAQUE restaurateur (compte connecté), pas la plateforme.
// Le domaine doit donc être enregistré PAR COMPTE CONNECTÉ via
// `stripe.paymentMethodDomains.create({ domain_name }, { stripeAccount })`.
//
// ⚠️ VOLET CODE UNIQUEMENT. Étapes opérationnelles HORS-CODE indispensables :
//   1. Activer Apple Pay / Google Pay / Link dans le Dashboard Stripe (settings
//      des wallets) — par compte connecté Express le cas échéant.
//   2. Vérifier que le fichier d'association de domaine Apple est servi à
//      `/.well-known/apple-developer-merchantid-domain-association` (Stripe
//      l'héberge automatiquement via le Payment Element, mais à re-vérifier sur
//      domaines custom / si CDN/SW intercepte).
//   3. Tester en mode LIVE sur appareil réel (Safari iOS/macOS) — Apple Pay ne
//      s'affiche pas en environnement non éligible.

/**
 * Domaines d'hébergement des tenants sur lesquels enregistrer Apple Pay.
 * Liste CONFIGURABLE (cf. firebase.json hosting + scripts deploy de package.json).
 * Tenir synchronisé avec les cibles hosting / domaines custom ajoutés.
 * @type {readonly string[]}
 */
const APPLE_PAY_DOMAINS = Object.freeze([
  "snacking-template.web.app",
  "o-bois-pizza.web.app",
  "pizzeriadelagare.web.app",
  "belly-smash-burger.web.app",
]);

/**
 * Détecte une erreur Stripe « ressource déjà existante » (domaine déjà enregistré
 * sur ce compte). Couvre le code générique `resource_already_exists` et, par
 * prudence, toute formulation « already ... exist » sur les domaines de méthode
 * de paiement (l'API peut renvoyer un 400 invalid_request_error dans ce cas).
 * @param {any} error - L'erreur levée par le SDK Stripe.
 * @returns {boolean} true si l'erreur signifie « déjà enregistré » (à ignorer).
 */
function isAlreadyRegistered(error) {
  if (!error) return false;
  if (error.code === "resource_already_exists") return true;
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("already") && msg.includes("exist");
}

/**
 * Enregistre (idempotent, best-effort) chaque domaine de la plateforme comme
 * domaine Apple Pay sur un compte connecté Stripe donné. Nécessaire pour que le
 * bouton Apple Pay s'affiche dans le Payment Element en charges directes.
 *
 * Idempotence : si un domaine est déjà enregistré sur le compte, l'erreur Stripe
 * « resource_already_exists » est ignorée proprement. Best-effort : AUCUNE
 * exception n'est propagée — cette fonction ne doit JAMAIS faire échouer le
 * webhook qui l'appelle (les erreurs sont seulement loggées, sans secret).
 *
 * @param {import("stripe").Stripe} stripe - Client Stripe (cf. getStripe()).
 * @param {string} stripeAccountId - ID du compte connecté (acct_…).
 * @param {readonly string[]} [domains=APPLE_PAY_DOMAINS] - Domaines à enregistrer.
 * @returns {Promise<{registered: string[], skipped: string[], failed: string[]}>}
 *   Bilan par domaine (ne lève jamais).
 */
async function registerApplePayDomains(stripe, stripeAccountId, domains = APPLE_PAY_DOMAINS) {
  const result = { registered: [], skipped: [], failed: [] };
  if (!stripe || !stripeAccountId) {
    console.warn("⚠️ registerApplePayDomains: stripe ou stripeAccountId manquant — no-op.");
    return result;
  }

  for (const domain of domains) {
    try {
      await stripe.paymentMethodDomains.create(
        { domain_name: domain },
        { stripeAccount: stripeAccountId }
      );
      result.registered.push(domain);
    } catch (error) {
      if (isAlreadyRegistered(error)) {
        // Déjà enregistré sur ce compte → idempotent, on ignore.
        result.skipped.push(domain);
      } else {
        // Best-effort : on log (sans secret) et on continue les autres domaines.
        result.failed.push(domain);
        console.error(
          `❌ registerApplePayDomains: échec ${domain} (acct ${stripeAccountId}): ${error?.message || error}`
        );
      }
    }
  }

  console.log(
    `🍏 Apple Pay domains (acct ${stripeAccountId}): ` +
    `enregistrés=${result.registered.length} déjà=${result.skipped.length} échecs=${result.failed.length}`
  );
  return result;
}

module.exports = { registerApplePayDomains, isAlreadyRegistered, APPLE_PAY_DOMAINS };
