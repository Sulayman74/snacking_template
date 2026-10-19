// 🔴 Tests unitaires — pastille de l'app (src/core/appBadge.js).
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  setAppBadgeCount,
  clearAppBadge,
  setupAppBadgeAutoClear,
  countPendingKitchenOrders,
  PENDING_KITCHEN_STATUSES,
} from "../../src/core/appBadge.js";

describe("appBadge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("compte seulement les commandes qui attendent la cuisine", () => {
    const orders = new Map([
      ["a", { statut: "en_attente_client" }], ["b", { statut: "nouvelle" }],
      ["c", { statut: "prete" }], ["d", { statut: "nouvelle" }],
    ]);
    expect(countPendingKitchenOrders(orders.values())).toBe(3);
    expect(PENDING_KITCHEN_STATUSES).toEqual(["en_attente_client", "nouvelle"]); // = functions/lib/kitchen.js
  });

  it("affiche le nombre, retire la pastille à 0", () => {
    const setAppBadge = vi.fn(() => Promise.resolve());
    const clearAppBadgeFn = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { setAppBadge, clearAppBadge: clearAppBadgeFn });
    setAppBadgeCount(4);
    setAppBadgeCount(0);
    expect(setAppBadge).toHaveBeenCalledWith(4);
    expect(clearAppBadgeFn).toHaveBeenCalledTimes(1);
  });

  it("setAppBadgeCount(0) appelle clearAppBadge et notifie le service worker", () => {
    const clearAppBadgeFn = vi.fn(() => Promise.resolve());
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", {
      setAppBadge: vi.fn(),
      clearAppBadge: clearAppBadgeFn,
      serviceWorker: { controller: { postMessage } },
    });
    setAppBadgeCount(0);
    expect(clearAppBadgeFn).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_BADGE" });
  });

  it("clearAppBadge retire la pastille et notifie le service worker si actif", () => {
    const clearAppBadgeFn = vi.fn(() => Promise.resolve());
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", {
      clearAppBadge: clearAppBadgeFn,
      serviceWorker: { controller: { postMessage } },
    });
    clearAppBadge();
    expect(clearAppBadgeFn).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_BADGE" });
  });

  it("clearAppBadge utilise navigator.serviceWorker.ready si controller est absent", async () => {
    const clearAppBadgeFn = vi.fn(() => Promise.resolve());
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", {
      clearAppBadge: clearAppBadgeFn,
      serviceWorker: {
        controller: null,
        ready: Promise.resolve({ active: { postMessage } }),
      },
    });
    clearAppBadge();
    expect(clearAppBadgeFn).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // flush microtask
    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_BADGE" });
  });

  it("setupAppBadgeAutoClear réinitialise immédiatement et lors de visibilitychange vers visible", () => {
    const clearAppBadgeFn = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clearAppBadge: clearAppBadgeFn });

    let visibilityHandler = null;
    let visibilityState = "hidden";
    const documentStub = {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: vi.fn((event, cb) => {
        if (event === "visibilitychange") visibilityHandler = cb;
      }),
    };
    vi.stubGlobal("document", documentStub);

    setupAppBadgeAutoClear();
    expect(clearAppBadgeFn).toHaveBeenCalledTimes(1);
    expect(documentStub.addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    // Passe en arrière-plan → pas d'appel supplémentaire
    visibilityState = "hidden";
    visibilityHandler();
    expect(clearAppBadgeFn).toHaveBeenCalledTimes(1);

    // Retour au premier plan → nouvel appel
    visibilityState = "visible";
    visibilityHandler();
    expect(clearAppBadgeFn).toHaveBeenCalledTimes(2);
  });

  it("navigateur sans Badging API → no-op", () => {
    vi.stubGlobal("navigator", {});
    expect(() => setAppBadgeCount(2)).not.toThrow();
    expect(() => clearAppBadge()).not.toThrow();
  });
});
