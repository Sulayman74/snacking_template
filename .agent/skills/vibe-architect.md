---
name: vibe-architect
description: Transforme l'identité visuelle d'un snack via les CSS Variables et le dictionnaire SAAS_THEMES (theming sans toucher au code métier).
---

# Skill : Vibe Architect

## Rôle
Modifier l'identité visuelle (couleurs, ombres, accents) d'un snack **sans coder de couleur en dur**. Tout passe par le dictionnaire `SAAS_THEMES` et les CSS Variables injectées dans `:root`.

## Context Awareness — fichiers à analyser
- `src/snack-config.js` → contient `SAAS_THEMES` (palettes : `ruby`, `ocean`, `forest`, `midnight`, `sunflower`) et la fonction de résolution `paletteKey`.
- `src/ui/AppUI.js` → contient `applyTheme(config)` qui injecte les variables CSS dans `:root`.
- `src/ui.js` → bootstrap `appUI.applyTheme(store.state.config)` via l'event `config-updated`.
- `src/core/Store.js` → écoute `config-updated` pour propager le thème.
- `snacks-seo.json` → `theme_color` et `shadowClass` par snack (utilisés pour le manifest PWA et l'ombre globale).

## Step-by-Step Actions
1. **Lire la config courante** depuis Firestore (`snacks/{snackId}.theme`) ou `snack-config.js` selon le mode (prod / dev).
2. **Choisir une palette** parmi les clés de `SAAS_THEMES`. Si la palette demandée n'existe pas → l'ajouter au dictionnaire avec ses HEX (`primary`, `secondary`, `accent`, `surface`, `text`).
3. **Injecter les HEX dans `:root`** via `AppUI.applyTheme()` :
   - `--color-primary`, `--color-secondary`, `--color-accent`, `--color-surface`, `--color-text`
   - Ne JAMAIS écrire de `style="color:#..."` ou de classe Tailwind avec couleur littérale.
4. **Synchroniser `snacks-seo.json`** : mettre à jour `theme_color` (manifest PWA) et `shadowClass` cohérents avec la palette.
5. **Émettre l'événement `config-updated`** sur `Store.js` pour forcer un re-render de l'UI sans reload.
6. **Vérification visuelle** : lancer `npm run dev`, ouvrir le snack ciblé, contrôler header/CTA/cart/modale.

## Safety & Patterns
- **SOLID** : ce skill ne touche QUE le theming. Pas de logique métier, pas de Firestore en dehors de la lecture/écriture du `theme`.
- **KISS** : si une couleur change, on modifie une seule entrée dans `SAAS_THEMES`. Pas d'override CSS ad-hoc.
- **Tailwind 4** : utiliser uniquement les variables CSS exposées (`--color-*`). Les classes utilitaires Tailwind doivent référencer ces variables (`bg-[var(--color-primary)]`).
- **Tests** : valider sur le **Firebase Local Emulator Suite** (`npm run emulators` + `npm run dev`) avant tout déploiement.
- **Non-régression** : avant modif d'`AppUI.js`, vérifier l'impact sur tous les snacks (Tacos, Pizza, Pizzeria de la Gare).
