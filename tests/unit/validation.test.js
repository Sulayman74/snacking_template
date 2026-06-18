// 🛡️ Tests unitaires — primitives de validation + garde require_. Module PUR.
// Couvre lib/validation.js : socle anti-injection de TOUTES les Cloud Functions
// (CLAUDE.md §6.3 — ne jamais faire confiance au client).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { V, require_ } = require("../../functions/lib/validation.js");

describe("V.isString / isNonEmptyString", () => {
  it("isString ne valide que les chaînes", () => {
    expect(V.isString("")).toBe(true);
    expect(V.isString("abc")).toBe(true);
    expect(V.isString(1)).toBe(false);
    expect(V.isString(null)).toBe(false);
    expect(V.isString(undefined)).toBe(false);
  });

  it("isNonEmptyString rejette le vide et borne la longueur", () => {
    expect(V.isNonEmptyString("a")).toBe(true);
    expect(V.isNonEmptyString("")).toBe(false);
    expect(V.isNonEmptyString(123)).toBe(false);
    expect(V.isNonEmptyString("abc", 2)).toBe(false); // > max
    expect(V.isNonEmptyString("ab", 2)).toBe(true); // == max
    expect(V.isNonEmptyString("x".repeat(1001))).toBe(false); // défaut 1000
  });
});

describe("V.isInt / isPositiveInt", () => {
  it("isInt n'accepte que les entiers", () => {
    expect(V.isInt(3)).toBe(true);
    expect(V.isInt(0)).toBe(true);
    expect(V.isInt(-2)).toBe(true);
    expect(V.isInt(3.5)).toBe(false);
    expect(V.isInt("3")).toBe(false);
    expect(V.isInt(NaN)).toBe(false);
  });

  it("isPositiveInt : entier strictement positif, borné", () => {
    expect(V.isPositiveInt(1)).toBe(true);
    expect(V.isPositiveInt(0)).toBe(false);
    expect(V.isPositiveInt(-1)).toBe(false);
    expect(V.isPositiveInt(3.5)).toBe(false);
    expect(V.isPositiveInt(11, 10)).toBe(false); // > max
    expect(V.isPositiveInt(10, 10)).toBe(true); // == max
  });
});

describe("V.isPlainObject / isArray", () => {
  it("isPlainObject : objet non-null, non-tableau", () => {
    expect(V.isPlainObject({})).toBe(true);
    expect(V.isPlainObject({ a: 1 })).toBe(true);
    expect(V.isPlainObject([])).toBe(false);
    expect(V.isPlainObject(null)).toBe(false);
    expect(V.isPlainObject("x")).toBe(false);
  });

  it("isArray", () => {
    expect(V.isArray([])).toBe(true);
    expect(V.isArray([1])).toBe(true);
    expect(V.isArray({})).toBe(false);
  });
});

describe("V.isEmail", () => {
  it("accepte les emails plausibles", () => {
    expect(V.isEmail("a@b.co")).toBe(true);
    expect(V.isEmail("jean.dupont@resto-snack.fr")).toBe(true);
  });
  it("rejette les formats invalides", () => {
    expect(V.isEmail("ab")).toBe(false);
    expect(V.isEmail("a@b")).toBe(false); // pas de TLD
    expect(V.isEmail("a b@c.fr")).toBe(false); // espace
    expect(V.isEmail("a@@b.fr")).toBe(false);
    expect(V.isEmail("x".repeat(320) + "@b.fr")).toBe(false); // > 320
    expect(V.isEmail(42)).toBe(false);
  });
});

describe("V.isDocId", () => {
  it("valide un id Firestore sans slash", () => {
    expect(V.isDocId("Ym1YiO4Ue5Fb5UXlxr06")).toBe(true);
    expect(V.isDocId("a")).toBe(true);
  });
  it("rejette vide, slash et non-chaîne", () => {
    expect(V.isDocId("")).toBe(false);
    expect(V.isDocId("a/b")).toBe(false);
    expect(V.isDocId("col/doc")).toBe(false);
    expect(V.isDocId(null)).toBe(false);
    expect(V.isDocId("x".repeat(1501))).toBe(false);
  });
});

describe("require_", () => {
  it("ne lève rien si la condition est vraie", () => {
    expect(() => require_(true, "msg")).not.toThrow();
    expect(() => require_(1, "msg")).not.toThrow();
  });
  it("lève une HttpsError invalid-argument si la condition est fausse", () => {
    expect(() => require_(false, "payload invalide")).toThrow("payload invalide");
    let err;
    try { require_(0, "boom"); } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.code).toBe("invalid-argument");
  });
});
