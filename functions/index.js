const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { getStorage } = require("firebase-admin/storage");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const path = require("path");
const os = require("os");
const fs = require("fs");
const sharp = require("sharp");
const admin = require("firebase-admin");

// Initialisation de Firebase Admin
admin.initializeApp();

// 🚨 CORRECTION 1 : On branche la base de données !
const db = admin.firestore();

// Force toutes les fonctions à être hébergées à Paris (europe-west9)
setGlobalOptions({ region: "europe-west9" });

// ============================================================================
// 🛡️ HELPERS — VALIDATION & RATE LIMITING
// ============================================================================

// --- Validation primitives ---
const V = {
  isString: (v) => typeof v === "string",
  isNonEmptyString: (v, max = 1000) =>
    typeof v === "string" && v.length > 0 && v.length <= max,
  isInt: (v) => Number.isInteger(v),
  isPositiveInt: (v, max = Number.MAX_SAFE_INTEGER) =>
    Number.isInteger(v) && v > 0 && v <= max,
  isPlainObject: (v) =>
    v !== null && typeof v === "object" && !Array.isArray(v),
  isArray: (v) => Array.isArray(v),
  isEmail: (v) =>
    typeof v === "string" && v.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  // Firestore doc IDs : pas de "/", longueur 1..1500
  isDocId: (v) =>
    typeof v === "string" && v.length > 0 && v.length <= 1500 && !v.includes("/"),
};

function require_(cond, msg) {
  if (!cond) throw new HttpsError("invalid-argument", msg);
}

// Limite la profondeur des metadata acceptés par Stripe (clés/valeurs <=500 chars)
function sanitizeStripeMetadata(metadata) {
  if (!V.isPlainObject(metadata)) return {};
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(metadata)) {
    if (count++ >= 50) break;
    if (typeof k !== "string" || k.length > 40) continue;
    const value = v == null ? "" : String(v);
    if (value.length > 500) continue;
    out[k] = value;
  }
  return out;
}

// --- Rate limiting (sliding window via Firestore transaction) ---
// Stocke un compteur + un début de fenêtre. Atomique — pas de race condition.
async function enforceRateLimit({ key, max, windowMs }) {
  const ref = db.collection("rateLimits").doc(key);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const windowStart = data?.windowStart?.toMillis?.() ?? 0;
    const count = data?.count ?? 0;

    if (!data || now - windowStart > windowMs) {
      tx.set(ref, {
        count: 1,
        windowStart: admin.firestore.Timestamp.fromMillis(now),
      });
      return;
    }

    if (count >= max) {
      throw new HttpsError(
        "resource-exhausted",
        "Trop de tentatives. Réessayez dans quelques instants."
      );
    }

    tx.update(ref, { count: count + 1 });
  });
}

// Détecte un token FCM devenu invalide (PWA réinstallée, désinstallation, etc.)
function isInvalidFcmTokenError(error) {
  const code = error?.code || error?.errorInfo?.code;
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  );
}

// Nettoie le fcmToken Firestore si l'erreur indique un token mort.
// Retourne true si nettoyage effectué.
async function cleanupInvalidFcmToken(userId, error) {
  if (!isInvalidFcmTokenError(error)) return false;
  try {
    await db.collection("users").doc(userId).update({
      fcmToken: admin.firestore.FieldValue.delete(),
    });
    console.log(`🧹 Token FCM invalide nettoyé pour user ${userId}`);
    return true;
  } catch (e) {
    console.error(`❌ Échec cleanup token user ${userId}:`, e);
    return false;
  }
}

// Identifie un appelant : uid si auth, sinon hash IP (X-Forwarded-For)
function callerKey(request, action) {
  if (request.auth?.uid) return `${action}_uid_${request.auth.uid}`;
  const xff = request.rawRequest?.headers?.["x-forwarded-for"];
  const ip =
    (typeof xff === "string" ? xff.split(",")[0].trim() : null) ||
    request.rawRequest?.ip ||
    "unknown";
  // On normalise l'IP en clé Firestore safe
  const safeIp = ip.replace(/[^a-zA-Z0-9.:_-]/g, "_").slice(0, 60);
  return `${action}_ip_${safeIp}`;
}

