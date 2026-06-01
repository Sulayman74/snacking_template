// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AdminStore } from "../../src/core/AdminStore.js";

let store;
beforeEach(() => { store = new AdminStore(); });

describe("AdminStore.validateProduct", () => {
  it("produit valide", () => {
    const r = store.validateProduct({ nom: "Burger", prix: 9.5, categorieId: "burgers" });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it("nom vide + prix négatif + catégorie absente → 3 erreurs", () => {
    const r = store.validateProduct({ nom: "  ", prix: -1, categorieId: "" });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBe(3);
  });
  it("taille sans nom → erreur", () => {
    const r = store.validateProduct({
      nom: "Pizza", prix: 0, categorieId: "pizzas",
      tailles: [{ nom: "", prix: 5 }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.toLowerCase().includes("taille"))).toBe(true);
  });
});

describe("AdminStore.validate (config + horaires)", () => {
  it("config absente → invalide", () => {
    expect(store.validate()).toEqual({ valid: false, errors: ["Configuration absente"] });
  });
  it("nom du snack manquant → invalide", () => {
    store.setConfig({ identity: { name: "" }, hours: [] });
    const r = store.validate();
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/nom du snack/i);
  });
  it("horaire open >= close → invalide", () => {
    store.setConfig({ identity: { name: "Test" }, hours: [{ day: "lundi", open: "22:00", close: "11:00", closed: false }] });
    expect(store.validate().valid).toBe(false);
  });
  it("config + horaires valides → valid true", () => {
    store.setConfig({ identity: { name: "Test" }, hours: [{ day: "lundi", open: "11:00", close: "22:00", closed: false }] });
    expect(store.validate().valid).toBe(true);
  });
});

describe("AdminStore.getSalesKPIs", () => {
  it("total/TVA(10%)/HT/moyenne depuis l'agrégat serveur", () => {
    store.setSalesAggregate({ count: 4, total: 100 });
    const k = store.getSalesKPIs();
    expect(k.total).toBe("100.00");
    expect(k.count).toBe(4);
    expect(k.avg).toBe("25.00");
    expect(k.tva).toBe("10.00");
    expect(k.ht).toBe("90.00");
  });
  it("aucune vente → 0 partout, jamais NaN", () => {
    const k = store.getSalesKPIs();
    expect(k.count).toBe(0);
    expect(k.avg).toBe("0.00");
    expect(k.total).toBe("0.00");
  });
});

describe("AdminStore.validate (coupures / jours fermés)", () => {
  it("coupure valide dans la plage → valid", () => {
    store.setConfig({
      identity: { name: "T" },
      hours: [{ day: "lundi", open: "11:00", close: "22:00", closed: false, hasBreak: true, breakStart: "14:00", breakEnd: "18:00" }],
    });
    expect(store.validate().valid).toBe(true);
  });
  it("coupure débordant la fermeture → invalide", () => {
    store.setConfig({
      identity: { name: "T" },
      hours: [{ day: "lundi", open: "11:00", close: "22:00", closed: false, hasBreak: true, breakStart: "14:00", breakEnd: "23:00" }],
    });
    expect(store.validate().valid).toBe(false);
  });
  it("coupure activée sans heures → invalide", () => {
    store.setConfig({
      identity: { name: "T" },
      hours: [{ day: "lundi", open: "11:00", close: "22:00", closed: false, hasBreak: true }],
    });
    const r = store.validate();
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /coupure/i.test(e))).toBe(true);
  });
  it("jour fermé → horaires incohérents ignorés", () => {
    store.setConfig({
      identity: { name: "T" },
      hours: [{ day: "lundi", open: "22:00", close: "11:00", closed: true }],
    });
    expect(store.validate().valid).toBe(true);
  });
});

describe("AdminStore.updateConfigField", () => {
  it("met à jour un champ imbriqué existant", () => {
    store.setConfig({ identity: { name: "A" } });
    store.updateConfigField("identity.name", "B");
    expect(store.state.config.identity.name).toBe("B");
  });
  it("crée les niveaux intermédiaires manquants", () => {
    store.setConfig({ identity: { name: "A" } });
    store.updateConfigField("contact.address.city", "Paris");
    expect(store.state.config.contact.address.city).toBe("Paris");
  });
  it("sans config chargée → ignoré sans throw", () => {
    expect(() => store.updateConfigField("a.b", 1)).not.toThrow();
  });
});

