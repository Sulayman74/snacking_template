// @vitest-environment jsdom
// 🍽️ Tests unitaires — petits bugs du menu (BUG-1), sur les VRAIS composants.
// Régressions : crudités jamais proposées, best-seller épuisé en vitrine, recherche
// sans résultat = page blanche, panier illisible (nom coupé, « & » affiché « &amp; »).
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/core/firebase.js", () => ({
  auth: { currentUser: null }, functions: {}, httpsCallable: vi.fn(() => vi.fn()), signInAnonymously: vi.fn(),
  db: {}, doc: vi.fn(), getDoc: vi.fn(), onSnapshot: vi.fn(), collection: vi.fn(), query: vi.fn(), where: vi.fn(),
}));

const { store } = await import("../../src/core/Store.js");
await import("../../src/components/SnackBestsellers.js");
await import("../../src/components/SnackMenuList.js");
await import("../../src/components/SnackCartItem.js");

const P = (over) => ({ id: over.nom, prix: 5, categorieId: "burgers", isAvailable: true, ventes: 0, ...over });

async function mount(tag, props = {}) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("« Nos Stars » (SnackBestsellers)", () => {
  it("n'affiche ni produit épuisé ni supplément, même s'ils vendent le plus", async () => {
    store.setMenu([
      P({ nom: "Tacos épuisé", ventes: 999, isAvailable: false }),
      P({ nom: "Cheddar", ventes: 500, categorieId: "supplements" }),
      P({ nom: "Burger", ventes: 50 }),
      P({ nom: "Frites", ventes: 40, categorieId: "sides" }),
      P({ nom: "Wrap", ventes: 30 }),
      P({ nom: "Salade", ventes: 1 }),
    ]);
    const el = await mount("snack-bestsellers");
    const names = [...el.shadowRoot.querySelectorAll("snack-menu-item")].map((i) => i.product.nom);
    expect(names).toEqual(["Burger", "Frites", "Wrap"]);
  });
});

describe("Recherche sans résultat (SnackMenuList)", () => {
  it("affiche un message et un bouton pour effacer, au lieu d'une page blanche", async () => {
    store.setMenu([P({ nom: "Burger" }), P({ nom: "Tacos", description: "poulet" })]);
    const el = await mount("snack-menu-list");
    el.searchQuery = "zzz";
    await el.updateComplete;
    const status = el.shadowRoot.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Aucun produit trouvé");

    status.querySelector("button").click();
    await el.updateComplete;
    expect(el.searchQuery).toBe("");
    expect(el.shadowRoot.querySelector('[role="status"]')).toBeNull();
  });

  it("la recherche porte aussi sur la description, sans planter si un nom manque", async () => {
    store.setMenu([P({ nom: "Tacos", description: "poulet" }), P({ nom: undefined, id: "x" })]);
    const el = await mount("snack-menu-list");
    el.searchQuery = "poulet";
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('[role="status"]')).toBeNull();
    expect(el.shadowRoot.querySelectorAll("snack-menu-item")).toHaveLength(1);
  });
});

describe("Article du panier (SnackCartItem)", () => {
  const item = {
    id: "burger-menu", nom: "Menu Burger & Frites maison extra-longues", prix: 12.4, quantity: 1,
    taille: "Mega", boisson: "Coca", sauces: ["Algérienne", "Samouraï"],
    supplements: [{ productId: "cheddar", nom: "Cheddar", prix: 1 }], sansCrudites: ["Oignons"],
  };

  it("une ligne par option, libellée ; « & » affiché tel quel (pas de double échappement)", async () => {
    const el = await mount("snack-cart-item", { item });
    const root = el.shadowRoot;
    expect(root.querySelector("h2").textContent).toBe(item.nom);
    expect(root.querySelector("h2").className).not.toContain("truncate");
    const rows = [...root.querySelectorAll("dt")].map((dt) => `${dt.textContent}: ${dt.nextElementSibling.textContent}`);
    expect(rows).toEqual([
      "Taille: Mega", "Boisson: Coca", "Sauces: Algérienne, Samouraï", "Suppléments: +Cheddar", "Sans: Oignons",
    ]);
    expect(root.innerHTML).not.toContain("&amp;amp;");
  });

  it("quantité 1 : le bouton − devient « Supprimer » (poubelle) ; boutons de 44 px libellés", async () => {
    const el = await mount("snack-cart-item", { item });
    const minus = el.shadowRoot.querySelector(".cart-item-minus");
    const plus = el.shadowRoot.querySelector(".cart-item-plus");
    expect(minus.getAttribute("aria-label")).toBe(`Supprimer ${item.nom} du panier`);
    expect(minus.querySelector("[data-lucide]").getAttribute("data-lucide")).toBe("trash-2");
    expect(plus.getAttribute("aria-label")).toBe(`Ajouter un ${item.nom}`);
    for (const b of [minus, plus]) expect(b.className).toMatch(/\bw-11 h-11\b/);
  });

  it("quantité 2 : bouton « − », total et prix unitaire affichés", async () => {
    const el = await mount("snack-cart-item", { item: { ...item, quantity: 2 } });
    const minus = el.shadowRoot.querySelector(".cart-item-minus");
    expect(minus.getAttribute("aria-label")).toBe(`Retirer un ${item.nom}`);
    expect(el.shadowRoot.textContent).toContain("24.80 €");
    expect(el.shadowRoot.textContent).toContain("12.40 € l'unité");
  });

  it("supprimer à quantité 1 retire l'article du panier", async () => {
    store.clearCart?.();
    store.addToCart({ ...item });
    const el = await mount("snack-cart-item", { item: store.state.cart[0] });
    el.shadowRoot.querySelector(".cart-item-minus").click();
    expect(store.state.cart.find((i) => i.id === item.id)).toBeUndefined();
  });
});

describe("Crudités dans la fiche produit (product-modal)", () => {
  it("les crudités configurées côté admin sont proposées « à retirer »", async () => {
    document.body.innerHTML = `
      <div id="product-modal-backdrop"></div>
      <div id="product-modal" class="translate-y-full">
        <img id="modal-img"><h3 id="modal-title"></h3><p id="modal-desc"></p>
        <button id="modal-share-btn"></button><div id="modal-allergens-container"></div>
        <div id="modal-options-container"></div>
        <button id="modal-fav-btn"></button><button id="modal-cta"></button>
      </div>
      <button id="close-product-modal"></button>`;
    const { productModalUI } = await import("../../src/product-modal.js");
    store.setConfig({ identity: { currency: "€" }, features: {} });
    store.setMenu([P({ nom: "Kebab", id: "kebab", hasCrudites: true, crudites: ["Oignons", "Tomates", " "] })]);

    productModalUI.open("kebab");

    const boxes = [...document.querySelectorAll(".crudite-checkbox")].map((b) => b.value);
    expect(boxes).toEqual(["Oignons", "Tomates"]);
    expect(document.getElementById("modal-options-container").textContent).toContain("Sans Oignons");
  });
});
