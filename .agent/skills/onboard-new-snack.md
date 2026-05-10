---
name: onboard-new-snack
description: Créer un nouveau snack dans l'écosystème Snacking Template sans coder (config build, SEO, Firebase Hosting target).
---

# Skill : Onboarding d'un nouveau snack

## But
Créer un nouveau snack dans l'écosystème **sans coder**, en se contentant d'orchestrer les fichiers de configuration existants.

## Pré-requis à demander à l'utilisateur
Avant toute action, demander explicitement :
1. **Nom du snack** (ex : `burger-house`, slug en kebab-case sans espace)
2. **Logo** (chemin relatif ou URL, à placer dans `/public/logos/`)
3. **Palette de couleurs** — choisir UNE option parmi :
   - `ruby` (rouge intense)
   - `ocean` (bleu profond)
   - `forest` (vert nature)
   - `midnight` (noir/violet sombre)
   - `sunflower` (jaune chaleureux)

Si une de ces informations manque, **stopper** et la demander avant de continuer.

## Étapes d'exécution

### 1. Ajouter le script de build dans `package.json`
Ajouter dans la section `"scripts"` :
```json
"build:<snackId>": "vite build --mode <snackId>"
```
Vérifier qu'il n'écrase pas un script existant.

### 2. Créer l'entrée SEO dans `snacks-seo.json`
Ajouter un objet pour le snack avec :
- `id` : le slug
- `name` : nom commercial
- `description` : phrase SEO (≤ 160 caractères)
- `logo` : chemin du logo
- `palette` : la palette choisie
- `url` : URL de production attendue

### 3. Ajouter une cible Firebase Hosting dans `firebase.json`
- Ajouter une nouvelle entrée dans le tableau `hosting` avec `target: "<snackId>"`
- Pointer `public` vers `dist/<snackId>`
- Conserver les `rewrites` standard (SPA → `/index.html`)
- Rappeler à l'utilisateur de lancer : `firebase target:apply hosting <snackId> <projectId>`

### 4. Vérifications finales
- Le `snackId` doit être unique dans tous les fichiers touchés
- Lancer `npm run build:<snackId>` pour valider que la config est correcte
- Ne PAS commit ni déployer sans validation explicite de l'utilisateur

## Règles strictes
- **Ne jamais modifier** `/src/core` ni `AppUI.js` pour onboarder un snack — toute la spécificité passe par la config et Firestore.
- **Ne jamais coder de couleur en dur** : utiliser uniquement les variables CSS de la palette choisie.
- Si l'utilisateur demande une palette qui n'est pas dans la liste, refuser et proposer les 5 options.
