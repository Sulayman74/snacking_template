// ============================================================================
// 🚀 GROWTH ENGINE — panier abandonné, push soir de match, win-back auto
// ============================================================================
// Trois CRON jobs automatisés pour le growth hacking. Chaque envoi 1:1 passe
// OBLIGATOIREMENT par le Gendarme (canSendMarketingPush) avant d'envoyer un
// push → zéro spam, cooldown 72h, opt-out RGPD, quiet hours.
//
// Architecture : les envois 1:1 (panier abandonné, win-back) gèrent leur propre
// FCM + lastMarketingPushAt (pas de doc campagnes_push, qui est réservé aux
// broadcasts admin). Le push soir de match crée un doc campagnes_push et délègue
// l'envoi au cron existant processPushCampaigns (DRY : opt-out + breaker + cleanup
// déjà en place dans ce pipeline).

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { db, FieldValue, Timestamp } = require("../lib/admin");
const { emitEvent } = require("../lib/events");
const { chunkArray } = require("../lib/util");
const { canSendMarketingPush } = require("../lib/pushGovernance");
const { getUserPushTargets, getClientPushTargetsBySnack, sendToTargets } = require("../lib/pushTargets");

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
// Cron quotidien à 9h. Vérifie les matchs du jour via le cache Firestore
// (alimenté par getUpcomingFootballEvents). Pour chaque match intéressant,
// crée un doc campagnes_push avec dateEnvoiPrevue = H-2 du match. Le pipeline
// existant (processPushCampaigns) s'occupe de l'envoi + opt-out + breaker.
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

      // 2. Filtrer les matchs d'AUJOURD'HUI
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      const todayMatches = matches.filter((m) => {
        const d = new Date(m.utcDate);
        return d >= todayStart && d <= todayEnd && m.status !== "FINISHED";
      });

      if (todayMatches.length === 0) {
        logger.info("[match-push] aucun match aujourd'hui.");
        return;
      }

      // 3. Pour chaque snack actif, créer une campagne push H-2 par match
      const snacksSnap = await db
        .collection("snacks")
        .where("maintenanceMode", "!=", true)
        .get();

      if (snacksSnap.empty) return;

      let created = 0;

      for (const snackDoc of snacksSnap.docs) {
        const snackId = snackDoc.id;

        for (const match of todayMatches) {
          const matchDate = new Date(match.utcDate);
          // Push prévu H-2 (2 heures avant le coup d'envoi)
          const pushDate = new Date(matchDate.getTime() - 2 * 60 * 60 * 1000);

          // Si H-2 est déjà passé, on ne crée pas la campagne (trop tard)
          if (pushDate <= now) continue;

          // Anti-doublon : vérifier qu'on n'a pas déjà créé une campagne pour ce match+snack
          const existingSnap = await db
            .collection("campagnes_push")
            .where("snackId", "==", snackId)
            .where("source", "==", "match_auto")
            .where("matchId", "==", match.id)
            .get();

          if (!existingSnap.empty) continue; // déjà planifiée

          const home = match.homeTeam?.name || "Équipe A";
          const away = match.awayTeam?.name || "Équipe B";

          await db.collection("campagnes_push").add({
            snackId,
            titre: `⚽ ${home} vs ${away} ce soir !`,
            message: `Commande ton menu avant le coup d'envoi, prêt pile pour le match 🍕`,
            cible: "all",
            actionUrl: null,
            imageUrl: null,
            statut: "en_attente",
            dateEnvoiPrevue: Timestamp.fromDate(pushDate),
            dateCreation: FieldValue.serverTimestamp(),
            source: "match_auto",
            matchId: match.id,
            stats: { envoye: 0, clics: 0 },
          });

          created++;
        }
      }

      if (created > 0) {
        logger.info(`⚽ ${created} campagne(s) soir de match planifiée(s).`);
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
