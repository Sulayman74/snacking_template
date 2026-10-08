# Cloud Functions — deux codebases

| Dossier | Codebase (`firebase.json`) | Contenu |
|---|---|---|
| `functions/` | `default` | Tout le métier : paiement, webhooks, commandes, fidélité, push, schedules… (`index.js` = barrel des `domains/`). |
| `functions-media/` | `media` | `optimizeImage` (trigger Storage) + **sharp**. Autonome : aucun import vers `functions/`. |

**Pourquoi** : chaque instance d'une function charge tout le `index.js` de son codebase.
Avec sharp (≈ 16 Mo de binaires libvips) dans le barrel principal, `createPaymentIntent`
payait le chargement d'une lib d'images à chaque cold start. Isolé, sharp n'est installé et
chargé que par `optimizeImage`.

## Déployer

```bash
firebase deploy --only functions            # les DEUX codebases
firebase deploy --only functions:default    # métier seulement
firebase deploy --only functions:media      # optimizeImage seulement
```

### Premier déploiement après le découpage

Déployer les **deux codebases ensemble** (`--only functions`). La CLI rattache la function
`optimizeImage` déjà en prod au codebase `media` **par son nom** → mise à jour en place, pas de
suppression/recréation, pas de coupure du trigger.

À ne pas faire avant ce premier déploiement : `--only functions:default` seul. La CLI verrait
`optimizeImage` (encore étiquetée `default` en prod) absente du code et proposerait de la supprimer.

## Émulateur et CI

L'émulateur Functions charge **les deux** dossiers : `npm ci --prefix functions-media` est
requis en plus de `npm ci --prefix functions` (fait dans `.github/workflows/playwright-tests.yml`).

## Autres consommateurs de sharp

`scripts/generate-icons.mjs` (`npm run icons:generate`) charge sharp depuis `functions-media/`.
