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
  // Téléphone saisi librement (espaces, points, tirets, parenthèses, + international) :
  // 6 à 15 chiffres (E.164). Pas de validation par pays : livraisons hors métropole.
  isPhone: (v) => {
    if (typeof v !== "string" || v.length > 25) return false;
    if (!/^\+?[0-9(][0-9 .()-]*$/.test(v.trim())) return false;
    const digits = v.replace(/\D/g, "").length;
    return digits >= 6 && digits <= 15;
  },
};

const isOptional = (v) => v === undefined || v === null || v === "";

/**
 * Valide l'objet `livraison` envoyé par le client (createPaymentIntent ET
 * finalizeOrder). Position obligatoire ; adresse, complément (étage, code…) et
 * téléphone facultatifs mais bornés — facultatifs pour ne pas rejeter une PWA en
 * cache antérieure à ces champs (le client exige le téléphone à la saisie).
 */
function assertLivraisonInput(livraison) {
  require_(V.isPlainObject(livraison), "livraison requise pour une commande en livraison.");
  require_(Number.isFinite(livraison.lat) && Math.abs(livraison.lat) <= 90, "Latitude de livraison invalide.");
  require_(Number.isFinite(livraison.lng) && Math.abs(livraison.lng) <= 180, "Longitude de livraison invalide.");
  require_(
    isOptional(livraison.adresse) || (V.isString(livraison.adresse) && livraison.adresse.length <= 300),
    "Adresse de livraison invalide."
  );
  require_(
    isOptional(livraison.complement) || (V.isString(livraison.complement) && livraison.complement.length <= 200),
    "Complément d'adresse invalide (200 caractères max)."
  );
  require_(isOptional(livraison.telephone) || V.isPhone(livraison.telephone), "Numéro de téléphone invalide.");
}

function require_(cond, msg) {
  if (!cond) throw new HttpsError("invalid-argument", msg);
}

module.exports = { V, require_, assertLivraisonInput };
