// @vitest-environment jsdom
// 🍳 Tests unitaires Cuisine — rendu des tickets + actions métier (statut/caisse).
// Les fonctions métier sont exposées sur `window` par admin-kitchen.js ; on injecte
// des mocks Firestore via window.fs / window.db (lus à l'appel, pas à l'import).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTicketElement } from "../../src/admin-kitchen.js";

describe("createTicketElement — rendu & statuts", () => {
  const baseCmd = {
    clientNom: "Bob",
    secretCode: "A1",
    total: 12.5,
    items: [{ nom: "Tacos", quantity: 2 }],
  };

  it("statut 'nouvelle' → bordure rouge + bouton MARQUER PRÊTE (→ prete)", () => {
    const el = createTicketElement("o1", { ...baseCmd, statut: "nouvelle" });
    expect(el.className).toContain("border-red-500");
    const btn = el.querySelector('[data-action="update-order"]');
    expect(btn.getAttribute("data-status")).toBe("prete");
    expect(el.textContent).toContain("MARQUER PRÊTE");
  });

  it("statut 'en_attente_client' → bouton Forcer Cuisson (→ nouvelle)", () => {
    const el = createTicketElement("o2", { ...baseCmd, statut: "en_attente_client" });
    expect(el.className).toContain("border-gray-400");
    const btn = el.querySelector('[data-action="update-order"]');
    expect(btn.getAttribute("data-status")).toBe("nouvelle");
  });

  it("statut 'prete' → bordure verte + bouton DONNÉE AU CLIENT (→ terminee)", () => {
    const el = createTicketElement("o3", { ...baseCmd, statut: "prete" });
    expect(el.className).toContain("border-green-500");
    const btn = el.querySelector('[data-action="update-order"]');
    expect(btn.getAttribute("data-status")).toBe("terminee");
  });

  it("échappe le nom client (anti-XSS)", () => {
    const el = createTicketElement("o4", {
      ...baseCmd,
      clientNom: '<img src=x onerror=alert(1)>',
      statut: "nouvelle",
    });
    expect(el.querySelector("img")).toBeNull();
    expect(el.innerHTML).toContain("&lt;img");
  });

  it("nom client absent → 'Client Anonyme'", () => {
    const el = createTicketElement("o4b", { ...baseCmd, clientNom: undefined, statut: "nouvelle" });
    expect(el.textContent).toContain("Client Anonyme");
  });

  it("total formaté en 2 décimales avec €", () => {
    const el = createTicketElement("o5", { ...baseCmd, total: 7, statut: "nouvelle" });
    expect(el.textContent).toContain("7.00 €");
  });

  it("total invalide → 0.00 € (jamais NaN)", () => {
    const el = createTicketElement("o5b", { ...baseCmd, total: undefined, statut: "nouvelle" });
    expect(el.textContent).toContain("0.00 €");
  });

  it("paiement payé → badge PAYÉ (data-status paye) + prix barré", () => {
    const el = createTicketElement("o6", {
      ...baseCmd,
      statut: "prete",
      paiement: { statut: "paye" },
    });
    const pay = el.querySelector('[data-action="update-payment"]');
    expect(pay.getAttribute("data-status")).toBe("paye");
    expect(el.querySelector(".line-through")).not.toBeNull();
    expect(el.textContent).toContain("PAYÉ");
  });

  it("paiement par défaut → badge ENCAISSER (data-status en_attente)", () => {
    const el = createTicketElement("o7", { ...baseCmd, statut: "prete" });
    const pay = el.querySelector('[data-action="update-payment"]');
    expect(pay.getAttribute("data-status")).toBe("en_attente");
    expect(el.textContent).toContain("ENCAISSER");
  });

  it("mode livraison → bandeau adresse + distance", () => {
    const el = createTicketElement("o8", {
      ...baseCmd,
      statut: "nouvelle",
      mode: "delivery",
      livraison: { adresse: "1 rue X", distanceKm: 2.3 },
    });
    expect(el.textContent).toContain("Livraison");
    expect(el.textContent).toContain("1 rue X");
    expect(el.textContent).toContain("2.3 km");
  });

  it("mode collect → pas de bandeau livraison", () => {
    const el = createTicketElement("o8b", { ...baseCmd, statut: "nouvelle" });
    expect(el.textContent).not.toContain("Livraison");
  });

  it("options article (taille, sauces, sans crudités) rendues et échappées", () => {
    const el = createTicketElement("o9", {
      ...baseCmd,
      statut: "nouvelle",
      items: [
        {
          nom: "Tacos",
          quantity: 1,
          tailleChoisie: "L",
          sauces: ["Algérienne", "<b>x</b>"],
          sansCrudites: ["Oignons"],
        },
      ],
    });
    expect(el.textContent).toContain("Taille : L");
    expect(el.textContent).toContain("Algérienne");
    expect(el.querySelector("b")).toBeNull(); // sauce HTML échappée
    expect(el.textContent).toContain("Oignons");
  });

  it("secretCode absent → '---'", () => {
    const el = createTicketElement("o10", { ...baseCmd, statut: "nouvelle", secretCode: undefined });
    expect(el.textContent).toContain("---");
  });

  it("id du ticket et data-status posés sur l'élément racine", () => {
    const el = createTicketElement("xyz", { ...baseCmd, statut: "prete" });
    expect(el.id).toBe("ticket-xyz");
    expect(el.getAttribute("data-status")).toBe("prete");
  });
});

