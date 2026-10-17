// ============================================================================
// 🚀 GROWTH ENGINE — panier abandonné, push soir de match, win-back auto
// ============================================================================
// Trois CRON jobs automatisés pour le growth hacking. Chaque envoi 1:1 passe
// OBLIGATOIREMENT par le Gendarme (canSendMarketingPush) avant d'envoyer un
// push → zéro spam, cooldown 72h, opt-out RGPD, quiet hours.
//
// Architecture : les envois 1:1 (panier abandonné, win-back) gèrent leur propre
// FCM + lastMarketingPushAt (pas de doc campagnes_push, qui est réservé aux
// broadcasts admin) et passent par le Gendarme. Le push soir de match est un
// BROADCAST : il crée un doc campagnes_push et délègue l'envoi au cron existant
// processPushCampaigns (opt-out + quiet hours + breaker). Le Gendarme 1:1 ne s'y
// applique pas ; sa cadence est gérée par lib/matchPush (une campagne par soirée,
// espacement minimal, plafond hebdo).

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { db, FieldValue, Timestamp } = require("../lib/admin");
const { emitEvent } = require("../lib/events");
const { chunkArray } = require("../lib/util");
const { canSendMarketingPush } = require("../lib/pushGovernance");
const { getUserPushTargets, getClientPushTargetsBySnack, sendToTargets } = require("../lib/pushTargets");
const { planMatchDayPush, MATCH_PUSH_SOURCE } = require("../lib/matchPush");

// ============================================================================
// 🛒 PANIER ABANDONNÉ (Priorité 1 — Intention forte)
// ============================================================================
// Cron toutes les 30 min. Détecte les checkouts non convertis (begin_checkout
// sans purchase correspondant dans les 30 min suivantes) et envoie un push 1:1
// "Tu as oublié ton panier !" au client. Le Gendarme bloque si cooldown 72h non
// respecté ou opt-out → un client ne reçoit jamais plus d'un push marketing
// tous les 3 jours, quel que soit le déclencheur.
exports.processAbandonedCarts = onSchedule(
  { schedule: "every 30 minutes", region: "europe-west1" },
  async (_event) => {
    try {
      // Fenêtre : checkouts entre 30 et 90 min (on laisse 30 min de grâce avant
      // de considérer un checkout comme abandonné, et on ne remonte pas au-delà
      // de 90 min pour ne pas spammer sur de vieux checkouts).
      const now = Date.now();
      const windowStart = Timestamp.fromMillis(now - 90 * 60 * 1000);
      const windowEnd = Timestamp.fromMillis(now - 30 * 60 * 1000);

      const checkoutSnap = await db
        .collection("events")
        .where("type", "==", "begin_checkout")
        .where("ts", ">=", windowStart)
        .where("ts", "<=", windowEnd)
        .get();

      if (checkoutSnap.empty) return;

      // Regrouper les checkouts par uid (un user peut avoir plusieurs begin_checkout,
      // on ne veut qu'un seul push). Map<uid, {snackId, ts}>
      const checkoutsByUid = new Map();
      for (const doc of checkoutSnap.docs) {
        const d = doc.data();
        if (!d.uid || !d.snackId) continue;
        // Garder le plus récent
        const existing = checkoutsByUid.get(d.uid);
        const docTs = d.ts?.toMillis?.() || 0;
        if (!existing || docTs > existing.ts) {
          checkoutsByUid.set(d.uid, { snackId: d.snackId, ts: docTs });
        }
      }

      if (checkoutsByUid.size === 0) return;

      // Vérifier les conversions (purchase) pour chaque uid dans la fenêtre
      const uids = [...checkoutsByUid.keys()];
      const purchaseSnap = await db
        .collection("events")
        .where("type", "==", "purchase")
        .where("ts", ">=", windowStart)
        .get();

      const convertedUids = new Set();
      for (const doc of purchaseSnap.docs) {
        const d = doc.data();
        if (d.uid) convertedUids.add(d.uid);
      }

      // Filtrer : garder uniquement les non-convertis
      const abandonedUids = uids.filter((uid) => !convertedUids.has(uid));

      let sent = 0;
      let skipped = 0;

      for (const uid of abandonedUids) {
        const { snackId } = checkoutsByUid.get(uid);

        try {
          // Lire le user + le snack pour le Gendarme
          const [userSnap, snackSnap] = await Promise.all([
            db.collection("users").doc(uid).get(),
            db.collection("snacks").doc(snackId).get(),
          ]);
          if (!userSnap.exists) continue;
          const userData = userSnap.data();
          const snackData = snackSnap.exists ? snackSnap.data() : {};

          // Aucun appareil abonné à CE snack → impossible d'envoyer
          const targets = await getUserPushTargets(uid, snackId, "client");
          if (targets.length === 0) continue;

          // 🛡️ GENDARME : vérification obligatoire avant tout envoi
          const { allowed, reason } = canSendMarketingPush(userData, snackData);
          if (!allowed) {
            skipped++;
            continue;
          }

          // ✅ Autorisé → envoyer le push
          const snackName = snackData.identity?.name || "Ton restaurant";
          const res = await sendToTargets(targets, {
            notification: {
              title: "🛒 Tu as oublié ton panier !",
              body: `Ta commande chez ${snackName} t'attend. Finalise-la en 1 clic.`,
            },
            data: { type: "ABANDONED_CART", snackId },
          });
          if (res.successCount === 0) continue; // tokens morts (nettoyés) : rien d'envoyé

          // Mettre à jour le timestamp anti-spam (Admin SDK → côté serveur)
          await db.collection("users").doc(uid).update({
            lastMarketingPushAt: FieldValue.serverTimestamp(),
          });

          // Event analytique (fire-and-forget)
          await emitEvent({
            snackId,
            type: "cart_abandoned",
            uid,
            props: { source: "auto_push" },
          });

          sent++;
        } catch (userErr) {
          // Les tokens morts sont nettoyés par sendToTargets ; ici : erreurs imprévues.
          logger.warn(`[abandoned-cart] échec user ${uid}:`, userErr?.message);
        }
      }

      if (sent > 0 || skipped > 0) {
        logger.info(
          `🛒 Paniers abandonnés : ${sent} push envoyé(s), ${skipped} bloqué(s) par le Gendarme.`
        );
      }
    } catch (err) {
      logger.error("❌ [abandoned-cart] erreur critique :", err);
    }
  }
);

