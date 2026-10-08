// ============================================================================
// 🧾 SCHÉMAS DE COMMANDE — source UNIQUE client ⇄ serveur (valibot)
// ----------------------------------------------------------------------------
// Décrit les payloads de createPaymentIntent et finalizeOrder. Le client
// (src/components/SnackCheckout.js) vérifie AVANT l'appel, le serveur
// (functions/domains/payment.js via lib/validation.js → parseInput) revalide à la
// réception avec les MÊMES règles et les MÊMES messages : plus de doublon
// « V côté serveur / forme implicite côté client ».
//
// Module ESM PUR (ni Firebase, ni DOM) : importé par Vite côté client et chargé
// par `require()` natif côté Cloud Functions (Node ≥ 22.12 ; runtime nodejs24).
// Il vit dans functions/ parce que ce dossier est empaqueté seul au déploiement.
//
// ⚠️ Ces schémas ne couvrent que la FORME (types, bornes, champs requis). Les
// règles MÉTIER (prix recalculés en base, zone de livraison, horaires, stock)
// restent dans functions/lib/pricing.js — le client n'est jamais de confiance.
// ============================================================================
import * as v from "valibot";

export const CART_MAX_ITEMS = 100;
export const ITEM_PRICE_MAX_EXCLUSIVE = 10_000; // € (prix unitaire client, revalidé en base)
export const ITEM_QTY_MAX = 100;
export const TOTAL_CENTS_MAX = 1_000_000;

// --- Primitives partagées (functions/lib/validation.js → V les réexporte) ------
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isPlainObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
export const isEmail = (x) => typeof x === "string" && x.length <= 320 && EMAIL_RE.test(x);
// Firestore doc IDs : pas de "/", longueur 1..1500
export const isDocId = (x) =>
  typeof x === "string" && x.length > 0 && x.length <= 1500 && !x.includes("/");
