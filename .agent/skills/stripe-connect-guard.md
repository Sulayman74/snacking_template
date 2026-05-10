---
name: stripe-connect-guard
description: Configure et sécurise createPaymentIntent (functions/index.js) avec Stripe Connect, frais 8%, comptes connectés et rate-limiting.
---

# Rôle
Maintenir et faire évoluer la logique de paiement Stripe **côté serveur uniquement** : création d'un `PaymentIntent` sur le compte connecté du snack, calcul de la commission plateforme (8%), validation stricte des entrées.

> Note : un skill complémentaire `update-stripe-logic` (dans `.claude/skills/`) couvre la règle **0% les 6 premiers mois → 8% ensuite**. Ce skill-ci se concentre sur l'**infra Connect** (comptes, sécurité, idempotence).

## Context Awareness — fichiers à analyser
- `functions/index.js` :
  - `exports.createPaymentIntent = onCall(...)` (l. ~414) — point d'entrée principal.
  - `exports.finalizeOrder = onCall(...)` (l. ~504) — récupère le PaymentIntent côté Connect (utilise `stripeAccount`).
  - `callerKey(request, "createPaymentIntent")` — clé de rate-limiting déjà en place.
  - Helper `V` pour la validation.
- `firestore` → collection `snacks/{snackId}` champs : `stripeAccountId`, `createdAt`, `feeOverride?`.
- `src/checkout.js` → côté client, ne fait QUE l'appel `onCall` (jamais de calcul de frais).

## Step-by-Step Actions
1. **Validation entrée** (`V`) :
   - `snackId` : string non vide.
   - `amount` : entier > 0 (centimes).
   - `currency` : ISO 4217 (`'eur'` par défaut).
   - `orderId` : string ; sert aussi de `idempotencyKey` Stripe.
2. **Rate limiting** : conserver l'usage existant de `callerKey(request, "createPaymentIntent")`.
3. **Lecture Firestore** :
   - `snackDoc = snacks/{snackId}` → extraire `stripeAccountId` et `createdAt`.
   - Si `stripeAccountId` manquant → `HttpsError('failed-precondition', 'snack-not-onboarded')`.
4. **Calcul des frais** (cohérent avec `update-stripe-logic`) :
   ```js
   const sixMonths = 1000 * 60 * 60 * 24 * 30 * 6;
   const isFreePeriod = (Date.now() - snackData.createdAt.toMillis()) < sixMonths;
   const applicationFeeAmount = isFreePeriod ? 0 : Math.round(amount * 0.08);
   ```
5. **Création du PaymentIntent sur le compte connecté** :
   ```js
   const params = {
     amount,
     currency,
     automatic_payment_methods: { enabled: true },
     metadata: { snackId, orderId, isFreePeriod: String(isFreePeriod) },
   };
   if (applicationFeeAmount > 0) params.application_fee_amount = applicationFeeAmount;
   const requestOptions = { stripeAccount: stripeAccountId, idempotencyKey: orderId };
   const intent = await stripe.paymentIntents.create(params, requestOptions);
   ```
6. **Réponse minimale** au client : `{ clientSecret, publishableKey }` — JAMAIS le `applicationFeeAmount` ni le `stripeAccountId`.
7. **Gestion d'erreurs** : mapper les `StripeError` → `HttpsError('failed-precondition' | 'invalid-argument' | 'internal')`. Logger l'erreur sans données sensibles.

## Safety & Patterns
- **SOLID** : `createPaymentIntent` = création seule. La validation post-paiement est dans `finalizeOrder`.
- **KISS** : pas de logique de frais côté client, pas de duplication entre handlers.
- **Sécurité** :
  - Aucune clé secrète Stripe ne sort des Cloud Functions.
  - Aucun `stripeAccountId` hardcodé — toujours lu depuis Firestore.
  - Les logs ne contiennent JAMAIS : numéros de carte, secrets, PII complète.
  - Idempotence Stripe via `orderId` pour empêcher le double débit en cas de retry.
- **Tests** :
  - Émulateurs Firebase + Stripe CLI (`stripe listen --forward-to localhost:5001/...`).
  - Cas : snack non onboardé, période gratuite, période payante, montant invalide, devise invalide, double appel avec même `orderId`.