// ============================================================================
// 🎁 FONCTION 1 : CADEAU DE FIDÉLITÉ (10 POINTS)
// ============================================================================
exports.notifierMenuOffert = onDocumentUpdated(
  "users/{userId}",
  async (event) => {
    const dataBefore = event.data.before.data();
    const dataAfter = event.data.after.data();
    const userId = event.params.userId;

    console.log(`🔍 Analyse du changement pour l'utilisateur : ${userId}`);

    if (dataAfter.points >= 10 && dataBefore.points < 10) {
      const token = dataAfter.fcmToken;

      if (!token) {
        console.log("⚠️ Abandon : Le client n'a pas de token FCM enregistré.");
        return;
      }

      const message = {
        notification: {
          title: "🎁 CADEAU : Menu Offert !",
          body: "Félicitations ! Tu as atteint 10 points. Ton prochain menu est gratuit chez nous !",
        },
        data: {
          type: "REWARD_UNLOCKED",
          points: "10",
        },
        token: token,
      };

      try {
        const response = await getMessaging().send(message);
        console.log("✅ Notification envoyée avec succès :", response);
      } catch (error) {
        console.error("❌ Erreur lors de l'envoi FCM :", error);
        await cleanupInvalidFcmToken(userId, error);
      }
    } else {
      console.log("ℹ️ Changement ignoré (pas le palier des 10 points).");
    }
  },
);

