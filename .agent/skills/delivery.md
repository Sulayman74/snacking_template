name: delivery
description: Active et orchestre la livraison native (PWA livreur + géofencing Haversine + ETA intelligent + Preuve de livraison photo PoD) quand enableDelivery est actif, pour le click&collect ET la livraison.
---

# Rôle
Mettre en place la **livraison native** d'un snack lorsque le flag `enableDelivery` est actif :
- Choix **Click & Collect / Livraison** au checkout.
- Capture d'adresse + **géolocalisation client** (PWA, HTTPS), validation du **rayon de livraison** (géofencing autour du resto).
- App **livreur dédiée** (PWA installable, géoloc) qui, à la prise en charge, diffuse sa position, **notifie le client de sa distance**, et capture des **preuves de livraison par photo** (PoD - Proof of Delivery) pour valider la conformité aux standards des plateformes modernes.
- **Temps estimé intelligent (ETA)** affiché au client, que ce soit en collect ou en livraison.

> **Décisions d'architecture validées :**
> - **Comptes livreurs dédiés** intégrés dans la collection `users`.
> - **Distance/ETA Haversine** (gratuit, à vol d'oiseau, vitesse moyenne paramétrable, AUCUNE clé API externe).
> - **ETA heuristique simple** (prépa de base + file d'attente cuisine + trajet).
> - **Firebase Storage** pour le stockage des preuves de livraison (photos compressées côté client avant envoi via Canvas API, utilisation de l'appareil photo natif via HTML5 `<input capture="environment">`).
>
> ⚠️ **Modèle de rôle** (aligné sur l'existant) : les rôles vivent dans le doc `users/{uid}` (`role: 'admin'|'superadmin'|'client'|'livreur'`), PAS en custom claims (cf. `firestore.rules` : `getAuthUser()`). Un **livreur = `users/{uid}` avec `role: 'livreur'` + `snackId`** (+ `nom`, `telephone`, `actif`, `fcmToken`). On réutilise ainsi `isOwner`, l'update self de `fcmToken`, et le helper `isDriver(snackId)` ajouté aux règles. Pas de collection `livreurs` séparée.

## Pré-requis & flags
- `snacks/{snackId}.enableDelivery === true` (flag déjà mappé dans `snack-config.js` → `config.features.enableDelivery`).
- Le snack DOIT avoir des coordonnées resto (`restaurantLat`/`restaurantLng`). Si absentes → géocoder l'adresse une fois (réutiliser le pattern de `src/services/weatherService.js`, qui fait déjà ville → lat/lon via Open-Meteo, gratuit).
- Le flag `enableClickAndCollect` reste indépendant : les deux modes peuvent coexister (sélecteur au checkout) ou la livraison peut être seule.
- Le champ existant `deliveryUrl` (lien plateforme tierce type UberEats) est distinct de la livraison native — ne pas le confondre. Clarifier avec le client lequel prime.
- Activation de **Firebase Storage** sur le projet Firebase pour la gestion des fichiers images de preuve.

## Context Awareness — fichiers à analyser (existant)
- `src/snack-config.js` → `loadSnackConfig` : ajoute le bloc `delivery` + coords resto au mapping (l. ~82-93, `features` + `deliveryUrl`).
- `src/checkout.js` → `finalizeOrderInFirestore` (appelle la CF `finalizeOrder`) : c'est ici qu'on injecte `mode` + `livraison` + l'ETA.
- `src/tracking.js` → `startOrderTracking` (onSnapshot sur `commandes/{orderId}`) : statuts client `en_attente_client → nouvelle → prete → terminee`. À étendre pour `en_livraison`/`livree` + affichage ETA + distance live + affichage des photos de preuve.
- `src/admin-kitchen.js` → radar cuisine 3 colonnes + `updateOrderStatus` + `requestWakeLock` (à réutiliser côté livreur).
- `src/ui/AdminConfigUI.js` → form de config admin (ajouter les réglages livraison).
- `src/pwa.js` → enregistrement SW + A2HS (modèle PWA à répliquer pour `livreur.html`).
- `functions/index.js` :
  - `finalizeOrder` (onCall, l. ~504) : création commande `commandes/{id}` (collection plate, champ `snackId`). Modèle actuel : `{ snackId, userId, clientNom, clientEmail, secretCode, date, statut, items, total, paiement }`.
  - `onOrderStatusChange` (onDocumentUpdated `commandes/{orderId}`, l. ~660) : envoie le push FCM quand `statut → prete`. `fcmToken` lu sur `users/{uid}`.
  - `cleanupInvalidFcmToken`, helper `V` (validation), `enforceRateLimit`/`callerKey`, `getMessaging().send()` (FCM 100% server-side).
- `vite.config.js` → `rollupOptions.input` : ajouter l'entrée `livreur`.
- ✅ `firebase.json` a désormais une section `firestore` → `firestore.rules` + `firestore.indexes.json` (versionnés dans le repo). Le flux livreur réutilise l'index existant `commandes(snackId, statut, date)` (query `statut=='prete'` puis filtre `mode`/`livreurId` en JS → **aucun nouvel index obligatoire**). Un index optionnel `commandes(snackId, mode, statut, date)` est inclus pour le passage à l'échelle.

## Modèle de données (extensions)

### `commandes/{orderId}` — nouveaux champs (rétro-compatibles, défauts pour les commandes legacy)

```

```text
File delivery-v3.md created successfully.

```json
{
  "mode": "collect | delivery",            // défaut 'collect' si absent
  "eta": {
    "prepMin": "number",                   // estimé prépa au moment de la commande
    "deliveryMin": "number | null",        // estimé trajet (livraison only)
    "totalMin": "number",                  // prepMin (+ deliveryMin)
    "readyAt": "Timestamp",                // computedAt + totalMin (cible affichée client)
    "computedAt": "Timestamp"
  },
  "livraison": {                           // présent si mode === 'delivery'
    "adresse": "string",                   // saisie/validée
    "lat": "number", "lng": "number",      // géoloc client (capturée à la commande)
    "distanceKm": "number",                // resto → client (Haversine)
    "frais": "number",                     // frais de livraison appliqués
    "preuves": {                           // NOUVEAU : Preuves de livraison par photo (PoD)
      "pickupUrl": "string | null",        // Photo du sac scellé prise au restaurant
      "dropoffUrl": "string | null",       // Photo du dépôt (porte, boîte aux lettres, client)
      "capturedAt": "Timestamp | null"
    }
  },
  "livreurId": "string | null",            // uid du livreur ayant pris en charge
  "livreur": {                             // mis à jour par l'app livreur (throttlé)
    "nom": "string",
    "position": { "lat": "number", "lng": "number", "updatedAt": "Timestamp" },
    "lastNotifiedBucket": "number | null"  // anti-spam géofencing (cf. seuils)
  }
}

```

Statuts étendus : `en_attente_client → nouvelle → prete → [en_livraison → livree] | terminee`.

* `en_livraison` : le livreur a pris la commande et a validé la photo de prise en charge (pickup). Le `watchPosition` devient actif.
* `livree` : la photo de dépôt (dropoff) a été envoyée et la commande est validée comme remise au client (équivalent `terminee` pour la livraison).

### `users/{uid}` — le livreur EST un user (cohérent avec admin/superadmin)

```json
{ 
  "role": "livreur", 
  "snackId": "string", 
  "nom": "string", 
  "telephone": "string", 
  "actif": "boolean",
  "fcmToken": "string | null", 
  "points": 0, 
  "createdBy": "string" /* uid admin */ 
}

```

Pas de collection séparée. Les **règles Firestore** s'appuient sur `users/{uid}.role == 'livreur' && .snackId == X` (helper `isDriver`) pour autoriser la lecture des commandes du snack et l'écriture encadrée des champs livraison.

### `snacks/{snackId}` — bloc `delivery` (édité via AdminConfigUI)

```json
{
  "enableDelivery": "boolean",
  "delivery": {
    "radiusKm": "number",        // rayon max de livraison (géofence resto)  ex: 5
    "frais": "number",           // frais fixes de livraison                 ex: 2.5
    "minOrder": "number",        // panier minimum livraison                 ex: 15
    "avgSpeedKmh": "number",     // vitesse moyenne livreur (Haversine→min)  ex: 22
    "prepBaseMin": "number",     // temps prépa de base                      ex: 12
    "queueFactorMin": "number"   // minutes ajoutées par commande en file    ex: 3
  },
  "restaurantLat": "number", "restaurantLng": "number"   // géocodés une fois
}

```

### Firebase Storage Layout — structure des dossiers

```text
deliveries/{snackId}/{orderId}/pickup.jpg     // Photo du sac au départ du restaurant
deliveries/{snackId}/{orderId}/dropoff.jpg    // Photo de preuve de dépôt chez le client

```

## Step-by-Step Actions

1. **Config snack + géocodage resto**
* Étendre `loadSnackConfig` (`snack-config.js`) : exposer `config.delivery` (avec défauts sûrs) + `config.identity.geo = { lat, lng, radiusKm }`.
* CF/one-shot : si `restaurantLat/Lng` absents, géocoder `street+zip+city` (pattern `weatherService.js`) et écrire sur `snacks/{snackId}`. Ne jamais géocoder à chaque chargement (coût/latence).


2. **Sélecteur de mode + capture géoloc au checkout** (`src/delivery.js`, branché dans `src/checkout.js`)
* Si `features.enableDelivery && features.enableClickAndCollect` → afficher un toggle **Collect / Livraison** avant le paiement.
* Si Livraison :
* `navigator.geolocation.getCurrentPosition()` (PWA/HTTPS) avec **fallback saisie manuelle d'adresse** (permission refusée / desktop). Géocoder l'adresse saisie si pas de coords.
* **Validation rayon** : `haversine(resto, client) <= delivery.radiusKm`, sinon toast "Hors zone de livraison".
* **Panier minimum** : `total >= delivery.minOrder`, ajouter `delivery.frais` au total.


* Passer `mode`, `livraison{adresse,lat,lng,distanceKm,frais}` à `finalizeOrder`. ⚠️ Le serveur **recalcule** distance/frais/total (ne jamais faire confiance au client — anti-manipulation prix, cf. la vérif Stripe existante l. ~583).


3. **ETA intelligent (heuristique simple)** — CF `getOrderEstimate` (onCall) + intégré dans `finalizeOrder`
* Lecture serveur : `queueCount` = nb commandes du `snackId` en `nouvelle` + `en_attente_client`.
* `prepMin = delivery.prepBaseMin + delivery.queueFactorMin * queueCount`.
* Livraison : `deliveryMin = round(distanceKm / delivery.avgSpeedKmh * 60)`.
* `totalMin = prepMin + (mode==='delivery' ? deliveryMin : 0)`, `readyAt = now + totalMin`.
* Appelé **au checkout** (afficher "Prêt dans ~15 min" / "Livré vers 19h45" AVANT paiement) et **figé sur la commande** dans `finalizeOrder`.
* Vaut pour **collect ET livraison** (collect = `deliveryMin: null`).
* Recalcul léger côté client pendant `en_livraison` à partir de la distance live (cf. étape 5), sans nouvel appel serveur.


4. **App livreur — `livreur.html` (PWA installable + géoloc + APN Preuves)** (`src/livreur.js`, `src/ui/LivreurUI.js`)
* Nouvelle entrée Vite (`rollupOptions.input.livreur`), propre manifest/scope PWA, SW partagé.
* Écran login dédié. À la connexion, lire `users/{uid}` et vérifier `role==='livreur'` (sinon rejet).
* **Liste des courses** : query `commandes` où `snackId == user.snackId && statut=='prete'` (réutilise l'index existant) puis filtre `mode=='delivery'` en JS ; + ses livraisons en cours `statut=='en_livraison'` filtré `livreurId==uid`.
* **Prise en charge avec preuve photo (Pickup PoD) :**
* Au clic sur "Je prends la course", ouvrir l'appareil photo natif via une balise invisible ou intégrée : `<input type="file" accept="image/*" capture="environment" id="pickup-camera">`.
* À la capture, l'image est injectée dans un HTML5 `<canvas>` pour **redimensionnement et compression locale** (ex: max 1000px de large, format JPEG, qualité 0.7) afin de préserver la data mobile du livreur.
* Envoi du blob compressé vers Firebase Storage sur le chemin `deliveries/{snackId}/{orderId}/pickup.jpg`.
* Une fois l'upload réussi, passer le statut Firestore à `en_livraison` via une transaction incluant `livreurId=uid`, `livreur.nom`, et `livraison.preuves.pickupUrl`. Si la transaction échoue ou la course est déjà prise, l'image correspondante est nettoyée sur Storage.


* Démarrer `navigator.geolocation.watchPosition()` + **Wake Lock** (réutiliser `requestWakeLock` de `admin-kitchen.js`).
* **Throttle d'écriture** : n'écrire `livreur.position` que toutes les ~20 s OU si déplacement > 100 m (helper dans `geoService.js`) → limite les writes Firestore.
* **Livraison finale avec preuve photo (Dropoff PoD) :**
* Bouton "Valider la livraison" → Déclenche à nouveau l'appareil photo (`capture="environment"`) pour photographier le sac déposé devant la porte, dans la boîte aux lettres ou remis en main propre.
* Traitement Canvas identique (compression locale JPEG).
* Upload vers Storage sur `deliveries/{snackId}/{orderId}/dropoff.jpg`.
* Update final Firestore : `statut='livree'`, `livraison.preuves.dropoffUrl`, `livraison.preuves.capturedAt = serverTimestamp()`.
* Arrêt immédiat de `watchPosition` et libération du Wake Lock.


* ⚠️ Limite PWA : pas de vraie géoloc background sur iOS → l'app doit rester au premier plan (Wake Lock) ; le documenter dans l'UI livreur.


5. **Géofencing & notifications de distance** — CF `onDriverPositionUpdate` (onDocumentUpdated `commandes/{orderId}`)
* Déclenchée quand `livreur.position` change ET `statut==='en_livraison'`.
* `dist = haversine(livreur.position, livraison)` (resto-side, source de vérité — **jamais** la distance calculée par le client).
* **Seuils (buckets) géofence** : ex `[3000, 1000, 300]` m. À chaque franchissement vers le bas non encore notifié (`lastNotifiedBucket`), envoyer un push FCM au client : "🛵 Votre livreur est à ~1 km" / "🛵 Le livreur arrive (300 m), préparez-vous !". Mettre à jour `livreur.lastNotifiedBucket` pour ne notifier **qu'une fois par seuil** (anti-spam).
* Réutiliser `getMessaging().send()` + `cleanupInvalidFcmToken` (mêmes patterns que `onOrderStatusChange`).
* Étendre la notif statut : push aussi à `en_livraison` ("En route ! 🛵") et `livree` ("Votre commande a été livrée ! 🎉").


6. **Tracking client enrichi** (`src/tracking.js`)
* Afficher l'**ETA** dès `en_attente_client`/`nouvelle` : "Prêt dans ~X min" (depuis `eta.readyAt`).
* Nouveau statut `en_livraison` : afficher "Votre livreur est en route", **distance live** (recalcul Haversine client à partir de `livreur.position`, lecture seule via le onSnapshot existant).
* Statut `livree` : Écran de fin affichant une confirmation visuelle. **Afficher l'image de preuve de dépôt** (`livraison.preuves.dropoffUrl`) pour rassurer le client sur l'emplacement exact de son sac (notamment en mode sans contact).
* Garder la logique 100% pilotée par l'onSnapshot existant (pas de polling).


7. **Comptes livreurs** — CF `createDriver` (onCall, réservé admin/superadmin du snack)
* Valider le rôle appelant (admin du `snackId`), `V` pour les entrées.
* Créer le compte Firebase Auth + le doc `users/{uid}` avec `{ role:'livreur', snackId, nom, telephone, actif:true, points:0 }` (admin SDK → contourne la règle `create` qui force `role:'client'`).
* UI de gestion minimale dans l'admin (liste/ajout/désactivation `actif`). Le livreur enregistre son `fcmToken` au login (réutiliser `requestNotif` → update self autorisé par la règle `users`).
* **Règles Firestore** (✅ déjà ajoutées dans `firestore.rules`) :
* helper `isDriver(snackId)` (lit `users/{uid}.role == 'livreur'`).
* `commandes` read : `+ isDriver(resource.data.snackId)`.
* `commandes` update livreur : `affectedKeys().hasOnly(['livreur','livreurId','statut','livraison'])`, `mode=='delivery'`, `statut in ['prete','en_livraison','livree']`, et `livreurId == null || == auth.uid` (anti-vol de course).




8. **Règles de sécurité Firebase Storage** (`storage.rules`)
* Restreindre l'écriture des images aux livreurs identifiés du snack, et permettre la lecture au client détenteur de la commande ainsi qu'aux admins.


```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /deliveries/{snackId}/{orderId}/{imageId} {
      // Seul un utilisateur connecté avec le rôle livreur associé à ce snackId peut uploader des preuves
      allow write: if request.auth != null && 
                   firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.role == 'livreur' &&
                   firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.snackId == snackId;

      // La lecture est autorisée pour tout client connecté (ou restreinte via une validation de commande si besoin)
      allow read: if request.auth != null;
    }
  }
}

```


9. **Build / multi-tenant**
* `vite.config.js` : `input.livreur = resolve(__dirname, 'livreur.html')`.
* Aucun nouveau script `build:*` requis (l'entrée se construit avec chaque snack). Vérifier le rendu `livreur.html` dans `dist/<snackId>/`.



## Safety & Patterns

* **Optimisation et Performance Data :** Les appareils photos mobiles modernes génèrent des fichiers de plus de 5 Mo. L'étape de compression locale par Canvas dans `src/services/imageService.js` est obligatoire avant l'appel à `uploadBytes` de Firebase Storage. Un fichier cible de ~150 Ko à 300 Ko max est requis.
* **RGPD & Éphémérité des données :** - La géolocalisation live du livreur (`livreur.position`) doit être **purgée** (champ supprimé ou mis à null) immédiatement lors du passage au statut `livree` pour respecter la vie privée.
* Les photos de preuve de dépôt (qui capturent parfois des halls d'immeubles, portes ou extérieurs privatifs) ne doivent pas être conservées indéfiniment. Mettre en place une **règle de cycle de vie des objets (Lifecycle Rule)** dans Firebase Storage pour supprimer automatiquement tout fichier du dossier `deliveries/*` après 14 jours.


* **SOLID/KISS :** L'utilisation de l'attribut natif HTML5 `capture="environment"` garantit l'ouverture automatique de l'appareil photo arrière sur smartphone sans avoir à initialiser des flux de caméras complexes via WebRTC/MediaDevices.
* **Non-régression :** `mode` absent ⇒ comportement collect actuel inchangé (Tacos/Pizza). Les commandes antérieures (legacy) doivent s'afficher normalement côté cuisine et tracking sans provoquer de crash dû aux nouveaux champs imbriqués.

## Tests (émulateur d'abord — interdiction de tester en prod)

* `geoService.js` : tests unitaires Haversine (distances connues), `etaFromDistance`, `shouldWritePosition` (throttle temps/distance), `bucketFor` (franchissement de seuils, idempotence).
* `imageService.js` : validation de la fonction de compression (mocking d'un objet File/Blob image vers Canvas).
* Firebase Local Emulator Suite (Functions + Firestore + Storage + Auth) :
* `getOrderEstimate` : file vide vs chargée, collect vs livraison, hors rayon.
* `finalizeOrder` : recalcul serveur frais/total (tentative de manipulation client rejetée), `mode` collect legacy intact.
* `onDriverPositionUpdate` : 1 seul push par seuil, FCM `DRY_RUN` (log au lieu d'envoyer), token invalide nettoyé.
* Rules Storage : test de rejet d'upload si l'utilisateur a un rôle `client`.


* E2E Playwright (cf. `tests/`) : parcours livraison (client commande livraison → cuisine `prete` → livreur prend la course avec mock upload photo → seuils notifiés → livraison finale et affichage de la photo sur l'interface client), façon `tests/radar.spec.js`. Mock géoloc via `context.setGeolocation(...)` + permission `geolocation`.
* Peupler `seed-data.json` avec un snack `enableDelivery`, un livreur, une commande livraison.