// ============================================================================
// ⚽ PUSH SOIR DE MATCH (Priorité 2 — Achat d'impulsion)
// ============================================================================
// Cron quotidien à 9h. Lit les matchs du jour dans le cache Firestore (alimenté
// par getUpcomingFootballEvents) et crée, par restaurant, UNE SEULE campagne
// campagnes_push pour la soirée (message groupé si plusieurs matchs), envoi H-2 du
// premier coup d'envoi. Regroupement, cadence (espacement + plafond hebdo) et
// contenu : lib/matchPush.js (pur, testé). Le pipeline processPushCampaigns
// s'occupe de l'envoi + opt-out + breaker, et revérifie la cadence au moment T.
exports.processMatchDayPush = onSchedule(
  { schedule: "0 9 * * *", region: "europe-west1", timeZone: "Europe/Paris" },
  async (_event) => {
    try {
      // 1. Lire le cache football (alimenté par getUpcomingFootballEvents)
      const cacheSnap = await db.collection("cache").doc("football_matches").get();
      if (!cacheSnap.exists) {
        logger.info("[match-push] pas de cache football → skip.");
        return;
      }
      const cached = cacheSnap.data();
      const matches = Array.isArray(cached.matches) ? cached.matches : [];
      if (matches.length === 0) return;

      // 2. Pour chaque snack actif : un plan (ou une raison de ne rien faire)
      const snacksSnap = await db
        .collection("snacks")
        .where("maintenanceMode", "!=", true)
        .get();

      if (snacksSnap.empty) return;

      let created = 0;
      /** @type {Record<string, number>} */
      const skipped = {};
      const nowMs = Date.now();

      for (const snackDoc of snacksSnap.docs) {
        const snackId = snackDoc.id;
        const snackData = snackDoc.data() || {};

        const { plan, reason } = planMatchDayPush({ matches, snackData, nowMs });
        if (!plan) {
          skipped[reason] = (skipped[reason] || 0) + 1;
          continue;
        }

        // Anti-doublon : UNE campagne par snack et par soirée (dayKey = jour dans le
        // fuseau du snack), quel que soit le nombre de matchs ou de runs du cron.
        const existingSnap = await db
          .collection("campagnes_push")
          .where("snackId", "==", snackId)
          .where("source", "==", MATCH_PUSH_SOURCE)
          .where("dayKey", "==", plan.dayKey)
          .limit(1)
          .get();

        if (!existingSnap.empty) {
          skipped["already-planned"] = (skipped["already-planned"] || 0) + 1;
          continue;
        }

        await db.collection("campagnes_push").add({
          snackId,
          titre: plan.titre,
          message: plan.message,
          cible: "all",
          actionUrl: null,
          imageUrl: null,
          statut: "en_attente",
          dateEnvoiPrevue: Timestamp.fromMillis(plan.pushAtMs),
          dateCreation: FieldValue.serverTimestamp(),
          source: MATCH_PUSH_SOURCE,
          dayKey: plan.dayKey,
          matchIds: plan.matchIds,
          matchCount: plan.matchCount,
          matchId: plan.matchIds[0], // compat : ancien anti-doublon par match
          stats: { envoye: 0, clics: 0 },
        });

        created++;
      }

      if (created > 0 || Object.keys(skipped).length > 0) {
        logger.info(`⚽ Soir de match : ${created} campagne(s) planifiée(s), ignorés : ${JSON.stringify(skipped)}.`);
      }
    } catch (err) {
      logger.error("❌ [match-push] erreur critique :", err);
    }
  }
);

