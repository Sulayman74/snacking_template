# 🧭 Brief Agent — Compréhension & Audit du projet `snacking_template`

> **But de ce document :** donner à un agent Claude (ou tout ingénieur) tout le contexte nécessaire pour **comprendre le projet** et **conduire un audit** (sécurité, qualité, perf, a11y, non-régression) sans avoir à tout re-découvrir.
> Dernière cartographie : 2026-06-13. Si un fichier/champ cité a changé, **vérifier avant de conclure**.

---

## 1. Résumé en une phrase

PWA SaaS multi-tenant de **Click & Collect / livraison** pour la restauration (snacks), bâtie en **Vite + Vanilla JS + Tailwind 4 + Firebase**, avec paiement **Stripe Connect** (commission plateforme), fidélité, marketing push, back-office cuisine et app livreur — **4 restaurants** servis depuis **un seul backend Firebase**, partitionnés par `snackId`.

---

## 2. Stack technique

| Couche | Technologie |
|---|---|
| Build / bundler | **Vite 7** (multi-entrées, PWA via `vite-plugin-pwa` + Workbox) |
| Frontend | **Vanilla JS ES6+** (pas de framework), modules natifs |
| Styles | **Tailwind 4** (`@tailwindcss/vite`) + CSS variables de thème |
| Backend | **Firebase Cloud Functions** (Node 24, `firebase-functions` v7) |
| Base de données | **Firestore** (NoSQL, cache persistant multi-onglet) |
| Auth | **Firebase Auth** (email/password + Google OAuth) |
| Stockage | **Firebase Storage** (images produits, preuves de livraison) |
| Paiement | **Stripe** `^21` (Connect Express, PaymentIntents) — API pinnée `2026-03-25.dahlia` |
| Push | **Firebase Cloud Messaging** (FCM) |
| Images serveur | **sharp** (optimisation WebP à l'upload) |
| Anti-abus | **App Check** (reCAPTCHA v3) — *code prêt, enforcement à activer* |
| Tests | **Vitest** (unit), **Playwright** (e2e sur émulateurs), `@firebase/rules-unit-testing` |
| CI/CD | **GitHub Actions** (deploy sur push main, e2e sur PR) |

---

## 3. Architecture & patterns (à respecter pour tout audit de cohérence)

- **SOLID + KISS + DRY.** Le moteur générique vit dans `/src/core`. Les spécificités client vivent dans **Firestore** (config par `snackId`), pas dans le code.
- **État centralisé via Store (pub/sub).** `src/core/Store.js` (client) et `src/core/AdminStore.js` (back-office) sont des **singletons `EventTarget`**. L'UI **écoute** les événements et re-render ; elle ne contient **aucune logique métier**.
  - Événements client : `config-updated`, `auth-updated`, `menu-updated`, `cart-updated`, `favorites-updated`, `last-order-updated`, `delivery-updated`.
  - Événements admin : `admin-config-updated`, `admin-products-updated`, `admin-sales-updated`, `admin-upsell-updated`, `admin-kitchen-load-updated`, `admin-push-updated`, `admin-saving-status`.
  - `Store.state` est **immuable** (copie gelée) ; toute mutation passe par une méthode.
- **Theming.** Aucune couleur en dur : CSS variables (`--color-primary`, `--color-accent`, …) appliquées par `src/ui/AppUI.js` sur `config-updated`. Injection anti-flash dans `vite.config.js` (`transformIndexHtml`).
- **Séparation logique / effets de bord.** Logique pure testable sans Firebase/Stripe (ex. `src/services/geoService.js` = distance Haversine, ETA ; calculs panier dans le Store).
- **Lazy-loading** systématique : SDK Stripe, scanner QR (`html5-qrcode`), analytics → chargés à la demande (perf INP/LCP, cf. CLAUDE.md §8).
- **PWA :** `registerType: 'prompt'` (jamais de reload auto — protège un paiement/preuve en cours). Stratégies Workbox : `CacheFirst` polices/CDN, `StaleWhileRevalidate` images produits, **`NetworkOnly` pour Cloud Functions** (paiement/commande jamais en cache).

### Flux de données
```
Firestore (onSnapshot temps réel)
   ↓
Store / AdminStore (singleton, émet des events)
   ↓
Classes UI (CartUI, AppUI…) abonnées aux events → rendu DOM
                ▲
Input utilisateur → router.js (délégation data-action) → mutation Store OU appel Cloud Function
   → écriture Firestore → re-déclenche le listener
```

---

## 4. Cartographie des fichiers

### Frontend `/src`
- **Core** : `core/Store.js`, `core/AdminStore.js`, `core/firebase.js` (barrel d'exports SDK), `firebase-init.js` (init Auth/Firestore/Storage/Functions/Messaging/App Check + wiring émulateur via `VITE_E2E_TESTING`).
- **Entrées** : `app.js` (client), `admin.js` (back-office), `superadmin.js` (gestion multi-snack/billing), `livreur.js` (app livreur). Routage par **délégation d'événements** (`router.js`, attributs `data-action`).
- **Features client** : `cart.js`, `checkout.js` (Stripe + finalize), `menu.js`, `loyalty.js`, `favorites.js`, `reorder.js`, `delivery.js` (collect vs livraison), `scanner.js` (QR fidélité), `tracking.js` (suivi commande/livreur temps réel), `smart-review.js` (avis Google selon note), `product-modal.js`, `auth.js`, `pwa.js`, `sw-update.js`.
- **Services** (purs, sans Firebase) : `services/geoService.js`, `services/weatherService.js` (Open-Meteo), `services/weatherInsights.js` (conseils marketing météo).
- **UI** (présentation pure) : `ui/AppUI.js` (thème/identité), `ui/CartUI.js`, `ui/UpsellUI.js`, `ui/FavoritesUI.js`, `ui/ReorderUI.js`, `ui/AdminConfigUI.js`, `ui/AdminProductsUI.js`, `ui/AdminMarketingUI.js`, `ui/AdminComptaUI.js`, `ui/AdminUpsellUI.js`, `ui/LivreurUI.js`.
- **Admin (logique)** : `admin-kitchen.js` (radar tickets temps réel, rush mode), `admin-products.js`, `admin-config.js`, `admin-marketing.js` (push + tips météo/foot/ventes), `admin-compta.js` (KPI + CSV + TVA), `admin-upsell.js`, `admin-livreurs.js`, `admin-csv.js`, `admin-notifs.js`.
- **Utils** : `utils.js`, `utils/ModalManager.js`, `logger.js`, `bridge.js`, `a2hs.js`, `snack-config.js`.
- ~11 000 lignes JS frontend.

### Backend `/functions` (~2 285 lignes, `index.js` ≈ 2 000)
- `index.js` — toutes les Cloud Functions (voir §6).
- `lib/stripe.js` — `getStripe()`, **API version pinnée** `STRIPE_API_VERSION = "2026-03-25.dahlia"`.
- `scripts/migrate-snack-fields.js` — migration idempotente (dry-run + `--apply`).
- `seed-emulator.js` — données fictives pour l'émulateur.
- `.env` — secrets locaux (clés : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). **Ne jamais committer / logguer les valeurs.**

### Racine
- `index.html` (storefront client), `admin.html`, `superadmin.html`, `livreur.html`, `legal.html`, `404.html`.
- `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc`, `cors.json`.
- Docs setup : `APP_CHECK_SETUP.md`, `STRIPE_WEBHOOK_SETUP.md`, `docs/audit-lots-4-5-6.md`, `docs/TEST-LIVRAISON.md`.

---

## 5. Features fonctionnelles

- **Commande en ligne** : menu temps réel, modale produit (tailles/options), panier optimiste, upsell au checkout.
- **Modes** : Click & Collect **ou** livraison (zone par rayon Haversine, frais & min de commande côté serveur).
- **Paiement Stripe Connect** : PaymentIntent → `finalizeOrder` recalcule le prix serveur, commission plateforme **0 % les 6 premiers mois puis 8 %**.
- **Fidélité** : points par snack, scan QR (`uid`) côté admin (anti-double-scan), récompenses.
- **Suivi commande** temps réel + géolocalisation livreur (notifications de distance : 3 km / 1 km / 300 m).
- **App livreur** : prise de courses, statuts, **preuve de livraison** (photo).
- **Back-office cuisine** : radar tickets temps réel, statuts, **rush mode** décidé serveur, charge cuisine.
- **Marketing push** : campagnes programmées (quota 2/mois/snack), flash offers, tips météo/football/tendances ventes.
- **Compta** : KPI ventes, export CSV, TVA.
- **SaaS / superadmin** : CRUD snacks, abonnement Stripe (suspension auto si impayé via `maintenanceMode`).
- **PWA** : offline catalogue, A2HS, mise à jour contrôlée par bandeau.
- **Favoris** + **« Recommander ma dernière commande »** (reorder revalidé contre le menu courant).

---

## 6. Surface backend (Cloud Functions) — pour audit

> Région : `europe-west1`. Tous les `onCall` requièrent en principe `request.auth` ; rate-limiting Firestore (fenêtre glissante) par `uid` ou IP.

**Paiement / Stripe**
- `createPaymentIntent` (onCall) — crée le PaymentIntent (rate 10/60s).
- `finalizeOrder` (onCall) — **finalise atomiquement** : recalcul prix serveur (`assertCartPricesAreLegit`), zone livraison, min commande, idempotence (`orderId = paymentIntentId`), crédit fidélité, parrainage, analytics upsell.
- `getStripeAccountStatus`, `getStripeOnboardingLink`, `createStripeConnectLoginLink` — onboarding Connect Express.
- `createSubscriptionCheckout` (onCall, **superadmin**) — abonnement SaaS.
- `stripeWebhook` (onRequest) — **vérif signature** `constructEvent`, idempotence (collection `stripeEvents`). Events : `invoice.payment_failed/succeeded`, `customer.subscription.deleted`, `checkout.session.completed`, `account.updated`.

**Commandes / notifications** (triggers Firestore) : `notifyAdminsOnNewOrder`, `onOrderStatusChange`, `onDriverPositionUpdate` (géofencing serveur).

**Fidélité** : `awardLoyaltyPoint` (onCall, **admin/superadmin**, cooldown anti-double-scan, transaction).

**Push / marketing** : `processPushCampaigns` (onSchedule 5 min, claim CAS + batch FCM + nettoyage tokens invalides), `schedulePushCampaign` (rate 5/60s + quota 2/mois), `pushFlashOffer` (**admin**, bloqué si `rushMode`).

**Cuisine** : `getKitchenLoad` (cache 30s). **Upsell** : `trackUpsellShown` (rate 30/60s). **Images** : `optimizeImage` (Storage trigger → WebP 800×800, conserve le download token). **Externe** : `getUpcomingFootballEvents` (secret `FOOTBALL_DATA_TOKEN`, cache 30 min). **Admin/users** : `createDriver` (**admin**), `createSnackAdmin` (**superadmin**).

**Validation** : helper `V` (`isNonEmptyString`, `isPositiveInt`, `isEmail`, `isDocId`, …) + `require_()` → `HttpsError('invalid-argument')`.

---

## 7. Modèle de données Firestore (partition = `snackId`)

| Collection | Clé / partition | Contenu |
|---|---|---|
| `snacks/{snackId}` | snackId | config resto, Stripe Connect IDs, capacité, livraison, `maintenanceMode` |
| `users/{uid}` | uid (+ `snackId` si staff) | profil, role, `pointsBySnack.{snackId}`, `fcmToken`, `favorites` |
| `commandes/{orderId}` | `snackId` (champ) | items, total, mode, livraison, eta, `paiement.statut`, statut |
| `produits/{productId}` | `snackId` (champ) | `prix`, `tailles`, `menuPriceAdd` |
| `campagnes_push/{id}` | `snackId` | statut, cible, date prévue, stats |
| `snacks/{snackId}/upsellStats/{productId}` | snackId+productId | shown / accepted / revenue |
| `cache/*` | global ou snackId | kitchen load (TTL 30s), foot (TTL 30 min) |
| `rateLimits/{key}` | action+uid/IP | compteurs fenêtre glissante |
| `stripeEvents/{eventId}` | event.id | idempotence webhook |

**Rôles** : `client` (défaut), `admin` (lié à un `snackId`), `livreur`, `superadmin`. Les rôles sont stockés **dans Firestore** (pas en custom claims) — point à noter pour l'audit (les `rules` relisent `users/{uid}`).

---

## 8. Posture sécurité (état des lieux)

**Points forts**
- **Deny-all par défaut** dans `firestore.rules` ; allowlist explicite par collection.
- **`commandes` : CREATE désactivé côté client** → toute commande passe par `finalizeOrder` après validation Stripe.
- Champs Stripe sensibles de `snacks` (account/subscription/`maintenanceMode`/charges/payouts) **interdits en écriture admin** (mutés uniquement par Admin SDK).
- **Isolation multi-tenant par `snackId`** : updates admin/queries `list` filtrées par tenant ; anti-énumération RGPD sur `users`.
- **Garde anti-queue-jump** sur `commandes` (client limité à `en_attente_client → nouvelle`) ; **livreur** limité aux champs de livraison, ne peut pas voler une course assignée.
- **Storage** : whitelist formats (PNG/JPEG/WebP/AVIF, **pas de SVG** → anti-XSS stocké), cap 15 Mo ; preuves de livraison (`pod/`) accès restreint (livreur/admin/propriétaire commande).
- **Recalcul prix serveur** (jamais confiance au client), **idempotence** commandes & webhook, **rate-limiting** Firestore.
- **Indexes composites** : tous avec `snackId` en tête (pas de fuite cross-tenant).
- Secrets via `.env` / Firebase Secrets ; `.gitignore` couvre `.env*`, `dist/`, `.firebase/`.

**Écarts / à surveiller (priorités d'audit)**
1. **App Check INACTIF** (code prêt, enforcement non branché). → activer `enforceAppCheck` sur `createPaymentIntent`/`finalizeOrder` avant le 1er abonné payant. *(Priorité moyenne ; rate-limits atténuent.)*
2. **Tests de `rules` incomplets** : couverts = `users`, `commandes`. Non couverts = `snacks`, `produits`, `campagnes_push`, `upsellStats`, **storage.rules**. *(Priorité moyenne.)*
3. **CI non bloquante** : dans `firebase-deploy.yml`, les tests unitaires tournent mais **ne bloquent pas** le déploiement (pas de `needs:`). *(Priorité moyenne — risque de déployer du rouge.)*
4. **`snacks` lisible publiquement** (`allow read: if true`) — intentionnel pour le menu ; **vérifier qu'aucune donnée sensible** (clés, secrets, infos privées) n'y figure.
5. **Rôles en Firestore et non en custom claims** → chaque évaluation de règle relit `users/{uid}` ; valider qu'aucun chemin ne permet l'élévation de rôle (création/maj de `role`/`snackId`).
6. **reCAPTCHA Enterprise** dans les deps functions mais usage non confirmé dans `index.js` → vérifier si réellement branché.
7. **Audit trail** : pas de Cloud Audit Logs configurés sur mutations sensibles (`snacks` Stripe, `commandes` paiement). *(Compliance.)*

---

## 9. Multi-tenant & déploiement

- **4 cibles hosting** (1 dist/ par `SNACK_ID`), **1 seul backend Firestore/Functions** → **la frontière de confiance est le champ `snackId` + les rules**. Elles doivent être blindées.

| Cible hosting | SNACK_ID |
|---|---|
| `snacking-template` (tacos) | `Ym1YiO4Ue5Fb5UXlxr06` |
| `o-bois-pizza` | `PsobiuoeUzNmHnwGtaRu` |
| `pizzeriadelagare` | `4L9THuI6hIAqKjjZUn4s` |
| `belly-smash-burger` | `umaGD0nOIWwgpyy8Ta4h` |

- CI : `firebase-deploy.yml` (push `main` → build 4 cibles + functions), `playwright-tests.yml` (e2e émulateurs sur PR). Anciens workflows hosting désactivés.

---

## 10. Commandes utiles

```bash
# Dev
npm run dev                 # frontend Vite
npm run emulators           # Auth+Firestore+Functions+Storage
npm run seed                # peuple l'émulateur

# Build / deploy (par tenant)
npm run build:tacos | build:pizza | build:pizzeria | build:belly | build:all
npm run deploy:all

# Tests
npm run test:unit           # Vitest
npm run test:e2e            # Playwright sur émulateurs (cart, commande, stock, reorder)
npm run test:loyalty        # harness fidélité
# Rules : vitest.rules.config.js  (tests/rules/*)

# Migration
npm run migrate:snack-fields[:apply]
```

---

## 11. Checklist de démarrage d'un audit

1. **Lire d'abord** : `CLAUDE.md` + `.claude/CLAUDE.md` (règles imposées : SOLID, JSDoc, sécurité, a11y, perf Lighthouse > 90, non-régression « Read Old / Write New »).
2. **Sécurité** : `firestore.rules`, `storage.rules`, `functions/index.js` (auth/role checks, recalcul prix, idempotence, rate-limit, secrets). Cibler les 7 écarts du §8.
3. **Non-régression** : tout changement dans `/src/core` ou `ui/AppUI.js` impacte **tous les snacks** → vérifier Tacos/Pizza/Pizzeria/Belly. Pattern Read-Old/Write-New obligatoire sur Firestore.
4. **Perf / PWA** : stratégies Workbox (`vite.config.js`), lazy-load Stripe/scanner, LCP/CLS images (WebP, width/height).
5. **a11y** : focus trap modales/panier, `aria-label` boutons icône, `:focus-visible`, contraste WCAG AA.
6. **Tests** : combler les trous de couverture `rules` (§8.2) ; rendre la CI bloquante.
7. **Financier** : tout en **centimes** ; vérifier les arrondis et la commission (0 %→8 % selon `createdAt`).

---

*Fin du brief. Pour aller plus loin : `docs/audit-lots-4-5-6.md` (audit existant), `APP_CHECK_SETUP.md`, `STRIPE_WEBHOOK_SETUP.md`.*
