// ============================================================================
// 💳 PAIEMENT — PaymentIntent, finalisation commande, remboursement
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getMessaging } = require("firebase-admin/messaging");
const { getStripe } = require("../lib/stripe");
const { ventilateTva } = require("../lib/tva");
const { db, FieldValue, Timestamp } = require("../lib/admin");
const { V, require_ } = require("../lib/validation");
const { enforceRateLimit, callerKey } = require("../lib/rateLimit");
const { sendRewardPush } = require("../lib/fcm");
const { resolveLoyaltyCooldownMs, creditLoyaltyPoints } = require("../lib/loyalty");
const { assertCallerIsSnackAdmin } = require("../lib/auth");
const { isFiniteNum } = require("../lib/geo");
const { getKitchenQueueCount, computePrepMin } = require("../lib/kitchen");
const { computeAuthoritativeOrder, refundOrphanChargeBestEffort } = require("../lib/pricing");
const { generateSecretCode } = require("../lib/util");
const { applyRefundToOrder } = require("../lib/refund");
const { emitEvent } = require("../lib/events");

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
  { region: "europe-west1" },
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
      const { totalCents } = await computeAuthoritativeOrder(snackData, snackId, cartItems, orderMode, livraison);
      require_(totalCents >= 50, "Montant inférieur au minimum (0,50 €).");

      // Règle Métier : 0% les 6 premiers mois, puis 8% (sur le total SERVEUR).
      let applicationFeeAmount = 0;
      if (stripeAccountId) {
        const createdAt = snackData.createdAt?.toDate() || new Date();
        const now = new Date();
        const diffMonths = (now.getFullYear() - createdAt.getFullYear()) * 12 + (now.getMonth() - createdAt.getMonth());
        if (diffMonths >= 2) {
          // Commission : 8%, mais avec un minimum de 0,50 € (50 centimes) par transaction 
          // pour couvrir les frais fixes de Stripe (≈0,25€) + marge de sécurité pour cartes étrangères.
          applicationFeeAmount = Math.max(50, Math.round(totalCents * 0.08));
        }
      }

      // 3. Préparation des paramètres du PaymentIntent (montant = total serveur).
      const params = {
        amount: totalCents,
        currency: currency ? currency.toLowerCase() : "eur",
        description: description || "Commande en ligne",
        // Metadata SERVEUR de confiance (traçabilité) en plus de celles du client.
        // order_id ≡ paymentIntentId (id de commande déterministe dans finalizeOrder),
        // donc déjà traçable sans le dupliquer ici.
        metadata: sanitizeStripeMetadata({
          ...(metadata || {}),
          snack_id: snackId,
          client_email: request.auth?.token?.email || metadata?.clientEmail || "",
        }),
        automatic_payment_methods: { enabled: true },
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
  { region: "europe-west1" },
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

    // 3. Le contrôle du montant encaissé est fait plus bas, APRÈS recalcul serveur
    //    du total attendu (articles validés + frais de livraison config). On ne se
    //    fie PAS au `totalCents` envoyé par le client (cf. CLAUDE.md §6.1).

    // 4. Idempotence ATOMIQUE — l'ID de la commande est dérivé du PaymentIntent
    //    (unique côté Stripe). Un check rapide évite de recalculer si la commande
    //    existe déjà ; la garantie anti-race repose sur le create() atomique (§5).
    const orderId = paymentIntentId;
    const docRef = db.collection("commandes").doc(orderId);
    const existingDoc = await docRef.get();
    if (existingDoc.exists) {
      return { orderId };
    }

    // 🛡️ MONTANT AUTORITATIF + VALIDATION — recalcul serveur (prix/zone/minimum)
    // via le helper partagé avec createPaymentIntent (DRY). Le client est DÉJÀ
    // débité (PI succeeded) : si la commande est jugée invalide ICI (cas résiduel,
    // ex. prix produit modifié entre la création du PI et la finalisation, ou panier
    // divergent), on rembourse AUTOMATIQUEMENT la charge avant de propager l'erreur
    // — plus de charge orpheline (F1). Le chemin nominal est déjà validé en amont
    // par createPaymentIntent, donc ce filet ne se déclenche qu'exceptionnellement.
    let itemsCents, lines, fraisCents, livraisonData, distanceKm;
    try {
      ({ itemsCents, lines, fraisCents, livraisonData, distanceKm } =
        await computeAuthoritativeOrder(snackData, snackId, cartItems, orderMode, livraison));

      // 🛡️ TOTAL ATTENDU SERVEUR = articles + frais de livraison (config). On EXIGE
      // que l'encaissement Stripe le couvre. ±1c (arrondis flottants).
      require_(
        paymentIntent.amount + 1 >= itemsCents + fraisCents,
        "Montant encaissé inférieur au total attendu (articles + livraison)."
      );
    } catch (validationErr) {
      await refundOrphanChargeBestEffort(stripe, paymentIntent, snackData.stripeAccountId || null);
      throw validationErr;
    }
    const expectedTotalCents = itemsCents + fraisCents;

    // 🚚 ETA (heuristique simple) — file cuisine + vitesse moyenne config.
    const dcfg = snackData.delivery || {};
    const avgSpeedKmh = isFiniteNum(dcfg.avgSpeedKmh) && dcfg.avgSpeedKmh > 0 ? dcfg.avgSpeedKmh : 22;
    const queueCount = await getKitchenQueueCount(snackId);
    const prepMin = computePrepMin(snackData, queueCount);
    const deliveryMin =
      orderMode === "delivery"
        ? (Number.isFinite(distanceKm) ? Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60)) : 0)
        : null;

    const totalMin = prepMin + (deliveryMin || 0);
    const etaData = {
      prepMin,
      deliveryMin,
      totalMin,
      computedAt: Timestamp.now(),
      readyAt: Timestamp.fromMillis(Date.now() + totalMin * 60000),
    };

    // 💶 SOCLE COMPTA (LOT A) — montants financiers persistés depuis des sources
    // SERVEUR de confiance, en centimes. Read-Old/Write-New : les commandes
    // antérieures n'ont aucun de ces champs (traitées en legacy côté compta).
    // Commission plateforme = LUE sur le PI (jamais recalculée).
    const commissionCents = Number(paymentIntent.application_fee_amount) || 0;
    // Frais Stripe RÉELS via la balance_transaction (expand ci-dessus). Indispo
    // (BT non encore disponible / non expandée) → null + flag pending (complété
    // plus tard par le webhook/refresh, jamais bloquant pour la commande).
    const charge = paymentIntent.latest_charge;
    const bt = charge && typeof charge === "object" ? charge.balance_transaction : null;
    const stripeFeeCents = bt && typeof bt === "object" && Number.isFinite(bt.fee) ? bt.fee : null;
    const stripeNetCents = bt && typeof bt === "object" && Number.isFinite(bt.net) ? bt.net : null;

    // Ventilation TVA (module pur) : lignes articles + frais livraison (10 %).
    const tvaBreakdown = ventilateTva(lines, fraisCents);

    // 🛒 Guest checkout (LOT 2) : `isGuest` dérivé du TOKEN auth (non falsifiable
    // par le client) ; `contactKey` = email normalisé → clé de réconciliation
    // d'une commande invité vers un compte a posteriori (RFM/fidélité, LOT 7).
    const isGuest = request.auth?.token?.firebase?.sign_in_provider === "anonymous";
    const contactKey = clientEmail.trim().toLowerCase();

    // 5. Créer la commande dans Firestore (uniquement si tout est vérifié)
    const newOrder = {
      snackId,
      userId: uid,
      clientNom: clientNom || clientEmail.split("@")[0],
      clientEmail,
      contactKey,
      isGuest,
      secretCode: generateSecretCode(6),
      date: FieldValue.serverTimestamp(),
      // Collect : on attend l'arrivée du client avant de cuisiner.
      // Livraison : la cuisine démarre immédiatement (pas d'arrivée client).
      statut: orderMode === "delivery" ? "nouvelle" : "en_attente_client",
      items: cartItems,
      // Total cohérent avec livraison.frais (articles + frais config), recalculé
      // serveur — pas le brut Stripe (qui pourrait inclure un sur-paiement client).
      total: expectedTotalCents / 100,
      mode: orderMode,
      livraison: livraisonData,
      livreurId: null,
      livreur: null,
      eta: etaData,
      paiement: {
        methode: "carte_bancaire",
        statut: "paye",
        stripeSessionId: paymentIntentId,
      },
      // 💶 Socle compta (LOT A) — tout en centimes, sources serveur.
      commission: commissionCents, // application_fee plateforme (lu sur le PI)
      stripeFee: stripeFeeCents, // frais Stripe réels (null si pas encore dispo)
      stripeNet: stripeNetCents, // net après frais Stripe (null si pending)
      stripeFeePending: stripeFeeCents === null,
      tvaBreakdown, // ventilation par taux (centimes) — cf. lib/tva.js
      // Bloc remboursement initialisé (alimenté par refundOrder — LOT B).
      refund: { total: 0, commission: 0, count: 0, fullyRefunded: false, items: [] },
    };

    // create() échoue si le doc existe déjà → idempotence atomique contre la race
    // "double-clic / retry réseau" (deux appels concurrents ayant tous deux passé
    // le check ci-dessus). Le perdant retourne l'orderId existant SANS rejouer le
    // parrainage (increment) ni lastOrderDate.
    try {
      await docRef.create(newOrder);
    } catch (e) {
      if (e.code === 6 || e.code === "already-exists") {
        return { orderId };
      }
      throw e;
    }

    // 📊 Event analytique `purchase` (write-time, fire-and-forget, sans PII).
    // Émis APRÈS create() réussi → 1 seul event par commande (le retry idempotent
    // ci-dessus retourne avant d'arriver ici). Alimente funnel + attribution.
    await emitEvent({
      snackId,
      type: "purchase",
      uid,
      props: {
        orderId,
        amountCents: expectedTotalCents,
        mode: orderMode,
        itemCount: Array.isArray(cartItems) ? cartItems.length : 0,
      },
    });

    // 🍟 POST-CRÉATION (best-effort) — parrainage + lastOrderDate. Un échec ici
    // ne doit JAMAIS faire échouer la réponse : la commande est créée et le
    // paiement confirmé (create() déterministe = pas de double-charge au retry).
    try {
      const userRef = db.collection("users").doc(uid);
      const userDoc = await userRef.get();

      // Première commande de l'utilisateur (lastOrderDate inexistant) ?
      // NB: .exists est une PROPRIÉTÉ dans l'Admin SDK (pas une méthode).
      if (referrerId && referrerId !== uid && (!userDoc.exists || !userDoc.data().lastOrderDate)) {
        const referrerRef = db.collection("users").doc(referrerId);
        const referrerDoc = await referrerRef.get();

        if (referrerDoc.exists) {
          const fieldPath = `pointsBySnack.${snackId}`;
          await referrerRef.update({
            [fieldPath]: FieldValue.increment(2)
          });

          // Notification au parrain
          const referrerData = referrerDoc.data();
          if (referrerData.fcmToken) {
            try {
              await getMessaging().send({
                notification: {
                  title: "🍟 Une frite offerte !",
                  body: "Votre filleul vient de commander ! Vous avez reçu 2 points de fidélité."
                },
                token: referrerData.fcmToken
              });
            } catch (e) {
              console.error("Erreur notif parrainage:", e);
            }
          }
        }
      }

      // 📊 Dénormalisation RFM (LOT 6) — forward-fill, SANS backfill. increment()
      // traite un champ absent comme 0 → fonctionne dès la 1ʳᵉ commande. Alimente
      // le calcul RFM (récence via lastOrderDate, fréquence via orderCount, montant
      // via totalSpentCents) et les cohortes (firstOrderDate, posé une seule fois).
      // ⚡ set+merge (upsert) au lieu de update() : tolère un doc inexistant (cas
      // invité anonyme dont ensureUserDoc aurait échoué côté client). FieldValue.increment()
      // dans un set({merge:true}) est strictement équivalent à update() sur un doc existant.
      const userUpdate = {
        lastOrderDate: FieldValue.serverTimestamp(),
        orderCount: FieldValue.increment(1),
        totalSpentCents: FieldValue.increment(expectedTotalCents),
      };
      if (!userDoc.exists || !userDoc.data().firstOrderDate) {
        userUpdate.firstOrderDate = FieldValue.serverTimestamp();
      }
      await userRef.set(userUpdate, { merge: true });
    } catch (postErr) {
      // Commande déjà créée + payée → on renvoie quand même un succès.
      console.error("finalizeOrder post-création (parrainage/lastOrderDate) échouée :", postErr);
    }

    // 🎁 FIDÉLITÉ CLIENT (best-effort) — +1 point par commande payée, collect ET
    // livraison (mode-agnostique). Ancré dans le bloc post-création idempotent
    // (les retries retournent §4/§5 avant ce point) → jamais de double crédit.
    // try/catch isolé : un échec fidélité ne casse jamais une commande déjà payée.
    // Anti-doublon F3 : le cooldown unifié (loyaltyLastCredit) peut SKIP ce crédit si
    // un point vient d'être gagné (ex. scan boutique juste avant) — skip silencieux,
    // jamais d'erreur sur une commande déjà payée.
    try {
      const clientRef = db.collection("users").doc(uid);
      const cooldownMs = resolveLoyaltyCooldownMs(snackData);
      const res = await db.runTransaction((tx) => creditLoyaltyPoints(tx, clientRef, snackId, 1, cooldownMs));
      if (res.skipped) {
        console.log(`finalizeOrder fidélité ignorée (anti-doublon F3) pour ${uid} / ${snackId}.`);
      } else if (res.reward) {
        await sendRewardPush(uid, res.fcmToken, snackId);
      }
    } catch (loyErr) {
      console.error("finalizeOrder crédit fidélité échoué :", loyErr);
    }

    // 🎡 FIDÉLITÉ : lot de roue en attente → OFFERT sur CETTE commande (redemption EN
    // COMMANDE, jamais par scan → pas de double point). Ancré dans le bloc post-création
    // idempotent (les retries retournent §4/§5 avant ce point) → jamais de double-offre.
    // Best-effort : un échec ne casse jamais une commande déjà payée. Le lot est attaché
    // à la commande (la cuisine le prépare) et pendingWheelReward est effacé (consommé).
    try {
      const wheelUserRef = db.collection("users").doc(uid);
      const wheelSnap = await wheelUserRef.get();
      const pendingWheel = wheelSnap.exists ? (wheelSnap.data().pendingWheelReward || {})[snackId] : null;
      if (pendingWheel?.productId) {
        await docRef.update({
          wheelPrize: { productId: pendingWheel.productId, nom: pendingWheel.nom || "Lot" },
        });
        await wheelUserRef.update({
          [`pendingWheelReward.${snackId}`]: FieldValue.delete(),
          [`rewardsRedeemed.${snackId}`]: FieldValue.increment(1),
        });
        await db.collection("loyaltyRewards").add({
          type: "wheel-redeem-order",
          snackId,
          clientUid: uid,
          productId: pendingWheel.productId,
          productNom: pendingWheel.nom || "Lot",
          orderId,
          redeemedAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (wheelErr) {
      console.error("finalizeOrder lot de roue (offert sur commande) échoué :", wheelErr);
    }

    // 📊 UPSELL ANALYTICS (best-effort) — agrège accepted/revenue depuis la
    // commande PAYÉE (source de vérité, zéro confiance client). Ne s'exécute
    // qu'à la première création (les retries retournent tôt §4/§5) → pas de
    // double comptage. Un échec ici ne fait JAMAIS échouer la commande.
    try {
      const upsellBatch = db.batch();
      let hasUpsell = false;
      for (const item of cartItems) {
        if (item.viaUpsell !== true || !V.isDocId(item.productId)) continue;
        const qty = Number(item.quantity) || 0;
        const prix = Number(item.prix) || 0;
        if (qty <= 0) continue;
        hasUpsell = true;
        const statRef = db
          .collection("snacks").doc(snackId)
          .collection("upsellStats").doc(item.productId);
        upsellBatch.set(
          statRef,
          {
            accepted: FieldValue.increment(qty),
            revenue: FieldValue.increment(prix * qty),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      if (hasUpsell) await upsellBatch.commit();
    } catch (upsellErr) {
      console.error("finalizeOrder upsellStats (accepted/revenue) échouée :", upsellErr);
    }

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
exports.refundOrder = onCall({ region: "europe-west1" }, async (request) => {
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

