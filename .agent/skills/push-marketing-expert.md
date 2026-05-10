---
name: push-marketing-expert
description: Conçoit et orchestre des campagnes de notifications push ciblées (actifs/inactifs/VIP) via processPushCampaigns.
---

# Rôle
Définir, segmenter et déclencher des campagnes de **push notifications** (FCM) basées sur le comportement client (panier abandonné, inactif 30j, VIP, fidélité), via la Cloud Function planifiée `processPushCampaigns`.

## Context Awareness — fichiers à analyser
- `functions/index.js` → `exports.processPushCampaigns = onSchedule(...)` (l. ~262) : job planifié déjà en place.
- `src/admin-marketing.js` + `src/ui/AdminMarketingUI.js` → UI admin pour créer/lister les campagnes.
- `src/loyalty.js` → critères de fidélité (points, paliers VIP).
- `src/tracking.js` → événements de comportement (last_seen, last_order, cart_abandoned_at).
- `src/pwa.js` → enregistrement du token FCM côté client (`fcmToken`).
- Firestore collections (toutes partitionnées par `snackId`) :
  - `snacks/{snackId}/campaigns/{campaignId}` — définition de campagne.
  - `snacks/{snackId}/users/{uid}` — profil + `fcmToken` + `lastSeenAt`, `lastOrderAt`.
  - `snacks/{snackId}/campaigns/{campaignId}/runs/{runId}` — historique d'exécution.

## Step-by-Step Actions
1. **Définir le schéma d'une campagne** (`snacks/{snackId}/campaigns/{campaignId}`) :
   ```
   { name, segment, title, body, deepLink?, scheduleCron?, status: 'draft'|'active'|'paused',
     createdBy, createdAt, lastRunAt?, stats: { sent, delivered, opened } }
   ```
2. **Définir les segments** (DRY — calculés depuis `users` collection) :
   - `actifs` : `lastOrderAt` < 30 jours.
   - `inactifs_30j` : `lastSeenAt` ≥ 30j ET `lastOrderAt` ≥ 30j.
   - `cart_abandoned` : `cart_abandoned_at` < 24h ET pas de commande depuis.
   - `vip` : palier loyalty top 10% (cf. `src/loyalty.js`).
   - `nouveaux` : `createdAt` ≤ 7j ET 0 commande.
3. **Création UI admin** (cf. `AdminMarketingUI.js`) :
   - Form : nom, segment, titre, body, deeplink, planning.
   - Preview de l'audience (`count` calculé via une query Firestore avant validation).
   - Bouton "Test sur moi" → envoi au seul `fcmToken` de l'admin courant.
4. **Exécution dans `processPushCampaigns`** :
   - Pour chaque snack actif → pour chaque campagne `status: active` due :
     a. Calculer le segment (query partitionnée par `snackId`).
     b. Découper en batches de 500 tokens (limite FCM).
     c. Appeler `messaging.sendEachForMulticast(...)`.
     d. Logger `runs/{runId}` : `{ sent, failures, durationMs }`.
     e. Mettre à jour `stats` agrégés sur la campagne.
5. **Tracking ouverture** :
   - Le client (PWA) envoie un événement `push_opened` à la fonction `trackPushOpen` lors d'un click.
   - Incrémenter `stats.opened` côté serveur (jamais côté client direct).
6. **Garde-fous anti-spam** :
   - Max 1 push / utilisateur / 24h (toutes campagnes confondues) → champ `lastPushAt` sur le profil user.
   - Respect des préférences `pushOptOut: true` → exclusion automatique.

## Safety & Patterns
- **SOLID** : segmentation isolée dans un module `segments.js`, envoi dans `dispatcher.js`, scheduling dans `processPushCampaigns`.
- **KISS** : pas de moteur de règles dynamique — segments codés explicitement, paramétrés via Firestore.
- **DRY** : réutiliser `callerKey` pour rate-limiter les actions admin (création/édition de campagne).
- **Sécurité & Conformité** :
  - Vérifier que l'appelant a le rôle `admin` du `snackId` ciblé pour créer/lancer une campagne.
  - Respecter RGPD : opt-in explicite stocké dans `users/{uid}.pushOptIn`. Pas de push si opt-in absent.
  - Aucun PII dans les payloads de push (pas d'email, pas de nom complet).
  - Tokens FCM expirés / invalides → suppression automatique (`fcmToken: FieldValue.delete()`).
- **Tests** :
  - Émulateurs Firebase (Functions + Firestore) + `firebase functions:shell` pour appeler `processPushCampaigns` à la main.
  - Mock FCM via injection (variable d'env `FCM_DRY_RUN=true` → log au lieu d'envoyer).
  - Cas : segment vide, batch > 500, token invalide, opt-out, double envoi (idempotence sur `runId`).
