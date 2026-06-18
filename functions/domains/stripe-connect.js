// ============================================================================
// 🏦 STRIPE CONNECT — onboarding (Account Link) + portail (Login Link) + statut
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getStripe } = require("../lib/stripe");
const { admin, db } = require("../lib/admin");
const { V, require_ } = require("../lib/validation");
const { enforceRateLimit, callerKey } = require("../lib/rateLimit");
const { assertCallerIsSnackAdmin } = require("../lib/auth");

// ============================================================================
// 🏦 STRIPE CONNECT : ONBOARDING (Account Link) + PORTAIL (Login Link)
// ============================================================================
// Crée (idempotent) le compte Express du snack et renvoie un lien d'onboarding.
// L'écriture de `stripeAccountId` se fait via l'Admin SDK — JAMAIS par le client
// (la rule snacks/write est document-level → ne pas laisser un admin l'auto-écrire).
exports.getStripeOnboardingLink = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = getStripe();
  const { snackId, origin } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  // URL de retour construite SERVEUR depuis une origine whitelistée (anti open-redirect).
  require_(
    V.isString(origin) && (
      /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/i.test(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ),
    "origin invalide."
  );
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "getStripeOnboardingLink"), max: 5, windowMs: 60_000 });

  try {
    const ref = db.collection("snacks").doc(snackId);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    let accountId = data.stripeAccountId || null;

    // Idempotence : on ne crée le compte connecté qu'une seule fois.
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: data.country || "FR",
        email: data.email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { snack_id: snackId },
      });
      accountId = account.id;
      await ref.set({ stripeAccountId: accountId }, { merge: true });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${origin}/admin.html?stripe=refresh`,
      return_url: `${origin}/admin.html?stripe=return`,
    });
    return { url: link.url };
  } catch (error) {
    console.error("❌ Erreur getStripeOnboardingLink :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible de générer le lien d'onboarding Stripe.");
  }
});

// Lien de connexion au portail Stripe Express (compte déjà créé).
// Appelé par le bouton "Ouvrir mon portail" (src/admin.js → openStripeExpressDashboard).
exports.createStripeConnectLoginLink = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = getStripe();
  const { snackId } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "createStripeConnectLoginLink"), max: 10, windowMs: 60_000 });

  try {
    const snap = await db.collection("snacks").doc(snackId).get();
    const accountId = snap.exists ? snap.data().stripeAccountId : null;
    require_(V.isNonEmptyString(accountId), "Compte Stripe non configuré pour ce snack.");
    const link = await stripe.accounts.createLoginLink(accountId);
    return { url: link.url };
  } catch (error) {
    console.error("❌ Erreur createStripeConnectLoginLink :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible d'ouvrir le portail Stripe.");
  }
});

// Statut LIVE du compte connecté (charges_enabled / details_submitted) + sync Firestore.
// Permet à l'UI de distinguer "compte créé mais onboarding incomplet" de "actif",
// sans dépendre de la configuration du webhook account.updated.
exports.getStripeAccountStatus = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = getStripe();
  const { snackId } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "getStripeAccountStatus"), max: 20, windowMs: 60_000 });

  try {
    const ref = db.collection("snacks").doc(snackId);
    const snap = await ref.get();
    const accountId = snap.exists ? snap.data().stripeAccountId : null;
    if (!accountId) return { connected: false, chargesEnabled: false, detailsSubmitted: false };

    const account = await stripe.accounts.retrieve(accountId);
    // Synchronise le statut dans Firestore au passage (source de vérité pour createPaymentIntent).
    await ref.set({
      stripeChargesEnabled: !!account.charges_enabled,
      stripeDetailsSubmitted: !!account.details_submitted,
      stripePayoutsEnabled: !!account.payouts_enabled,
    }, { merge: true });

    return {
      connected: true,
      chargesEnabled: !!account.charges_enabled,
      detailsSubmitted: !!account.details_submitted,
      payoutsEnabled: !!account.payouts_enabled,
    };
  } catch (error) {
    console.error("❌ Erreur getStripeAccountStatus :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible de lire le statut Stripe.");
  }
});

