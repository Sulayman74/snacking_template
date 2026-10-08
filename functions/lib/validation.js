// ============================================================================
// 🛡️ VALIDATION — primitives + garde require_ (transversal, tous domaines)
// ============================================================================
// Ne fais jamais confiance aux entrées client (CLAUDE.md §6.3). Utilisé par toutes
// les Cloud Functions pour valider les payloads avant toute écriture/débit.
//
// Deux niveaux :
//   - `V` + `require_` : primitives pour les callables « simples » (admin, loyalty…).
//   - `parseInput(schema, data)` : payloads PARTAGÉS avec le client (commande →
//     createPaymentIntent / finalizeOrder), décrits UNE fois dans
//     ../shared/orderSchemas.mjs (valibot) et vérifiés des deux côtés.

const { HttpsError } = require("firebase-functions/v2/https");
// Module ESM chargé par require() natif (Node ≥ 22.12 ; runtime nodejs24).
const shared = require("../shared/orderSchemas.mjs");

// --- Validation primitives ---
const V = {
  isString: (v) => typeof v === "string",
  isNonEmptyString: (v, max = 1000) =>
    typeof v === "string" && v.length > 0 && v.length <= max,
  isInt: (v) => Number.isInteger(v),
  isPositiveInt: (v, max = Number.MAX_SAFE_INTEGER) =>
    Number.isInteger(v) && v > 0 && v <= max,
  isPlainObject: shared.isPlainObject,
  isArray: (v) => Array.isArray(v),
  // Email / id Firestore / téléphone : définition UNIQUE dans shared/orderSchemas.mjs
  // (le client applique exactement les mêmes règles).
  isEmail: shared.isEmail,
  isDocId: shared.isDocId,
  isPhone: shared.isPhone,
};

/**
 * Valide l'objet `livraison` envoyé par le client contre LivraisonSchema (position
 * obligatoire ; adresse, complément et téléphone facultatifs mais bornés).
 * `parseInput` l'applique déjà quand mode === "delivery" ; gardé pour les appels
 * directs et les tests.
 */
function assertLivraisonInput(livraison) {
  const message = shared.firstIssueMessage(shared.LivraisonSchema, livraison);
  if (message) throw new HttpsError("invalid-argument", message);
}

/**
 * Valide `data` contre un schéma de ../shared/orderSchemas.mjs (forme + adresse
 * de livraison si mode === "delivery"). Lève HttpsError invalid-argument avec le
 * message de la PREMIÈRE erreur — celui que le client a pu afficher avant l'appel.
 * @template {import("valibot").GenericSchema} T
 * @param {T} schema
 * @param {unknown} data
 * @returns {{ value: import("valibot").InferOutput<T>, orderMode: "delivery"|"collect" }}
 */
function parseInput(schema, data) {
  const result = shared.validateOrderInput(schema, data);
  if (result.ok === false) throw new HttpsError("invalid-argument", result.message);
  return { value: result.value, orderMode: result.orderMode };
}

function require_(cond, msg) {
  if (!cond) throw new HttpsError("invalid-argument", msg);
}

module.exports = { V, require_, assertLivraisonInput, parseInput };
