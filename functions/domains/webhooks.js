// ============================================================================
// 🤖 WEBHOOKS STRIPE — billing SaaS B2B (suspension/réactivation locataire)
// ============================================================================

const { onRequest } = require("firebase-functions/v2/https");
const { getStripe, resolveSubscriptionId } = require("../lib/stripe");
const { admin, db } = require("../lib/admin");
const { applyRefundToOrder } = require("../lib/refund");
const { registerApplePayDomains } = require("../lib/wallets");

// ============================================================================
// 🤖 FONCTION 7 : STRIPE WEBHOOK (SAAS BILLING B2B)
// ============================================================================
// Écoute les événements Stripe (ex: invoice.payment_failed) pour couper
// automatiquement l'accès (maintenance) en cas de non-paiement de l'abonnement.

/**
 * Bascule le `maintenanceMode` du snack associé à un abonnement Stripe.
 * Centralise la logique partagée par les events de suspension/réactivation SaaS.
 * @param {string|null} subscriptionId - ID d'abonnement Stripe (no-op si falsy).
 * @param {boolean} maintenanceMode - true = suspendre, false = réactiver.
 * @param {string} reason - Raison loggée (sans PII).
 * @returns {Promise<void>}
 */
async function setSnackMaintenanceBySubscription(subscriptionId, maintenanceMode, reason) {
    if (!subscriptionId) return;
    const snap = await db.collection("snacks")
        .where("stripeSubscriptionId", "==", subscriptionId).limit(1).get();
    if (snap.empty) return;
    const snackDoc = snap.docs[0];
    await snackDoc.ref.update({ maintenanceMode });
    const icon = maintenanceMode ? "🔒 LOCATAIRE SUSPENDU" : "✅ LOCATAIRE RÉACTIVÉ";
    console.log(`${icon}: snack ${snackDoc.id} — ${reason} (Sub: ${subscriptionId}).`);
}