describe("window.updateOrderStatus", () => {
  beforeEach(() => {
    window.db = {};
    window.fs = {
      updateDoc: vi.fn().mockResolvedValue(),
      doc: vi.fn((db, col, id) => ({ col, id })),
    };
  });

  it("écrit le nouveau statut sur la bonne commande", async () => {
    await window.updateOrderStatus("cmd1", "prete");
    expect(window.fs.doc).toHaveBeenCalledWith(window.db, "commandes", "cmd1");
    expect(window.fs.updateDoc.mock.calls[0][1]).toEqual({ statut: "prete" });
  });

  it("erreur Firestore → catchée (pas de throw)", async () => {
    window.fs.updateDoc = vi.fn().mockRejectedValue(new Error("net"));
    await expect(window.updateOrderStatus("cmd1", "prete")).resolves.toBeUndefined();
  });
});

describe("window.updatePaymentStatus", () => {
  let batch;
  beforeEach(() => {
    batch = { update: vi.fn(), commit: vi.fn().mockResolvedValue() };
    window.db = {};
    window.showToast = vi.fn();
    window.fs = {
      writeBatch: vi.fn(() => batch),
      doc: vi.fn((db, col, id) => ({ col, id })),
      getDoc: vi.fn(),
      increment: vi.fn((n) => ({ __inc: n })),
    };
  });

  it("toggle paye → en_attente : aucun incrément de ventes", async () => {
    await window.updatePaymentStatus("cmd1", "paye");
    expect(batch.update).toHaveBeenCalledWith(expect.anything(), {
      "paiement.statut": "en_attente",
    });
    expect(window.fs.getDoc).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith("Paiement annulé.", "success");
  });

  it("toggle en_attente → paye : incrémente les ventes par article", async () => {
    window.fs.getDoc = vi.fn().mockResolvedValue({
      exists: () => true,
      data: () => ({
        items: [
          { productId: "p1", quantity: 2 },
          { id: "p2-xl", quantity: 1 }, // pas de productId → fallback split("-")[0]
        ],
      }),
    });
    await window.updatePaymentStatus("cmd1", "en_attente");
    // 1 update statut paiement + 2 updates ventes
    expect(batch.update).toHaveBeenCalledTimes(3);
    expect(window.fs.increment).toHaveBeenCalledWith(2);
    expect(window.fs.increment).toHaveBeenCalledWith(1);
    expect(window.fs.doc).toHaveBeenCalledWith(window.db, "produits", "p1");
    expect(window.fs.doc).toHaveBeenCalledWith(window.db, "produits", "p2");
    expect(window.showToast).toHaveBeenCalledWith(
      expect.stringContaining("Best-Sellers"),
      "success",
    );
  });

  it("erreur lors du commit → toast erreur", async () => {
    window.fs.getDoc = vi.fn().mockResolvedValue({ exists: () => false });
    batch.commit = vi.fn().mockRejectedValue(new Error("boom"));
    await window.updatePaymentStatus("cmd1", "en_attente");
    expect(window.showToast).toHaveBeenCalledWith(
      "Impossible de mettre à jour le paiement.",
      "error",
    );
  });
});