// ============================================================================
// 🔄 WIN-BACK AUTO (Priorité 3 — Réengagement)
// ============================================================================
// Cron toutes les 6h. Cible les clients inactifs depuis ≥14 jours qui ont un
// token FCM valide. Envoi 1:1 avec passage OBLIGATOIRE par le Gendarme
// (canSendMarketingPush) → le cooldown 72h + opt-out empêchent tout spam.
// Le win-back est le push MARKETING le moins prioritaire : si un panier
// abandonné ou un soir de match a déjà posé lastMarketingPushAt < 72h,
// le win-back sera bloqué naturellement par le Gendarme.
exports.processWinBack = onSchedule(
  { schedule: "every 6 hours", region: "europe-west1" },
  async (_event) => {
    try {
      // Seuil d'inactivité : 14 jours
      const inactiveThreshold = Timestamp.fromMillis(
        Date.now() - 14 * 24 * 60 * 60 * 1000
      );

      // Lire tous les snacks actifs
      const snacksSnap = await db
        .collection("snacks")
        .where("maintenanceMode", "!=", true)
        .get();

      if (snacksSnap.empty) return;

      let totalSent = 0;
      let totalSkipped = 0;

      for (const snackDoc of snacksSnap.docs) {
        const snackId = snackDoc.id;
        const snackData = snackDoc.data() || {};
        const snackName = snackData.identity?.name || "Ton restaurant";

        // Clients abonnés au push de CE snack (les fiches client n'ont pas de
        // snackId : l'ancienne requête users.snackId ne touchait que l'équipe),
        // puis filtre « inactif depuis 14 j » sur la fiche user.
        const devicesByUid = await getClientPushTargetsBySnack(snackId);
        const userDocs = [];
        for (const uids of chunkArray([...devicesByUid.keys()], 300)) {
          userDocs.push(...await db.getAll(...uids.map((uid) => db.collection("users").doc(uid))));
        }

        for (const userDoc of userDocs) {
          if (!userDoc.exists) continue;
          const userData = userDoc.data();
          const lastOrder = userData.lastOrderDate;
          if (!lastOrder || lastOrder.toMillis() > inactiveThreshold.toMillis()) continue;

          // 🛡️ GENDARME : vérification obligatoire
          const { allowed } = canSendMarketingPush(userData, snackData);
          if (!allowed) {
            totalSkipped++;
            continue;
          }

          try {
            const res = await sendToTargets(devicesByUid.get(userDoc.id), {
              notification: {
                title: "🎁 Tu nous manques !",
                body: `Ça fait un moment… Reviens chez ${snackName}, on t'attend !`,
              },
              data: { type: "WINBACK", snackId },
            });
            if (res.successCount === 0) continue; // tokens morts (nettoyés) : rien d'envoyé

            // Poser le timestamp anti-spam
            await db.collection("users").doc(userDoc.id).update({
              lastMarketingPushAt: FieldValue.serverTimestamp(),
            });

            // Event analytique
            await emitEvent({
              snackId,
              type: "push_sent",
              uid: userDoc.id,
              props: { source: "winback_auto" },
            });

            totalSent++;
          } catch (sendErr) {
            // Les tokens morts sont nettoyés par sendToTargets ; ici : erreurs imprévues.
            logger.warn(`[win-back] échec user ${userDoc.id}:`, sendErr?.message);
          }
        }
      }

      if (totalSent > 0 || totalSkipped > 0) {
        logger.info(
          `🔄 Win-back : ${totalSent} push envoyé(s), ${totalSkipped} bloqué(s) par le Gendarme.`
        );
      }
    } catch (err) {
      logger.error("❌ [win-back] erreur critique :", err);
    }
  }
);
