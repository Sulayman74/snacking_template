// ============================================================================
// 💳 PAIEMENT — PaymentIntent, finalisation commande, remboursement
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getStripe, STRIPE_SECRET_KEY } = require("../lib/stripe");
const { db, FieldValue } = require("../lib/admin");
const { V, require_ } = require("../lib/validation");
const { enforceRateLimit, callerKey } = require("../lib/rateLimit");
const { assertCallerIsSnackAdmin } = require("../lib/auth");
const { isFiniteNum } = require("../lib/geo");
const { computeAuthoritativeOrder } = require("../lib/pricing");
const { applyRefundToOrder } = require("../lib/refund");
const {
  ORDER_CURRENCY,
  assertPaymentIntentMatchesOrder,
  assertPaymentIntentOwnedBy,
} = require("../lib/paymentGuards");
const { PENDING_ORDERS, createOrderFromPaymentIntent } = require("../lib/orderCreation");

// Limite la profondeur des metadata acceptés par Stripe (clés/valeurs <=500 chars)
function sanitizeStripeMetadata(metadata) {
  if (!V.isPlainObject(metadata)) return {};
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(metadata)) {
    if (count++ >= 50) break;
    if (typeof k !== "string" || k.length > 40) continue;
    const value = v == null ? "" : String(v);
    if (value.length > 500) continue;
    out[k] = value;
  }
  return out;
}
// ============================================================================
// 💳 FONCTION 4 : LE TIROIR-CAISSE (STRIPE CHECKOUT)
// ============================================================================

