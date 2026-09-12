// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { extractTenantIdentifier, resolveCurrentTenant, CACHE_KEY_PREFIX } from "../../src/core/tenantResolver.js";

// Mock des primitives Firebase Firestore
vi.mock("../../src/core/firebase.js", () => ({
  db: {},
  doc: vi.fn((_db, _col, id) => ({ _id: id })),
  getDoc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn()
}));

import { getDoc, getDocs } from "../../src/core/firebase.js";

describe("Résolution du Tenant (tenantResolver)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete window.__INITIAL_SNACK_ID__;
    delete window.CURRENT_SNACK_ID;
    delete window.currentTenant;
    vi.clearAllMocks();
  });

  describe("extractTenantIdentifier", () => {
    it("détecte via query param ?s=tacos", () => {
      const url = new URL("https://app.monsaas.com/menu?s=tacos-king");
      expect(extractTenantIdentifier(url)).toBe("tacos-king");
    });

    it("détecte via query param ?snack=pizza-express", () => {
      const url = new URL("https://app.monsaas.com/?snack=pizza-express");
      expect(extractTenantIdentifier(url)).toBe("pizza-express");
    });

    it("détecte via chemin URL /s/mon-snack", () => {
      const url = new URL("https://app.monsaas.com/s/belly-burger/checkout");
      expect(extractTenantIdentifier(url)).toBe("belly-burger");
    });

    it("détecte via sous-domaine dédié", () => {
      const url = new URL("https://tacos-paris.monsaas.fr/accueil");
      expect(extractTenantIdentifier(url)).toBe("tacos-paris");
    });

    it("ignore les sous-domaines techniques www et app", () => {
      const url = new URL("https://www.monsaas.com/");
      expect(extractTenantIdentifier(url)).toBeNull();
    });

    it("utilise le fallback window.CURRENT_SNACK_ID si aucun paramètre URL", () => {
      window.CURRENT_SNACK_ID = "fallback-snack-id";
      const url = new URL("https://app.monsaas.com/");
      expect(extractTenantIdentifier(url)).toBe("fallback-snack-id");
    });
  });

  describe("resolveCurrentTenant", () => {
    it("charge et résout le snack depuis Firestore s'il n'est pas en cache", async () => {
      const url = new URL("https://app.monsaas.com/?s=snack-123");
      getDoc.mockResolvedValueOnce({
        exists: () => true,
        id: "snack-123",
        data: () => ({ nom: "Tacos 123", colorPalette: "ruby" })
      });

      const tenant = await resolveCurrentTenant({ location: url });
      expect(tenant.id).toBe("snack-123");
      expect(tenant.nom).toBe("Tacos 123");

      // Vérifie la mise en cache
      const cached = JSON.parse(sessionStorage.getItem(`${CACHE_KEY_PREFIX}snack-123`));
      expect(cached.data.id).toBe("snack-123");
    });

    it("utilise le cache sessionStorage sans appeler Firestore", async () => {
      const cachedData = { id: "cached-snack", nom: "Snack en Cache" };
      sessionStorage.setItem(
        `${CACHE_KEY_PREFIX}cached-snack`,
        JSON.stringify({ data: cachedData, timestamp: Date.now() })
      );

      const url = new URL("https://app.monsaas.com/?s=cached-snack");
      const tenant = await resolveCurrentTenant({ location: url });

      expect(tenant.nom).toBe("Snack en Cache");
      expect(getDoc).not.toHaveBeenCalled();
      expect(getDocs).not.toHaveBeenCalled();
    });

    it("tente une recherche par slug si la recherche par doc ID échoue", async () => {
      const url = new URL("https://app.monsaas.com/?s=slug-snack");
      getDoc.mockResolvedValueOnce({ exists: () => false });
      getDocs.mockResolvedValueOnce({
        empty: false,
        docs: [{ id: "real-firestore-id", data: () => ({ nom: "Snack par Slug" }) }]
      });

      const tenant = await resolveCurrentTenant({ location: url });
      expect(tenant.id).toBe("real-firestore-id");
      expect(tenant.nom).toBe("Snack par Slug");
    });

    it("lève une erreur si le snack n'est trouvé ni par id ni par slug", async () => {
      const url = new URL("https://app.monsaas.com/?s=introuvable");
      getDoc.mockResolvedValueOnce({ exists: () => false });
      getDocs.mockResolvedValueOnce({ empty: true, docs: [] });

      await expect(resolveCurrentTenant({ location: url })).rejects.toThrow(
        "Snack introuvable pour l'identifiant : introuvable"
      );
    });
  });
});
