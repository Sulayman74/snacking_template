# PWA & Auth — À faire plus tard

> Reporté volontairement (septembre 2026) : ces chantiers n'ont d'intérêt qu'avec de vrais clients en production.
> Le projet est en phase de **démo**. Source : audit PWA multi-agents (Back / Front / DevOps / Firebase).

## Déclencheur

Reprendre ce document **à la signature du premier client** (premier snack en `live` Stripe avec du trafic réel).

---

## 1. App Check — enforcement

**État actuel**
- Code client prêt : reCAPTCHA v3, conditionné à `VITE_APPCHECK_SITE_KEY` (`src/firebase-init.js:79-97`).
- La clé n'est pas renseignée dans `.env.development` / `.env.production.local` → App Check inactif.
- Aucun `enforceAppCheck` dans `functions/`.
- `APP_CHECK_SETUP.md` est obsolète : il pointe vers `functions/index.js` (devenu un barrel). Les callables sont dans `functions/domains/*.js`.

**À faire**
1. Créer la clé reCAPTCHA en déclarant **tous** les domaines Hosting (`.firebaserc`) + domaines custom.
2. Activer App Check côté client, observer les métriques **24-48 h** en mode « non appliqué ».
3. `enforceAppCheck: true` sur les callables sensibles (`functions/domains/payment.js` : `createPaymentIntent`, `finalizeOrder`), puis Firestore / Storage.
4. **Ne pas** activer l'enforcement sur Authentication (le checkout invité utilise `signInAnonymously`).
5. Mettre à jour `APP_CHECK_SETUP.md`.

**Points d'attention**
- reCAPTCHA ne tourne pas dans un Service Worker : un appel émis depuis le SW n'aura pas de jeton (ex. `trackPushClick`, `onRequest` dans `marketing.js`).
- Sur iOS en web app installée : App Attest / DeviceCheck indisponibles sur le web, score reCAPTCHA possiblement plus bas → à mesurer pendant l'observation.
- Émulateurs : debug token uniquement.

**Effort** : ~1 j + 24-48 h d'observation.

---

## 2. Téléphone / SMS OTP + Web OTP

**État actuel** : pas de téléphone, pas de SMS. Auth = email/mot de passe, Google (popup), anonyme (invité).

**À faire**
- `signInWithPhoneNumber` + `RecaptchaVerifier` (Firebase Auth).
- iOS : `autocomplete="one-time-code"` sur le champ suffit (remplissage auto du clavier).
- Chrome Android : Web OTP (`navigator.credentials.get({ otp })`) — le format du SMS Firebase n'est *a priori* pas personnalisable pour la ligne `@domaine #code` → à vérifier.

**Points d'attention**
- Coût SMS à l'unité (plan Blaze) : poste le plus cher.
- **SMS pumping** : restreindre les régions SMS, rate limit, et App Check (§1) **avant** d'ouvrir le SMS.
- L'émulateur Auth expose les codes : testable localement sans vrai SMS.

**Effort** : 1-3 j.

---

## 3. Passkeys (WebAuthn)

**État actuel** : rien. Firebase Auth ne gère pas WebAuthn nativement.

**À faire**
- `@simplewebauthn/server` dans Functions : callables `passkeyRegisterStart/Finish`, `passkeyLoginStart/Finish`.
- Challenges stockés avec durée de vie ; collection `users/{uid}/passkeys` (écriture client interdite).
- Connexion : `admin.auth().createCustomToken(uid)` → `signInWithCustomToken` côté client.
- Rôle IAM « Service Account Token Creator » (`signBlob`) sur le compte de service des Functions.
- **Ne jamais** mettre le rôle dans le custom token : les rôles restent dans Firestore.

**Points d'attention**
- **RP ID par domaine** : chaque `*.web.app` est son propre RP (`web.app` est sur la Public Suffix List) → une passkey par snack. Un RP commun exige un domaine commun ou les « Related Origin Requests ».

**Effort** : 4-8 j. Difficile.

---

## 4. Digital Credentials API

**Décision** : non. Pas de besoin métier (vérification d'âge / d'identité), API encore jeune, aucune intégration Firebase.
À réévaluer seulement si un besoin réglementaire apparaît (ex. vente d'alcool).