describe("AdminStore.generateSalesCSV", () => {
  it("liste vide → null", () => {
    expect(store.generateSalesCSV([])).toBeNull();
  });
  it("en-têtes + ligne client (HT/TVA 10%) + ligne TOTAL", () => {
    store.setSalesAggregate({ count: 1, total: 10 });
    const csv = store.generateSalesCSV([{ id: "c1", clientNom: "Bob", total: 10, statut: "payé" }]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Total TTC");
    expect(lines[1]).toContain("Bob");
    expect(lines[1]).toContain("10.00"); // TTC
    expect(lines[1]).toContain("9.00"); // HT
    expect(lines[1]).toContain("1.00"); // TVA
    expect(lines[lines.length - 1]).toMatch(/^TOTAL/);
  });
  it("clientNom déduit de l'email si absent", () => {
    store.setSalesAggregate({ count: 1, total: 5 });
    const csv = store.generateSalesCSV([{ id: "c2", clientEmail: "jane@x.com", total: 5 }]);
    expect(csv).toContain("jane");
  });
});

describe("AdminStore.getPushEligibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T10:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("aucun push ce mois → canSend, remaining 2", () => {
    const e = store.getPushEligibility();
    expect(e.canSend).toBe(true);
    expect(e.remaining).toBe(2);
  });
  it("2 pushs ce mois → quota atteint", () => {
    store.setPushHistory([
      { dateCreation: new Date("2026-06-01") },
      { dateCreation: new Date("2026-06-10") },
    ]);
    const e = store.getPushEligibility();
    expect(e.canSend).toBe(false);
    expect(e.count).toBe(2);
    expect(e.message).toMatch(/quota/i);
  });
  it("pushs d'un autre mois ignorés", () => {
    store.setPushHistory([{ dateCreation: new Date("2026-05-20") }]);
    expect(store.getPushEligibility().count).toBe(0);
  });
  it("supporte le format Firestore Timestamp (toDate)", () => {
    store.setPushHistory([{ dateCreation: { toDate: () => new Date("2026-06-05") } }]);
    expect(store.getPushEligibility().count).toBe(1);
  });
});

describe("AdminStore.getSmartMarketingTips", () => {
  afterEach(() => vi.useRealTimers());
  const at = (iso) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  it("creux 14h-17h → tip 'creux'", () => {
    at("2026-06-15T15:00:00"); // lundi 15h
    expect(store.getSmartMarketingTips().some((t) => t.type === "creux")).toBe(true);
  });
  it("hors creux → pas de tip 'creux'", () => {
    at("2026-06-15T10:00:00");
    expect(store.getSmartMarketingTips().some((t) => t.type === "creux")).toBe(false);
  });
  it("juin → tip saisonnier été", () => {
    at("2026-06-15T10:00:00");
    expect(store.getSmartMarketingTips().some((t) => /été/i.test(t.title))).toBe(true);
  });
  it("samedi → tip week-end", () => {
    at("2026-06-13T10:00:00"); // samedi
    expect(store.getSmartMarketingTips().some((t) => t.type === "weekend")).toBe(true);
  });
});

