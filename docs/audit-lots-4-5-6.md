# 🔎 Bilan d'investigation — Dette technique (Lots 4 / 5 / 6)

| | |
|---|---|
| **Périmètre** | Lot 4 (surface globale `window.*`), Lot 5 (webhook Stripe `invoice.subscription`), Lot 6 (transition de statut non gardée) |
| **Type** | Investigation / audit — **aucune modification de code** |
| **Méthode** | Mesure statique sur le repo (`grep`/lecture ciblée), branche `main` |
| **Date** | 2026-06-11 |
| **Statut global** | Lot 6 : bug confirmé, prêt · Lot 5 : bugs confirmés, 1 dépendance externe · Lot 4 : inventaire conforme |

**Échelle de sévérité utilisée** : 🔴 Critique · 🟠 Élevée · 🟡 Moyenne · 🔵 Faible / dette.

---

## 1. Lot 6 — Transition de statut client non gardée — 🟡 Moyenne

### 1.1 Constat (confirmé)
La règle Firestore autorise le propriétaire d'une commande à forcer `statut → 'nouvelle'`
**depuis n'importe quel état**, faute de garde sur l'état **source**.

- Création de commande — [`functions/index.js:1042`](../functions/index.js#L1042) :
  ```js
  statut: orderMode === "delivery" ? "nouvelle" : "en_attente_client",
  ```
  → l'état `en_attente_client` n'existe **que** pour le mode *collect*.
- Écriture client — [`src/tracking.js:104-107`](../src/tracking.js#L104-L107) :
  ```js
  await updateDoc(doc(db, "commandes", orderId), {
    statut: "nouvelle",
    dateArriveeClient: window.fs.serverTimestamp(),
  });
  ```
- Règle — [`firestore.rules:130-134`](../firestore.rules#L130-L134) : contraint `affectedKeys`
  (`statut`, `dateArriveeClient`) **et** la cible (`== 'nouvelle'`), mais **pas l'état de départ**.

### 1.2 Validation du chemin légitime
Le seul parcours client réel est **`en_attente_client → nouvelle`** :
- Le bouton `data-action="notify-arrival"` n'est câblé **que** dans la branche
  `en_attente_client` du radar client ([`src/tracking.js:152`](../src/tracking.js#L152)+) ;
  en état `nouvelle`, le même bouton devient `close-tracking-modal`.
- `src/delivery.js` n'écrit **aucun** `statut` (aucune autre voie d'écriture client).

### 1.3 Impact
🟡 Pollution de la file cuisine : un client (double-tap ou malveillant) peut renvoyer une
commande `prete`/`en_livraison`/`livree` en file. Fausse `getKitchenQueueCount`
([`functions/index.js:184`](../functions/index.js#L184)) → ETA erronée.
**Pas** de fuite de données ni d'impact financier (`total`/`paiement` restent non modifiables).

### 1.4 Remédiation
Ajouter une **garde d'état source** dans la branche `isOwner` :
```diff
  (
    isOwner(resource.data.userId)
+   && resource.data.statut == 'en_attente_client'
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['statut', 'dateArriveeClient'])
    && request.resource.data.statut == 'nouvelle'
  )
```
> **Note** : la garde optionnelle `mode != 'delivery'` du plan initial est **redondante** —
> une commande *delivery* démarre à `nouvelle` et n'atteint jamais `en_attente_client`.
> La garde d'état source suffit à elle seule.

**Effort** : 🟢 Faible (1 ligne de règle + test E2E `prete → nouvelle` refusé).
**Prêt à coder** : ✅ oui, immédiatement.

---

## 2. Lot 5 — Webhook Stripe `invoice.subscription` — 🟠 Élevée

### 2.1 Constat (confirmé)
Deux lectures fragiles du `subscriptionId` dans le handler `stripeWebhook` :
- [`functions/index.js:1618`](../functions/index.js#L1618) : `const subscriptionId = invoice.subscription || invoice.id;`
- [`functions/index.js:1633`](../functions/index.js#L1633) : `const subscriptionId = invoice.subscription;`

### 2.2 Défaillances identifiées
1. **Champ déprécié (API Basil `2025-03-31.basil`+)** : sur un objet Invoice, `invoice.subscription`
   est remplacé par `invoice.parent.subscription_details.subscription`. Si le endpoint webhook
   est en Basil+, `invoice.subscription` vaut `undefined` →
   - `payment_succeeded` : le snack suspendu **n'est jamais réactivé** ;
   - `payment_failed` : fallback sur `invoice.id` → le snack en impayé **n'est jamais suspendu**.
   → **Casse silencieuse de l'enforcement de l'abonnement SaaS** (aucune erreur levée).
2. **Mauvais regroupement d'événement** : `customer.subscription.deleted` est traité dans la
   **même branche** que `payment_failed` ([`functions/index.js:1616-1618`](../functions/index.js#L1616-L1618)).
   Or pour cet événement l'objet est une *Subscription* (`event.data.object.id`), **pas** une
   Invoice → le `|| invoice.id` masque l'erreur au lieu de la corriger.
3. **`apiVersion` non épinglée** : **7** instanciations `require("stripe")(...)` sans `apiVersion`
   (lignes 572, 687, 740, 763, 803, 859, 1585 — `grep apiVersion` = **0**). Le code suit la version
   par défaut du compte → dérive possible et non maîtrisée.

État actuel : aucune lecture `invoice.parent` / `subscription_details` dans le code.
SDK : `stripe@^21.0.1`.

### 2.3 Remédiation
1. **Helper défensif** (lit ancien **et** nouveau chemin) :
   ```js
   function resolveSubscriptionId(invoice) {
     if (!invoice) return null;
     if (typeof invoice.subscription === "string") return invoice.subscription; // legacy
     const parent = invoice.parent;
     if (parent && parent.type === "subscription_details") {
       return parent.subscription_details?.subscription ?? null; // Basil+
     }
     return null;
   }
   ```
2. **Séparer** le cas `customer.subscription.deleted` (`event.data.object.id`) de la branche invoice.
3. **Épingler `apiVersion`** sur les 7 call-sites (idéalement factoriser un module
   `functions/lib/stripe.js`), **aligné** sur la version du endpoint webhook.

### 2.4 🔴 Dépendance externe (action manuelle Dashboard)
La forme du payload webhook dépend de la **version d'API configurée sur le endpoint**
(Dashboard Stripe → Developers → Webhooks → version), **pas** du SDK. **Relever cette valeur
est un prérequis** avant de choisir l'`apiVersion` à épingler. Le helper reste néanmoins sûr
quelle que soit la réponse.

**Effort** : 🟡 Faible/Moyen.
**Prêt à coder** : ⚠️ oui pour le helper ; le pin `apiVersion` attend la version du endpoint.
**Non-régression à re-tester** : tout le tunnel paiement (`createPaymentIntent`, `finalizeOrder`,
`createSubscriptionCheckout`, `getStripeOnboardingLink`, `getStripeAccountStatus`) sur clés **test**.

---

## 3. Lot 4 — Surface globale `window.*` — 🔵 Dette (transverse)

### 3.1 Inventaire mesuré
| Métrique | Valeur |
|---|---|
| Assignations `window.X =` | **139** |
| Fichiers concernés (`src/`) | **37** |
| Handlers `onclick=` inline (HTML) | **45** |

**Globals les plus lus** :

| Global | Lectures | Catégorie\* |
|---|---:|---|
| `window.showToast` | 112 | C (handler/UI) |
| `window.fs` | 64 | A (réexport lib) |
| `window.db` | 56 | A |
| `window.triggerVibration` | 37 | C |
| `window.currentAdminSnackId` | 33 | B (service) |
| `window.auth` | 32 | A |
| `window.snackConfig` | 19 | B |
| `window.authTools` | 18 | A |
| `window.switchView` | 10 | C |
| `window.getCartTotal` | 9 | B |
| `window.favoritesService` | 6 | B |
| `window.store` | 6 | B |
| `window.cart` | 5 | B |
| `window.startOrderTracking` | 5 | B/C |

\* A = réexport de lib (→ barrel ESM) · B = service applicatif (→ export ESM) · C = handler appelé depuis `onclick=` HTML (→ namespace unique `window.app`).

### 3.2 Remédiation (incrémentale, 3 PR)
1. **PR-1** : barrel `src/core/firebase.js` + migration catégorie A (`fs`/`db`/`auth`/`authTools` ≈ **170** lectures) — **gain immédiat le plus élevé**.
2. **PR-2** : conversion des services B en exports ESM nommés.
3. **PR-3** : regroupement des handlers C sous un seul `window.app` + maj des 45 `onclick=`.
4. Règle ESLint anti-récidive interdisant tout nouveau `window.X =` hors `app.js`/`firebase.js`.

### 3.3 ⚠️ Prérequis identifié
`madge` **n'est pas installé**. La détection des **cycles d'import** (risque clé du passage ESM,
ex. `firebase-init ↔ store`) nécessitera `npx madge --circular src/` avant de démarrer la PR-1.

**Effort** : 🔴 Élevé. **À découper en 3 PR, à merger en dernier** (transverse, gros diff).

---

## 4. Synthèse & séquencement

| Ordre | Lot | Sévérité | Effort | Prêt à coder | Blocage |
|---:|---|:---:|:---:|:---:|---|
| 1 | **6** — statut | 🟡 | 🟢 Faible | ✅ | — |
| 2 | **5** — Stripe | 🟠 | 🟡 Moyen | ⚠️ partiel | Version API du endpoint webhook (Dashboard) |
| 3 | **4** — globals | 🔵 | 🔴 Élevé | 🔍 PR-1 | Installer `madge` (cycles) |

- **Lots 5 et 6 parallélisables** (agents/branches distincts).
- **Lot 4** démarre son investigation en parallèle mais **merge en dernier** (conflits massifs).
- **Règle d'or** : aucun de ces lots ne change le comportement métier observable — chantiers de robustesse/dette uniquement.

### Actions externes à planifier (hors code)
- [ ] **Lot 5** : relever la version d'API du endpoint webhook Stripe + version du compte.
- [ ] **Lot 4** : `npm i -D madge` puis `npx madge --circular src/` avant PR-1.
