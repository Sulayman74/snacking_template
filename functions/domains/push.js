// ============================================================================
// 🔔 PUSH — enregistrement des appareils (abonnements par snack / app)
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("../lib/admin");
const { V, require_ } = require("../lib/validation");
const { enforceRateLimit, callerKey } = require("../lib/rateLimit");
const { PUSH_APPS, upsertSubscription } = require("../lib/pushTargets");

// Token FCM : base64url + ":" (format opaque, borné).
const FCM_TOKEN_RE = /^[A-Za-z0-9_:-]{20,4096}$/;

/**
 * Enregistre le token push de l'appareil courant pour un snack et une app
 * (client / admin / livreur). Seul point d'écriture de `pushSubscriptions`
 * (règles Firestore fermées). Le rôle admin/livreur est vérifié côté serveur.
 * @param {object} request.data - `{ token, snackId, app }`.
 */
exports.registerPushToken = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const uid = request.auth.uid;

  await enforceRateLimit({ key: callerKey(request, "registerPushToken"), max: 20, windowMs: 60_000 });

  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { token, snackId, app } = data;
  require_(V.isString(token) && FCM_TOKEN_RE.test(token), "Token push invalide.");
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(PUSH_APPS.includes(app), "app invalide.");

  const snackSnap = await db.collection("snacks").doc(snackId).get();
  if (!snackSnap.exists) throw new HttpsError("not-found", "Snack introuvable.");

  // Admin / livreur : le compte doit réellement avoir ce rôle DANS ce snack
  // (sinon n'importe qui recevrait les alertes cuisine d'un restaurant).
  if (app !== "client") {
    const userSnap = await db.collection("users").doc(uid).get();
    const user = userSnap.exists ? userSnap.data() : {};
    if (user.role !== app || user.snackId !== snackId) {
      throw new HttpsError("permission-denied", "Rôle non autorisé pour ce restaurant.");
    }
  }

  await upsertSubscription({ uid, snackId, app, token });
  return { ok: true };
});
