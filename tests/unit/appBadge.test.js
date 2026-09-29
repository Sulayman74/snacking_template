// 🔴 Tests unitaires — pastille de l'app (src/core/appBadge.js).
import { describe, it, expect, vi, afterEach } from "vitest";
import { setAppBadgeCount, countPendingKitchenOrders, PENDING_KITCHEN_STATUSES } from "../../src/core/appBadge.js";

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
    const clearAppBadge = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });
    setAppBadgeCount(4);
    setAppBadgeCount(0);
    expect(setAppBadge).toHaveBeenCalledWith(4);
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
  });

  it("navigateur sans Badging API → no-op", () => {
    vi.stubGlobal("navigator", {});
    expect(() => setAppBadgeCount(2)).not.toThrow();
  });
});
