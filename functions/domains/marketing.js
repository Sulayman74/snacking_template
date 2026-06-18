// ============================================================================
// 📣 MARKETING PUSH — robot CRON, offre flash, campagnes programmées, tracking
// ============================================================================

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { db, FieldValue, Timestamp } = require("../lib/admin");
const { V, require_ } = require("../lib/validation");
const { enforceRateLimit, callerKey } = require("../lib/rateLimit");
const { assertCallerIsSnackAdmin } = require("../lib/auth");
const { computeKitchenLoad } = require("../lib/kitchen");
const { chunkArray } = require("../lib/util");
const { emitEvent } = require("../lib/events");

// ============================================================================
// 🚀 FONCTION 3 : LE ROBOT MARKETING PUSH (CRON JOB)
// ============================================================================
exports.processPushCampaigns = onSchedule(
  { schedule: "every 5 minutes", region: "europe-west1" },
  async (_event) => {
    const now = Timestamp.now();

    const thirtyDaysAgoDate = new Date();
    thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
    const thirtyDaysAgo = Timestamp.fromDate(thirtyDaysAgoDate);

    try {
      // 🩹 Récupération des campagnes ORPHELINES : si un run a claim une campagne
      // (en_attente → en_cours) puis a crashé avant la finalisation, elle resterait
      // bloquée en "en_cours" à vie. On la remet en file si elle y traîne > 15 min
      // (claimedAt absent = orphelin d'avant ce correctif → toujours remis en file).
      const STUCK_MS = 15 * 60 * 1000;
      const stuckSnap = await db
        .collection("campagnes_push")
        .where("statut", "==", "en_cours")
        .get();
      for (const d of stuckSnap.docs) {
        const claimedMs = d.data().claimedAt?.toMillis?.() || 0;
        if (Date.now() - claimedMs > STUCK_MS) {
          await d.ref.update({ statut: "en_attente" });
          console.log(`🩹 Campagne ${d.id} orpheline (en_cours figé) → remise en file.`);
        }
      }

      const snapshot = await db
        .collection("campagnes_push")
        .where("statut", "==", "en_attente")
        .where("dateEnvoiPrevue", "<=", now)
        .get();

      if (snapshot.empty) return null;

      for (const doc of snapshot.docs) {
        // 🔒 Claim atomique : on réserve la campagne (en_attente → en_cours) AVANT
        // tout envoi. Si un autre run l'a déjà prise (le CAS échoue) → on l'ignore.
        // Anti double-envoi si deux exécutions du cron se chevauchent (run > 5 min).
        try {
          await db.runTransaction(async (tx) => {
            const fresh = await tx.get(doc.ref);
            if (!fresh.exists || fresh.data().statut !== "en_attente") {
              throw new Error("already-claimed");
            }
            // claimedAt horodate le claim → permet la récupération des orphelines.
            tx.update(doc.ref, {
              statut: "en_cours",
              claimedAt: FieldValue.serverTimestamp(),
            });
          });
        } catch (claimErr) {
          console.log(`Campagne ${doc.id} déjà réservée par un autre run — ignorée.`);
          continue;
        }

        const campagne = doc.data();

        const usersSnapshot = await db
          .collection("users")
          .where("snackId", "==", campagne.snackId)
          .where("fcmToken", "!=", null)
          .get();

        // 🎯 1. On stocke des objets {token, uid} pour identifier qui nettoyer plus tard
        const targetUsers = [];

        usersSnapshot.forEach((userDoc) => {
          const user = userDoc.data();
          const lastOrder = user.lastOrderDate;

          let isMatch = false;
          if (campagne.cible === "active") {
            if (lastOrder && lastOrder.toMillis() >= thirtyDaysAgo.toMillis()) {
              isMatch = true;
            }
          } else if (campagne.cible === "inactive") {
            if (!lastOrder || lastOrder.toMillis() < thirtyDaysAgo.toMillis()) {
              isMatch = true;
            }
          } else {
            isMatch = true;
          }

          if (isMatch) {
            targetUsers.push({ token: user.fcmToken, uid: userDoc.id });
          }
        });

        if (targetUsers.length === 0) {
          await doc.ref.update({
            statut: "annulee_sans_cible",
            dateEnvoiReelle: FieldValue.serverTimestamp(),
            notes: "Ciblage n'a retourné aucun client",
          });
          console.log(
            `⚠️ Campagne ${doc.id} annulée : Aucun utilisateur trouvé.`,
          );
          continue;
        }

        // 🎯 2. On découpe notre liste d'objets
        const userChunks = chunkArray(targetUsers, 500);
        let totalSuccess = 0;
        let totalErrors = 0;
        // Proxy du taux de désabonnement : nb de jetons FCM invalidés (supprimés)
        // sur cette campagne. Persisté dans stats → alimente le circuit breaker
        // anti-fatigue (LOT 5) et le calcul "LTV perdue" du ROI (LOT 8).
        let totalTokensInvalidated = 0;

        const baseUrl = "https://snacking-template.web.app/";

        const basePayload = {
          notification: {
            title: campagne.titre,
            body: campagne.message,
            ...(campagne.imageUrl && { image: campagne.imageUrl }),
          },
          data: {
            actionUrl: campagne.actionUrl || "",
            // Tracking des clics : le SW renvoie campaignId/snackId à trackPushClick.
            campaignId: doc.id,
            snackId: campagne.snackId || "",
          },
          webpush: {
            fcm_options: {
              link: campagne.actionUrl
                ? `${baseUrl}${campagne.actionUrl}`
                : baseUrl,
            },
          },
        };

        for (const chunk of userChunks) {
          // On extrait uniquement les tokens pour l'envoi FCM
          const tokens = chunk.map((u) => u.token);
          const payload = { ...basePayload, tokens };

          const response = await admin
            .messaging()
            .sendEachForMulticast(payload);

          // Mise à jour des compteurs globaux de la campagne
          totalSuccess += response.successCount;
          totalErrors += response.failureCount;

          // 🧹 3. Nettoyage intelligent des jetons obsolètes
          const batch = db.batch();
          let needsCleanup = false;

          response.responses.forEach((res, idx) => {
            if (!res.success) {
              const error = res.error.code;
              // On ne supprime que si le token est explicitement invalide ou expiré
              if (
                error === "messaging/registration-token-not-registered" ||
                error === "messaging/invalid-registration-token"
              ) {
                const userId = chunk[idx].uid; // Grâce à l'index, on retrouve le bon UID
                batch.update(db.collection("users").doc(userId), {
                  fcmToken: FieldValue.delete(),
                });
                needsCleanup = true;
                totalTokensInvalidated += 1;
              }
            }
          });

          if (needsCleanup) {
            await batch.commit();
            console.log(
              `🧹 Nettoyage : ${totalTokensInvalidated} jeton(s) invalide(s) supprimé(s) (cumul campagne).`,
            );
          }
        }

        // Finalisation de la campagne en base. ⚠️ Chemins POINTÉS pour ne PAS
        // écraser stats.clics (incrémenté de façon asynchrone par trackPushClick
        // quand les clients cliquent sur la notification).
        await doc.ref.update({
          statut: "envoyee",
          dateEnvoiReelle: FieldValue.serverTimestamp(),
          "stats.envoye": totalSuccess,
          "stats.erreurs": totalErrors,
          "stats.tokensInvalidated": totalTokensInvalidated,
        });

        // 📊 Event `push_sent` (1 par campagne, write-time) → attribution/ROI.
        await emitEvent({
          snackId: campagne.snackId,
          type: "push_sent",
          props: {
            campaignId: doc.id,
            cible: campagne.cible || "all",
            count: totalSuccess,
            tokensInvalidated: totalTokensInvalidated,
          },
        });

        console.log(
          `✅ Campagne ${doc.id} terminée (${campagne.cible}). Succès: ${totalSuccess} | Erreurs: ${totalErrors}`,
        );
      }
    } catch (error) {
      console.error("❌ Erreur critique Push :", error);
    }
  },
);