exports.createPaymentIntent = onCall(
  { region: "europe-west1", secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    const stripe = getStripe();

    // 🛡️ Authentification obligatoire : le client est forcément loggé pour
    // commander (cf. src/checkout.js). Ferme la porte aux appels anonymes
    // (création massive d'intents / sondage des snackId).
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    // 🛡️ Rate limit AVANT toute logique : 10 tentatives / 60s par utilisateur (ou IP)
    await enforceRateLimit({
      key: callerKey(request, "createPaymentIntent"),
      max: 10,
      windowMs: 60_000,
    });

    // 🛡️ Validation stricte des entrées
    const data = request.data;
    require_(V.isPlainObject(data), "Payload invalide.");

    // 🛡️ ANTI CHARGE ORPHELINE (F1) — le montant du PaymentIntent est désormais
    // RECALCULÉ côté serveur depuis le panier + la config livraison (jamais le
    // `amount` client, conservé seulement pour compat/traçabilité). On valide donc
    // le panier AVANT de débiter : prix manipulé / hors-zone / minimum → rejet sans
    // aucune charge. Le client recalculait déjà côté UI ; ici c'est l'autorité.
    const { currency, description, metadata, snackId, cartItems, mode, livraison } = data;

    require_(V.isDocId(snackId), "snackId invalide.");
    require_(V.isArray(cartItems) && cartItems.length > 0, "cartItems vide ou invalide.");
    require_(cartItems.length <= 100, "Panier trop volumineux.");
    require_(
      currency === undefined || (V.isString(currency) && /^[a-z]{3}$/i.test(currency)),
      "Devise invalide."
    );
    require_(
      description === undefined ||
        (V.isString(description) && description.length <= 1000),
      "Description invalide."
    );
    require_(
      metadata === undefined || V.isPlainObject(metadata),
      "Metadata invalides."
    );

    // Validation détaillée de chaque item (même contrat que finalizeOrder).
    for (const item of cartItems) {
      require_(V.isPlainObject(item), "Item de panier invalide.");
      require_(V.isNonEmptyString(item.nom, 200), "Nom d'item invalide.");
      require_(
        typeof item.prix === "number" && item.prix >= 0 && item.prix < 10_000,
        "Prix d'item invalide."
      );
      require_(V.isPositiveInt(item.quantity, 100), "Quantité d'item invalide.");
    }

    // 🚚 Mode + adresse de livraison (collect par défaut → legacy inchangé).
    const orderMode = mode === "delivery" ? "delivery" : "collect";
    if (orderMode === "delivery") {
      require_(V.isPlainObject(livraison), "livraison requise pour une commande en livraison.");
      require_(isFiniteNum(livraison.lat) && Math.abs(livraison.lat) <= 90, "Latitude de livraison invalide.");
      require_(isFiniteNum(livraison.lng) && Math.abs(livraison.lng) <= 180, "Longitude de livraison invalide.");
      require_(
        livraison.adresse === undefined ||
          livraison.adresse === null ||
          (V.isString(livraison.adresse) && livraison.adresse.length <= 300),
        "Adresse de livraison invalide."
      );
    }

    try {
      // 1. Récupération du Snack (Tenant) + config Stripe Connect.
      const snackDoc = await db.collection("snacks").doc(snackId).get();
      const snackData = snackDoc.exists ? (snackDoc.data() || {}) : {};
      const stripeAccountId = snackData.stripeAccountId || null;

      // 🛡️ Garde : compte connecté créé mais onboarding NON terminé.
      if (stripeAccountId && snackData.stripeChargesEnabled === false) {
        throw new HttpsError(
          "failed-precondition",
          "Le compte Stripe du restaurant n'a pas terminé sa configuration."
        );
      }

      // 2. 🛡️ MONTANT AUTORITATIF — recalcul + validation panier/zone/minimum AVANT
      //    tout débit. Toute manipulation rejette ici, sans charge orpheline (F1).
      const { totalCents } = await computeAuthoritativeOrder(snackData, snackId, cartItems, orderMode, livraison, {
        enforceOpeningHours: true,
      });
      require_(totalCents >= 50, "Montant inférieur au minimum (0,50 €).");

      // Règle Métier : Période d'essai (ex: 1 mois par défaut), puis commission selon la formule (Starter 8% ou Pro 0%).
      let applicationFeeAmount = 0;
      if (stripeAccountId) {
        const trialMonths = typeof snackData.trialPeriodMonths === 'number' ? snackData.trialPeriodMonths : 1;
        const createdAt = snackData.createdAt?.toDate() || new Date();
        const now = new Date();
        const diffMonths = (now.getFullYear() - createdAt.getFullYear()) * 12 + (now.getMonth() - createdAt.getMonth());
        if (diffMonths >= trialMonths) {
          const plan = snackData.pricingPlan || "starter";
          if (plan === "starter") {
            // Offre Starter : 8% avec un minimum de 0,50 € (50 centimes) par transaction
            const commissionRate = typeof snackData.commissionRate === 'number' ? snackData.commissionRate : 0.08;
            const minFeeCents = typeof snackData.minFeeCents === 'number' ? snackData.minFeeCents : 50;
            applicationFeeAmount = Math.max(minFeeCents, Math.round(totalCents * commissionRate));
          } else if (plan === "pro") {
            // Offre Pro : Loyer SaaS fixe mensuel (ex: 79 €/mois) -> 0 % de commission transactionnelle
            applicationFeeAmount = 0;
          }
        }
      }

      // 3. Préparation des paramètres du PaymentIntent (montant = total serveur).
      const params = {
        amount: totalCents,
        // 🛡️ Devise IMPOSÉE serveur : le montant est calculé en centimes d'euro.
        // Accepter la devise client permettait de payer 1500 KRW (~1 €) une
        // commande de 15 € (devises sans décimales). Le param client est ignoré.
        currency: ORDER_CURRENCY,
        description: description || "Commande en ligne",
        // Metadata SERVEUR de confiance (traçabilité) en plus de celles du client.
        // order_id ≡ paymentIntentId (id de commande déterministe dans finalizeOrder),
        // donc déjà traçable sans le dupliquer ici.
        metadata: sanitizeStripeMetadata({
          ...(metadata || {}),
          snack_id: snackId,
          client_email: request.auth?.token?.email || metadata?.clientEmail || "",
          // Propriétaire du PI (vérifié par finalizeOrder) — posé APRÈS le spread
          // client pour qu'il ne puisse pas être usurpé.
          uid: request.auth.uid,
        }),
        // 🛡️ Pas de moyens de paiement à REDIRECTION (PayPal/Klarna/iDEAL…) : le
        // client ne gère pas le retour sur return_url → client débité sans
        // commande. Cartes (3DS en modale, redirect:"if_required"), Apple/Google
        // Pay et Link restent disponibles.
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      };

      // 4. Optionnel : Routage Stripe Connect (charge directe sur le compte connecté).
      let requestOptions = undefined;
      if (stripeAccountId) {
          if (applicationFeeAmount > 0) {
              params.application_fee_amount = applicationFeeAmount;
          }
          requestOptions = { stripeAccount: stripeAccountId };
      }

      const paymentIntent = await stripe.paymentIntents.create(params, requestOptions);

      // 🧾 FILET « DÉBITÉ SANS COMMANDE » — on mémorise le panier VALIDÉ côté
      // serveur (clé = id du PI). Si le client perd le réseau entre le paiement et
      // finalizeOrder, le réconciliateur planifié (domains/order-recovery) crée la
      // commande à partir de ce document. Supprimé dès que la commande existe.
      // Écrit AVANT de renvoyer le clientSecret : en cas d'échec, aucun débit possible.
      await db.collection(PENDING_ORDERS).doc(paymentIntent.id).set({
        snackId,
        uid: request.auth.uid,
        isGuest: request.auth.token?.firebase?.sign_in_provider === "anonymous",
        clientEmail: request.auth.token?.email || "",
        clientNom: request.auth.token?.name || null,
        stripeAccountId: stripeAccountId || null,
        cartItems,
        mode: orderMode,
        livraison: orderMode === "delivery" ? livraison : null,
        createdAt: FieldValue.serverTimestamp(),
      });

      // `stripeAccountId` est renvoyé au client : en charge DIRECTE, Stripe.js doit
      // initialiser Elements avec `{ stripeAccount }` (sinon elements/sessions → 400,
      // la clé plateforme ne voit pas le PI du compte connecté). Non sensible : c'est
      // un identifiant de compte (les docs `snacks` sont déjà en lecture publique).
      return { clientSecret: paymentIntent.client_secret, stripeAccountId: stripeAccountId || null };
    } catch (error) {
      console.error("❌ Erreur Stripe PaymentIntent :", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Impossible d'initialiser le paiement.");
    }
  },
);

// ============================================================================
// 💳 FONCTION 5 : FINALISATION COMMANDE (vérification Stripe côté serveur)
// ============================================================================
exports.finalizeOrder = onCall(
  { region: "europe-west1", secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    const stripe = getStripe();

    // 1. Authentification obligatoire
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }
    const uid = request.auth.uid;

    // 🛡️ Rate limit : 5 finalisations / 60s par utilisateur (au-dessus = abus)
    await enforceRateLimit({
      key: callerKey(request, "finalizeOrder"),
      max: 5,
      windowMs: 60_000,
    });

    // 🛡️ Validation stricte
    const data = request.data;
    require_(V.isPlainObject(data), "Payload invalide.");

    const {
      paymentIntentId,
      snackId,
      cartItems,
      clientEmail,
      clientNom,
      totalCents,
      referrerId,
      mode,
      livraison,
    } = data;

    require_(V.isNonEmptyString(paymentIntentId, 200), "paymentIntentId invalide.");
    require_(V.isDocId(snackId), "snackId invalide.");
    require_(V.isArray(cartItems) && cartItems.length > 0, "cartItems vide ou invalide.");
    require_(cartItems.length <= 100, "Panier trop volumineux.");
    require_(V.isEmail(clientEmail), "clientEmail invalide.");
    require_(
      clientNom === undefined ||
        clientNom === null ||
        (V.isString(clientNom) && clientNom.length <= 100),
      "clientNom invalide."
    );
    require_(V.isPositiveInt(totalCents, 1_000_000), "totalCents invalide.");
    require_(
      referrerId === undefined || referrerId === null || V.isDocId(referrerId),
      "referrerId invalide."
    );

    // 🚚 Mode + adresse de livraison (collect par défaut → legacy inchangé).
    const orderMode = mode === "delivery" ? "delivery" : "collect";
    if (orderMode === "delivery") {
      require_(V.isPlainObject(livraison), "livraison requise pour une commande en livraison.");
      require_(isFiniteNum(livraison.lat) && Math.abs(livraison.lat) <= 90, "Latitude de livraison invalide.");
      require_(isFiniteNum(livraison.lng) && Math.abs(livraison.lng) <= 180, "Longitude de livraison invalide.");
      require_(
        livraison.adresse === undefined ||
          livraison.adresse === null ||
          (V.isString(livraison.adresse) && livraison.adresse.length <= 300),
        "Adresse de livraison invalide."
      );
    }

    // Validation détaillée de chaque item du panier
    for (const item of cartItems) {
      require_(V.isPlainObject(item), "Item de panier invalide.");
      require_(V.isNonEmptyString(item.nom, 200), "Nom d'item invalide.");
      require_(
        typeof item.prix === "number" && item.prix >= 0 && item.prix < 10_000,
        "Prix d'item invalide."
      );
      require_(V.isPositiveInt(item.quantity, 100), "Quantité d'item invalide.");
    }

    // 2. Vérifier le PaymentIntent côté Stripe (le client ne peut pas falsifier ça)
    let paymentIntent;
    let snackData = {};
    try {
      const snackDoc = await db.collection("snacks").doc(snackId).get();
      if (snackDoc.exists) {
          snackData = snackDoc.data() || {};
      }
      const stripeAccountId = snackData.stripeAccountId || null;

      const retrieveOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
      // Expand latest_charge.balance_transaction → frais Stripe RÉELS (fee/net),
      // lus et non estimés (LOT A). En charge directe, la BT est sur le compte connecté.
      paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ["latest_charge.balance_transaction"] },
        retrieveOptions
      );
    } catch (e) {
      throw new HttpsError("not-found", "PaymentIntent introuvable.");
    }

    if (paymentIntent.status !== "succeeded") {
      throw new HttpsError("failed-precondition", `Paiement non confirmé (statut: ${paymentIntent.status}).`);
    }

    // 🛡️ PI émis pour CE snack et en EUR (cf. lib/paymentGuards).
    assertPaymentIntentMatchesOrder(paymentIntent, snackId);

    // 3. Le contrôle du montant encaissé est fait plus bas, APRÈS recalcul serveur
    //    du total attendu (articles validés + frais de livraison config). On ne se
    //    fie PAS au `totalCents` envoyé par le client (cf. CLAUDE.md §6.1).

    // 🛡️ PI créé par CET utilisateur (metadata.uid posé par createPaymentIntent).
    assertPaymentIntentOwnedBy(paymentIntent, uid);

    // 4-5. Création idempotente + effets de bord (chemin partagé avec le
    //      réconciliateur planifié — cf. lib/orderCreation).
    const { orderId } = await createOrderFromPaymentIntent({
      stripe,
      paymentIntent,
      snackId,
      snackData,
      uid,
      // `isGuest` dérivé du TOKEN auth (non falsifiable par le client).
      isGuest: request.auth?.token?.firebase?.sign_in_provider === "anonymous",
      cartItems,
      orderMode,
      livraison,
      clientEmail,
      clientNom,
      referrerId,
    });
    return { orderId };
  }
);

