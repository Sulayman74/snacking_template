// ============================================================================
// 🔌 CLIENT STRIPE — instanciation centralisée (DRY / DIP)
// ============================================================================
// Toutes les Cloud Functions passent par getStripe() afin que la version d'API
// soit ÉPINGLÉE en un seul endroit, au lieu d'être implicite (version par défaut
// du compte → dérive non maîtrisée).
//
// ⚠️ STRIPE_API_VERSION est ALIGNÉE sur la version configurée pour le endpoint
// webhook "snacks_events" (Dashboard → Developers → Webhooks). Garder les deux
// synchronisés garantit que les objets construits/lus par le serveur ont la même
// forme que les events reçus par le webhook (ex. invoice.parent.* en Basil+).
// Si tu changes la version du endpoint, mets à jour cette constante (et re-teste
// le tunnel paiement sur clés TEST).

const Stripe = require("stripe");

/** Version d'API Stripe épinglée — cf. endpoint webhook "snacks_events". */
const STRIPE_API_VERSION = "2026-03-25.dahlia";

/**
 * Instancie un client Stripe avec la clé secrète d'environnement et l'apiVersion
 * épinglée. À utiliser à la place de `require("stripe")(...)` direct.
 * @returns {import("stripe").Stripe} Client Stripe configuré.
 */
function getStripe() {
    return Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
}

/**
 * Résout l'ID d'abonnement Stripe à partir d'un objet Invoice, en supportant
 * l'ancien champ `invoice.subscription` (legacy, pré-Basil) ET le nouveau chemin
 * `invoice.parent.subscription_details.subscription` (API 2025-03-31.basil+).
 * Pattern Read Old/New (CLAUDE.md §5.1) : sûr quelle que soit la version d'API
 * configurée sur le endpoint webhook. Logique PURE → testable sans I/O.
 * @param {object} invoice - L'objet Invoice issu de l'event Stripe.
 * @returns {string|null} L'ID d'abonnement, ou null si absent/non résoluble.
 */
function resolveSubscriptionId(invoice) {
    if (!invoice) return null;
    if (typeof invoice.subscription === "string") return invoice.subscription; // legacy
    const parent = invoice.parent;
    if (parent && parent.type === "subscription_details") {
        return parent.subscription_details?.subscription ?? null; // Basil+
    }
    return null;
}

module.exports = { getStripe, STRIPE_API_VERSION, resolveSubscriptionId };