// ============================================================================
// ⚡ FONCTION : OFFRE FLASH (gardée par la charge cuisine)
// ============================================================================
// Pousse une offre flash au segment "active" — MAIS refuse en rushMode (cuisine
// surchargée). Le flash DOIT passer par cette CF (role-gate + rate-limit +
// rushMode serveur) : un client ne crée jamais une campagne directement.
// Lecture de charge FRAÎCHE (pas le cache 30s) : débloquer/bloquer une offre sur
// un état périmé serait incorrect ; action admin rare → coût négligeable.
// L'envoi est délégué au cron existant `processPushCampaigns` (≤ 5 min) via un
// doc campagnes_push conforme — pas de mécanique FCM dupliquée (DRY).
exports.pushFlashOffer = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentification requise.");
  }

  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { snackId, title, body, ttlMin } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isNonEmptyString(title, 80), "Titre invalide.");
  require_(V.isNonEmptyString(body, 200), "Message invalide.");
  require_(V.isPositiveInt(ttlMin, 240), "ttlMin invalide.");

  // 🛡️ Réservé à l'admin du snack + rate limit (3 offres flash / 60s).
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({
    key: callerKey(request, "flashOffer"),
    max: 3,
    windowMs: 60_000,
  });

  // 🔥 Garde de capacité : on refuse en plein coup de feu (lecture fraîche).
  const snackSnap = await db.collection("snacks").doc(snackId).get();
  if (!snackSnap.exists) throw new HttpsError("not-found", "Snack introuvable.");
  const { rushMode } = await computeKitchenLoad(snackSnap.data() || {}, snackId);
  if (rushMode) throw new HttpsError("failed-precondition", "kitchen-busy");

  // ✅ Déléguer l'envoi au cron : doc campagnes_push immédiat, segment "active".
  await db.collection("campagnes_push").add({
    snackId,
    titre: title,
    message: body,
    cible: "active",
    actionUrl: null,
    imageUrl: null,
    statut: "en_attente",
    dateEnvoiPrevue: Timestamp.now(),
    dateCreation: FieldValue.serverTimestamp(),
    source: "flash_offer",
    flashTtlMin: ttlMin,
    stats: { envoye: 0, clics: 0 },
  });

  return { ok: true };
});

