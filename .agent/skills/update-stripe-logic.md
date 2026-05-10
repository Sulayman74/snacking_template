---
name: update-stripe-logic
description: Modifier les frais ou la logique de paiement Stripe (createPaymentIntent) en respectant la règle 0% les 6 premiers mois puis 8%.
---

# Skill : Mise à jour de la logique Stripe

## But
Modifier la logique de paiement (frais, applicationFeeAmount, montant, devises…) dans `functions/index.js` **sans casser le contrat de partenariat** avec les snacks.

## Règle métier IMMUABLE
- **0% de frais** les **6 premiers mois** suivant la date d'inscription du snack (`createdAt` dans Firestore).
- **8% de frais** (`applicationFeeAmount = round(amount * 0.08)`) après la période d'onboarding.
- Le calcul des frais se fait **côté serveur uniquement**. Jamais côté client.

## Étapes d'exécution

### 1. Localiser la fonction
- Cible exclusive : `functions/index.js`, fonction `createPaymentIntent` (Cloud Function `onCall`).
- Ne JAMAIS dupliquer cette logique dans le frontend ni dans un autre handler.

### 2. Récupérer le `stripeAccountId` depuis Firestore
- Lire le document `snacks/{snackId}` pour obtenir :
  - `stripeAccountId` (Connect account du snack)
  - `createdAt` (Timestamp Firestore — base du calcul des 6 mois)
- Si `stripeAccountId` est absent → renvoyer une erreur `failed-precondition` (snack pas onboardé sur Stripe Connect).

### 3. Calculer les frais
```js
const sixMonthsMs = 1000 * 60 * 60 * 24 * 30 * 6;
const isFreePeriod = (Date.now() - snack.createdAt.toMillis()) < sixMonthsMs;
const applicationFeeAmount = isFreePeriod ? 0 : Math.round(amount * 0.08);
```

### 4. Construire le PaymentIntent
- Passer `application_fee_amount: applicationFeeAmount`
- Passer `transfer_data: { destination: stripeAccountId }`
- Inclure `metadata` : `{ snackId, orderId, isFreePeriod }` pour audit/dashboard.

### 5. Validation des entrées
- Toujours utiliser le helper `V` (cf. CLAUDE.md) pour valider :
  - `snackId` : string non vide
  - `amount` : entier > 0 (en centimes)
  - `currency` : string ISO 4217 (ex : `'eur'`)
- Toute entrée invalide → `invalid-argument`.

### 6. Logging & Auditabilité
- Logger (sans données sensibles) : `snackId`, `amount`, `applicationFeeAmount`, `isFreePeriod`.
- Ne JAMAIS logger : numéros de carte, secret keys, PII client.

## Règles strictes
- **Ne jamais** déplacer le calcul des frais côté client.
- **Ne jamais** hardcoder un `stripeAccountId` — toujours le lire depuis Firestore.
- **Ne jamais** modifier la règle des 6 mois sans validation explicite de l'utilisateur (c'est un engagement commercial).
- Toute modification doit être testée sur le Firebase Local Emulator Suite avant déploiement (cf. CLAUDE.md > Sandbox).
