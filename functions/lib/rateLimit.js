// ============================================================================
// 🚦 RATE LIMITING — fenêtre glissante atomique (Firestore transaction)
// ============================================================================
// Transversal (~16 functions). Stocke compteur + début de fenêtre par clé (uid/IP +
// action) → atomique, pas de race. callerKey() construit la clé d'identification.

const { HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./admin");

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

module.exports = { enforceRateLimit, callerKey };
