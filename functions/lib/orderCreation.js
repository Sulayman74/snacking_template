// ============================================================================
// 🧾 CRÉATION DE COMMANDE depuis un PaymentIntent PAYÉ (chemin unique)
// ============================================================================
// Partagé par finalizeOrder (client, juste après le paiement) et le réconciliateur
// planifié (filet « débité sans commande » : client qui perd le réseau avant
// finalizeOrder). L'id de commande = id du PaymentIntent + create() atomique →
// quel que soit l'appelant qui passe en premier, une seule commande et un seul
// jeu d'effets de bord (parrainage, fidélité, roue, upsell, event purchase).
// Les gardes PI (statut, devise, snack, propriétaire) sont faites PAR L'APPELANT.

const { ventilateTva } = require("./tva");
const { db, FieldValue, Timestamp } = require("./admin");
const { V, require_ } = require("./validation");
const { sendRewardPush } = require("./fcm");
const { getUserPushTargets, sendToTargets } = require("./pushTargets");
const { resolveLoyaltyCooldownMs, creditLoyaltyPoints } = require("./loyalty");
const { isFiniteNum } = require("./geo");
const { getKitchenQueueCount, computePrepMin } = require("./kitchen");
const { computeAuthoritativeOrder, refundOrphanChargeBestEffort } = require("./pricing");
const { generateSecretCode } = require("./util");
const { emitEvent } = require("./events");

/** Collection des paniers validés en attente de paiement (écrits par createPaymentIntent). */
const PENDING_ORDERS = "pendingOrders";

/**
 * Supprime (best-effort) le panier en attente une fois la commande créée/trouvée.
 * @param {string} orderId - = id du PaymentIntent.
 */
async function clearPendingOrder(orderId) {
  try {
    await db.collection(PENDING_ORDERS).doc(orderId).delete();
  } catch (e) {
    console.error(`pendingOrders ${orderId} : suppression échouée`, e);
  }
}

/**
 * Crée la commande Firestore d'un PaymentIntent "succeeded" (idempotent).
 * @param {Object} p
 * @param {import("stripe").Stripe} p.stripe
 * @param {Object} p.paymentIntent - PI récupéré (expand latest_charge.balance_transaction).
 * @param {string} p.snackId
 * @param {Object} p.snackData - Doc snack.
 * @param {string} p.uid - Client propriétaire de la commande.
 * @param {boolean} p.isGuest - Dérivé du token auth (jamais du payload client).
 * @param {Array} p.cartItems - Panier (revalidé et re-pricé ici).
 * @param {"collect"|"delivery"} p.orderMode
 * @param {Object|null} p.livraison
 * @param {string} p.clientEmail - Peut être "" (invité récupéré sans email).
 * @param {string|null} p.clientNom
 * @param {string|null} p.referrerId
 * @returns {Promise<{orderId: string, created: boolean}>}
 */
async function createOrderFromPaymentIntent({
  stripe, paymentIntent, snackId, snackData, uid, isGuest,
  cartItems, orderMode, livraison, clientEmail, clientNom, referrerId,
}) {
  const paymentIntentId = paymentIntent.id;

  // 4. Idempotence ATOMIQUE — l'ID de la commande est dérivé du PaymentIntent
  //    (unique côté Stripe). Un check rapide évite de recalculer si la commande
  //    existe déjà ; la garantie anti-race repose sur le create() atomique (§5).
  const orderId = paymentIntentId;
  const docRef = db.collection("commandes").doc(orderId);
  const existingDoc = await docRef.get();
  if (existingDoc.exists) {
    await clearPendingOrder(orderId);
    return { orderId, created: false };
  }

  // 🛡️ MONTANT AUTORITATIF + VALIDATION — recalcul serveur (prix/zone/minimum)
  // via le helper partagé avec createPaymentIntent (DRY). Le client est DÉJÀ
  // débité (PI succeeded) : si la commande est jugée invalide ICI (cas résiduel,
  // ex. prix produit modifié entre la création du PI et la finalisation, ou panier
  // divergent), on rembourse AUTOMATIQUEMENT la charge avant de propager l'erreur
  // — plus de charge orpheline (F1). Le chemin nominal est déjà validé en amont
  // par createPaymentIntent, donc ce filet ne se déclenche qu'exceptionnellement.
  let itemsCents, lines, orderItems, fraisCents, livraisonData, distanceKm;
  try {
    ({ itemsCents, lines, orderItems, fraisCents, livraisonData, distanceKm } =
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

  // 🛒 Guest checkout (LOT 2) : `isGuest` dérivé du TOKEN auth par l'appelant
  // (non falsifiable par le client) ; `contactKey` = email normalisé → clé de
  // réconciliation d'une commande invité vers un compte a posteriori (LOT 7).
  const contactKey = clientEmail.trim().toLowerCase();

  // 5. Créer la commande dans Firestore (uniquement si tout est vérifié)
  const newOrder = {
    snackId,
    userId: uid,
    clientNom: clientNom || clientEmail.split("@")[0] || "Client",
    clientEmail,
    contactKey,
    isGuest,
    secretCode: generateSecretCode(6),
    date: FieldValue.serverTimestamp(),
    // Collect : on attend l'arrivée du client avant de cuisiner.
    // Livraison : la cuisine démarre immédiatement (pas d'arrivée client).
    statut: orderMode === "delivery" ? "nouvelle" : "en_attente_client",
    // Lignes RECONSTRUITES serveur (nom/suppléments/prix en base, options
    // bornées) — jamais le payload client brut (cf. lib/pricing buildOrderLine).
    items: orderItems,
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
      await clearPendingOrder(orderId);
      return { orderId, created: false };
    }
    throw e;
  }
  await clearPendingOrder(orderId);

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

        // Notification au parrain (ses appareils abonnés à CE snack).
        try {
          await sendToTargets(await getUserPushTargets(referrerId, snackId, "client"), {
            notification: {
              title: "🍟 Une frite offerte !",
              body: "Votre filleul vient de commander ! Vous avez reçu 2 points de fidélité."
            },
          });
        } catch (e) {
          console.error("Erreur notif parrainage:", e);
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
    console.error("createOrder post-création (parrainage/lastOrderDate) échouée :", postErr);
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
      console.log(`createOrder fidélité ignorée (anti-doublon F3) pour ${uid} / ${snackId}.`);
    } else if (res.reward) {
      await sendRewardPush(uid, snackId);
    }
  } catch (loyErr) {
    console.error("createOrder crédit fidélité échoué :", loyErr);
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
    console.error("createOrder lot de roue (offert sur commande) échoué :", wheelErr);
  }

  // 📊 UPSELL ANALYTICS (best-effort) — agrège accepted/revenue depuis la
  // commande PAYÉE (source de vérité, zéro confiance client). Ne s'exécute
  // qu'à la première création (les retries retournent tôt §4/§5) → pas de
  // double comptage. Un échec ici ne fait JAMAIS échouer la commande.
  try {
    const upsellBatch = db.batch();
    let hasUpsell = false;
    for (const item of orderItems) {
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
    console.error("createOrder upsellStats (accepted/revenue) échouée :", upsellErr);
  }


  return { orderId, created: true };
}

module.exports = { PENDING_ORDERS, clearPendingOrder, createOrderFromPaymentIntent };