// ============================================================================
// 💸 REMBOURSEMENT (LOT B) — refundOrder + réconciliation
// ============================================================================


/**
 * Rembourse une commande (total ou partiel). Charge DIRECTE : le refund passe
 * `{ stripeAccount }` + `refund_application_fee: true` (si commission Connect) →
 * Stripe rend la commission au prorata. Admin du snack propriétaire uniquement.
 * Montants en centimes, lus depuis la commande (jamais le client). Idempotent
 * (Idempotency-Key + dédup refundId).
 * @param {object} request.data - `{ orderId, amount?, reason? }`.
 */
exports.refundOrder = onCall({ region: "europe-west1", secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const stripe = getStripe();
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");

  // 1. Validation stricte des entrées.
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { orderId, amount, reason } = data;
  require_(V.isNonEmptyString(orderId, 200), "orderId invalide.");
  require_(
    amount === undefined || amount === null || V.isPositiveInt(amount, 1_000_000),
    "amount invalide (centimes)."
  );
  const REASONS = ["duplicate", "fraudulent", "requested_by_customer"];
  const refundReason = reason === undefined || reason === null ? "requested_by_customer" : reason;
  require_(REASONS.includes(refundReason), "reason invalide.");

  // 2. Rate limit (clé par uid) — avant les lectures, pour couper l'abus tôt.
  await enforceRateLimit({ key: callerKey(request, "refundOrder"), max: 10, windowMs: 60_000 });

  // 3. Lire la commande (Admin SDK) — source de vérité serveur.
  const orderRef = db.collection("commandes").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new HttpsError("not-found", "Commande introuvable.");
  const order = orderSnap.data() || {};

  // 4. Admin du snack PROPRIÉTAIRE (snackId lu sur la commande, jamais du client).
  const snackId = order.snackId;
  require_(V.isDocId(snackId), "Commande sans snackId valide.");
  await assertCallerIsSnackAdmin(request, snackId);

  // 5. Garde-fous montant. ⚠️ order.total est en EUROS ; tout le reste en centimes.
  const refundableStatuts = ["paye", "partiellement_rembourse"];
  require_(
    refundableStatuts.includes(order.paiement?.statut),
    "Commande non remboursable (statut paiement)."
  );
  const paymentIntentId = order.paiement?.stripeSessionId;
  require_(V.isNonEmptyString(paymentIntentId, 200), "PaymentIntent introuvable sur la commande.");
  const orderTotalCents = Math.round(Number(order.total) * 100);
  require_(Number.isInteger(orderTotalCents) && orderTotalCents > 0, "Total de commande invalide.");
  const alreadyRefunded = Number(order.refund?.total) || 0;
  const remaining = orderTotalCents - alreadyRefunded;
  require_(remaining > 0, "Commande déjà intégralement remboursée.");
  const refundAmount = amount === undefined || amount === null ? remaining : amount;
  require_(refundAmount > 0 && refundAmount <= remaining, "Montant de remboursement hors limites.");

  // 6. Compte connecté (charge directe). Null = charge plateforme (legacy/sans Connect).
  const snackDoc = await db.collection("snacks").doc(snackId).get();
  const stripeAccountId = (snackDoc.exists ? snackDoc.data() : {}).stripeAccountId || null;

  // 7. Refund Stripe. `refund_application_fee` n'est valide QUE si la charge porte
  //    réellement une commission Connect (sinon Stripe rejette : "can only be used
  //    by the Connect application that created the charge"). On ne le passe donc que
  //    si compte connecté ET commission > 0 (ex. période franchise 0 % → aucune
  //    application fee à rendre). Quand présent, Stripe rend la commission au prorata.
  //    Idempotency-Key dérivée de l'état → un retry réseau renvoie le MÊME refund.id
  //    (puis dédup en base), un nouveau remboursement partiel a une clé distincte.
  const hasApplicationFee = !!stripeAccountId && (Number(order.commission) || 0) > 0;
  const refundParams = { payment_intent: paymentIntentId, amount: refundAmount, reason: refundReason };
  if (hasApplicationFee) refundParams.refund_application_fee = true;
  let refund;
  try {
    refund = await stripe.refunds.create(refundParams, {
      ...(stripeAccountId ? { stripeAccount: stripeAccountId } : {}),
      idempotencyKey: `refund_${orderId}_${refundAmount}_${alreadyRefunded}`,
    });
  } catch (e) {
    console.error("refundOrder — échec Stripe refunds.create :", e?.message || e);
    throw new HttpsError("internal", "Échec du remboursement côté Stripe.");
  }

  // 8. Commission rendue au prorata (cohérent avec Stripe ; évite un appel API
  //    supplémentaire ; réconciliable a posteriori via l'objet application_fee_refund).
  const commissionRefunded =
    orderTotalCents > 0 ? Math.round(((Number(order.commission) || 0) * refundAmount) / orderTotalCents) : 0;

  // 9. Persister (transaction idempotente, partagée avec le webhook).
  const res = await applyRefundToOrder(orderRef, {
    refundId: refund.id,
    amount: refundAmount,
    commissionRefunded,
    reason: refundReason,
    source: "app",
  });

  return {
    ok: true,
    refundId: refund.id,
    amount: refundAmount,
    commissionRefunded,
    duplicate: res.duplicate === true,
    refundTotal: res.refundTotal,
    fullyRefunded: res.fullyRefunded ?? res.refundTotal >= orderTotalCents,
  };
});