// Téléphone saisi librement (espaces, points, tirets, parenthèses, + international) :
// 6 à 15 chiffres (E.164). Pas de validation par pays : livraisons hors métropole.
export const isPhone = (x) => {
  if (typeof x !== "string" || x.length > 25) return false;
  if (!/^\+?[0-9(][0-9 .()-]*$/.test(x.trim())) return false;
  const digits = x.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 15;
};

/** Mode de commande effectif : "delivery" explicite, tout le reste = collect (legacy). */
export const orderModeOf = (mode) => (mode === "delivery" ? "delivery" : "collect");

// --- Briques ---------------------------------------------------------------
// Objet « lâche » : les clés inconnues sont CONSERVÉES (le serveur lit aussi
// productId, type, supplements, amount…). Une clé ABSENTE remonte le message du
// champ (valibot l'attribue par défaut à l'objet → « Payload invalide. »).
function looseObject(entries, message) {
  return v.looseObject(entries, (issue) => {
    const key = issue.path?.at(-1)?.key;
    const own = key != null ? entries[String(key)]?.message : undefined;
    return typeof own === "string" ? own : message;
  });
}
/** Objet strict : null / tableau / primitif → `message`, puis validation des clés. */
const plainObject = (entries, message) =>
  v.pipe(v.custom(isPlainObject, message), looseObject(entries, message));
/** @param {string} message @param {{ min?: number, max: number }} bounds */
const str = (message, { min = 0, max }) =>
  v.pipe(v.string(message), v.minLength(min, message), v.maxLength(max, message));
const docId = (message) => v.pipe(v.string(message), v.check(isDocId, message));
const positiveInt = (message, max) =>
  v.pipe(v.number(message), v.integer(message), v.minValue(1, message), v.maxValue(max, message));
const coord = (message, bound) =>
  v.pipe(v.number(message), v.finite(message), v.minValue(-bound, message), v.maxValue(bound, message));

// --- Schémas -----------------------------------------------------------------
/** Ligne de panier telle que sérialisée par src/core/orderPayload.js. */
export const CartItemSchema = plainObject(
  {
    nom: str("Nom d'item invalide.", { min: 1, max: 200 }),
    prix: v.pipe(
      v.number("Prix d'item invalide."),
      v.minValue(0, "Prix d'item invalide."),
      v.ltValue(ITEM_PRICE_MAX_EXCLUSIVE, "Prix d'item invalide."),
    ),
    quantity: positiveInt("Quantité d'item invalide.", ITEM_QTY_MAX),
  },
  "Item de panier invalide.",
);

export const CartItemsSchema = v.pipe(
  v.array(CartItemSchema, "cartItems vide ou invalide."),
  v.minLength(1, "cartItems vide ou invalide."),
  v.maxLength(CART_MAX_ITEMS, "Panier trop volumineux."),
);

/**
 * Adresse de livraison. Position obligatoire ; adresse, complément (étage, code…)
 * et téléphone facultatifs mais bornés — facultatifs pour ne pas rejeter une PWA
 * en cache antérieure à ces champs (le client exige le téléphone à la saisie).
 */
export const LivraisonSchema = plainObject(
  {
    lat: coord("Latitude de livraison invalide.", 90),
    lng: coord("Longitude de livraison invalide.", 180),
    adresse: v.nullish(str("Adresse de livraison invalide.", { max: 300 })),
    complement: v.nullish(str("Complément d'adresse invalide (200 caractères max).", { max: 200 })),
    telephone: v.nullish(
      v.pipe(
        v.string("Numéro de téléphone invalide."),
        v.check((s) => s === "" || isPhone(s), "Numéro de téléphone invalide."),
      ),
    ),
  },
  "livraison requise pour une commande en livraison.",
);

// Tronc commun des deux callables. `mode` et `livraison` sont acceptés tels quels
// ici : validateOrderInput applique LivraisonSchema SEULEMENT si mode === "delivery"
// (en collect, une livraison nulle ou périmée est ignorée, comme avant).
const orderCommon = {
  snackId: docId("snackId invalide."),
  cartItems: CartItemsSchema,
  mode: v.optional(v.unknown()),
  livraison: v.optional(v.unknown()),
};

/** Payload de createPaymentIntent (`amount` client toléré : compat/traçabilité, jamais utilisé). */
export const CreatePaymentIntentInputSchema = plainObject(
  {
    ...orderCommon,
    currency: v.optional(v.pipe(v.string("Devise invalide."), v.regex(/^[a-z]{3}$/i, "Devise invalide."))),
    description: v.optional(str("Description invalide.", { max: 1000 })),
    metadata: v.optional(v.custom(isPlainObject, "Metadata invalides.")),
    // Créneau de retrait : validé côté serveur contre les horaires du snack (lib/pickup.js).
    retrait: v.optional(v.unknown()),
  },
  "Payload invalide.",
);

/** Payload de finalizeOrder. */
export const FinalizeOrderInputSchema = plainObject(
  {
    paymentIntentId: str("paymentIntentId invalide.", { min: 1, max: 200 }),
    ...orderCommon,
    clientEmail: v.pipe(v.string("clientEmail invalide."), v.check(isEmail, "clientEmail invalide.")),
    clientNom: v.nullish(str("clientNom invalide.", { max: 100 })),
    totalCents: positiveInt("totalCents invalide.", TOTAL_CENTS_MAX),
    referrerId: v.nullish(docId("referrerId invalide.")),
  },
  "Payload invalide.",
);

/** @typedef {import("valibot").InferOutput<typeof CartItemSchema>} CartItemInput */
/** @typedef {import("valibot").InferOutput<typeof LivraisonSchema>} LivraisonInput */
/** @typedef {import("valibot").InferOutput<typeof CreatePaymentIntentInputSchema>} CreatePaymentIntentInput */
/** @typedef {import("valibot").InferOutput<typeof FinalizeOrderInputSchema>} FinalizeOrderInput */

// --- Validation --------------------------------------------------------------
/** Message de la première erreur, ou null si `data` respecte `schema`. */
export function firstIssueMessage(schema, data) {
  const result = v.safeParse(schema, data);
  return result.success ? null : result.issues[0].message;
}

/**
 * Valide un payload de commande : forme (schéma) PUIS adresse de livraison si
 * mode === "delivery". Même séquence côté client et côté serveur → le message
 * affiché avant l'appel est celui que la Cloud Function aurait renvoyé.
 * @template {import("valibot").GenericSchema} T
 * @param {T} schema
 * @param {unknown} data
 * @returns {{ ok: true, value: import("valibot").InferOutput<T>, orderMode: "delivery"|"collect" } | { ok: false, message: string }}
 */
export function validateOrderInput(schema, data) {
  const result = v.safeParse(schema, data);
  if (!result.success) return { ok: false, message: result.issues[0].message };
  const output = /** @type {any} */ (result.output);
  const orderMode = orderModeOf(output.mode);
  if (orderMode === "delivery") {
    const message = firstIssueMessage(LivraisonSchema, output.livraison);
    if (message) return { ok: false, message };
  }
  return { ok: true, value: output, orderMode };
}
