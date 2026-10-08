// 🧾 Tests unitaires — schémas de commande partagés client ⇄ serveur
// (functions/shared/orderSchemas.mjs). Parité avec l'ancienne chaîne de require_
// de payment.js : mêmes règles, mêmes messages, clés inconnues conservées ; et le
// VRAI payload client (buildOrderItemsPayload) passe le schéma.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import {
  CartItemSchema,
  CreatePaymentIntentInputSchema,
  FinalizeOrderInputSchema,
  LivraisonSchema,
  validateOrderInput,
  firstIssueMessage,
  orderModeOf,
  CART_MAX_ITEMS,
} from "../../functions/shared/orderSchemas.mjs";
import { buildOrderItemsPayload } from "../../src/core/orderPayload.js";

const require = createRequire(import.meta.url);
const { parseInput, V } = require("../../functions/lib/validation.js");

const item = (over = {}) => ({ nom: "Tacos M", prix: 8.5, quantity: 1, productId: "p1", type: "seul", ...over });
const pi = (over = {}) => ({
  snackId: "Ym1YiO4Ue5Fb5UXlxr06", amount: 850, currency: "eur", description: "Commande web",
  cartItems: [item()], mode: "collect", livraison: null, metadata: { ticket: "1x Tacos" }, ...over,
});
const fo = (over = {}) => ({
  paymentIntentId: "pi_123", snackId: "Ym1YiO4Ue5Fb5UXlxr06", cartItems: [item()], clientEmail: "a@b.co",
  clientNom: "Ana", totalCents: 850, referrerId: null, mode: "collect", livraison: null, ...over,
});
const msg = (schema, data) => { const r = validateOrderInput(schema, data); return r.ok ? null : r.message; };

describe("CreatePaymentIntentInputSchema — parité avec l'ancienne validation", () => {
  it("accepte le payload nominal et conserve les clés inconnues (amount, productId…)", () => {
    const r = validateOrderInput(CreatePaymentIntentInputSchema, pi());
    expect(r.ok).toBe(true);
    expect(r.orderMode).toBe("collect");
    expect(r.value.amount).toBe(850);
    expect(r.value.cartItems[0].productId).toBe("p1");
  });

  it("clé requise ABSENTE → message du champ (pas celui de l'objet)", () => {
    const { snackId, ...sans } = pi();
    expect(msg(CreatePaymentIntentInputSchema, sans)).toBe("snackId invalide.");
    const { cartItems, ...sansItems } = pi();
    expect(msg(CreatePaymentIntentInputSchema, sansItems)).toBe("cartItems vide ou invalide.");
  });

  it.each([
    ["payload null", null, "Payload invalide."],
    ["payload tableau", [], "Payload invalide."],
    ["payload chaîne", "x", "Payload invalide."],
    ["snackId undefined", pi({ snackId: undefined }), "snackId invalide."],
    ["snackId avec slash", pi({ snackId: "a/b" }), "snackId invalide."],
    ["cartItems non tableau", pi({ cartItems: {} }), "cartItems vide ou invalide."],
    ["cartItems vide", pi({ cartItems: [] }), "cartItems vide ou invalide."],
    ["panier trop gros", pi({ cartItems: Array.from({ length: CART_MAX_ITEMS + 1 }, () => item()) }), "Panier trop volumineux."],
    ["item non objet", pi({ cartItems: ["x"] }), "Item de panier invalide."],
    ["item tableau", pi({ cartItems: [[]] }), "Item de panier invalide."],
    ["nom vide", pi({ cartItems: [item({ nom: "" })] }), "Nom d'item invalide."],
    ["nom trop long", pi({ cartItems: [item({ nom: "x".repeat(201) })] }), "Nom d'item invalide."],
    ["prix négatif", pi({ cartItems: [item({ prix: -1 })] }), "Prix d'item invalide."],
    ["prix >= 10000", pi({ cartItems: [item({ prix: 10_000 })] }), "Prix d'item invalide."],
    ["prix NaN", pi({ cartItems: [item({ prix: NaN })] }), "Prix d'item invalide."],
    ["prix chaîne", pi({ cartItems: [item({ prix: "8.5" })] }), "Prix d'item invalide."],
    ["quantité 0", pi({ cartItems: [item({ quantity: 0 })] }), "Quantité d'item invalide."],
    ["quantité décimale", pi({ cartItems: [item({ quantity: 1.5 })] }), "Quantité d'item invalide."],
    ["quantité > 100", pi({ cartItems: [item({ quantity: 101 })] }), "Quantité d'item invalide."],
    ["devise null", pi({ currency: null }), "Devise invalide."],
    ["devise 4 lettres", pi({ currency: "EURO" }), "Devise invalide."],
    ["description trop longue", pi({ description: "x".repeat(1001) }), "Description invalide."],
    ["metadata tableau", pi({ metadata: [] }), "Metadata invalides."],
    ["metadata null", pi({ metadata: null }), "Metadata invalides."],
  ])("%s → %s", (_, data, expected) => {
    expect(msg(CreatePaymentIntentInputSchema, data)).toBe(expected);
  });

  it("champs optionnels absents acceptés ; devise insensible à la casse", () => {
    expect(msg(CreatePaymentIntentInputSchema, { snackId: "s", cartItems: [item()] })).toBeNull();
    expect(msg(CreatePaymentIntentInputSchema, pi({ currency: "EUR" }))).toBeNull();
    expect(msg(CreatePaymentIntentInputSchema, pi({ cartItems: [item({ prix: 0 })] }))).toBeNull(); // offert
  });
});

