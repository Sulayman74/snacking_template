# 💳 Stripe — clés, environnements et passage en live

## 1. Où vit chaque clé

| Clé | Nature | Dev / émulateur | CI (GitHub Actions) | Production |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` (`sk_…`) | **secrète** | `functions/.secret.local` | secret `STRIPE_SECRET_KEY` (sk_test) | **Secret Manager** |
| `STRIPE_WEBHOOK_SECRET` (`whsec_…`) | **secrète** | `functions/.secret.local` (optionnel) | — (harnais : valeur fictive) | **Secret Manager** |
| `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_…`) | publique | `.env.development` (versionné) | secret `VITE_STRIPE_PUBLISHABLE_KEY` | secret GitHub / `.env.production.local` |

Règles :
- **Aucune clé secrète dans le code ni dans `functions/.env`** : ce fichier est *déployé* avec les Functions.
  Déclarer une clé à la fois dans `.env` et comme secret fait échouer `firebase deploy`.
- Toute variable `VITE_*` est publiée **en clair** dans le JS du site. `vite.config.js` fait échouer le build si
  une `VITE_*` contient `sk_`, `rk_` ou `whsec_`, ou si la clé publishable manque en build de production.
- Chaque Cloud Function qui appelle `getStripe()` déclare `secrets: [STRIPE_SECRET_KEY]`
  (+ `STRIPE_WEBHOOK_SECRET` pour `stripeWebhook`). Nouvelle fonction Stripe = même déclaration.

## 2. Environnements Stripe du projet

| Environnement | Compte | Usage |
|---|---|---|
| Sandbox **« Environnement de test Code Crafters »** | `acct_1TG1RfIfiBxoqwsy` | **tests / dev / prod actuelle en mode test** (comptes Connect de test, webhook) |
| « Code Crafters » — *mode test* | `acct_1TG1RSITZKN8ppag` | ❌ non utilisé par ce projet |
| « Code Crafters » — *live* | — | production réelle (jour J) |

⚠️ Le bandeau « Environnement de test » du *mode test* du compte principal ressemble au nom du sandbox.
Repère infaillible : une clé du sandbox commence par **`sk_test_51TG1Rf`** / **`pk_test_51TG1Rf`**
(Settings → Business → Account details doit afficher `acct_1TG1RfIfiBxoqwsy`).

## 3. Mise en place locale (une fois)

```bash
cp functions/.secret.local.example functions/.secret.local   # puis y coller la sk_test du sandbox
cp .env.example .env.production.local                        # seulement pour npm run deploy:* en local
```

## 4. Rotation d'une clé secrète (fuite, départ d'un membre…)

1. Dashboard du **bon environnement** → Developers → API keys → *Roll key* → expiration **dans 1 h**.
2. Prod : `firebase functions:secrets:set STRIPE_SECRET_KEY` puis `firebase deploy --only functions`
   (depuis la branche actuellement en production).
3. Local : `functions/.secret.local`. CI : secret GitHub `STRIPE_SECRET_KEY`.
4. Autres projets branchés sur le même compte (ex. `locationbibi`) : même mise à jour dans l'heure.
5. Vérifier que l'ancienne clé est refusée (`StripeAuthenticationError`).

## 5. Premier déploiement après la migration vers Secret Manager

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY        # sk_test du sandbox (prod actuelle en test)
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET    # whsec_ de l'endpoint stripewebhook (Dashboard → Webhooks)
firebase deploy --only functions,firestore:rules
npm run deploy:all
```

## 6. ✅ Checklist « passage en live »

Compte Stripe
- [ ] Compte live **activé** (vérification entreprise, IBAN plateforme).
- [ ] **Connect** activé en live, profil plateforme et branding renseignés.
- [ ] Wallets (Apple Pay / Google Pay / Link) activés en live.

Webhook
- [ ] Endpoint **live** créé vers l'URL de `stripeWebhook`, mêmes événements et **même version d'API**
      que `STRIPE_API_VERSION` (`functions/lib/stripe.js`).

Secrets & variables
- [ ] `firebase functions:secrets:set STRIPE_SECRET_KEY` → `sk_live_…`
- [ ] `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` → `whsec_…` de l'endpoint live
- [ ] Secret GitHub `VITE_STRIPE_PUBLISHABLE_KEY` → `pk_live_…` (et `.env.production.local` si déploiement local)
- [ ] Le secret GitHub `STRIPE_SECRET_KEY` (CI) **reste une clé de test**.

Données
- [ ] Pour chaque snack : vider `stripeAccountId`, `stripeChargesEnabled`, `stripeDetailsSubmitted`,
      `stripePayoutsEnabled` (IDs de comptes *test* invalides en live), puis **onboarding Connect live**
      du restaurateur depuis son back-office.
- [ ] Horaires et `lastOrderMinutesBeforeClose` vérifiés pour chaque snack.

Déploiement & contrôle
- [ ] `firebase deploy --only functions` puis `npm run deploy:all` (le build ne doit plus afficher
      « clé Stripe de TEST »).
- [ ] Commande réelle de faible montant sur chaque snack, puis **remboursement** depuis le back-office.
- [ ] Événement webhook reçu en 200 dans le Dashboard live.
