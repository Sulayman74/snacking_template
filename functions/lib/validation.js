// ============================================================================
// 🛡️ VALIDATION — primitives + garde require_ (transversal, tous domaines)
// ============================================================================
// Ne fais jamais confiance aux entrées client (CLAUDE.md §6.3). Utilisé par toutes
// les Cloud Functions pour valider les payloads avant toute écriture/débit.

const { HttpsError } = require("firebase-functions/v2/https");

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

module.exports = { V, require_ };
