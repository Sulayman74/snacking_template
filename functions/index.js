const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
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

// --- Géo & ETA livraison (Haversine, sans dépendance) -----------------------
// Dupliqué côté client dans src/services/geoService.js (KISS : pas de package
// partagé entre /functions CommonJS et /src ESM). Source de vérité = serveur.
const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;
const isFiniteNum = (n) => typeof n === "number" && Number.isFinite(n);
const numberOrNull = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function haversineKm(a, b) {
  if (!a || !b || !isFiniteNum(a.lat) || !isFiniteNum(a.lng) || !isFiniteNum(b.lat) || !isFiniteNum(b.lng)) {
    return NaN;
  }
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Vérifie que l'appelant est admin du snack (ou superadmin). Rôles en Firestore
// (cohérent avec firestore.rules : getAuthUser()), PAS en custom claims.
async function assertCallerIsSnackAdmin(request, snackId) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const c = callerDoc.exists ? callerDoc.data() : null;
  const ok = c && (c.role === "superadmin" || (c.role === "admin" && c.snackId === snackId));
  if (!ok) throw new HttpsError("permission-denied", "Réservé à l'administrateur du snack.");
}

// Palier de géofence franchi (mètres) parmi des seuils décroissants.
// Renvoie le plus petit seuil >= distance, ou null si au-delà du plus grand.
function bucketForServer(distanceM, thresholds = [3000, 1000, 300]) {
  if (!Number.isFinite(distanceM)) return null;
  const sorted = [...thresholds].sort((a, b) => b - a);
  let crossed = null;
  for (const t of sorted) if (distanceM <= t) crossed = t;
  return crossed;
}

// Nombre de commandes "en cours" pour un snack (file d'attente cuisine).
async function getKitchenQueueCount(snackId) {
  try {
    const agg = await db
      .collection("commandes")
      .where("snackId", "==", snackId)
      .where("statut", "in", ["en_attente_client", "nouvelle"])
      .count()
      .get();
    return agg.data().count || 0;
  } catch (e) {
    console.warn("[eta] queue count indisponible :", e.message);
    return 0;
  }
}

// --- Anti-fraude prix : recalcul depuis la base, jamais le prix du client ------
// Ensemble des prix unitaires LÉGITIMES d'un produit (en centimes) :
//   - base : `prix` (produit simple) OU chaque `tailles[].prix` (produit taillé)
//   - +menu : base + (menuPriceAdd || 2.5), réplique exacte du calcul client
//             (src/product-modal.js : prixMenu = menuPriceAdd || 2.5).
// On inclut toujours la variante menu : elle ne fait qu'AUGMENTER le prix, donc
// l'autoriser ne peut pas baisser le plancher anti-fraude.
function allowedUnitPriceCents(product) {
  const cents = (e) => Math.round(Number(e) * 100);
  const menuAdd = product.menuPriceAdd || 2.5; // 0/undefined → 2.5 (cf. client)
  const bases =
    Array.isArray(product.tailles) && product.tailles.length > 0
      ? product.tailles.map((t) => Number(t.prix))
      : [Number(product.prix)];

  const set = new Set();
  for (const b of bases) {
    if (!Number.isFinite(b)) continue;
    set.add(cents(b));
    set.add(cents(b + menuAdd));
  }
  return set;
}

