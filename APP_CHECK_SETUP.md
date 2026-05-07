# Firebase App Check + reCAPTCHA v3 — Guide d'activation

Ce document décrit comment activer Firebase App Check (avec reCAPTCHA v3) pour protéger Firestore, les Cloud Functions et Storage contre les appels venant d'origines non autorisées (scripts, bots, scrapers, faux clients).

> **Statut actuel :** le code est déjà en place dans [src/firebase-init.js](src/firebase-init.js), mais désactivé tant que la variable d'environnement `VITE_APPCHECK_SITE_KEY` n'est pas définie. La PWA fonctionne normalement sans cette clé — seul un `console.warn` apparaît en prod.

---

## Pourquoi App Check ?

Sans App Check, **n'importe qui** peut copier ta `firebaseConfig` (visible dans le bundle JS) et appeler ton Firestore / tes Functions depuis un script Node, Postman, ou un autre site. Les règles Firestore protègent contre certains abus, mais elles ne stoppent pas :

- Le **scraping** de ton menu / config par un concurrent
- Le **spam** sur `createPaymentIntent` (10 appels/min sont déjà bloqués par le rate-limit, mais un attaquant qui change d'IP passe outre)
- Le **bourrage** de réinitialisations FCM ou de notifications push
- Les **faux comptes** créés en masse via `signInWithEmailAndPassword`

App Check ajoute une attestation **par requête** : "ce token vient bien d'un navigateur qui a chargé ma vraie PWA, pas d'un curl quelque part dans le monde."

---

## Quand activer ?

| Situation | Activer App Check ? |
|-----------|---------------------|
| Démos commerciales aux prospects | ❌ Pas nécessaire |
| Premier client en abonnement payant | ✅ Oui, avant le go-live |
| Tu vois passer du trafic suspect dans Firebase Console | ✅ Urgent |
| Tu veux deployer une nouvelle Cloud Function sensible | ✅ Oui |

---

## Étape 1 — Créer la clé reCAPTCHA v3

1. Va sur https://www.google.com/recaptcha/admin/create
2. Connecte-toi avec ton compte Google
3. Remplis le formulaire :
   - **Label** : `snacking-template-prod` (ou ce que tu veux)
   - **Type** : `reCAPTCHA v3`
   - **Domaines** : ajoute **tous** les domaines où la PWA tourne :
     - `snacking-template.web.app`
     - `snacking-template.firebaseapp.com`
     - `localhost` (pour dev local)
     - Ton domaine custom si tu en as un (ex: `tacos-paris.fr`)
   - Coche les conditions
4. Clique **Submit**
5. Tu obtiens **2 clés** :
   - **Clé du site** (publique, commence par `6L...`) → c'est celle qu'on utilise dans `.env.local`
   - **Clé secrète** → on la donnera à Firebase Console à l'étape 2

---

## Étape 2 — Enregistrer l'app dans Firebase App Check

1. Console Firebase → projet **snacking-template** → menu de gauche → **App Check** (sous "Build")
2. Onglet **Apps** → trouve ton app web `snacking-template (web)` → **Register**
3. Choisis **reCAPTCHA v3** comme provider
4. Colle la **clé secrète** (celle obtenue à l'étape 1)
5. **TTL du token** : laisse la valeur par défaut (1 heure) — c'est un bon compromis sécurité/perf
6. **Save**

---

## Étape 3 — Configurer le projet local

Crée un fichier `.env.local` à la racine du projet (ne JAMAIS le committer — il est déjà dans `.gitignore` via le pattern `*.local`) :

```bash
VITE_APPCHECK_SITE_KEY=6LcXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Remplace par ta **clé du site** (publique). Cette clé sera embarquée dans le bundle JS — c'est OK, elle est conçue pour ça.

Puis rebuild :

```bash
npm run build:tacos    # ou build:pizza, build:all
firebase deploy --only hosting
```

---

## Étape 4 — Tester en local AVANT de déployer

Le mode debug est déjà câblé dans [src/firebase-init.js](src/firebase-init.js) (`self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` en mode `DEV`). Procédure :

1. Lance le dev server : `npm run dev`
2. Ouvre la PWA dans Chrome → **Console DevTools**
3. Recharge la page
4. Cherche un message du type :
   ```
   App Check debug token: 1a2b3c4d-XXXX-XXXX-XXXX-XXXXXXXXXXXX. You will need to add it to your app's App Check settings...
   ```
5. Copie ce token
6. Console Firebase → **App Check** → onglet **Apps** → ton app → menu trois points → **Manage debug tokens** → **Add debug token**
7. Donne-lui un nom (`local-mac-sulayman`) et colle le token → **Save**

À partir de là, tes appels Firestore/Functions depuis localhost passent comme des appels légitimes, sans casser quoi que ce soit.

> ⚠️ **N'ajoute jamais un debug token en production.** C'est uniquement pour ton poste dev.

---

## Étape 5 — Vérifier que les vrais clients génèrent bien des tokens

**Avant** d'activer l'enforcement, on observe pendant 24-48h.

1. Console Firebase → **App Check** → onglet **APIs**
2. Tu vois une liste : `Cloud Firestore`, `Cloud Functions`, `Cloud Storage`, `Authentication`
3. Pour chacune, regarde la métrique **Requêtes vérifiées** vs **Requêtes non vérifiées**
4. Tant que la PWA tourne en prod et que les vrais utilisateurs cliquent, tu dois voir le ratio **vérifiées** monter
5. Les **non vérifiées** = soit du trafic légitime depuis une version pas encore déployée, soit du trafic suspect (bots)

**Critère de passage à l'étape 6** : > 95% des requêtes vérifiées sur 24h.

---

## Étape 6 — Activer l'enforcement (le moment où ça bloque vraiment)

### 6a. Côté Firebase (Firestore + Storage)

Console Firebase → **App Check** → onglet **APIs** :

- `Cloud Firestore` → bouton **Enforce** → confirme
- `Cloud Storage` → bouton **Enforce** → confirme
- ⚠️ Pour `Authentication`, **n'active PAS l'enforcement** tant que les vieux comptes n'ont pas tous des tokens — ça bloquerait les anciens utilisateurs.

### 6b. Côté Cloud Functions (callable)

Ouvre [functions/index.js](functions/index.js) et ajoute `enforceAppCheck: true` aux deux callables sensibles :

```js
exports.createPaymentIntent = onCall(
  { region: "europe-west1", enforceAppCheck: true },  // ← ajouter
  async (request) => { ... }
);

exports.finalizeOrder = onCall(
  { region: "europe-west1", enforceAppCheck: true },  // ← ajouter
  async (request) => { ... }
);
```

Puis redéploie :

```bash
cd functions && npm run deploy
```

À partir de là, **toute requête sans token App Check valide est rejetée** avec un `unauthenticated` côté Functions et un refus silencieux côté Firestore.

---

## Troubleshooting

### "App Check token is invalid" en local
→ Tu as oublié l'étape 4 (debug token). Ou ton `.env.local` n'est pas chargé : redémarre `npm run dev`.

### "App Check token is invalid" en prod après déploiement
→ Vérifie que le domaine de prod est bien dans la liste reCAPTCHA (étape 1). Sinon, ajoute-le dans https://www.google.com/recaptcha/admin

### Le warning `⚠️ VITE_APPCHECK_SITE_KEY non configurée` apparaît en prod
→ Le build a été fait sans la variable. Vérifie que `.env.local` existe au moment du `npm run build:xxx`.

### Les anciens utilisateurs FCM ne reçoivent plus de notifs après activation
→ Normal pendant ~1h le temps que les tokens FCM se rafraîchissent. Si ça persiste, c'est que ces utilisateurs ont une vieille version de la PWA en cache. Solution : bump du `version` dans le service worker pour forcer le refresh.

### Je veux désactiver temporairement App Check (urgence prod)
→ Console Firebase → **App Check** → onglet **APIs** → **Unenforce** sur le service concerné. Effet immédiat. Puis enquête sur la cause.

---

## Récapitulatif fichiers touchés

| Fichier | Rôle |
|---------|------|
| [src/firebase-init.js](src/firebase-init.js) | Init conditionnelle App Check (déjà fait) |
| `.env.local` | Stocke `VITE_APPCHECK_SITE_KEY` (à créer) |
| [functions/index.js](functions/index.js) | Ajouter `enforceAppCheck: true` (étape 6b) |

---

## Coût

reCAPTCHA v3 : **gratuit** jusqu'à 1M d'évaluations/mois. Au-delà, passe sur reCAPTCHA Enterprise (payant, déjà dans `functions/package.json` au cas où).

App Check : **gratuit**, fait partie de Firebase.