// ============================================================================
// 🖼️ FONCTION 2 : OPTIMISATION D'IMAGES (SHARP)
// ============================================================================
exports.optimizeImage = onObjectFinalized(
  { memory: "512MiB" },
  async (event) => {
    const fileBucket = event.data.bucket;
    const filePath = event.data.name;
    const contentType = event.data.contentType;

    if (
      !contentType.startsWith("image/") ||
      !filePath.startsWith("produits/")
    ) {
      return logger.log("Fichier ignoré (Pas une image de produit).");
    }

    if (event.data.metadata && event.data.metadata.optimized === "true") {
      return logger.log("Image déjà optimisée.");
    }

    const bucket = getStorage().bucket(fileBucket);
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(os.tmpdir(), fileName);
    const tempOptimizedPath = path.join(os.tmpdir(), `opt_${fileName}`);

    try {
      logger.log(`Téléchargement de ${filePath} pour optimisation...`);
      await bucket.file(filePath).download({ destination: tempFilePath });

      logger.log("Compression en cours avec Sharp...");
      await sharp(tempFilePath)
        .resize(800, 800, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toFile(tempOptimizedPath);

      logger.log("Upload de l'image optimisée...");
      await bucket.upload(tempOptimizedPath, {
        destination: filePath,
        metadata: {
          contentType: "image/webp",
          metadata: { optimized: "true" },
        },
      });

      fs.unlinkSync(tempFilePath);
      fs.unlinkSync(tempOptimizedPath);

      return logger.log(`✅ Succès ! L'image ${fileName} a été compressée.`);
    } catch (error) {
      logger.error("❌ Erreur lors de l'optimisation :", error);
      return null;
    }
  },
);

// ============================================================================
// 🛠️ OUTILS : GÉNÉRATEUR DE CODE ET DÉCOUPEUR
// ============================================================================
function generateSecretCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function chunkArray(array, size) {
  const chunked = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
}

// ============================================================================
// 🚀 FONCTION 3 : LE ROBOT MARKETING PUSH (CRON JOB)
// ============================================================================
exports.processPushCampaigns = onSchedule(
  { schedule: "every 5 minutes", region: "europe-west1" },
  async (_event) => {
    const now = admin.firestore.Timestamp.now();

    const thirtyDaysAgoDate = new Date();
    thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
    const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(thirtyDaysAgoDate);

    try {
      const snapshot = await db
        .collection("campagnes_push")
        .where("statut", "==", "en_attente")
        .where("dateEnvoiPrevue", "<=", now)
        .get();

      if (snapshot.empty) return null;

      for (const doc of snapshot.docs) {
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
            dateEnvoiReelle: admin.firestore.FieldValue.serverTimestamp(),
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

        const baseUrl = "https://snacking-template.web.app/";

        const basePayload = {
          notification: {
            title: campagne.titre,
            body: campagne.message,
            ...(campagne.imageUrl && { image: campagne.imageUrl }),
          },
          data: {
            actionUrl: campagne.actionUrl || "",
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
                  fcmToken: admin.firestore.FieldValue.delete(),
                });
                needsCleanup = true;
              }
            }
          });

          if (needsCleanup) {
            await batch.commit();
            console.log(
              `🧹 Nettoyage effectué pour un lot de jetons invalides.`,
            );
          }
        }

        // Finalisation de la campagne en base
        await doc.ref.update({
          statut: "envoyee",
          dateEnvoiReelle: admin.firestore.FieldValue.serverTimestamp(),
          stats: { envoye: totalSuccess, erreurs: totalErrors },
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
// 💳 FONCTION 4 : LE TIROIR-CAISSE (STRIPE CHECKOUT)
// ============================================================================

exports.createPaymentIntent = onCall(
  { region: "europe-west1" },
  async (request) => {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    // 🛡️ Rate limit AVANT toute logique : 10 tentatives / 60s par utilisateur (ou IP)
    await enforceRateLimit({
      key: callerKey(request, "createPaymentIntent"),
      max: 10,
      windowMs: 60_000,
    });

    // 🛡️ Validation stricte des entrées
    const data = request.data;
    require_(V.isPlainObject(data), "Payload invalide.");

    const { amount, currency, description, metadata, snackId } = data;

    require_(V.isPositiveInt(amount, 1_000_000), "Montant invalide.");
    require_(amount >= 50, "Montant inférieur au minimum (0,50 €).");
    require_(
      currency === undefined || (V.isString(currency) && /^[a-z]{3}$/i.test(currency)),
      "Devise invalide."
    );
    require_(
      description === undefined ||
        (V.isString(description) && description.length <= 1000),
      "Description invalide."
    );
    require_(
      metadata === undefined || V.isPlainObject(metadata),
      "Metadata invalides."
    );

    try {
      // 1. Récupération des infos du Snack (Tenant)
      let stripeAccountId = null;
      let applicationFeeAmount = 0;

      if (snackId) {
        const snackDoc = await db.collection("snacks").doc(snackId).get();
        if (snackDoc.exists) {
          const snackData = snackDoc.data();
          stripeAccountId = snackData.stripeAccountId;
          
          // Règle Métier : 0% les 6 premiers mois, puis 8%
          if (stripeAccountId) {
             const createdAt = snackData.createdAt?.toDate() || new Date();
             const now = new Date();
             const diffMonths = (now.getFullYear() - createdAt.getFullYear()) * 12 + (now.getMonth() - createdAt.getMonth());
             
             if (diffMonths >= 6) {
                 applicationFeeAmount = Math.round(amount * 0.08);
             }
          }
        }
      }

      // 2. Préparation des paramètres du PaymentIntent
      const params = {
        amount,
        currency: currency ? currency.toLowerCase() : "eur",
        description: description || "Commande en ligne",
        metadata: sanitizeStripeMetadata(metadata),
        automatic_payment_methods: { enabled: true },
      };
      
      // 3. Optionnel : Routage Stripe Connect
      let requestOptions = undefined;
      if (stripeAccountId) {
          if (applicationFeeAmount > 0) {
              params.application_fee_amount = applicationFeeAmount;
          }
          requestOptions = { stripeAccount: stripeAccountId };
      }

      const paymentIntent = await stripe.paymentIntents.create(params, requestOptions);

      return { clientSecret: paymentIntent.client_secret };
    } catch (error) {
      console.error("❌ Erreur Stripe PaymentIntent :", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Impossible d'initialiser le paiement.");
    }
  },
);

// ============================================================================
// 💳 FONCTION 5 : FINALISATION COMMANDE (vérification Stripe côté serveur)
// ============================================================================
exports.finalizeOrder = onCall(
  { region: "europe-west1" },
  async (request) => {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    // 1. Authentification obligatoire
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }
    const uid = request.auth.uid;

    // 🛡️ Rate limit : 5 finalisations / 60s par utilisateur (au-dessus = abus)
    await enforceRateLimit({
      key: callerKey(request, "finalizeOrder"),
      max: 5,
      windowMs: 60_000,
    });

    // 🛡️ Validation stricte
    const data = request.data;
    require_(V.isPlainObject(data), "Payload invalide.");

    const {
      paymentIntentId,
      snackId,
      cartItems,
      clientEmail,
      clientNom,
      totalCents,
      referrerId,
    } = data;

    require_(V.isNonEmptyString(paymentIntentId, 200), "paymentIntentId invalide.");
    require_(V.isDocId(snackId), "snackId invalide.");
    require_(V.isArray(cartItems) && cartItems.length > 0, "cartItems vide ou invalide.");
    require_(cartItems.length <= 100, "Panier trop volumineux.");
    require_(V.isEmail(clientEmail), "clientEmail invalide.");
    require_(
      clientNom === undefined ||
        clientNom === null ||
        (V.isString(clientNom) && clientNom.length <= 100),
      "clientNom invalide."
    );
    require_(V.isPositiveInt(totalCents, 1_000_000), "totalCents invalide.");
    require_(
      referrerId === undefined || referrerId === null || V.isDocId(referrerId),
      "referrerId invalide."
    );

    // Validation détaillée de chaque item du panier
    for (const item of cartItems) {
      require_(V.isPlainObject(item), "Item de panier invalide.");
      require_(V.isNonEmptyString(item.nom, 200), "Nom d'item invalide.");
      require_(
        typeof item.prix === "number" && item.prix >= 0 && item.prix < 10_000,
        "Prix d'item invalide."
      );
      require_(V.isPositiveInt(item.quantity, 100), "Quantité d'item invalide.");
    }

    // 2. Vérifier le PaymentIntent côté Stripe (le client ne peut pas falsifier ça)
    let paymentIntent;
    try {
      let stripeAccountId = null;
      const snackDoc = await db.collection("snacks").doc(snackId).get();
      if (snackDoc.exists) {
          stripeAccountId = snackDoc.data().stripeAccountId;
      }

      const retrieveOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, retrieveOptions);
    } catch (e) {
      throw new HttpsError("not-found", "PaymentIntent introuvable.");
    }

    if (paymentIntent.status !== "succeeded") {
      throw new HttpsError("failed-precondition", `Paiement non confirmé (statut: ${paymentIntent.status}).`);
    }

    // 3. Vérifier que le montant Stripe correspond au panier (anti-manipulation prix)
    if (Math.abs(paymentIntent.amount - totalCents) > 10) {
      throw new HttpsError("invalid-argument", "Montant incohérent avec le panier.");
    }

    // 4. Idempotence — éviter une double commande si le client relance
    const existing = await db.collection("commandes")
      .where("paiement.stripeSessionId", "==", paymentIntentId)
      .limit(1).get();
    if (!existing.empty) {
      return { orderId: existing.docs[0].id };
    }

    // 5. Créer la commande dans Firestore (uniquement si tout est vérifié)
    const newOrder = {
      snackId,
      userId: uid,
      clientNom: clientNom || clientEmail.split("@")[0],
      clientEmail,
      secretCode: generateSecretCode(6),
      date: admin.firestore.FieldValue.serverTimestamp(),
      statut: "en_attente_client",
      items: cartItems,
      total: paymentIntent.amount / 100,
      paiement: {
        methode: "carte_bancaire",
        statut: "paye",
        stripeSessionId: paymentIntentId,
      },
    };

    const docRef = await db.collection("commandes").add(newOrder);

    // 🍟 LOGIQUE PARRAINAGE
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();
    
    // On vérifie si c'est la toute première commande de l'utilisateur (lastOrderDate inexistant)
    if (referrerId && referrerId !== uid && (!userDoc.exists() || !userDoc.data().lastOrderDate)) {
      const referrerRef = db.collection("users").doc(referrerId);
      const referrerDoc = await referrerRef.get();

      if (referrerDoc.exists()) {
        const fieldPath = `pointsBySnack.${snackId}`;
        await referrerRef.update({
          [fieldPath]: admin.firestore.FieldValue.increment(2)
        });

        // Notification au parrain
        const referrerData = referrerDoc.data();
        if (referrerData.fcmToken) {
          try {
            await getMessaging().send({
              notification: {
                title: "🍟 Une frite offerte !",
                body: "Votre filleul vient de commander ! Vous avez reçu 2 points de fidélité."
              },
              token: referrerData.fcmToken
            });
          } catch (e) {
            console.error("Erreur notif parrainage:", e);
          }
        }
      }
    }

    await userRef.update({
      lastOrderDate: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { orderId: docRef.id };
  }
);

// ============================================================================
// 🔔 FONCTION 6 : NOTIFICATION "COMMANDE PRÊTE" (V2)
// ============================================================================
exports.onOrderStatusChange = onDocumentUpdated(
  "commandes/{orderId}",
  async (event) => {
    const newData = event.data.after.data();
    const oldData = event.data.before.data();
    const orderId = event.params.orderId;

    // 🎯 On ne déclenche que si le statut passe de n'importe quoi à "prete"
    if (oldData.statut !== "prete" && newData.statut === "prete") {
      const userId = newData.userId;

      try {
        // 1. Chercher le token du client dans la collection 'users'
        // On utilise la constante 'db' que tu as déjà définie en haut
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.data();
        const fcmToken = userData ? userData.fcmToken : null;

        if (fcmToken) {
          // 2. Préparer le message
          const message = {
            notification: {
              title: "C'est prêt ! 🍟",
              body: `Votre commande #${orderId.slice(-4).toUpperCase()} est prête. Bon appétit !`,
            },
            // Optionnel : On peut ajouter un lien vers l'app
            webpush: {
              fcm_options: {
                link: "https://snacking-template.web.app/",
              },
            },
            token: fcmToken,
          };

          // 3. Envoyer via Messaging
          const response = await getMessaging().send(message);
          console.log(
            `✅ Notif "Prête" envoyée pour commande ${orderId} :`,
            response,
          );
        } else {
          console.log(`⚠️ Pas de token FCM pour l'utilisateur ${userId}.`);
        }
      } catch (error) {
        console.error(
          "❌ Erreur lors de l'envoi de la notification de commande :",
          error,
        );
        await cleanupInvalidFcmToken(userId, error);
      }
    }
  },
);

// ============================================================================
// ⚽ FONCTION : FOOTBALL EVENTS (Smart Marketing Advisor)
// ============================================================================
// Récupère les matchs des 7 prochains jours pour les compétitions ciblées,
// filtre selon les équipes du resto et met en cache Firestore 30 min pour
// éviter de saturer l'API football-data.org (10 req/min en free tier).
//
// Token lu via secret Firebase :
//   firebase functions:secrets:set FOOTBALL_DATA_TOKEN
//
// Throttling-aware : on log un warning si `X-Requests-Available-Minute` < 2
// (best practice demandée explicitement par l'auteur de l'API).
//
// Réponse : { matches: [...], cached: bool, stale?: bool, ageMs?: number }
//   - cached:false → fetch frais
//   - cached:true   → renvoyé du cache (TTL non expiré)
//   - stale:true    → fetch échoué, on retombe sur le vieux cache
//
// Filtres (spec utilisateur) :
//   FL1 → OL, OM, PSG
//   PL  → Man City, Man United, Arsenal
//   PD  → Real Madrid, Barcelona, Atlético
//   CL  → tous les matchs
//   WC  → équipe de France OR stages quarts/demi/finale
//   EC  → équipe de France OR stages quarts/demi/finale

const FOOTBALL_API_BASE = "https://api.football-data.org/v4";
const FOOTBALL_CACHE_DOC = "football_matches";
const FOOTBALL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const FOOTBALL_HORIZON_DAYS = 7;

const FOOTBALL_FILTERS = {
  FL1: { keywords: ["lyon", "marseille", "paris"] },
  PL:  { keywords: ["manchester city", "manchester united", "arsenal"] },
  PD:  { keywords: ["real madrid", "barcelona", "atletico"] },
  CL:  { keywords: null }, // tous
  WC:  { keywords: ["france"], stages: ["QUARTER_FINALS", "SEMI_FINALS", "FINAL"] },
  EC:  { keywords: ["france"], stages: ["QUARTER_FINALS", "SEMI_FINALS", "FINAL"] },
};
const FOOTBALL_COMPETITIONS = Object.keys(FOOTBALL_FILTERS).join(",");

function normalizeName(s) {
  // Strip accents + lower : "Atlético" → "atletico", "France" → "france"
  return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function isMatchInteresting(match) {
  const filter = FOOTBALL_FILTERS[match.competition?.code];
  if (!filter) return false;

  // CL : tous
  if (filter.keywords === null && !filter.stages) return true;

  const home = normalizeName(match.homeTeam?.name);
  const away = normalizeName(match.awayTeam?.name);
  const teamMatch = filter.keywords?.some((kw) => {
    const k = normalizeName(kw);
    return home.includes(k) || away.includes(k);
  });

  // WC/EC : OR entre équipe (France) et stage (quarts/demi/finale)
  if (filter.stages) {
    const stageMatch = filter.stages.includes(match.stage);
    return Boolean(teamMatch || stageMatch);
  }

  return Boolean(teamMatch);
}

exports.getUpcomingFootballEvents = onCall(
  { region: "europe-west1", secrets: ["FOOTBALL_DATA_TOKEN"] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    const cacheRef = db.collection("cache").doc(FOOTBALL_CACHE_DOC);
    const cacheSnap = await cacheRef.get();
    const cached = cacheSnap.exists ? cacheSnap.data() : null;
    const fetchedAtMs = cached?.fetchedAt?.toMillis?.() || 0;
    const ageMs = Date.now() - fetchedAtMs;

    // 1. Cache hit valide → return direct
    if (cached && ageMs < FOOTBALL_CACHE_TTL_MS && Array.isArray(cached.matches)) {
      return { matches: cached.matches, cached: true, ageMs };
    }

    // 2. Cache miss / expiré → fetch upstream
    const token = process.env.FOOTBALL_DATA_TOKEN;
    if (!token) {
      logger.error("[football] FOOTBALL_DATA_TOKEN manquant en runtime.");
      if (cached) return { matches: cached.matches || [], cached: true, stale: true };
      throw new HttpsError("failed-precondition", "Secret football non configuré.");
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + FOOTBALL_HORIZON_DAYS * 24 * 60 * 60 * 1000);
    const dateFrom = now.toISOString().slice(0, 10);
    const dateTo = horizon.toISOString().slice(0, 10);
    const url = `${FOOTBALL_API_BASE}/matches?competitions=${FOOTBALL_COMPETITIONS}&dateFrom=${dateFrom}&dateTo=${dateTo}`;

    try {
      const resp = await fetch(url, { headers: { "X-Auth-Token": token } });

      // Throttling awareness — l'auteur de l'API demande explicitement de
      // surveiller ce header pour ne pas saturer leur rate limiter.
      const remaining = resp.headers.get("X-Requests-Available-Minute");
      if (remaining !== null && parseInt(remaining, 10) < 2) {
        logger.warn(`[football] quota faible : ${remaining}/min restantes.`);
      }

      if (!resp.ok) throw new Error(`football-data HTTP ${resp.status}`);
      const data = await resp.json();
      const filtered = (data?.matches || [])
        .filter(isMatchInteresting)
        .map((m) => ({
          id: m.id,
          utcDate: m.utcDate,
          status: m.status,
          stage: m.stage,
          competition: { code: m.competition?.code, name: m.competition?.name },
          homeTeam: { name: m.homeTeam?.name, crest: m.homeTeam?.crest },
          awayTeam: { name: m.awayTeam?.name, crest: m.awayTeam?.crest },
        }));

      await cacheRef.set({
        matches: filtered,
        fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        upstreamRemainingMinute: remaining,
      });

      return { matches: filtered, cached: false };
    } catch (err) {
      logger.error("[football] fetch failed:", err.message);
      // Fail-safe : on retombe sur un vieux cache si dispo
      if (cached?.matches) {
        return { matches: cached.matches, cached: true, stale: true, ageMs };
      }
      throw new HttpsError("unavailable", "Données football indisponibles.");
    }
  }
);

// ============================================================================
// 🤖 FONCTION 7 : STRIPE WEBHOOK (SAAS BILLING B2B)
// ============================================================================
// Écoute les événements Stripe (ex: invoice.payment_failed) pour couper 
// automatiquement l'accès (maintenance) en cas de non-paiement de l'abonnement.

exports.stripeWebhook = onRequest({ region: "europe-west9" }, async (request, response) => {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const sig = request.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        // Stripe SDK requires the raw body buffer for signature verification
        event = stripe.webhooks.constructEvent(request.rawBody, sig, endpointSecret);
    } catch (err) {
        console.error(`⚠️ Webhook signature verification failed.`, err.message);
        return response.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        if (event.type === 'invoice.payment_failed' || event.type === 'customer.subscription.deleted') {
            const invoice = event.data.object;
            const subscriptionId = invoice.subscription || invoice.id; // if subscription deleted event
            
            if (subscriptionId) {
                // Find the Snack with this subscription ID
                const snacksSnapshot = await db.collection("snacks").where("stripeSubscriptionId", "==", subscriptionId).get();
                
                if (!snacksSnapshot.empty) {
                    const snackDoc = snacksSnapshot.docs[0];
                    await snackDoc.ref.update({ maintenanceMode: true });
                    console.log(`🔒 LOCATAIRE SUSPENDU: Le snack ${snackDoc.id} a été mis en maintenance suite à un échec de paiement (Sub: ${subscriptionId}).`);
                }
            }
        }
        else if (event.type === 'invoice.payment_succeeded') {
            const invoice = event.data.object;
            const subscriptionId = invoice.subscription;
            
            if (subscriptionId) {
                // Find the Snack with this subscription ID
                const snacksSnapshot = await db.collection("snacks").where("stripeSubscriptionId", "==", subscriptionId).get();
                
                if (!snacksSnapshot.empty) {
                    const snackDoc = snacksSnapshot.docs[0];
                    // Si on veut être gentil, on le remet en ligne automatiquement.
                    // await snackDoc.ref.update({ maintenanceMode: false });
                    console.log(`✅ PAIEMENT SAAS REÇU: Le snack ${snackDoc.id} a payé son abonnement (Sub: ${subscriptionId}).`);
                }
            }
        }

        response.json({ received: true });
    } catch (error) {
        console.error("❌ Erreur traitement Webhook :", error);
        response.status(500).send("Internal Server Error");
    }
});
