// @vitest-environment jsdom
// 📲 Tests unitaires — bandeau « Installer l'app » (audit UX-3), sur le VRAI module.
// Régression : affiché 1,5 s après la première visite, il masquait « Ajouter ».
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/core/platform.js", () => ({ needsInstallForPush: vi.fn(() => false) }));
const { setupA2HS } = await import("../../src/a2hs.js");

const OPTS = { bannerId: "banner", btnId: "install", closeId: "close", hintId: "hint" };
const visible = () => !document.getElementById("banner").classList.contains("opacity-0");
const installable = () => window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn() }));

describe("setupA2HS", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = `
      <div id="banner" class="translate-y-32 opacity-0 pointer-events-none">
        <p id="hint"></p><button id="install"></button><button id="close"></button>
      </div>`;
  });
  afterEach(() => vi.useRealTimers());

  it("admin/livreur (sans condition) : affiché dès que l'app est installable", () => {
    setupA2HS(OPTS);
    installable();
    vi.advanceTimersByTime(1500);
    expect(visible()).toBe(true);
  });

  it("client : rien avant la première commande, puis affiché après", () => {
    setupA2HS({ ...OPTS, waitForEvent: "snack:order-placed" });
    installable();
    vi.advanceTimersByTime(10_000);
    expect(visible()).toBe(false);

    window.dispatchEvent(new CustomEvent("snack:order-placed"));
    vi.advanceTimersByTime(1500);
    expect(visible()).toBe(true);
  });

  it("client déjà venu commander : affiché dès la visite suivante", () => {
    localStorage.setItem("a2hs_ready_banner", "1");
    setupA2HS({ ...OPTS, waitForEvent: "snack:order-placed" });
    installable();
    vi.advanceTimersByTime(1500);
    expect(visible()).toBe(true);
  });

  it("commande passée mais app pas installable : rien", () => {
    setupA2HS({ ...OPTS, waitForEvent: "snack:order-placed" });
    window.dispatchEvent(new CustomEvent("snack:order-placed"));
    vi.advanceTimersByTime(5000);
    expect(visible()).toBe(false);
  });
});
