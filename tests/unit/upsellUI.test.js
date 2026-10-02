// @vitest-environment jsdom
// ➕ Tests unitaires — bottom-sheet d'upsell (audit UX-2), sur le VRAI module.
// Régression : « Non merci » renvoyait au panier au lieu du paiement, et l'upsell
// réapparaissait à chaque nouvelle validation.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/core/firebase.js", () => ({
  functions: {},
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({})),
}));
vi.mock("../../src/core/Store.js", () => ({
  store: { getUpsellSuggestions: vi.fn(), addToCart: vi.fn() },
}));

const { store } = await import("../../src/core/Store.js");

function mountDom() {
  document.body.innerHTML = `
    <div id="upsell-bottom-sheet" class="hidden opacity-0">
      <div class="absolute inset-0" data-upsell-action="skip" id="backdrop"></div>
      <div id="upsell-sheet-content" class="translate-y-full">
        <button data-upsell-action="cancel" id="close"></button>
        <h3 id="upsell-title"></h3>
        <ul id="upsell-suggestions"></ul>
        <button data-upsell-action="continue" id="continue"></button>
        <button data-upsell-action="skip" id="no-thanks"></button>
      </div>
    </div>
    <template id="upsell-item-template">
      <li><div><img class="upsell-item-image"><div class="upsell-item-fallback"></div></div>
      <p class="upsell-item-name"></p><p class="upsell-item-price"></p>
      <button class="upsell-add-btn"></button></li>
    </template>`;
}

async function freshUpsell() {
  vi.resetModules();
  mountDom();
  return (await import("../../src/ui/UpsellUI.js")).upsellUI;
}

const SUGGESTIONS = [{ id: "cafe", nom: "Café", prix: 1.5 }];

describe("UpsellUI — décisions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.getUpsellSuggestions.mockReturnValue(SUGGESTIONS);
  });

  it.each([
    ["no-thanks", "continue"], // « Non merci » → paiement
    ["backdrop", "continue"],  // tap sur le fond → paiement
    ["continue", "continue"],
    ["close", "cancel"],       // croix → retour panier
  ])("clic sur %s → %s", async (target, expected) => {
    const upsell = await freshUpsell();
    const choice = upsell.show();
    document.getElementById(target).click();
    vi.advanceTimersByTime(300);
    await expect(choice).resolves.toBe(expected);
  });

  it("proposé une seule fois par session", async () => {
    const upsell = await freshUpsell();
    expect(upsell.shouldOffer()).toBe(true);
    const first = upsell.show();
    document.getElementById("close").click();
    vi.advanceTimersByTime(300);
    await first;

    expect(upsell.shouldOffer()).toBe(false);
    await expect(upsell.show()).resolves.toBe("continue");
    expect(document.getElementById("upsell-bottom-sheet").classList.contains("hidden")).toBe(true);
  });

  it("aucune suggestion → rien à proposer (pas d'appel charge cuisine)", async () => {
    store.getUpsellSuggestions.mockReturnValue([]);
    const upsell = await freshUpsell();
    expect(upsell.shouldOffer()).toBe(false);
  });
});
