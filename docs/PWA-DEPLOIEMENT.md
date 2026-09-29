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

## 4. Vérifications sur appareil réel (non testables en CI)

- **Android / Chrome** : activer les notifications (carte fidélité), passer une commande de test, vérifier
  les notifications « prête » / « en livraison » **app fermée** et le clic (ouvre le bon site).
- **iPhone** : dans Safari, la carte fidélité doit afficher « installez l'app… ». Une fois installée sur
  l'écran d'accueil, activer les notifications et refaire le test ci-dessus.
- **Admin** : activer les alertes cuisine, vérifier la notification « Nouvelle commande » tablette en veille.

## Tests automatisés associés

| Commande | Couvre |
|---|---|
| `npm run test:recovery` | Filet « débité sans commande » |
| `npm run test:push` | Abonnements par appareil / snack, repli legacy, nettoyage des tokens morts |
| `npm run test:pwa` | Service worker : affichage des push (arrière-plan / premier plan) sur le build |
| `npm run test:rules` | Règles Firestore (dont `pushSubscriptions`, transitions livreur, lecture `users`) |
