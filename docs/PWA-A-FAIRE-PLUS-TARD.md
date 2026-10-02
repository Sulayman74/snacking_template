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

---

## 5. Declarative Web Push (iOS/Safari 18.4+)

**État actuel** : le push passe par FCM et fonctionne sur iPhone (app installée, iOS 16.4+) depuis le
service worker unique (`src/sw.js`). Le SW lit déjà le format déclaratif (`src/sw/push-payload.js` :
`web_push: 8030`, `navigate`, `app_badge`) — seul l'envoi manque.

**Intérêt** : iOS affiche la notification lui-même, même si le service worker a été arrêté ou évincé
→ plus fiable sur iPhone. FCM n'émet pas ce format.

**À faire**
1. Générer une paire VAPID (`npx web-push generate-vapid-keys`) ; clé privée dans Secret Manager
   (`firebase functions:secrets:set VAPID_PRIVATE_KEY`), publique en `VITE_VAPID_PUBLIC_KEY`.
2. Front (`src/push-register.js`) : sur Safari installé, `pushManager.subscribe({ userVisibleOnly: true,
   applicationServerKey })` et envoi de l'abonnement (endpoint + clés) au callable `registerPushToken`
   (nouveau champ `channel: "webpush"`).
3. Functions : dépendance `web-push`, `defineSecret("VAPID_PRIVATE_KEY")` déclaré sur chaque fonction
   qui envoie ; dans `lib/pushTargets.sendToTargets`, router `channel === "webpush"` vers `web-push` avec
   un payload `{ web_push: 8030, notification: { title, body, navigate, app_badge } }`, FCM sinon.
   Nettoyage sur HTTP 404/410.
4. Étendre le garde-fou de secrets du build (`vite.config.js`) : refuser tout `VITE_*PRIVATE*`.
5. Tests : `test:push` (canal webpush stubbé), test sur iPhone réel (non testable en CI).

**Effort** : 3-5 j.

---

## 6. Écran cuisine — relance « Vu » et SMS au gérant

**Contexte** : audit du 29/09/2026, option D du brainstorming KDS-1. Les options A (écoute active
pendant tout le service, sonnerie sur toute commande « à cuisiner ») et B (push admin à l'arrivée du
client) sont faites. Reste le cas où **personne ne regarde ni n'entend** : cuisine vide, tablette
tombée en veille sans notification autorisée, rush.

**Besoin** : aucune commande payée ratée, et savoir quand une commande a été vue (litige client).

**Principe**
1. Chaque ticket porte un accusé de réception : champ `vueAt` (+ `vueBy`) posé par un bouton « Vu »
   sur le ticket, ou automatiquement quand le ticket a été affiché écran visible pendant X s.
   Règles Firestore : l'admin du snack peut écrire `vueAt` (liste blanche admin à étendre).
2. Escalade tant que `vueAt` est vide, pilotée par une tâche planifiée (`onSchedule` toutes les
   minutes, requête `statut == "nouvelle" && vueAt == null && date < now - N`) :
   - T+0 : sonnerie + push (déjà en place) ;
   - T+2 min : nouveau push « Commande en attente depuis 2 min » (gratuit) ;
   - T+5 min : **SMS au gérant** (payant, opt-in par snack).
3. Idempotence : un marqueur par palier (`relance.push2At`, `relance.smsAt`) écrit en transaction,
   pour ne jamais envoyer deux fois.

**Prestataires SMS (France)** : Brevo, OVHcloud SMS, Twilio. Ordre de grandeur **0,05 à 0,08 € HT
par SMS**. Clé d'API en Secret Manager (`defineSecret`), jamais dans le code ni en `VITE_*`.

**Coût estimé** : 100 commandes/jour, 5 % non vues à T+5 min → ~150 SMS/mois ≈ **8 à 12 € par snack
et par mois**. Tâche planifiée : ~43 000 exécutions/mois (dans les 2 M gratuits). Lectures Firestore :
une requête indexée par minute, négligeable. À refacturer dans l'abonnement ou à réserver à une
offre supérieure.

**Pour**
- Quasi impossible de rater une commande ; preuve horodatée qu'elle a été vue.
- Palier push gratuit avant le SMS : le SMS reste rare.

**Contre**
- Un geste de plus en plein rush si le « Vu » est manuel (préférer l'accusé automatique à l'affichage).
- Coût variable par snack ; numéro du gérant à collecter (RGPD : finalité, opt-out, mention légale).
- Index composite à créer (`snackId`, `statut`, `vueAt`, `date`).

**À faire**
1. Trancher « Vu » manuel ou automatique (recommandé : automatique après 5 s écran visible, bouton en
   secours).
2. Champs `vueAt`/`vueBy`, règles, index ; affichage « vu à 12:04 » sur le ticket.
3. Tâche planifiée d'escalade + push de relance (sans SMS) → mesurer le taux de commandes non vues.
4. Seulement si ce taux le justifie : SMS opt-in par snack (numéro gérant dans la config admin).
5. Tests : harnais d'escalade (émulateur, horloge simulée), idempotence des paliers.

**Effort** : 1,5 j sans SMS ; +1 j avec SMS.

---

## 7. Créneaux : capacité maximale et mode « Occupé » (lot 2d)

**Contexte** : plan « étape 2 » du 01/10/2026. Les lots 2a (suivi et reçu), 2b (cuisson dès le paiement
pour « Dès que possible ») et 2c (créneaux « plus tard » avec lancement automatique) couvrent le besoin
de base. Ce lot sert à **lisser le coup de feu** quand un snack reçoit beaucoup de commandes en ligne.

**Ce qui se fait sur le marché** : les solutions de click & collect pour snacks et pizzerias limitent
le nombre de commandes par créneau de 15 min ; Uber Eats propose au restaurant un mode « Occupé »
(+10 min) / « Très occupé » (+20 min) sur le délai de préparation.

**Principe**
1. Réglage restaurateur `capacity.maxOrdersPerSlot` (vide = illimité). Un créneau plein n'est plus
   proposé au client ; « Dès que possible » se décale au premier créneau libre.
2. Bouton « Occupé +10 min » sur l'écran cuisine (`prepExtraMin` temporaire, retour auto à la fin du
   service) : allonge l'heure annoncée aux nouveaux clients, sans couper les commandes (la pause existe
   déjà pour ça).
3. Contrôle serveur au paiement : compter les commandes du créneau en transaction (sinon deux clients
   prennent la dernière place en même temps).

**Pour** : moins de retards en rush, heure annoncée fiable, aucune action requise en temps normal.
**Contre** : un réglage de plus à expliquer ; risque de refuser des ventes si la capacité est mal
réglée → valeur par défaut « illimité ».
**Coût** : 1 agrégat `count()` Firestore par paiement (négligeable).
**Effort** : ~1 j.
**Déclencheur** : un snack qui se plaint de retards en rush, ou plus de ~40 commandes en ligne/jour.
