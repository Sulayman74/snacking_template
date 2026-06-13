# 🎨 Personnaliser un snack (couleurs & police)

Guide pratique pour habiller un restaurant : **couleurs** (palette) et **police** (font).
Tout repose sur un principe **double-source** :

| Source | Rôle | Quand elle agit |
|---|---|---|
| **Firestore** `snacks/{snackId}` | Vérité **runtime**, éditable à chaud (admin) | Au chargement de l'app, sans rebuild |
| **`snacks-seo.json`** (repo) | Miroir **build-time** | Injecté dès le 1er octet du HTML → zéro flash (FOUT/mauvaise couleur) |

👉 Pour un rendu **parfait et stable**, on renseigne **les deux** avec la même valeur.
Le build seul suffit déjà à afficher le bon thème ; Firestore sert d'override live.

---

## 1. Personnaliser un snack **existant**

### A. Couleur — champ `colorPalette`
Dans Firestore, document `snacks/{snackId}`, champ `colorPalette` (string) = une clé du catalogue.

Palettes disponibles (définies dans [`src/snack-config.js`](../src/snack-config.js) → `SAAS_THEMES`) :

| `colorPalette` | primary (`theme_color`) | light (`lightHex`) | Ambiance |
|---|---|---|---|
| `ruby`      | `#dc2626` | `#fee2e2` | Rouge vif |
| `ocean`     | `#0077b6` | `#caf0f8` | Bleu lagon |
| `forest`    | `#16a34a` | `#dcfce7` | Vert |
| `midnight`  | `#4c1d95` | `#f3e9ff` | Violet profond |
| `sunflower` | `#eab308` | `#fef9c3` | Jaune (texte foncé) |
| `belly`     | `#0A1B3F` | `#C8D8E9` | Navy + or |

Puis, dans [`snacks-seo.json`](../snacks-seo.json), sur le bon `snackId`, aligne **3 champs** (anti-flash) :
```json
"theme_color": "#16a34a",
"colorPalette": "forest",
"lightHex": "#dcfce7"
```
(`theme_color` = la colonne *primary*, `lightHex` = la colonne *light* du tableau ci-dessus.)

### B. Police — champ `fontKey`
Dans Firestore, `snacks/{snackId}`, champ `fontKey` (string) = une clé du catalogue.

Polices disponibles (définies dans [`src/theme-fonts.js`](../src/theme-fonts.js) → `SAAS_FONTS`) :

| `fontKey` | Famille | Style |
|---|---|---|
| `system`       | police système | défaut, 0 octet réseau |
| `poppins`      | Poppins | géométrique arrondie |
| `inter`        | Inter | grotesque neutre |
| `montserrat`   | Montserrat | géométrique large, premium |
| `spacegrotesk` | Space Grotesk | caractère marqué |
| `outfit`       | Outfit | sans serré, moderne |

Puis, dans `snacks-seo.json`, sur le même `snackId`, ajoute :
```json
"fontKey": "poppins"
```

### C. Déployer
```bash
npm run deploy:tacos     # ou :pizza / :pizzeria / :belly / deploy:all
```
> Les noms de scripts ↔ snackId sont dans [`package.json`](../package.json).

### D. Voir le résultat (⚠️ cache PWA)
L'app est une PWA avec Service Worker (`registerType: 'prompt'`) : l'ancienne version
cachée peut masquer le changement. Pour forcer :
- **Hard refresh** `Cmd+Shift+R`, ou
- **Navigation privée** / autre navigateur (le plus fiable : aucun SW installé), ou
- DevTools → Application → Service Workers → *Unregister* + *Clear storage*.

> 💡 Les polices se voient surtout sur les **gros titres** (héros, nom du resto).

---

## 2. Créer un snack **from scratch** (nouveau tenant)

Récap des points à brancher (≈ 6 étapes) :

