// ============================================================================
// 💼 ABONNEMENT SaaS (Stripe Billing) — lien Checkout pour le restaurateur
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getStripe } = require("../lib/stripe");
const { admin, db } = require("../lib/admin");
const { V, require_ } = require("../lib/validation");
const { enforceRateLimit, callerKey } = require("../lib/rateLimit");

// ============================================================================
// 💼 ABONNEMENT SaaS (Stripe Billing) : lien Checkout à envoyer au restaurateur
// ============================================================================
// SUPERADMIN uniquement. Montant mensuel choisi (ex. 20/39/49 €) → prix INLINE
// (price_data), donc aucun Price à pré-créer dans Stripe. Le snack_id voyage en
// metadata → le webhook checkout.session.completed lie l'abonnement au snack.
exports.createSubscriptionCheckout = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = getStripe();
  const { snackId, amountEur, origin } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isPositiveInt(amountEur, 1000) && amountEur >= 5, "Montant invalide (5 à 1000 €).");
  require_(
    V.isString(origin) && (
      /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/i.test(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ),
    "origin invalide."
  );

  // 🛡️ Superadmin uniquement.
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== "superadmin") {
    throw new HttpsError("permission-denied", "Réservé au superadmin.");
  }
  await enforceRateLimit({ key: callerKey(request, "createSubscriptionCheckout"), max: 30, windowMs: 3_600_000 });

  const snackSnap = await db.collection("snacks").doc(snackId).get();
  require_(snackSnap.exists, "Snack introuvable.");
  const snackName = snackSnap.data().nom || snackId;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          product_data: { name: `Abonnement SaaS — ${snackName}` },
          unit_amount: amountEur * 100, // centimes
          recurring: { interval: "month" },
        },
      }],
      metadata: { snack_id: snackId },
      subscription_data: { metadata: { snack_id: snackId } },
      allow_promotion_codes: true,
      success_url: `${origin}/admin.html?sub=success`,
      cancel_url: `${origin}/superadmin.html?sub=cancel`,
    });
    return { url: session.url };
  } catch (error) {
    console.error("❌ createSubscriptionCheckout :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible de générer le lien d'abonnement.");
  }
});

