# ✅ Checklist — Livraison native, PoD, PWA & Notifications

Parcours de validation après déploiement. Coche au fur et à mesure.

## 0. Pré-requis (config, une fois)
- [ ] **Admin → Configuration → Livraison** : `Activer la livraison` ✓, `Rayon`, `Frais`, `Commande min`, `Vitesse`, `Prépa de base`, et **Position du restaurant** (bouton « Utiliser ma position actuelle » depuis le resto).
- [ ] (Optionnel) `enableClickAndCollect` activé si tu veux aussi l'emporter (sinon livraison seule).
- [ ] **Admin → Livreurs** : créer au moins 1 compte livreur (nom, email, mot de passe).

## 1. Déploiement
```bash
# Backend (functions + sécurité)
firebase deploy --only functions,firestore:rules,firestore:indexes,storage
# Front (par snack)
npm run build:tacos && firebase deploy --only hosting:snacking-template
```
- [ ] Les 3 nouvelles CF sont déployées : `createDriver`, `notifyAdminsOnNewOrder`, `onDriverPositionUpdate` (+ `finalizeOrder`/`onOrderStatusChange` à jour).
- [ ] Règles Firestore + Storage déployées sans erreur.

## 2. Client — commande (non-régression + livraison)
- [ ] **Collect** (si activé) : commander comme avant → suivi `en cuisine` → `prête` → `terminée`. **Rien de cassé.**
- [ ] CTA principal = **« Commander »** (ouvre le panier) dès que collect OU livraison est actif.
- [ ] **Livraison** : toggle Emporter/Livraison (ou mode livraison forcé si livraison seule).
- [ ] **Me localiser** (autoriser la géoloc) → distance + frais + ETA affichés ; total panier = articles + frais.
- [ ] **Hors zone** (adresse trop loin) → message « hors zone », checkout bloqué.
- [ ] **Panier minimum** non atteint → message, checkout bloqué.
- [ ] Paiement Stripe OK → commande créée en `nouvelle` (livraison démarre en cuisine).

## 3. Cuisine (admin)
- [ ] Le ticket livraison affiche le **badge Livraison + adresse + distance**.
- [ ] **Push « 🛎️ Nouvelle commande »** reçu (après avoir activé les alertes admin) — même app en arrière-plan.
- [ ] « MARQUER PRÊTE » → statut `prête`.

## 4. Livreur (`/livreur.html`)
- [ ] Login livreur OK ; **carte « Activer mon espace »** (Notifications + Localisation) avec états corrects.
- [ ] **Modale « Comment ça marche »** au 1er login (et via le bouton `?`).
- [ ] La course `prête` apparaît dans **« Courses à récupérer »** → **Prendre la course** → passe en livraison.
- [ ] **Étape 1 — Photo prise en charge** : caméra → **aperçu** → Reprendre / Envoyer. Bouton passe en « confirmée » (grisé).
- [ ] **Bouton « J'ai livré » verrouillé** tant que loin du client → *« Rapprochez-vous (X m) »* ; se débloque à < 200 m.
- [ ] GPS refusé → bouton bloqué avec *« Activez la localisation »*.
- [ ] **Étape 2 — Photo de dépôt** → aperçu → Envoyer → statut `livrée`, suivi GPS stoppé.

## 5. Notifications distance (géofencing)
- [ ] Pendant le trajet, le **client** reçoit les paliers : ~3 km, ~1 km, ~300 m (une fois chacun).
- [ ] Le client reçoit aussi : `en route` (prise en charge) et `livré`.

## 6. Suivi client (livraison)
- [ ] `en cuisine` → ETA « prêt/livraison estimé vers HH:MM ».
- [ ] `en livraison` → **distance live** du livreur + nom.
- [ ] `livrée` → écran de fin + **photo de preuve cliquable** (agrandir).

## 7. Admin — journal des livraisons
- [ ] **Admin → Livreurs → « Livraisons récentes »** : cartes avec vignettes **Prise en charge + Dépôt**, statut, horodatage.
- [ ] Clic vignette → **lightbox** plein écran.

## 8. PWA (install + update)
- [ ] **Install** depuis `/admin.html` → icône **toque « Cuisine »** (plein bord), ouvre `/admin.html`.
- [ ] **Install** depuis `/livreur.html` → icône **scooter « Livreur »** (plein bord), ouvre `/livreur.html`.
- [ ] Bandeau **« Installer l'app »** (Android) / instructions Partager (iOS).
- [ ] Nouvelle version déployée → **bandeau « Rafraîchir »** (pas de reload auto). Clic → met à jour.

## ⚠️ Rappels iOS
- Push web : **uniquement PWA installée + iOS ≥ 16.4**.
- Pas de géoloc en arrière-plan → garder l'app livreur au premier plan (Wake Lock actif).
- Icône d'accueil iOS en cache : supprimer l'ancienne avant de réinstaller pour voir la nouvelle.

## Points de vigilance
- Proximité « J'ai livré » fiable si le client a fait **Me localiser** (GPS) ; adresse tapée = géocodage ville (moins précis) → ajuster `DELIVERY_PROXIMITY_M` si besoin.
- Storage : l'upload PoD marche dès que les règles autorisent l'écriture image (déjà le cas).