1. **Firestore** — crée le document `snacks/{nouvelId}` avec au minimum :
   ```
   nom, colorPalette, fontKey, enableOnlineOrder, enableClickAndCollect,
   enableDelivery, enableLoyaltyCard, maintenanceMode, hours, ...
   ```
   (voir le seed [`functions/seed-emulator.js`](../functions/seed-emulator.js) pour la forme exacte d'un doc snack.)

2. **`snacks-seo.json`** — ajoute une entrée `"{nouvelId}": { ... }` :
   ```json
   "MON_NOUVEAU_SNACK_ID": {
     "title": "Mon Resto | Click & Collect",
     "desc": "Description SEO du menu digital…",
     "canonicalUrl": "https://mon-resto.web.app",
     "logoUrl": "https://…/logo.webp",
     "iconUrl": "https://…/icon.webp",
     "heroUrl": "https://…/hero.webp",
     "theme_color": "#16a34a",
     "colorPalette": "forest",
     "lightHex": "#dcfce7",
     "fontKey": "poppins",
     "shadowClass": "shadow-green-600/40"
   }
   ```

3. **`package.json`** — ajoute les scripts build/deploy du tenant :
   ```jsonc
   "build:monresto":  "SNACK_ID=MON_NOUVEAU_SNACK_ID vite build",
   "deploy:monresto": "npm run build:monresto && firebase deploy --only hosting:mon-resto",
   ```
   et pense à l'ajouter à `build:all` / `deploy:all`.

4. **Firebase Hosting** — crée le site et mappe la cible :
   ```bash
   firebase hosting:sites:create mon-resto
   firebase target:apply hosting mon-resto mon-resto
   ```

5. **`firebase.json`** — ajoute le bloc hosting (le `public` doit pointer vers `dist/{snackId}`) :
   ```jsonc
   {
     "target": "mon-resto",
     "public": "dist/MON_NOUVEAU_SNACK_ID",
     "ignore": ["firebase.json", "**/.*", "**/node_modules/**"]
   }
   ```

6. **Déploie** : `npm run deploy:monresto`.

---

## 3. Ajouter une **nouvelle police** au catalogue

Une seule modif, dans [`src/theme-fonts.js`](../src/theme-fonts.js) → `SAAS_FONTS` :
```js
montserrat: {
  body:    "'Montserrat', ui-sans-serif, system-ui, sans-serif",
  display: "'Montserrat', ui-sans-serif, system-ui, sans-serif",
  href:    "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap",
},
```
Ce module est partagé **runtime + build** (DRY) : `fontKey: "montserrat"` devient utilisable partout.

**Règles perf (CLAUDE.md §8.1)** :
- `&display=swap` **obligatoire** dans l'`href` (texte visible tout de suite, pas de FOIT).
- **1 famille, 2 graisses max** (ex: `wght@400;600`) — sinon le poids réseau explose.
- `display: null` → les titres héritent de `body`.

---

## 4. Ajouter une **nouvelle palette** de couleurs

Dans [`src/snack-config.js`](../src/snack-config.js) → `SAAS_THEMES` :
```js
"sunset": { primaryHex: "#ea580c", accentHex: "#f97316", lightHex: "#ffedd5", onPrimaryHex: "#ffffff" },
```
- `primaryHex` : couleur principale (boutons, accents forts).
- `accentHex` : couleur secondaire.
- `lightHex` : **base claire** (fond de page) — choisis une teinte très pâle de la primary.
- `onPrimaryHex` : couleur du **texte posé sur la primary** (blanc, ou foncé si primary claire — cf. `sunflower`).

> ⚠️ **Contraste (WCAG AA)** : si la primary est claire, mets `onPrimaryHex` foncé (`#111827`)
> et revérifie la lisibilité.

Puis renseigne `colorPalette` (+ `theme_color`/`lightHex` dans `snacks-seo.json`) comme au §1.A.

---

## 5. Sous le capot (pour comprendre)

- **Tokens CSS** (`src/styles.css` → `@theme`) : `--color-primary`, `--color-accent`,
  `--color-primary-light`, `--color-on-primary`, `--font-body`, `--font-display`.
  Tailwind v4 en génère les utilitaires (`bg-primary`, `text-accent`, `font-body`…).
- **Build** (`vite.config.js` → `transformIndexHtml`) : lit `snacks-seo.json` et injecte,
  dès le `<head>`, les variables (`--color-*`, `--font-*`) + le `<link>` de police
  (`display=swap`). → bon thème/police **au 1er paint**, sans flash.
- **Runtime** (`src/ui/AppUI.js` → `applyTheme`) : lit la config Firestore et **surcharge**
  les variables. La police n'est surchargée **que si Firestore a un `fontKey` explicite**
  (sinon on garde la valeur du build → zéro clobber).
- **Résolution** (`src/snack-config.js`) : `data.colorPalette` → `SAAS_THEMES`,
  `data.fontKey` → `resolveFont()` ; exposés dans `config.theme.colors` / `config.theme.fonts`.

---

### TL;DR
> Snack existant : pose `colorPalette` + `fontKey` dans **Firestore** ET dans **`snacks-seo.json`**
> (avec `theme_color`/`lightHex`), puis `npm run deploy:<snack>`, puis **hard refresh / nav privée**.
