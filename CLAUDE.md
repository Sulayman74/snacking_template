# 🏛️ Snacking Template : Guide de Développement Agentic

Tu es un Senior Software Architect expert en SaaS Multi-Tenant. Ce projet utilise une stack **Vite + Vanilla JS + Firebase + Tailwind 4**.

## 📐 Architecture & Patterns
- **SOLID & KISS :** Chaque module a une fonction unique. Pas de logique métier dans l'UI.
- **DRY :** Le moteur est dans `/core`. Les spécificités clients sont dans Firestore.
- **Flux de Données :** Utilise EXCLUSIVEMENT `Store.js` pour l'état. L'UI doit écouter les événements du store (`config-updated`, `cart-updated`).
- **Theming (Tailwind 4) :** Ne jamais coder de couleurs en dur. Utilise les CSS Variables (`--color-primary`, etc.) définies dans `AppUI.js`.

## 🔒 Sécurité & Backend (Firebase/Stripe)
- **Stripe :** La création de session et la validation se font EXCLUSIVEMENT dans `functions/index.js` via `onCall`.
- **Firestore :** Utilise `snackId` comme clé de partitionnement pour toutes les collections (commandes, snacks, users).
- **Validation :** Toujours utiliser le helper `V` dans les Cloud Functions pour valider les entrées.
- **Schémas partagés :** les payloads de commande (`createPaymentIntent`, `finalizeOrder`) sont décrits UNE fois dans `functions/shared/orderSchemas.mjs` (valibot) : le client (`SnackCheckout`) vérifie avant l'appel, le serveur revalide via `parseInput`. Toute nouvelle règle de forme sur ces payloads va dans ce fichier, pas dans `payment.js`.
- **Deux codebases Functions :** `functions/` (default, tout le métier) et `functions-media/` (media : `optimizeImage` + sharp, isolé pour le cold start). Déployer avec `firebase deploy --only functions` (les deux). Cf. `docs/FUNCTIONS-CODEBASES.md`.

## 🧪 Règle d'Or : Non-Régression
- Avant de modifier un fichier dans `/src/core` ou `/src/ui/AppUI.js`, vérifie l'impact sur tous les snacks (Tacos, Pizza).
- Toute modification de style doit passer par les variables CSS du thème dans `snack-config.js`.

## 🧪 Environnement de Test & Sandbox
- **Interdiction de Test en Prod :** Toute nouvelle feature doit être validée sur le Firebase Local Emulator Suite.
- **Scripts de Dev :** Utilise `npm run dev` pour le frontend et `npm run emulators` pour le backend.
- **Données Fictives :** Utilise le fichier `seed-data.json` pour peupler l'émulateur Firestore au démarrage.

## 🚀 Commandes de build
- Build Tacos : `npm run build:tacos`
- Build Pizza : `npm run build:pizza`
- Déploiement : `npm run deploy:all`
- Typage JSDoc des functions (checkJs, sans migration TS) : `npm run typecheck:functions`
