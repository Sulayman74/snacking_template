# PWA — Notes de déploiement (phases 0 et 1)

À suivre **dans cet ordre** lors du prochain déploiement de la branche.

## 1. Functions + règles Firestore (en premier)

```bash
firebase deploy --only functions,firestore:rules
```

- Nouvelles fonctions : `reconcilePendingOrders` (planifiée, 5 min) et `registerPushToken` (callable).
- Les Functions d'envoi lisent les nouveaux abonnements **et** l'ancien champ `users.fcmToken` (repli) :
  elles fonctionnent avec l'ancien front comme avec le nouveau.

## 2. Hosting (ensuite)

```bash
npm run deploy:all
```

- Le nouveau front enregistre les appareils via `registerPushToken`. Déployé AVANT les Functions,
  il retomberait sur `users.fcmToken` (repli prévu), mais autant respecter l'ordre.
- Le nouveau service worker (`src/sw.js`) s'installe en mode « prompt » : les utilisateurs voient le
  bandeau « Rafraîchir » ; rien n'est rechargé de force.

## 3. Une seule fois : expiration automatique des abonnements push

Les abonnements non revus depuis 60 jours portent un `expireAt` passé. Activer la politique TTL :

```bash
gcloud firestore fields ttls update expireAt \
  --collection-group=pushSubscriptions --enable-ttl --project=snacking-template
```

(La suppression effective peut prendre jusqu'à ~24 h après `expireAt`.)

## 3 bis. Domaines Apple Pay / Google Pay (rattrapage, idempotent)

Le webhook n'enregistre le domaine qu'au 1er passage d'un compte connecté à « actif » : les comptes
déjà actifs (ex. Team Fusion) ne l'ont jamais eu → Apple Pay n'apparaît pas. Avec Node 24 :

```bash
export STRIPE_SECRET_KEY=$(gcloud secrets versions access latest --secret=STRIPE_SECRET_KEY --project=snacking-template)
npm run stripe:apple-pay-domains          # dry-run : état par snack, n'écrit rien
npm run stripe:apple-pay-domains:apply    # enregistre les domaines manquants
```

À relancer après chaque nouveau snack / domaine custom, et au passage en clés **live**.

## 4. Vérifications sur appareil réel (non testables en CI)

- **Android / Chrome** : activer les notifications (carte fidélité), passer une commande de test, vérifier
  les notifications « prête » / « en livraison » **app fermée** et le clic (ouvre le bon site).
- **iPhone** : dans Safari, la carte fidélité doit afficher « installez l'app… ». Une fois installée sur
  l'écran d'accueil, activer les notifications et refaire le test ci-dessus.
- **Admin** : activer les alertes cuisine, vérifier la notification « Nouvelle commande » tablette en veille,
  et la pastille chiffrée sur l'icône de l'app (commandes en attente).
- **Livreur hors-ligne** : mode avion pendant une course → photo de prise en charge → « envoi en attente » ;
  couper le mode avion → la photo part seule et la course affiche « Prise en charge confirmée ».
- **Paiement express** : sur iPhone (Safari) avec une carte dans Wallet, le bouton Apple Pay doit apparaître
  au-dessus du formulaire une fois le domaine enregistré (§ 3 bis). Sur Android/Chrome : Google Pay.

## 📦 Ce que le service worker met en cache

- **Précache (à la 1re visite)** : la coquille **client** seulement (`index.html`, `legal.html`, leurs JS/CSS).
- **À la 1re ouverture** : les pages admin / livreur / superadmin, leurs chunks et la sonnerie cuisine
  (`app-pages`, `app-assets`, `app-media`). Elles restent utilisables **hors-ligne ensuite** ; une tablette
  jamais connectée à l'admin ne peut pas l'ouvrir hors-ligne (la connexion exige le réseau de toute façon).
- **Runtime** : polices/icônes CDN (30 j), images Storage (7 j). Cloud Functions : jamais.
- Vérifié par `npm run test:pwa` (contenu du précache, client et admin hors-ligne).

## 🧯 En cas d'incident : service worker cassé

Symptôme : l'app ne charge plus / reste bloquée chez les utilisateurs déjà venus, même après un correctif.
La console affiche au démarrage `🏷️ Client version <commit>` : elle dit quel build tourne chez l'utilisateur.

1. **Couper le service worker partout** (sans toucher au reste du code) :
   ```bash
   nvm use 24
   npm run deploy:sw-kill
   ```
   Le SW d'urgence (`scripts/sw-kill-switch.js`) remplace `sw.js` : à la navigation suivante il vide les caches,
   se désinstalle et recharge la page une fois, depuis le réseau (testé sans boucle : `npm run test:pwa`).
2. Corriger, puis **redéployer normalement** (`npm run deploy:all`) : le SW normal se réinstalle.

À ne jamais faire : renommer `sw.js` ou retirer `Cache-Control: no-cache` sur `sw.js` (firebase.json) — les
navigateurs ne verraient plus les mises à jour du service worker.

## Tests automatisés associés

| Commande | Couvre |
|---|---|
| `npm run test:recovery` | Filet « débité sans commande » |
| `npm run test:push` | Abonnements par appareil / snack, repli legacy, nettoyage des tokens morts |
| `npm run test:pwa` | Service worker : affichage des push (arrière-plan / premier plan) + kill-switch, sur le build |
| `npm run test:rules` | Règles Firestore (dont `pushSubscriptions`, transitions livreur, lecture `users`) |
