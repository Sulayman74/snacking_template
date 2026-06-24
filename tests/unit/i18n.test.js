// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { t, changeLanguage, translateDOM } from "../../src/i18n/index.js";
import { store } from "../../src/core/Store.js";

describe("Module i18n - Internationalisation", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Réinitialiser la langue en français pour chaque test
    await changeLanguage("fr");
  });

  it("doit traduire une clé simple existante", () => {
    expect(t("navbar.menu")).toBe("La Carte");
  });

  it("doit interpoler les paramètres", () => {
    expect(t("cart.itemQuantity", { quantity: 3, name: "Burger" })).toBe("3 x Burger");
  });

  it("doit renvoyer la clé elle-même si elle est absente", () => {
    expect(t("inconnue.cle")).toBe("inconnue.cle");
  });

  it("doit traduire le DOM statique avec data-i18n", () => {
    document.body.innerHTML = `
      <div data-i18n="navbar.menu">Ancien texte</div>
      <input data-i18n-placeholder="auth.email" placeholder="Old placeholder" />
      <button data-i18n-title="navbar.theme" title="Old title">Theme</button>
    `;

    translateDOM();

    expect(document.querySelector("[data-i18n]").textContent).toBe("La Carte");
    expect(document.querySelector("[data-i18n-placeholder]").placeholder).toBe("Adresse e-mail");
    expect(document.querySelector("[data-i18n-title]").getAttribute("title")).toBe("Thème");
  });

  it("doit changer de langue vers l'anglais", async () => {
    // Initialement en français
    expect(t("navbar.menu")).toBe("La Carte");

    // Changer pour l'anglais
    await changeLanguage("en");

    expect(store.state.locale).toBe("en");
    expect(localStorage.getItem("snack_locale")).toBe("en");
    expect(t("navbar.menu")).toBe("The Menu");
  });
});
