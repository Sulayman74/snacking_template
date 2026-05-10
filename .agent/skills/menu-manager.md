---
name: menu-manager
description: Extrait les données de menus (PDF/Images) et peuple Firestore en optimisant les images via Sharp dans les Cloud Functions.
---

# Rôle
Automatiser l'ingestion d'un menu (PDF, photo, scan) → catégories + produits Firestore + images optimisées (WebP via Sharp), partitionnés par `snackId`.

## Context Awareness — fichiers à analyser
- `functions/index.js` → contient déjà l'usage de `sharp` (l. ~211) pour la transformation d'images uploadées.
- `src/menu.js` + `src/admin-products.js` + `src/ui/AdminProductsUI.js` → modèle de données produit attendu côté front.
- `src/admin-csv.js` → format CSV existant (utile comme fallback d'import).
- Firestore collections cibles (toutes partitionnées par `snackId`) :
  - `snacks/{snackId}/categories/{categoryId}`
  - `snacks/{snackId}/products/{productId}`
- Storage : `produits/{snackId}/{productId}.webp`

## Step-by-Step Actions
1. **Réception du fichier** (PDF ou image) via `onCall` `importMenu` :
   - Valider avec le helper `V` : `snackId` non vide, `fileBase64` ≤ 10 Mo, `mime` autorisé (`application/pdf`, `image/png`, `image/jpeg`).
2. **Extraction du contenu** :
   - PDF → utiliser un OCR/parser (texte structuré) pour repérer titres de catégories, libellés produits, prix.
   - Image → OCR direct.
   - Produire un tableau `[{ category, name, description, price, imageRef? }]`.
3. **Normalisation** :
   - Prix en centimes (entier).
   - Slugs en kebab-case.
   - `snackId` injecté sur chaque doc (clé de partitionnement obligatoire).
4. **Optimisation images via Sharp** (réutiliser le pattern existant ligne ~211) :
   - Resize max 1024px côté long, conversion WebP qualité 80.
   - Upload dans `produits/{snackId}/{productId}.webp`.
   - Stocker l'URL publique dans le doc Firestore.
5. **Écriture batchée Firestore** :
   - Utiliser un `WriteBatch` (max 500 ops) pour catégories + produits.
   - Si > 500 ops → découper en plusieurs batches.
6. **Retour client** : `{ imported: N, skipped: M, errors: [...] }` pour permettre une UI de revue dans l'admin.

## Safety & Patterns
- **SOLID** : un module ingestion (parsing), un module storage (sharp + upload), un module persistence (Firestore). Pas de mélange.
- **KISS** : pas d'IA/heuristique opaque pour l'OCR — préférer un parser explicite, retourner les ambiguïtés à l'admin pour validation manuelle.
- **DRY** : réutiliser les helpers existants (`callerKey`, validation `V`, pattern Sharp déjà en place ligne ~211).
- **Sécurité** :
  - Vérifier que l'utilisateur appelant a le rôle `admin` du `snackId` ciblé.
  - Refuser tout import si `snackId` n'existe pas dans `snacks/`.
  - Ne JAMAIS écrire dans une collection non préfixée par `snackId`.
- **Tests** : émulateur Firestore + Storage (`firebase emulators:start --only firestore,storage,functions`) + jeu de PDF de test dans `tests/fixtures/menus/`.
