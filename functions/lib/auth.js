// ============================================================================
// 🔐 AUTH — vérification rôle admin du snack (côté serveur)
// ============================================================================
// Rôles lus en Firestore (cohérent avec firestore.rules : getAuthUser()), PAS en
// custom claims. Utilisé par ~10 functions admin (onboarding, scan, push, etc.).

const { HttpsError } = require("firebase-functions/v2/https");
const { db } = require("./admin");

// Vérifie que l'appelant est admin du snack (ou superadmin). Rôles en Firestore
// (cohérent avec firestore.rules : getAuthUser()), PAS en custom claims.
async function assertCallerIsSnackAdmin(request, snackId) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  const c = callerDoc.exists ? callerDoc.data() : null;
  const ok = c && (c.role === "superadmin" || (c.role === "admin" && c.snackId === snackId));
  if (!ok) throw new HttpsError("permission-denied", "Réservé à l'administrateur du snack.");
}

module.exports = { assertCallerIsSnackAdmin };
