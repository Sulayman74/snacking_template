// @vitest-environment jsdom
// 📡 Tests unitaires — suivi de commande côté client (ORD-1), sur le VRAI tracking.js.
// Régressions : badge invisible sur mobile, aucun code ni récap à la confirmation,
// « C'est prêt » rejoué à chaque reprise, suivi jamais relancé, commande remboursée
// laissée « en cours ».
import { describe, it, expect, beforeEach, vi } from "vitest";

let next = null;
let onError = null;
vi.mock("../../src/core/firebase.js", () => ({
  auth: { currentUser: { uid: "u1", isAnonymous: false } },
  db: {},
  doc: vi.fn((db, col, id) => ({ col, id })),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  onSnapshot: vi.fn((ref, onNext, onErr) => { next = onNext; onError = onErr; return vi.fn(); }),
}));
vi.mock("../../src/core/platform.js", () => ({ needsInstallForPush: () => false }));

const fb = await import("../../src/core/firebase.js");
const { escapeHTML, safeURL } = await import("../../src/utils.js");
await import("../../src/tracking.js");

const snap = (data) => ({ exists: () => data !== null, data: () => data });
const order = (over = {}) => ({
  statut: "en_attente_client", mode: "collect", secretCode: "K7Q2", total: 14.5, clientNom: "Léa",
  items: [{ nom: "Menu Burger", quantity: 2 }, { nom: "Coca", quantity: 1 }], paiement: { statut: "paye" }, ...over,
});
const badge = () => document.getElementById("order-tracking-badge");
const subtitle = () => document.getElementById("tracking-subtitle");

beforeEach(() => {
  window.stopOrderTracking();
  localStorage.clear();
  next = null;
  fb.onSnapshot.mockClear();
  document.body.innerHTML = `
    <div id="order-tracking-badge" class="hidden"><span id="badge-text"></span></div>
    <div id="order-tracking-modal" class="hidden opacity-0"><div class="bg-surface scale-95">
      <span id="tracking-order-id"></span><div id="tracking-icon-container"></div><i id="tracking-icon"></i>
      <h2 id="tracking-title"></h2><div id="tracking-subtitle"></div>
      <button id="tracking-action-btn"></button><div id="tracking-notif-prompt"></div>
      <div id="guest-registration-banner" class="hidden"></div>
    </div></div>`;
  Object.assign(window, {
    escapeHTML, safeURL, swapIcon: vi.fn(), showToast: vi.fn(), triggerVibration: vi.fn(),
    snackConfig: {
      identity: { name: "Team Fusion" },
      contact: { address: { street: "18 av. de la Libération", zip: "74300", city: "Cluses", googleMapsUrl: "" } },
      geo: { lat: 46.06, lng: 6.58 },
    },
  });
  localStorage.setItem("activeOrderId", "ORDER1234");
});

describe("Confirmation et badge", () => {
  it("dès la confirmation : code de retrait, récapitulatif, total et itinéraire", () => {
    window.startOrderTracking("ORDER1234");
    next(snap(order()));
    const html = subtitle().innerHTML;
    expect(subtitle().textContent).toContain("K7Q2");
    expect(subtitle().textContent).toContain("2× Menu Burger");
    expect(subtitle().textContent).toContain("14.50 €");
    expect(subtitle().textContent).toContain("18 av. de la Libération, 74300 Cluses");
    expect(html).toContain("https://www.google.com/maps/dir/?api=1&amp;destination=46.06,6.58");
  });

  it("le badge est visible sur mobile (plus de `hidden md:flex`)", () => {
    window.startOrderTracking("ORDER1234");
    next(snap(order({ statut: "nouvelle" })));
    expect(badge().className).toMatch(/^flex /);
    expect(badge().className).not.toContain("hidden");
  });

  it("textes de commande échappés (nom d'article, code)", () => {
    window.startOrderTracking("ORDER1234");
    next(snap(order({ secretCode: "<b>X</b>", items: [{ nom: '<img src=x onerror="window.p=1">', quantity: 1 }] })));
    expect(subtitle().querySelector("img")).toBeNull();
    expect(subtitle().textContent).toContain("<b>X</b>"); // affiché comme du texte
  });
});

describe("Alertes jouées une seule fois", () => {
  it("« C'est prêt » : toast et fenêtre au premier passage, pas à la reprise de l'app", () => {
    window.startOrderTracking("ORDER1234");
    next(snap(order({ statut: "prete" })));
    expect(window.showToast).toHaveBeenCalledTimes(1);

    window.stopOrderTracking();               // app fermée…
    window.resumeOrderTracking();             // …puis rouverte
    next(snap(order({ statut: "prete" })));
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(subtitle().textContent).toContain("K7Q2"); // le code reste affiché
  });
});

describe("Fin de suivi", () => {
  it("commande remboursée : message clair, commande oubliée, badge masqué", () => {
    window.startOrderTracking("ORDER1234");
    next(snap(order({ statut: "nouvelle", paiement: { statut: "rembourse" } })));
    expect(document.getElementById("tracking-title").textContent).toBe("Commande remboursée");
    expect(localStorage.getItem("activeOrderId")).toBeNull();
    expect(badge().className).toBe("hidden");
  });

  it("commande introuvable : on arrête de la suivre", () => {
    window.startOrderTracking("ORDER1234");
    next(snap(null));
    expect(localStorage.getItem("activeOrderId")).toBeNull();
  });

  it("accès refusé (autre compte) : commande oubliée sans message d'erreur", () => {
    window.startOrderTracking("ORDER1234");
    onError({ code: "permission-denied" });
    expect(localStorage.getItem("activeOrderId")).toBeNull();
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it("coupure réseau : on garde la commande pour reprendre plus tard", () => {
    window.startOrderTracking("ORDER1234");
    onError({ code: "unavailable" });
    expect(localStorage.getItem("activeOrderId")).toBe("ORDER1234");
  });
});

describe("Reprise du suivi", () => {
  it("resumeOrderTracking relance la commande stockée ; deux appels = une seule écoute", () => {
    window.resumeOrderTracking();
    window.resumeOrderTracking();
    expect(fb.onSnapshot).toHaveBeenCalledTimes(1);
    expect(fb.onSnapshot.mock.calls[0][0]).toMatchObject({ col: "commandes", id: "ORDER1234" });
  });

  it("sans commande en cours : rien n'est écouté", () => {
    localStorage.clear();
    window.resumeOrderTracking();
    expect(fb.onSnapshot).not.toHaveBeenCalled();
  });
});
