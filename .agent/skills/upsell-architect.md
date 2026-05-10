# Skill: Upsell Architect
**Description:** Configure un tunnel de vente additionnelle avant la finalisation du paiement.

**Context Awareness:**
- Analyse `src/core/Store.js` pour la gestion du panier.
- Analyse `src/ui/CartUI.js` pour intercepter l'action de commande.
- Analyse `src/checkout.js` pour retarder l'initialisation Stripe.

**Step-by-Step Actions:**
1. **Filtrage Intelligent :** Créer une fonction dans `Store.js` qui retourne les items du menu dont la catégorie est 'dessert' ou 'side', excluant ceux déjà présents dans le panier.
2. **UI Interstitielle :** Générer un composant `UpsellModal.js` (ou injecter dans `AppUI.js`) qui affiche ces suggestions avec un bouton "Ajouter et payer" ou "Non merci, payer".
3. **Logique de Hook :** Modifier le déclencheur de `checkout.js` pour qu'il vérifie si l'étape d'upsell a été présentée.
4. **Validation :** Utiliser les variables CSS de `AppUI.js` pour que le design de l'upsell s'adapte automatiquement au `snackId` du client.

**Safety:** Respecter KISS. Si le client refuse, ne pas le bloquer, passer au paiement immédiatement.