describe("livraison : validée seulement si mode === 'delivery'", () => {
  const base = { lat: 46.06, lng: 6.58, adresse: "18 Avenue de la libération 74300 Cluses" };

  it("collect : livraison nulle ou périmée ignorée (legacy inchangé)", () => {
    expect(msg(CreatePaymentIntentInputSchema, pi({ mode: "collect", livraison: null }))).toBeNull();
    expect(msg(CreatePaymentIntentInputSchema, pi({ mode: undefined, livraison: { lat: "x" } }))).toBeNull();
    expect(orderModeOf("delivery")).toBe("delivery");
    expect(orderModeOf("truc")).toBe("collect");
    expect(orderModeOf(undefined)).toBe("collect");
  });

  it("delivery : position obligatoire, champs facultatifs bornés, PWA ancienne acceptée", () => {
    const d = (livraison) => msg(CreatePaymentIntentInputSchema, pi({ mode: "delivery", livraison }));
    expect(d(null)).toBe("livraison requise pour une commande en livraison.");
    expect(d(undefined)).toBe("livraison requise pour une commande en livraison.");
    expect(d({ adresse: "x" })).toBe("Latitude de livraison invalide.");
    expect(d({ ...base, lat: 91 })).toBe("Latitude de livraison invalide.");
    expect(d({ ...base, lng: Infinity })).toBe("Longitude de livraison invalide.");
    expect(d({ ...base, adresse: 42 })).toBe("Adresse de livraison invalide.");
    expect(d({ ...base, complement: "x".repeat(201) })).toBe("Complément d'adresse invalide (200 caractères max).");
    expect(d({ ...base, complement: 42 })).toBe("Complément d'adresse invalide (200 caractères max).");
    expect(d({ ...base, telephone: "appelle-moi" })).toBe("Numéro de téléphone invalide.");
    const r = validateOrderInput(CreatePaymentIntentInputSchema, pi({ mode: "delivery", livraison: { ...base, complement: "", telephone: "" } }));
    expect(r.ok).toBe(true);
    expect(r.orderMode).toBe("delivery");
    expect(firstIssueMessage(LivraisonSchema, { ...base, complement: "3e étage, code 4521B", telephone: "+33 6 12 34 56 78" })).toBeNull();
    expect(firstIssueMessage(LivraisonSchema, base)).toBeNull();
  });
});