// Vérifie que CHAQUE prix unitaire facturé correspond à un prix réel du produit
// en base, puis que le montant encaissé par Stripe couvre au moins la somme des
// articles. Lève une HttpsError si une manipulation de prix est détectée.
async function assertCartPricesAreLegit(cartItems, paidAmountCents, snackId) {
  const TOL = 1; // ±1 centime (arrondis flottants)

  // Lecture groupée des produits (un getAll au lieu de N getDoc).
  const ids = [...new Set(cartItems.map((i) => i.productId).filter(Boolean))];
  require_(ids.length > 0, "Aucun produit identifiable dans le panier.");
  const refs = ids.map((id) => db.collection("produits").doc(id));
  const snaps = await db.getAll(...refs);
  const products = new Map();
  snaps.forEach((s) => { if (s.exists) products.set(s.id, s.data()); });

  let expectedItemsCents = 0;
  for (const item of cartItems) {
    const product = products.get(item.productId);
    require_(!!product, `Produit introuvable : ${item.productId}.`);
    // Cloisonnement multi-tenant : le produit doit appartenir au snack commandé.
    require_(product.snackId === snackId, "Produit hors du restaurant ciblé.");

    const paidCents = Math.round(Number(item.prix) * 100);
    const allowed = allowedUnitPriceCents(product);
    const ok = [...allowed].some((a) => Math.abs(a - paidCents) <= TOL);
    require_(ok, `Prix manipulé pour « ${item.nom} » (${item.prix} € non autorisé).`);

    expectedItemsCents += paidCents * item.quantity;
  }

  // Le montant réellement encaissé (immuable, source Stripe) doit AU MOINS couvrir
  // la valeur des articles. La livraison ne peut qu'ajouter par-dessus.
  require_(
    paidAmountCents + TOL >= expectedItemsCents,
    "Montant encaissé inférieur à la valeur réelle du panier."
  );
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

      // ⚠️ On préserve le token de téléchargement existant. Le client appelle
      // getDownloadURL() (qui pose firebaseStorageDownloadTokens) puis stocke l'URL
      // dans Firestore. Réécrire l'objet sans reporter ce token l'invaliderait
      // → l'URL en base renverrait 403 (image cassée). On le lit juste avant l'upload
      // pour laisser le temps au getDownloadURL client de l'avoir posé.
      let downloadToken;
      try {
        const [existingMeta] = await bucket.file(filePath).getMetadata();
        downloadToken = existingMeta?.metadata?.firebaseStorageDownloadTokens;
      } catch (e) {
        logger.warn("Lecture du token existant impossible (conservation ignorée) :", e);
      }

      logger.log("Upload de l'image optimisée...");
      await bucket.upload(tempOptimizedPath, {
        destination: filePath,
        metadata: {
          contentType: "image/webp",
          metadata: {
            optimized: "true",
            ...(downloadToken ? { firebaseStorageDownloadTokens: downloadToken } : {}),
          },
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
        // 🔒 Claim atomique : on réserve la campagne (en_attente → en_cours) AVANT
        // tout envoi. Si un autre run l'a déjà prise (le CAS échoue) → on l'ignore.
        // Anti double-envoi si deux exécutions du cron se chevauchent (run > 5 min).
        try {
          await db.runTransaction(async (tx) => {
            const fresh = await tx.get(doc.ref);
            if (!fresh.exists || fresh.data().statut !== "en_attente") {
              throw new Error("already-claimed");
            }
            tx.update(doc.ref, { statut: "en_cours" });
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

    // 🛡️ Authentification obligatoire : le client est forcément loggé pour
    // commander (cf. src/checkout.js). Ferme la porte aux appels anonymes
    // (création massive d'intents / sondage des snackId).
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

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

          // 🛡️ Garde : compte connecté créé mais onboarding NON terminé
          // (statut synchronisé par account.updated / getStripeAccountStatus).
          // On bloque seulement si explicitement false → sinon comportement inchangé.
          if (stripeAccountId && snackData.stripeChargesEnabled === false) {
            throw new HttpsError(
              "failed-precondition",
              "Le compte Stripe du restaurant n'a pas terminé sa configuration."
            );
          }

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
        // Metadata SERVEUR de confiance (traçabilité) en plus de celles du client.
        // order_id ≡ paymentIntentId (id de commande déterministe dans finalizeOrder),
        // donc déjà traçable sans le dupliquer ici.
        metadata: sanitizeStripeMetadata({
          ...(metadata || {}),
          snack_id: snackId || "",
          client_email: request.auth?.token?.email || metadata?.clientEmail || "",
        }),
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
// 🏦 STRIPE CONNECT : ONBOARDING (Account Link) + PORTAIL (Login Link)
// ============================================================================
// Crée (idempotent) le compte Express du snack et renvoie un lien d'onboarding.
// L'écriture de `stripeAccountId` se fait via l'Admin SDK — JAMAIS par le client
// (la rule snacks/write est document-level → ne pas laisser un admin l'auto-écrire).
exports.getStripeOnboardingLink = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  const { snackId, origin } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  // URL de retour construite SERVEUR depuis une origine whitelistée (anti open-redirect).
  require_(
    V.isString(origin) && (
      /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/i.test(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ),
    "origin invalide."
  );
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "getStripeOnboardingLink"), max: 5, windowMs: 60_000 });

  try {
    const ref = db.collection("snacks").doc(snackId);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    let accountId = data.stripeAccountId || null;

    // Idempotence : on ne crée le compte connecté qu'une seule fois.
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: data.country || "FR",
        email: data.email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { snack_id: snackId },
      });
      accountId = account.id;
      await ref.set({ stripeAccountId: accountId }, { merge: true });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${origin}/admin.html?stripe=refresh`,
      return_url: `${origin}/admin.html?stripe=return`,
    });
    return { url: link.url };
  } catch (error) {
    console.error("❌ Erreur getStripeOnboardingLink :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible de générer le lien d'onboarding Stripe.");
  }
});

// Lien de connexion au portail Stripe Express (compte déjà créé).
// Appelé par le bouton "Ouvrir mon portail" (src/admin.js → openStripeExpressDashboard).
exports.createStripeConnectLoginLink = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  const { snackId } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "createStripeConnectLoginLink"), max: 10, windowMs: 60_000 });

  try {
    const snap = await db.collection("snacks").doc(snackId).get();
    const accountId = snap.exists ? snap.data().stripeAccountId : null;
    require_(V.isNonEmptyString(accountId), "Compte Stripe non configuré pour ce snack.");
    const link = await stripe.accounts.createLoginLink(accountId);
    return { url: link.url };
  } catch (error) {
    console.error("❌ Erreur createStripeConnectLoginLink :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible d'ouvrir le portail Stripe.");
  }
});

// Statut LIVE du compte connecté (charges_enabled / details_submitted) + sync Firestore.
// Permet à l'UI de distinguer "compte créé mais onboarding incomplet" de "actif",
// sans dépendre de la configuration du webhook account.updated.
exports.getStripeAccountStatus = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  const { snackId } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "getStripeAccountStatus"), max: 20, windowMs: 60_000 });

  try {
    const ref = db.collection("snacks").doc(snackId);
    const snap = await ref.get();
    const accountId = snap.exists ? snap.data().stripeAccountId : null;
    if (!accountId) return { connected: false, chargesEnabled: false, detailsSubmitted: false };

    const account = await stripe.accounts.retrieve(accountId);
    // Synchronise le statut dans Firestore au passage (source de vérité pour createPaymentIntent).
    await ref.set({
      stripeChargesEnabled: !!account.charges_enabled,
      stripeDetailsSubmitted: !!account.details_submitted,
      stripePayoutsEnabled: !!account.payouts_enabled,
    }, { merge: true });

    return {
      connected: true,
      chargesEnabled: !!account.charges_enabled,
      detailsSubmitted: !!account.details_submitted,
      payoutsEnabled: !!account.payouts_enabled,
    };
  } catch (error) {
    console.error("❌ Erreur getStripeAccountStatus :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible de lire le statut Stripe.");
  }
});

// ============================================================================
// 💼 ABONNEMENT SaaS (Stripe Billing) : lien Checkout à envoyer au restaurateur
// ============================================================================
// SUPERADMIN uniquement. Montant mensuel choisi (ex. 20/39/49 €) → prix INLINE
// (price_data), donc aucun Price à pré-créer dans Stripe. Le snack_id voyage en
// metadata → le webhook checkout.session.completed lie l'abonnement au snack.
exports.createSubscriptionCheckout = onCall({ region: "europe-west1" }, async (request) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  const { snackId, amountEur, origin } = request.data || {};
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isPositiveInt(amountEur, 1000) && amountEur >= 5, "Montant invalide (5 à 1000 €).");
  require_(
    V.isString(origin) && (
      /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/i.test(origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ),
    "origin invalide."
  );

  // 🛡️ Superadmin uniquement.
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== "superadmin") {
    throw new HttpsError("permission-denied", "Réservé au superadmin.");
  }
  await enforceRateLimit({ key: callerKey(request, "createSubscriptionCheckout"), max: 30, windowMs: 3_600_000 });

  const snackSnap = await db.collection("snacks").doc(snackId).get();
  require_(snackSnap.exists, "Snack introuvable.");
  const snackName = snackSnap.data().nom || snackId;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          product_data: { name: `Abonnement SaaS — ${snackName}` },
          unit_amount: amountEur * 100, // centimes
          recurring: { interval: "month" },
        },
      }],
      metadata: { snack_id: snackId },
      subscription_data: { metadata: { snack_id: snackId } },
      allow_promotion_codes: true,
      success_url: `${origin}/admin.html?sub=success`,
      cancel_url: `${origin}/superadmin.html?sub=cancel`,
    });
    return { url: session.url };
  } catch (error) {
    console.error("❌ createSubscriptionCheckout :", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Impossible de générer le lien d'abonnement.");
  }
});

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
      mode,
      livraison,
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

    // 🚚 Mode + adresse de livraison (collect par défaut → legacy inchangé).
    const orderMode = mode === "delivery" ? "delivery" : "collect";
    if (orderMode === "delivery") {
      require_(V.isPlainObject(livraison), "livraison requise pour une commande en livraison.");
      require_(isFiniteNum(livraison.lat) && Math.abs(livraison.lat) <= 90, "Latitude de livraison invalide.");
      require_(isFiniteNum(livraison.lng) && Math.abs(livraison.lng) <= 180, "Longitude de livraison invalide.");
      require_(
        livraison.adresse === undefined ||
          livraison.adresse === null ||
          (V.isString(livraison.adresse) && livraison.adresse.length <= 300),
        "Adresse de livraison invalide."
      );
    }

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
    let snackData = {};
    try {
      const snackDoc = await db.collection("snacks").doc(snackId).get();
      if (snackDoc.exists) {
          snackData = snackDoc.data() || {};
      }
      const stripeAccountId = snackData.stripeAccountId || null;

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

    // 4. Idempotence ATOMIQUE — l'ID de la commande est dérivé du PaymentIntent
    //    (unique côté Stripe). Un check rapide évite de recalculer si la commande
    //    existe déjà ; la garantie anti-race repose sur le create() atomique (§5).
    const orderId = paymentIntentId;
    const docRef = db.collection("commandes").doc(orderId);
    const existingDoc = await docRef.get();
    if (existingDoc.exists) {
      return { orderId };
    }

    // 🛡️ ANTI-FRAUDE PRIX — chaque prix unitaire doit correspondre à un prix réel
    // du produit en base, et le montant encaissé doit couvrir la valeur du panier.
    // On ne fait JAMAIS confiance au prix envoyé par le client (cf. CLAUDE.md §6.1).
    await assertCartPricesAreLegit(cartItems, paymentIntent.amount, snackId);

    // 🚚 ETA (heuristique simple) + livraison — TOUT recalculé serveur.
    const dcfg = snackData.delivery || {};
    const prepBaseMin = isFiniteNum(dcfg.prepBaseMin) ? dcfg.prepBaseMin : 12;
    const queueFactorMin = isFiniteNum(dcfg.queueFactorMin) ? dcfg.queueFactorMin : 3;
    const avgSpeedKmh = isFiniteNum(dcfg.avgSpeedKmh) && dcfg.avgSpeedKmh > 0 ? dcfg.avgSpeedKmh : 22;

    const queueCount = await getKitchenQueueCount(snackId);
    const prepMin = Math.max(1, Math.round(prepBaseMin + queueFactorMin * queueCount));

    let livraisonData = null;
    let deliveryMin = null;
    if (orderMode === "delivery") {
      const resto = { lat: numberOrNull(snackData.restaurantLat), lng: numberOrNull(snackData.restaurantLng) };
      const client = { lat: livraison.lat, lng: livraison.lng };
      const distanceKm = haversineKm(resto, client);
      const hasDist = Number.isFinite(distanceKm);
      deliveryMin = hasDist ? Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60)) : 0;
      livraisonData = {
        adresse: (livraison.adresse || "").toString().slice(0, 300),
        lat: client.lat,
        lng: client.lng,
        distanceKm: hasDist ? Math.round(distanceKm * 10) / 10 : null,
        frais: isFiniteNum(dcfg.frais) ? dcfg.frais : 0, // frais issus de la config (jamais du client)
      };
    }

    const totalMin = prepMin + (deliveryMin || 0);
    const etaData = {
      prepMin,
      deliveryMin,
      totalMin,
      computedAt: admin.firestore.Timestamp.now(),
      readyAt: admin.firestore.Timestamp.fromMillis(Date.now() + totalMin * 60000),
    };

    // 5. Créer la commande dans Firestore (uniquement si tout est vérifié)
    const newOrder = {
      snackId,
      userId: uid,
      clientNom: clientNom || clientEmail.split("@")[0],
      clientEmail,
      secretCode: generateSecretCode(6),
      date: admin.firestore.FieldValue.serverTimestamp(),
      // Collect : on attend l'arrivée du client avant de cuisiner.
      // Livraison : la cuisine démarre immédiatement (pas d'arrivée client).
      statut: orderMode === "delivery" ? "nouvelle" : "en_attente_client",
      items: cartItems,
      total: paymentIntent.amount / 100,
      mode: orderMode,
      livraison: livraisonData,
      livreurId: null,
      livreur: null,
      eta: etaData,
      paiement: {
        methode: "carte_bancaire",
        statut: "paye",
        stripeSessionId: paymentIntentId,
      },
    };

    // create() échoue si le doc existe déjà → idempotence atomique contre la race
    // "double-clic / retry réseau" (deux appels concurrents ayant tous deux passé
    // le check ci-dessus). Le perdant retourne l'orderId existant SANS rejouer le
    // parrainage (increment) ni lastOrderDate.
    try {
      await docRef.create(newOrder);
    } catch (e) {
      if (e.code === 6 || e.code === "already-exists") {
        return { orderId };
      }
      throw e;
    }

    // 🍟 POST-CRÉATION (best-effort) — parrainage + lastOrderDate. Un échec ici
    // ne doit JAMAIS faire échouer la réponse : la commande est créée et le
    // paiement confirmé (create() déterministe = pas de double-charge au retry).
    try {
      const userRef = db.collection("users").doc(uid);
      const userDoc = await userRef.get();

      // Première commande de l'utilisateur (lastOrderDate inexistant) ?
      // NB: .exists est une PROPRIÉTÉ dans l'Admin SDK (pas une méthode).
      if (referrerId && referrerId !== uid && (!userDoc.exists || !userDoc.data().lastOrderDate)) {
        const referrerRef = db.collection("users").doc(referrerId);
        const referrerDoc = await referrerRef.get();

        if (referrerDoc.exists) {
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
    } catch (postErr) {
      // Commande déjà créée + payée → on renvoie quand même un succès.
      console.error("finalizeOrder post-création (parrainage/lastOrderDate) échouée :", postErr);
    }

    return { orderId };
  }
);

// ============================================================================
// 🚚 FONCTION : CRÉER UN LIVREUR (réservé admin du snack)
// ============================================================================
// Crée le compte Auth + le doc users/{uid} avec role 'livreur' (admin SDK →
// contourne la règle 'create' qui force role:'client'). Le livreur se connecte
// ensuite sur /livreur.html.
exports.createDriver = onCall({ region: "europe-west1" }, async (request) => {
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");

  const { snackId, nom, email, password, telephone } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isNonEmptyString(nom, 100), "Nom invalide.");
  require_(V.isEmail(email), "Email invalide.");
  require_(
    V.isString(password) && password.length >= 6 && password.length <= 100,
    "Mot de passe invalide (6 à 100 caractères)."
  );
  require_(
    telephone === undefined || telephone === null || (V.isString(telephone) && telephone.length <= 30),
    "Téléphone invalide."
  );

  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "createDriver"), max: 20, windowMs: 3_600_000 });

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: nom });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email est déjà utilisé.");
    }
    if (e.code === "auth/invalid-password" || e.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Email ou mot de passe invalide.");
    }
    console.error("createDriver auth error:", e);
    throw new HttpsError("internal", "Création du compte impossible.");
  }

  await db.collection("users").doc(userRecord.uid).set({
    role: "livreur",
    snackId,
    nom,
    email,
    telephone: telephone || "",
    actif: true,
    points: 0,
    createdBy: request.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { uid: userRecord.uid };
});

// Crée le compte admin d'un snack (Auth + users/{uid} role:'admin'). SUPERADMIN
// uniquement. Mot de passe temporaire généré serveur, renvoyé UNE fois pour être
// transmis au restaurateur (qui le changera). Débloque l'accès à /admin.html.
exports.createSnackAdmin = onCall({ region: "europe-west1" }, async (request) => {
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { snackId, email, nom } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isEmail(email), "Email invalide.");
  require_(
    nom === undefined || nom === null || (V.isString(nom) && nom.length <= 100),
    "Nom invalide."
  );

  // 🛡️ Superadmin uniquement (création d'un compte admin = action sensible).
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== "superadmin") {
    throw new HttpsError("permission-denied", "Réservé au superadmin.");
  }
  await enforceRateLimit({ key: callerKey(request, "createSnackAdmin"), max: 20, windowMs: 3_600_000 });

  const snackSnap = await db.collection("snacks").doc(snackId).get();
  require_(snackSnap.exists, "Snack introuvable.");

  const tempPassword = generateSecretCode(10); // affiché 1 fois au superadmin
  const displayName = nom || email.split("@")[0];

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password: tempPassword, displayName });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email est déjà utilisé.");
    }
    if (e.code === "auth/invalid-password" || e.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Email ou mot de passe invalide.");
    }
    console.error("createSnackAdmin auth error:", e);
    throw new HttpsError("internal", "Création du compte impossible.");
  }

  await db.collection("users").doc(userRecord.uid).set({
    role: "admin",
    snackId,
    nom: displayName,
    email,
    pointsBySnack: {},
    createdBy: request.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { uid: userRecord.uid, email, tempPassword };
});

// ============================================================================
// ❤️ FIDÉLITÉ : crédit d'un point côté SERVEUR (transaction + anti double-scan)
// ============================================================================
// Remplace l'écriture client du scanner (src/scanner.js). L'admin du snack (ou
// superadmin) scanne le QR (uid client) → +1 point, ou remise à 0 + récompense
// au palier de 10. Transaction = pas de race au seuil ; cooldown = pas de double-scan.
exports.awardLoyaltyPoint = onCall({ region: "europe-west1" }, async (request) => {
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { clientUid, snackId } = data;
  require_(V.isDocId(clientUid), "clientUid invalide.");
  require_(V.isDocId(snackId), "snackId invalide.");

  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "awardLoyaltyPoint"), max: 60, windowMs: 60_000 });

  const MAX_POINTS = 10;
  const COOLDOWN_MS = 20_000; // anti double-scan accidentel
  const clientRef = db.collection("users").doc(clientUid);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(clientRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Ce QR code n'est pas dans la base.");
    }
    const d = snap.data();
    const current = (d.pointsBySnack || {})[snackId] || 0;
    const lastScan = (d.loyaltyLastScan || {})[snackId];
    const lastMs = lastScan && lastScan.toMillis ? lastScan.toMillis() : 0;

    // Anti-rejeu : refuse un re-scan trop rapproché (double-scan accidentel).
    if (lastMs && Date.now() - lastMs < COOLDOWN_MS) {
      throw new HttpsError("failed-precondition", "Carte déjà scannée à l'instant.");
    }

    let newPoints;
    let reward = false;
    if (current >= MAX_POINTS) {
      newPoints = 0;        // palier atteint → menu offert, carte remise à 0
      reward = true;
    } else {
      newPoints = current + 1;
    }

    tx.update(clientRef, {
      [`pointsBySnack.${snackId}`]: newPoints,
      [`loyaltyLastScan.${snackId}`]: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { points: newPoints, max: MAX_POINTS, reward };
  });
});

// ============================================================================
// 🛎️ FONCTION : ALERTE ADMINS À CHAQUE NOUVELLE COMMANDE (push cuisine)
// ============================================================================
// Notifie les admins du snack même tablette en veille / arrière-plan (le bip
// in-app ne marche qu'au premier plan). Query equality-only (snackId + role)
// → pas d'index composite requis (index merging).
exports.notifyAdminsOnNewOrder = onDocumentCreated(
  "commandes/{orderId}",
  async (event) => {
    const order = event.data?.data();
    if (!order?.snackId) return;

    try {
      const adminsSnap = await db
        .collection("users")
        .where("snackId", "==", order.snackId)
        .where("role", "==", "admin")
        .get();

      const targets = [];
      adminsSnap.forEach((d) => {
        const token = d.data().fcmToken;
        if (token) targets.push({ uid: d.id, token });
      });
      if (targets.length === 0) return;

      const modeLabel = order.mode === "delivery" ? "Livraison" : "Sur place";
      const total = typeof order.total === "number" ? `${order.total.toFixed(2)}€` : "";
      const client = order.clientNom || "Client";

      const response = await getMessaging().sendEachForMulticast({
        notification: { title: "🛎️ Nouvelle commande", body: `${client} · ${total} · ${modeLabel}` },
        webpush: { fcm_options: { link: "https://snacking-template.web.app/admin.html" } },
        tokens: targets.map((t) => t.token),
      });

      // Nettoyage des tokens devenus invalides.
      await Promise.all(
        response.responses.map((r, i) =>
          r.success ? null : cleanupInvalidFcmToken(targets[i].uid, r.error)
        )
      );
      console.log(`🛎️ Alerte commande envoyée à ${targets.length} admin(s) (snack ${order.snackId}).`);
    } catch (error) {
      console.error("❌ Erreur notifyAdminsOnNewOrder :", error);
    }
  },
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

    // On ne déclenche que sur un VRAI changement de statut.
    if (oldData.statut === newData.statut) return;

    const shortId = orderId.slice(-4).toUpperCase();
    const isDelivery = newData.mode === "delivery";

    // Message adapté au statut + au mode (collect / livraison).
    let notif = null;
    if (newData.statut === "prete") {
      notif = isDelivery
        ? { title: "Commande prête ✅", body: `Votre commande #${shortId} est prête, un livreur va la récupérer.` }
        : { title: "C'est prêt ! 🍟", body: `Votre commande #${shortId} est prête. Bon appétit !` };
    } else if (newData.statut === "en_livraison") {
      notif = { title: "En route ! 🛵", body: `Votre commande #${shortId} est en chemin.` };
    } else if (newData.statut === "livree") {
      notif = { title: "Livré ! 🎉", body: `Bon appétit ! Merci pour votre commande #${shortId}.` };
    }
    if (!notif) return;

    const userId = newData.userId;
    try {
      const userDoc = await db.collection("users").doc(userId).get();
      const fcmToken = userDoc.exists ? userDoc.data().fcmToken : null;
      if (!fcmToken) {
        console.log(`⚠️ Pas de token FCM pour l'utilisateur ${userId}.`);
        return;
      }
      const response = await getMessaging().send({
        notification: notif,
        webpush: { fcm_options: { link: "https://snacking-template.web.app/" } },
        token: fcmToken,
      });
      console.log(`✅ Notif "${newData.statut}" envoyée pour commande ${orderId} :`, response);
    } catch (error) {
      console.error("❌ Erreur lors de l'envoi de la notification de commande :", error);
      await cleanupInvalidFcmToken(userId, error);
    }
  },
);

// ============================================================================
// 🛰️ FONCTION : GÉOFENCING LIVREUR → NOTIFS DE DISTANCE AU CLIENT
// ============================================================================
// Déclenchée à chaque mise à jour de position du livreur. Recalcule la distance
// Haversine livreur→client (source de vérité SERVEUR) et notifie le client à
// chaque palier franchi (3 km / 1 km / 300 m), UNE seule fois par palier.
exports.onDriverPositionUpdate = onDocumentUpdated(
  "commandes/{orderId}",
  async (event) => {
    const after = event.data.after.data();
    const before = event.data.before.data();

    if (after.statut !== "en_livraison" || after.mode !== "delivery") return;

    const newPos = after.livreur?.position;
    const oldPos = before.livreur?.position;
    if (!newPos || !isFiniteNum(newPos.lat) || !isFiniteNum(newPos.lng)) return;
    // Position réellement modifiée (évite la boucle après update de lastNotifiedBucket).
    if (oldPos && oldPos.lat === newPos.lat && oldPos.lng === newPos.lng) return;

    const client = after.livraison;
    if (!client || !isFiniteNum(client.lat) || !isFiniteNum(client.lng)) return;

    const distM = haversineKm(newPos, client) * 1000;
    const bucket = bucketForServer(distM);
    if (bucket == null) return; // encore au-delà du plus grand palier

    const last = after.livreur?.lastNotifiedBucket ?? null;
    // On ne notifie qu'en se rapprochant (palier strictement plus petit).
    if (last != null && bucket >= last) return;

    // Marque le palier AVANT l'envoi (idempotence, pas de double notif).
    await event.data.after.ref.update({ "livreur.lastNotifiedBucket": bucket });

    const userId = after.userId;
    try {
      const userDoc = await db.collection("users").doc(userId).get();
      const fcmToken = userDoc.exists ? userDoc.data().fcmToken : null;
      if (!fcmToken) return;

      const label = bucket >= 1000 ? `${bucket / 1000} km` : `${bucket} m`;
      const body = bucket <= 300 ? `Votre livreur arrive (${label}), préparez-vous !` : `Votre livreur est à ${label} environ.`;
      await getMessaging().send({
        notification: { title: "🛵 Votre livreur approche", body },
        webpush: { fcm_options: { link: "https://snacking-template.web.app/" } },
        token: fcmToken,
      });
    } catch (error) {
      console.error("❌ Erreur notif géofence :", error);
      await cleanupInvalidFcmToken(userId, error);
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

    // 🛡️ Idempotence — Stripe garantit une livraison "at-least-once" (retries).
    // create() est atomique : si l'event a déjà été traité, on ACK (200) sans rejouer.
    const eventRef = db.collection("stripeEvents").doc(event.id);
    try {
        await eventRef.create({
            type: event.type,
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        if (e.code === 6 || e.code === "already-exists") {
            return response.json({ received: true, duplicate: true });
        }
        console.error("❌ Erreur garde idempotence Webhook :", e);
        return response.status(500).send("Internal Server Error");
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
                    // Réactivation automatique : un snack suspendu pour impayé qui
                    // règle son abonnement doit être remis en ligne (sinon il reste
                    // bloqué malgré le paiement).
                    await snackDoc.ref.update({ maintenanceMode: false });
                    console.log(`✅ PAIEMENT SAAS REÇU: Le snack ${snackDoc.id} réactivé après paiement (Sub: ${subscriptionId}).`);
                }
            }
        }
        else if (event.type === 'checkout.session.completed') {
            // 💼 Abonnement SaaS souscrit par un resto → on lie l'abonnement au snack
            // (via metadata.snack_id) et on l'active. Les invoices récurrentes suivantes
            // sont gérées par invoice.payment_failed/succeeded (réf. stripeSubscriptionId).
            const session = event.data.object;
            const snackId = session.metadata && session.metadata.snack_id;
            if (snackId && session.subscription && session.mode === 'subscription') {
                await db.collection("snacks").doc(snackId).set({
                    stripeSubscriptionId: session.subscription,
                    maintenanceMode: false,
                }, { merge: true });
                console.log(`✅ Abonnement activé: snack ${snackId} (sub ${session.subscription}).`);
            }
        }
        else if (event.type === 'account.updated') {
            // 🏦 CONNECT : synchronise le statut d'onboarding du compte connecté.
            // (Nécessite d'activer l'écoute des events "sur les comptes connectés"
            // dans la config du webhook Stripe.)
            const account = event.data.object;
            const snap = await db.collection("snacks").where("stripeAccountId", "==", account.id).limit(1).get();
            if (!snap.empty) {
                await snap.docs[0].ref.update({
                    stripeChargesEnabled: !!account.charges_enabled,
                    stripeDetailsSubmitted: !!account.details_submitted,
                    stripePayoutsEnabled: !!account.payouts_enabled,
                });
                console.log(`🔄 account.updated: snack ${snap.docs[0].id} charges_enabled=${account.charges_enabled}`);
            }
        }

        response.json({ received: true });
    } catch (error) {
        console.error("❌ Erreur traitement Webhook :", error);
        // On retire le marqueur d'idempotence pour autoriser le retry Stripe
        // (sinon l'event serait considéré "déjà traité" et l'effet jamais appliqué).
        await eventRef.delete().catch(() => {});
        response.status(500).send("Internal Server Error");
    }
});