// ============================================================================
// 📣 FONCTION : PROGRAMMER UNE CAMPAGNE PUSH (quota + rate-limit SERVEUR)
// ============================================================================
// Remplace l'écriture client directe dans `campagnes_push` : le quota mensuel
// (2/mois/snack) et le rate-limit sont désormais ENFORCÉS côté serveur (un admin
// ne peut plus le contourner). La création directe par le client est fermée par
// firestore.rules (`campagnes_push` create:if false) — seules les CF (Admin SDK)
// écrivent. Le cron `processPushCampaigns` envoie ensuite la campagne.
exports.schedulePushCampaign = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentification requise.");
  }

  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { snackId, titre, message, cible, actionUrl, imageUrl, dateEnvoiPrevue } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isNonEmptyString(titre, 80), "Titre invalide.");
  require_(V.isNonEmptyString(message, 200), "Message invalide.");
  require_(["all", "active", "inactive"].includes(cible), "Cible invalide.");
  require_(actionUrl == null || (V.isString(actionUrl) && actionUrl.length <= 300), "actionUrl invalide.");
  require_(imageUrl == null || (V.isString(imageUrl) && imageUrl.length <= 1000), "imageUrl invalide.");

  // 🛡️ Réservé à l'admin du snack + rate limit (5 / 60s, garde anti-burst).
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({
    key: callerKey(request, "schedulePush"),
    max: 5,
    windowMs: 60_000,
  });

  // Date d'envoi : ISO string (sérialisée par httpsCallable) → Timestamp. Défaut: maintenant.
  let envoiDate = new Date(dateEnvoiPrevue);
  if (Number.isNaN(envoiDate.getTime())) envoiDate = new Date();

  // 🛡️ QUOTA SERVEUR — 2 campagnes / mois calendaire / snack (autorité serveur,
  // miroir de getPushEligibility côté client mais NON contournable).
  const now = new Date();
  const monthStart = Timestamp.fromDate(
    new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const monthlyAgg = await db
    .collection("campagnes_push")
    .where("snackId", "==", snackId)
    .where("dateCreation", ">=", monthStart)
    .count()
    .get();
  const MONTHLY_LIMIT = 2;
  if (monthlyAgg.data().count >= MONTHLY_LIMIT) {
    throw new HttpsError("resource-exhausted", "Quota mensuel de campagnes atteint (2/2).");
  }

  const ref = await db.collection("campagnes_push").add({
    snackId,
    titre,
    message,
    cible,
    actionUrl: actionUrl || null,
    imageUrl: imageUrl || null,
    statut: "en_attente",
    dateEnvoiPrevue: Timestamp.fromDate(envoiDate),
    dateCreation: FieldValue.serverTimestamp(),
    source: "scheduled",
    stats: { envoye: 0, clics: 0 },
  });

  return { ok: true, campaignId: ref.id };
});

