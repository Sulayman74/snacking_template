---
name: multi-tenant-deployer
description: Automatise l'ajout d'un nouveau client (scripts package.json, cibles firebase.json, entrée snacks-seo.json) sans toucher au code applicatif.
---

# Rôle
Onboarder un nouveau snack dans l'écosystème **multi-tenant** : ajouter le script de build (`build:<snack>`), la cible Firebase Hosting, l'entrée SEO/PWA, sans aucune modification du code dans `/src/core` ni `AppUI.js`.

> Note : un skill complémentaire `onboard-new-snack` (dans `.claude/skills/`) couvre la collecte d'inputs (nom/logo/palette). Ce skill-ci se concentre sur l'**orchestration des fichiers de config**.

## Context Awareness — fichiers à analyser
- `package.json` → section `scripts` :
  - Convention existante : `"build:<key>": "SNACK_ID=<firestoreDocId> vite build"` (ex : `build:tacos`, `build:pizza`).
  - Convention déploiement : `"deploy:<key>": "npm run build:<key> && firebase deploy --only hosting:<target>"`.
- `firebase.json` → tableau `hosting` :
  - Chaque entrée : `target`, `public: dist/<snackId>`, `rewrites SPA → /index.html`.
  - Exemples : `snacking-template`, `o-bois-pizza`, `pizzeriadelagare`.
- `.firebaserc` → mapping `target → site Firebase`.
- `snacks-seo.json` → entrée par `snackId` avec `title`, `desc`, `canonicalUrl`, `logoUrl`, `iconUrl`, `heroUrl`, `theme_color`, `shadowClass`.
- `vite.config.js` → utilise `process.env.SNACK_ID` pour générer dans `dist/<SNACK_ID>`.

## Step-by-Step Actions
1. **Collecter** auprès de l'utilisateur (cf. `onboard-new-snack` si présent) :
   - `snackKey` (ex : `burger-house`) — slug court pour les scripts npm.
   - `snackId` — Firestore doc ID (≈ 20 chars Firestore).
   - `hostingTarget` — slug du site Firebase (ex : `burger-house`).
   - `siteName` Firebase (`<target>.web.app`).
2. **Vérifier l'unicité** :
   - `grep` `snackKey`, `snackId`, `hostingTarget` dans `package.json`, `firebase.json`, `.firebaserc`, `snacks-seo.json`.
   - Si déjà présent → STOP, demander confirmation/renommage.
3. **Vérifier l'existence du snack en Firestore** :
   - Le doc `snacks/{snackId}` DOIT exister (sinon le build n'a pas de config à charger).
4. **Mettre à jour `package.json`** :
   ```json
   "build:<snackKey>":  "SNACK_ID=<snackId> vite build",
   "deploy:<snackKey>": "npm run build:<snackKey> && firebase deploy --only hosting:<hostingTarget>"
   ```
   Ajouter aussi `<snackKey>` dans `build:all` et `deploy:all`.
5. **Mettre à jour `firebase.json`** : ajouter une entrée `hosting` :
   ```json
   {
     "target": "<hostingTarget>",
     "public": "dist/<snackId>",
     "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
     "rewrites": [{ "source": "**", "destination": "/index.html" }]
   }
   ```
6. **Mettre à jour `.firebaserc`** : `firebase target:apply hosting <hostingTarget> <siteName>`.
7. **Mettre à jour `snacks-seo.json`** : ajouter l'objet sous la clé `<snackId>` (champs : `title`, `desc`, `canonicalUrl`, `logoUrl`, `iconUrl`, `heroUrl`, `theme_color`, `shadowClass`).
8. **Validation** :
   - `npm run build:<snackKey>` → vérifier que `dist/<snackId>/` est généré.
   - Lancer `firebase emulators:start --only hosting` et vérifier le rendu.
9. **Ne PAS déployer** sans validation explicite de l'utilisateur.

## Safety & Patterns
- **SOLID** : ce skill ne touche QUE les fichiers de configuration. Aucune modif dans `/src` ni `/functions`.
- **KISS** : la spécificité d'un snack vit dans Firestore (`snacks/{snackId}`), pas dans le code.
- **DRY** : suivre strictement les conventions de nommage existantes (`build:<key>`, `dist/<snackId>`, hosting target en slug).
- **Sécurité** :
  - Ne JAMAIS commit de clé API ni token dans `firebase.json` ou `package.json`.
  - Vérifier `.firebaserc` n'expose pas de project ID interdit.
- **Tests** : émulateur Hosting + build local AVANT tout `firebase deploy`. Le déploiement effectif reste une action manuelle de l'utilisateur.
