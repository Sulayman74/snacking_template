// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/utils.js", () => ({
  escapeHTML: (s) => String(s ?? ""),
  showToast: vi.fn(),
}));

vi.mock("../../src/core/firebase.js", () => ({
  db: {},
  fs: {},
  query: vi.fn(),
  collection: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

import { adminStore } from "../../src/core/AdminStore.js";
import { adminUpsellUI } from "../../src/ui/AdminUpsellUI.js";
import "../../src/admin-marketing.js";

describe("Admin Pagination (Upsell & Push Campaigns)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="upsell-stats-table"></div>
      <div id="last-campaign-stats"></div>
    `;
    adminUpsellUI.tableEl = document.getElementById("upsell-stats-table");
    adminUpsellUI.currentPage = 1;
  });

  describe("AdminUpsellUI Pagination", () => {
    it("affiche tous les éléments sans barre de pagination si <= 5 produits", () => {
      const rows = [
        { productId: "p1", nom: "Tacos M", shown: 10, accepted: 2, revenue: 16.0 },
        { productId: "p2", nom: "Tacos L", shown: 12, accepted: 3, revenue: 27.0 },
        { productId: "p3", nom: "Tacos XL", shown: 8, accepted: 1, revenue: 11.5 },
      ];

      adminStore.setUpsellStats(rows);

      const tableEl = document.getElementById("upsell-stats-table");
      expect(tableEl.querySelectorAll("tbody tr").length).toBe(3);
      expect(tableEl.querySelector("[data-upsell-page]")).toBeNull();
    });

    it("pagine par 5 par défaut et affiche la pagination si > 5 produits", () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        productId: `p${i + 1}`,
        nom: `Produit ${i + 1}`,
        shown: 10 + i,
        accepted: i,
        revenue: (i + 1) * 5,
      }));

      adminStore.setUpsellStats(rows);

      const tableEl = document.getElementById("upsell-stats-table");
      // Desktop table rows
      const trs = tableEl.querySelectorAll("tbody tr");
      expect(trs.length).toBe(5);
      expect(trs[0].textContent).toContain("Produit 1");
      expect(trs[4].textContent).toContain("Produit 5");

      // Pagination controls
      expect(tableEl.textContent).toContain("Affichage 1–5 sur 12 produits");
      expect(tableEl.textContent).toContain("1 / 3");

      const prevBtn = tableEl.querySelector('[data-upsell-page="0"]');
      expect(prevBtn.disabled).toBe(true);

      const nextBtn = tableEl.querySelector('[data-upsell-page="2"]');
      expect(nextBtn.disabled).toBe(false);
    });

    it("navigue entre les pages via setPage et clic délégué avec bornage", () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        productId: `p${i + 1}`,
        nom: `Produit ${i + 1}`,
        shown: 10 + i,
        accepted: i,
        revenue: (i + 1) * 5,
      }));

      adminStore.setUpsellStats(rows);
      const tableEl = document.getElementById("upsell-stats-table");

      // Aller en page 2 via setPage
      adminUpsellUI.setPage(2);
      expect(tableEl.querySelectorAll("tbody tr").length).toBe(5);
      expect(tableEl.textContent).toContain("Produit 6");
      expect(tableEl.textContent).toContain("Produit 10");
      expect(tableEl.textContent).toContain("2 / 3");

      // Aller en page 3 via clic délégué sur le bouton suivant
      const nextBtn = tableEl.querySelector('[data-upsell-page="3"]');
      nextBtn.click();
      expect(tableEl.querySelectorAll("tbody tr").length).toBe(2);
      expect(tableEl.textContent).toContain("Produit 11");
      expect(tableEl.textContent).toContain("Produit 12");
      expect(tableEl.textContent).toContain("3 / 3");

      // Clamping vers l'avant
      adminUpsellUI.setPage(999);
      expect(adminUpsellUI.currentPage).toBe(3);

      // Clamping vers l'arrière
      adminUpsellUI.setPage(-10);
      expect(adminUpsellUI.currentPage).toBe(1);
    });
  });

  describe("Push History Pagination", () => {
    it("pagine les campagnes push par 5 par défaut et permet de changer de page", () => {
      const history = Array.from({ length: 13 }, (_, i) => ({
        id: `c${i + 1}`,
        titre: `Campagne ${i + 1}`,
        message: `Message promo ${i + 1}`,
        cible: "all",
        stats: { envoye: 50, clics: 10 },
      }));

      adminStore.setPushHistory(history);
      // Simuler l'appel window.changePushHistoryPage
      window.changePushHistoryPage(1);

      const container = document.getElementById("last-campaign-stats");
      expect(container.textContent).toContain("Campagne 1");
      expect(container.textContent).toContain("Campagne 5");
      expect(container.textContent).not.toContain("Campagne 6");
      expect(container.textContent).toContain("Affichage 1–5 sur 13");
      expect(container.textContent).toContain("1 / 3");

      // Page 2
      window.changePushHistoryPage(2);
      expect(container.textContent).toContain("Campagne 6");
      expect(container.textContent).toContain("Campagne 10");
      expect(container.textContent).toContain("2 / 3");

      // Page 3 (dernière page, 3 éléments restants)
      window.changePushHistoryPage(3);
      expect(container.textContent).toContain("Campagne 11");
      expect(container.textContent).toContain("Campagne 13");
      expect(container.textContent).toContain("3 / 3");
    });
  });
});
