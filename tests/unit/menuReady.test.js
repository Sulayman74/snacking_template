// @vitest-environment jsdom
// 🍔 Tests unitaires — signal « menu prêt » (audit UX-6), sur le VRAI module.
// Régression : `snack:menu:ready` n'était jamais émis → splash de 4 s à chaque
// ouverture et lien direct « ?action=product » qui n'ouvrait jamais la fiche.
import { describe, it, expect, beforeEach, vi } from "vitest";

let onNext, onError;
vi.mock("../../src/core/firebase.js", () => ({
  db: {},
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn((q, next, error) => { onNext = next; onError = error; return vi.fn(); }),
}));
vi.mock("../../src/core/Store.js", () => ({ store: { setMenu: vi.fn() } }));
await import("../../src/menu.js");

const snapshot = (docs) => ({ forEach: (fn) => docs.forEach((d) => fn({ id: d.id, data: () => d })) });

describe("chargerMenuComplet — snack:menu:ready", () => {
  let ready;
  beforeEach(() => {
    window.snackConfig = { identity: { id: "snackA" } };
    ready = vi.fn();
    window.addEventListener("snack:menu:ready", ready);
    window.chargerMenuComplet();
  });

  it("émis une fois au premier résultat, pas à chaque mise à jour du menu", () => {
    onNext(snapshot([{ id: "p1" }]));
    onNext(snapshot([{ id: "p1" }, { id: "p2" }]));
    expect(ready).toHaveBeenCalledTimes(1);
    window.removeEventListener("snack:menu:ready", ready);
  });

  it("émis aussi en cas d'erreur (le splash ne reste pas affiché)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    onError(new Error("permission-denied"));
    expect(ready).toHaveBeenCalledTimes(1);
    window.removeEventListener("snack:menu:ready", ready);
  });
});
