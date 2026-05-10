---
name: quality-tester
description: Lance les Firebase Emulators et exécute la suite Playwright (cart, commande, radar, stock) avant tout déploiement.
---

# Rôle
Garantir la non-régression avant chaque déploiement : démarrer la **Firebase Local Emulator Suite**, lancer les tests **Playwright** (`tests/*.spec.js`), et bloquer le pipeline si un seul test échoue.

## Context Awareness — fichiers à analyser
- `playwright.config.js` → configuration Playwright (baseURL, browsers, retries).
- `tests/cart.spec.js` → flux panier.
- `tests/commande.spec.js` → flux commande complète (jusqu'au paiement test).
- `tests/radar.spec.js` → écran admin / radar de commandes.
- `tests/stock.spec.js` → gestion de stock.
- `firebase.json` → présence de `functions` et `hosting` (les émulateurs Firestore/Auth/Storage doivent être démarrés en complément).
- `package.json` → ajouter (si absent) :
  - `"emulators": "firebase emulators:start --only auth,firestore,functions,hosting,storage"`
  - `"test:e2e": "playwright test"`

## Step-by-Step Actions
1. **Vérifier les pré-requis** :
   - `firebase-tools` installé (`firebase --version`).
   - `npx playwright install` (binaires browsers).
   - Une cible de build par snack à tester (`npm run build:<key>` exécuté au préalable).
2. **Démarrer les émulateurs** en background :
   ```
   npm run emulators
   ```
   Attendre que les ports soient up (Firestore: 8080, Auth: 9099, Functions: 5001, Hosting: 5000, Storage: 9199).
3. **Seeder les émulateurs** (optionnel) avec `seed-data.json` si présent (cf. CLAUDE.md > Sandbox).
4. **Lancer Playwright** :
   ```
   npm run test:e2e
   ```
   Ordre recommandé : `cart` → `commande` → `stock` → `radar` (du plus simple au plus impactant).
5. **Analyse du rapport** :
   - Lire `playwright-report/index.html`.
   - Pour chaque échec, capturer screenshot + trace, et **STOP** : ne JAMAIS proposer un déploiement si un test échoue.
6. **Nettoyage** : arrêter les émulateurs, vider `test-results/` si succès complet.
7. **Décision** :
   - 100% pass → autoriser l'utilisateur à lancer `npm run deploy:<snack>` manuellement.
   - ≥ 1 échec → renvoyer un résumé synthétique + suggestion de fix (ne pas tenter de fix automatique sans accord).

## Safety & Patterns
- **SOLID** : ce skill ne modifie PAS le code applicatif — il ne fait que lancer/observer.
- **KISS** : un seul rapport, une seule décision (pass/fail).
- **Pas de prod en test** :
  - JAMAIS pointer Playwright vers `*.web.app` (prod).
  - Toujours `baseURL = http://localhost:5000` (Hosting emulator).
  - Les Cloud Functions appelées via `httpsCallable` doivent passer par l'émulateur (`useFunctionsEmulator`).
- **Sécurité** :
  - Ne JAMAIS utiliser de vraie clé Stripe en test → utiliser `pk_test_*` + `stripe-mock` ou `stripe listen`.
  - Aucune écriture sur Firestore prod pendant les tests.
- **CI** : le skill doit être exécutable en headless (`PLAYWRIGHT_HEADLESS=1`) pour intégration GitHub Actions.