describe("AdminStore.toggleProductStatus", () => {
  it("inverse isAvailable et écrit dans Firestore", async () => {
    store.setProducts([{ id: "p1", isAvailable: true }]);
    const updateDoc = vi.fn().mockResolvedValue();
    const doc = vi.fn(() => ({}));
    const ok = await store.toggleProductStatus({}, { updateDoc, doc }, "p1");
    expect(ok).toBe(true);
    expect(updateDoc.mock.calls[0][1]).toEqual({ isAvailable: false });
  });
  it("produit inconnu → no-op (undefined, aucune écriture)", async () => {
    const updateDoc = vi.fn();
    const res = await store.toggleProductStatus({}, { updateDoc, doc: vi.fn() }, "ghost");
    expect(res).toBeUndefined();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});

describe("AdminStore.saveProduct (persistance mockée)", () => {
  it("création → addDoc + champs par défaut (isAvailable, snackId)", async () => {
    store.setConfig({ identity: { id: "snack1" } });
    const addDoc = vi.fn().mockResolvedValue({ id: "newId" });
    const fs = {
      addDoc,
      collection: vi.fn((db, name) => ({ name })),
      serverTimestamp: vi.fn(() => "TS"),
      doc: vi.fn(),
      updateDoc: vi.fn(),
    };
    const id = await store.saveProduct({}, fs, { nom: "Frite", prix: 3, categorieId: "sides" });
    expect(id).toBe("newId");
    const data = addDoc.mock.calls[0][1];
    expect(data.isAvailable).toBe(true);
    expect(data.snackId).toBe("snack1");
  });
  it("mise à jour (id présent) → updateDoc, pas d'addDoc", async () => {
    const fs = {
      updateDoc: vi.fn().mockResolvedValue(),
      doc: vi.fn(() => ({})),
      addDoc: vi.fn(),
      collection: vi.fn(),
      serverTimestamp: vi.fn(() => "TS"),
    };
    await store.saveProduct({}, fs, { id: "p1", nom: "Burger", prix: 9, categorieId: "burgers" });
    expect(fs.updateDoc).toHaveBeenCalled();
    expect(fs.addDoc).not.toHaveBeenCalled();
  });
  it("produit invalide → throw, aucune écriture", async () => {
    const fs = { addDoc: vi.fn(), updateDoc: vi.fn(), doc: vi.fn(), collection: vi.fn(), serverTimestamp: vi.fn() };
    await expect(store.saveProduct({}, fs, { nom: "", prix: -1 })).rejects.toThrow();
    expect(fs.addDoc).not.toHaveBeenCalled();
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });
});

describe("AdminStore.schedulePush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T10:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("quota atteint → throw", async () => {
    store.setConfig({ identity: { id: "s1" } });
    store.setPushHistory([
      { dateCreation: new Date("2026-06-01") },
      { dateCreation: new Date("2026-06-02") },
    ]);
    await expect(store.schedulePush({}, {}, {})).rejects.toThrow(/quota/i);
  });
  it("OK → addDoc avec snackId + statut 'en_attente'", async () => {
    store.setConfig({ identity: { id: "s1" } });
    const addDoc = vi.fn().mockResolvedValue({ id: "x" });
    const fs = { addDoc, collection: vi.fn(() => ({})), serverTimestamp: vi.fn(() => "TS") };
    await store.schedulePush({}, fs, { titre: "Promo" });
    const data = addDoc.mock.calls[0][1];
    expect(data.statut).toBe("en_attente");
    expect(data.snackId).toBe("s1");
  });
});

describe("AdminStore.getFootballTip", () => {
  it("bridge sans functions → null", async () => {
    expect(await store.getFootballTip({})).toBeNull();
  });
  it("aucun match dans la fenêtre 48h → null", async () => {
    const far = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    const httpsCallable = vi.fn(() => async () => ({
      data: { matches: [{ utcDate: far, homeTeam: { name: "A" }, awayTeam: { name: "B" }, competition: { code: "CL" } }] },
    }));
    expect(await store.getFootballTip({ httpsCallable, functions: {} })).toBeNull();
  });
  it("match imminent (<48h) → tip football", async () => {
    const soon = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const httpsCallable = vi.fn(() => async () => ({
      data: { matches: [{ utcDate: soon, homeTeam: { name: "PSG" }, awayTeam: { name: "OM" }, competition: { code: "CL" } }] },
    }));
    const tip = await store.getFootballTip({ httpsCallable, functions: {} });
    expect(tip.type).toBe("football");
    expect(tip.title).toContain("PSG");
  });
});

describe("AdminStore.getSalesTrendTip", () => {
  it("arguments manquants → null", async () => {
    expect(await store.getSalesTrendTip(null, {}, "s1")).toBeNull();
  });
  it("snapshot vide → null", async () => {
    const fs = {
      query: vi.fn(), collection: vi.fn(), where: vi.fn(),
      getDocs: vi.fn().mockResolvedValue({ empty: true, forEach() {} }),
      Timestamp: { fromDate: (d) => d },
    };
    expect(await store.getSalesTrendTip({}, fs, "s1")).toBeNull();
  });
  it("baisse ≥15% sur 7 jours vs moyenne du mois → tip 'sales-trend'", async () => {
    const day = 24 * 3600 * 1000;
    const now = Date.now();
    const docs = [];
    // Activité soutenue il y a 8–29 jours (hors des 7 derniers)
    for (let i = 8; i < 30; i++) docs.push({ data: () => ({ total: 20, date: new Date(now - i * day) }) });
    // Quasi rien sur les 7 derniers jours
    docs.push({ data: () => ({ total: 5, date: new Date(now - 1 * day) }) });
    const fs = {
      query: vi.fn(), collection: vi.fn(), where: vi.fn(),
      getDocs: vi.fn().mockResolvedValue({ empty: false, forEach: (cb) => docs.forEach(cb) }),
      Timestamp: { fromDate: (d) => d },
    };
    const tip = await store.getSalesTrendTip({}, fs, "s1");
    expect(tip?.type).toBe("sales-trend");
  });
});