exports.stripeWebhook = onRequest({ region: "europe-west9" }, async (request, response) => {
    const stripe = getStripe();
    const sig = request.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        // Stripe SDK requires the raw body buffer for signature verification
        event = stripe.webhooks.constructEvent(request.rawBody, sig, endpointSecret);
    } catch (err) {
        console.error(`⚠️ Webhook signature verification failed.`, err.message);
        return response.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 🛡️ Idempotence — Stripe garantit une livraison "at-least-once" (retries).
    // create() est atomique : si l'event a déjà été traité, on ACK (200) sans rejouer.
    const eventRef = db.collection("stripeEvents").doc(event.id);
    try {
        await eventRef.create({
            type: event.type,
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        if (e.code === 6 || e.code === "already-exists") {
            return response.json({ received: true, duplicate: true });
        }
        console.error("❌ Erreur garde idempotence Webhook :", e);
        return response.status(500).send("Internal Server Error");
    }

    try {
        if (event.type === 'invoice.payment_failed') {
            // Objet = Invoice → l'ID d'abonnement se lit via resolveSubscriptionId
            // (legacy `invoice.subscription` OU Basil `invoice.parent…`).
            await setSnackMaintenanceBySubscription(
                resolveSubscriptionId(event.data.object), true, "échec de paiement");
        }
        else if (event.type === 'customer.subscription.deleted') {
            // ⚠️ Pour cet event, l'objet EST une Subscription : l'ID est
            // directement `object.id` (et NON `invoice.subscription` — c'était
            // le bug de regroupement initial, masqué par `|| invoice.id`).
            await setSnackMaintenanceBySubscription(
                event.data.object.id, true, "abonnement annulé");
        }
        else if (event.type === 'invoice.payment_succeeded') {
            // Réactivation automatique : un snack suspendu pour impayé qui règle
            // son abonnement doit être remis en ligne (sinon bloqué malgré le paiement).
            await setSnackMaintenanceBySubscription(
                resolveSubscriptionId(event.data.object), false, "paiement reçu");
        }
        else if (event.type === 'checkout.session.completed') {
            // 💼 Abonnement SaaS souscrit par un resto → on lie l'abonnement au snack
            // (via metadata.snack_id) et on l'active. Les invoices récurrentes suivantes
            // sont gérées par invoice.payment_failed/succeeded (réf. stripeSubscriptionId).
            const session = event.data.object;
            const snackId = session.metadata && session.metadata.snack_id;
            if (snackId && session.subscription && session.mode === 'subscription') {
                await db.collection("snacks").doc(snackId).set({
                    stripeSubscriptionId: session.subscription,
                    maintenanceMode: false,
                }, { merge: true });
                console.log(`✅ Abonnement activé: snack ${snackId} (sub ${session.subscription}).`);
            }
        }
        else if (event.type === 'account.updated') {
            // 🏦 CONNECT : synchronise le statut d'onboarding du compte connecté.
            // (Nécessite d'activer l'écoute des events "sur les comptes connectés"
            // dans la config du webhook Stripe.)
            const account = event.data.object;
            const snap = await db.collection("snacks").where("stripeAccountId", "==", account.id).limit(1).get();
            if (!snap.empty) {
                const doc = snap.docs[0];
                // Transition false→true des charges : on enregistre le domaine Apple Pay
                // SUR CE COMPTE CONNECTÉ au tout premier passage à charges_enabled.
                // On lit l'ancienne valeur AVANT update pour ne déclencher l'enregistrement
                // qu'une fois (l'API paymentMethodDomains.create est de toute façon
                // idempotente — cf. lib/wallets — ce garde-fou évite juste des appels inutiles
                // à chaque account.updated d'un compte déjà actif).
                const wasChargesEnabled = !!(doc.data() || {}).stripeChargesEnabled;
                await doc.ref.update({
                    stripeChargesEnabled: !!account.charges_enabled,
                    stripeDetailsSubmitted: !!account.details_submitted,
                    stripePayoutsEnabled: !!account.payouts_enabled,
                });
                console.log(`🔄 account.updated: snack ${doc.id} charges_enabled=${account.charges_enabled}`);

                if (account.charges_enabled && !wasChargesEnabled) {
                    // Best-effort : registerApplePayDomains ne lève jamais (try/catch interne),
                    // donc cet appel ne peut pas faire échouer le webhook.
                    await registerApplePayDomains(stripe, account.id);
                }
            }
        }
        else if (event.type === 'charge.refunded') {
            // 💸 FILET (LOT B) : un remboursement initié HORS app (dashboard Stripe)
            // doit être réconcilié dans le bloc refund de la commande. La dédup par
            // refund.id (applyRefundToOrder) garantit qu'un refund déjà tracé par
            // refundOrder n'est PAS recompté. orderId = paymentIntent (= id commande).
            // NB: charge.refunds.data est borné (~10 derniers) — suffisant ici ; pour
            // un historique long, retrieve la charge avec expand refunds.
            const charge = event.data.object;
            const orderId = typeof charge.payment_intent === 'string'
                ? charge.payment_intent
                : charge.payment_intent?.id;
            if (orderId) {
                const orderRef = db.collection("commandes").doc(orderId);
                const orderSnap = await orderRef.get();
                if (orderSnap.exists) {
                    const order = orderSnap.data() || {};
                    const orderTotalCents = Math.round(Number(order.total) * 100);
                    for (const r of (charge.refunds?.data || [])) {
                        const commissionRefunded = orderTotalCents > 0
                            ? Math.round(((Number(order.commission) || 0) * r.amount) / orderTotalCents)
                            : 0;
                        await applyRefundToOrder(orderRef, {
                            refundId: r.id, amount: r.amount, commissionRefunded,
                            reason: r.reason || null, source: "stripe",
                        });
                    }
                }
            }
        }

        response.json({ received: true });
    } catch (error) {
        console.error("❌ Erreur traitement Webhook :", error);
        // On retire le marqueur d'idempotence pour autoriser le retry Stripe
        // (sinon l'event serait considéré "déjà traité" et l'effet jamais appliqué).
        await eventRef.delete().catch(() => {});
        response.status(500).send("Internal Server Error");
    }
});
