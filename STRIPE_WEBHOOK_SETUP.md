# 🚀 Guide de Configuration : Webhook Stripe (SaaS Billing)

Ce document explique comment activer le Webhook Stripe qui s'occupe de **suspendre automatiquement les restaurants qui ne paient plus leur abonnement SaaS**.

> **Note :** Cette étape est **facultative** pour le lancement. Si le Webhook n'est pas configuré, le système fonctionnera parfaitement. La seule différence est que vous devrez mettre en maintenance manuellement les mauvais payeurs depuis votre interface SuperAdmin.

---

## Étape 1 : Déployer la Cloud Function

Assurez-vous que votre fonction `stripeWebhook` est en ligne sur les serveurs de Google (Firebase).

1. Ouvrez votre terminal à la racine du projet.
2. Lancez la commande suivante :
   ```bash
   firebase deploy --only functions:stripeWebhook
   ```
3. Une fois déployée, Firebase vous donnera une **URL (Trigger URL)**. Elle ressemble à ceci :
   `https://europe-west9-votre-projet.cloudfunctions.net/stripeWebhook`
   *Copiez cette URL.*

---

## Étape 2 : Configurer Stripe

1. Connectez-vous à votre [Dashboard Stripe](https://dashboard.stripe.com/).
2. En haut à droite, activez le **Mode Test** (si vous testez) ou restez en mode Live.
3. Allez dans **Développeurs > Webhooks**.
4. Cliquez sur le bouton **Ajouter un endpoint**.
5. Collez l'**URL** obtenue à l'Étape 1 dans le champ "URL de l'endpoint".
6. Cliquez sur **Sélectionner des événements** et cochez ces événements :
   - `invoice.payment_failed` (Quand un prélèvement échoue)
   - `invoice.payment_succeeded` (Quand une facture est payée/régularisée)
   - `customer.subscription.deleted` (Quand l'abonnement est annulé)
   - `checkout.session.completed` (Souscription d'un abonnement SaaS par un resto)
   - `account.updated` (Statut d'onboarding Stripe Connect du compte connecté)
   - `charge.refunded` (Remboursement — réconcilie le bloc `refund` de la commande, **LOT B**)
7. Cliquez sur **Ajouter l'endpoint**.

> ### ⚠️ Comptes connectés (Stripe Connect) — requis pour `charge.refunded` et `account.updated`
> En **charge directe**, les paiements et remboursements vivent sur le **compte connecté** du resto. Pour que `charge.refunded` (remboursement fait depuis le dashboard, hors app) et `account.updated` parviennent à ce webhook, l'endpoint doit écouter les **événements sur les comptes connectés** :
> - Soit cochez **« Écouter les événements sur les comptes connectés »** à la création de l'endpoint,
> - Soit créez un endpoint **Connect** dédié pointant sur la même URL.
>
> Sans cela, un remboursement initié depuis le dashboard Stripe ne sera **pas** réconcilié automatiquement (le bloc `refund` de la commande resterait à 0). Les remboursements faits **via l'app** (`refundOrder`) sont, eux, toujours tracés directement.

---

## Étape 3 : Récupérer le Secret Webhook

Une fois l'endpoint créé sur Stripe, vous arriverez sur la page de votre Webhook.

1. Cherchez la section **Secret de signature** (Signing secret) et cliquez sur *Révéler*.
2. Copiez cette clé qui commence par `whsec_...`
3. Retournez dans votre terminal pour enregistrer ce secret de façon sécurisée dans Firebase :

   ```bash
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   ```
   *(Collez la clé `whsec_...` quand on vous le demande, puis appuyez sur Entrée)*

4. Redéployez votre fonction pour qu'elle prenne en compte ce secret :
   ```bash
   firebase deploy --only functions:stripeWebhook
   ```

---

## C'est terminé ! 🎉

Désormais, si un locataire a un `Stripe Subscription ID` configuré dans votre SuperAdmin, et que son prélèvement mensuel Stripe échoue, le Webhook mettra instantanément son site en **Mode Maintenance**. S'il régularise sa situation en payant la facture, le Webhook le remettra en ligne.