// ============================================================================
// 📊 FONCTION : TRACKING CLIC PUSH (compteur best-effort)
// ============================================================================
// Appelée par le Service Worker (notificationclick) pour incrémenter stats.clics
// de la campagne. Best-effort et NON authentifié (le SW n'a pas de contexte auth) :
// un échec n'a aucun impact, au pire la stat est imprécise. cors:true gère le
// préflight cross-origin. On n'incrémente que si la campagne existe.
exports.trackPushClick = onRequest({ region: "europe-west9", cors: true }, async (req, res) => {
  try {
    const campaignId = (req.query.c || (req.body && req.body.campaignId) || "").toString();
    if (V.isDocId(campaignId)) {
      const ref = db.collection("campagnes_push").doc(campaignId);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.update({ "stats.clics": FieldValue.increment(1) });
        // 📊 Event `push_clicked` → attribution push→commande (LOT 8).
        await emitEvent({
          snackId: snap.data().snackId,
          type: "push_clicked",
          props: { campaignId },
        });
      }
    }
  } catch (e) {
    console.warn("[trackPushClick] échec :", e && e.message);
  }
  // Toujours 204 : fire-and-forget, on n'expose jamais d'erreur au SW.
  res.status(204).end();
});

// ============================================================================
// 📊 FONCTION : TRACKING UPSELL "SHOWN" (instrumentation légère)
// ============================================================================
// Incrémente le compteur `shown` des produits affichés dans la bottom-sheet
// d'upsell, pour calculer le taux d'acceptation côté admin (accepted/shown).
// Écrit EXCLUSIVEMENT côté serveur dans snacks/{snackId}/upsellStats/{productId}
// (un client ne fabrique pas ses propres stats). Fire-and-forget côté client :
// un échec ici n'impacte jamais le tunnel de commande.
exports.trackUpsellShown = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentification requise.");
  }

  // 🛡️ Rate limit généreux : 1 appel par affichage upsell (≈ 1 par checkout).
  await enforceRateLimit({
    key: callerKey(request, "trackUpsellShown"),
    max: 30,
    windowMs: 60_000,
  });

  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");

  const { snackId, productIds } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isArray(productIds) && productIds.length > 0, "productIds vide ou invalide.");
  require_(productIds.length <= 10, "Trop de productIds.");

  const batch = db.batch();
  let count = 0;
  for (const productId of productIds) {
    if (!V.isDocId(productId)) continue;
    count++;
    const statRef = db
      .collection("snacks").doc(snackId)
      .collection("upsellStats").doc(productId);
    batch.set(
      statRef,
      {
        shown: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  require_(count > 0, "Aucun productId valide.");
  await batch.commit();

  return { ok: true, tracked: count };
});