describe("FinalizeOrderInputSchema", () => {
  it("accepte le payload nominal (clientNom/referrerId null ou absents tolérés)", () => {
    expect(msg(FinalizeOrderInputSchema, fo())).toBeNull();
    expect(msg(FinalizeOrderInputSchema, fo({ clientNom: null, referrerId: undefined }))).toBeNull();
  });

  it.each([
    ["paymentIntentId undefined", fo({ paymentIntentId: undefined }), "paymentIntentId invalide."],
    ["paymentIntentId vide", fo({ paymentIntentId: "" }), "paymentIntentId invalide."],
    ["clientEmail sans TLD", fo({ clientEmail: "a@b" }), "clientEmail invalide."],
    ["clientEmail undefined", fo({ clientEmail: undefined }), "clientEmail invalide."],
    ["clientNom trop long", fo({ clientNom: "x".repeat(101) }), "clientNom invalide."],
    ["totalCents 0", fo({ totalCents: 0 }), "totalCents invalide."],
    ["totalCents > 1 000 000", fo({ totalCents: 1_000_001 }), "totalCents invalide."],
    ["totalCents chaîne", fo({ totalCents: "850" }), "totalCents invalide."],
    ["referrerId avec slash", fo({ referrerId: "a/b" }), "referrerId invalide."],
    ["item invalide", fo({ cartItems: [item({ quantity: 0 })] }), "Quantité d'item invalide."],
    ["delivery sans adresse", fo({ mode: "delivery", livraison: null }), "livraison requise pour une commande en livraison."],
  ])("%s → %s", (_, data, expected) => {
    expect(msg(FinalizeOrderInputSchema, data)).toBe(expected);
  });
});

describe("le VRAI payload client passe le schéma (src/core/orderPayload.js)", () => {
  it("buildOrderItemsPayload → CartItemSchema, suppléments et options conservés", () => {
    const cart = [
      { id: "burger-menu", productId: "burger", nom: "Burger", formule: "menu", prix: 13, prixBase: 9.5, prixMenuAdd: 2.5, quantity: 2, supplements: [{ id: "cheddar", nom: "Cheddar", prix: 1 }], sauces: ["BBQ"] },
      { id: "canette", nom: "Canette", prix: 2, quantity: 1 },
    ];
    const items = buildOrderItemsPayload(cart);
    for (const line of items) expect(firstIssueMessage(CartItemSchema, line)).toBeNull();
    const r = validateOrderInput(CreatePaymentIntentInputSchema, pi({ cartItems: items }));
    expect(r.ok).toBe(true);
    expect(r.value.cartItems[0].supplements).toEqual([{ productId: "cheddar", nom: "Cheddar", prix: 1 }]);
    expect(r.value.cartItems[0].type).toBe("menu");
    expect(r.value.cartItems[0].sauces).toEqual(["BBQ"]);
  });
});

describe("serveur : parseInput (functions/lib/validation.js)", () => {
  it("lève HttpsError invalid-argument avec le message du schéma, sinon renvoie orderMode", () => {
    let err;
    try { parseInput(CreatePaymentIntentInputSchema, pi({ snackId: "" })); } catch (e) { err = e; }
    expect(err?.code).toBe("invalid-argument");
    expect(err?.message).toBe("snackId invalide.");
    expect(parseInput(FinalizeOrderInputSchema, fo()).orderMode).toBe("collect");
    expect(parseInput(CreatePaymentIntentInputSchema, pi({ mode: "delivery", livraison: { lat: 1, lng: 2 } })).orderMode).toBe("delivery");
  });

  it("V réexporte les primitives partagées (une seule définition)", () => {
    expect(V.isEmail("a@b.co")).toBe(true);
    expect(V.isDocId("a/b")).toBe(false);
    expect(V.isPhone("06 12 34 56 78")).toBe(true);
  });
});
