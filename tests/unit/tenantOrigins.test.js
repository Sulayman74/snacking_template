// 🌐 Tests unitaires — source unique « snackId → origine » (liens push, Apple Pay).
// Régression : les liens des notifications renvoyaient tous les snacks sur le site Tacos.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { TENANT_HOSTS, DEFAULT_ORIGIN, resolveSnackOrigin } = require("../../functions/lib/tenantOrigins.js");
const { APPLE_PAY_DOMAINS } = require("../../functions/lib/wallets.js");

describe("resolveSnackOrigin", () => {
  it("chaque tenant déployé a SON origine", () => {
    expect(resolveSnackOrigin("Ym1YiO4Ue5Fb5UXlxr06")).toBe("https://snacking-template.web.app");
    expect(resolveSnackOrigin("PsobiuoeUzNmHnwGtaRu")).toBe("https://o-bois-pizza.web.app");
    expect(resolveSnackOrigin("umaGD0nOIWwgpyy8Ta4h")).toBe("https://belly-smash-burger.web.app");
  });

  it("le site déployé connu prime sur le champ domaine", () => {
    expect(resolveSnackOrigin("PsobiuoeUzNmHnwGtaRu", { domaine: "pas-encore-branche.fr" })).toBe("https://o-bois-pizza.web.app");
  });

  it("snack inconnu : utilise le domaine du superadmin s'il est valide", () => {
    expect(resolveSnackOrigin("nouveau", { domaine: " MonSnack.fr " })).toBe("https://monsnack.fr");
  });

  it.each(["", "https://evil.com/x", "evil.com/path", "a b.fr", "javascript:alert(1)", "localhost"])(
    "domaine invalide %j → origine par défaut", (domaine) => {
      expect(resolveSnackOrigin("nouveau", { domaine })).toBe(DEFAULT_ORIGIN);
    });

  it("les domaines Apple Pay suivent la même source", () => {
    expect([...APPLE_PAY_DOMAINS]).toEqual(Object.values(TENANT_HOSTS));
  });

  it("snacks-seo.json (build) et tenantOrigins (functions) sont cohérents", () => {
    const seo = JSON.parse(readFileSync("snacks-seo.json", "utf8"));
    for (const [snackId, host] of Object.entries(TENANT_HOSTS)) {
      expect(seo[snackId]?.canonicalUrl, snackId).toBe(`https://${host}`);
    }
  });
});
