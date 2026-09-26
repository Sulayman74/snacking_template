// @vitest-environment jsdom
// 🛡️ Tests unitaires — verrous anti double-clic du VRAI composant <snack-checkout>.
// Régression : deux clics rapides sur « Valider » créaient deux PaymentIntents ;
// deux clics sur « Payer » lançaient deux confirmPayment (le `?disabled` Lit
// n'est appliqué qu'au rendu suivant).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/firebase.js", () => ({
  auth: { currentUser: { uid: "u1", isAnonymous: false, email: "c@test.dev" } },
  functions: {},
  httpsCallable: vi.fn(() => vi.fn()),
  signInAnonymously: vi.fn(),
}));
vi.mock("../../src/auth.js", () => ({ ensureUserDoc: vi.fn() }));
vi.mock("../../src/ui/UpsellUI.js", () => ({ upsellUI: { show: vi.fn() } }));

const { SnackCheckout } = await import("../../src/components/SnackCheckout.js");

describe("<snack-checkout> — anti double-clic", () => {
  let el;
  beforeEach(() => {
    el = new SnackCheckout();
  });

  it("processCheckout : deux clics concurrents → un seul tunnel (un seul PaymentIntent)", async () => {
    let release;
    const inner = vi.spyOn(el, "_processCheckout").mockImplementation(
      () => new Promise((r) => { release = r; })
    );
    const first = el.processCheckout();
    const second = el.processCheckout();
    release();
    await Promise.all([first, second]);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("processCheckout : le verrou est relâché après échec (on peut réessayer)", async () => {
    const inner = vi.spyOn(el, "_processCheckout")
      .mockRejectedValueOnce(new Error("réseau"))
      .mockResolvedValueOnce();
    await expect(el.processCheckout()).rejects.toThrow("réseau");
    await el.processCheckout();
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("submitStripePayment : deux clics concurrents → un seul confirmPayment", async () => {
    let release;
    const confirmPayment = vi.fn(() => new Promise((r) => { release = r; }));
    el.stripeInstance = { confirmPayment };
    el.stripeElements = {};
    const first = el.submitStripePayment();
    const second = el.submitStripePayment();
    release({ error: { message: "Carte refusée" } });
    await Promise.all([first, second]);
    expect(confirmPayment).toHaveBeenCalledTimes(1);
    expect(el.isProcessing).toBe(false);
    expect(el.errorMessage).toBe("Carte refusée");
  });

  it("submitStripePayment : statut non abouti sans erreur → message (jamais d'écran muet)", async () => {
    el.stripeInstance = { confirmPayment: vi.fn().mockResolvedValue({ paymentIntent: { status: "processing" } }) };
    el.stripeElements = {};
    const finalize = vi.spyOn(el, "finalizeOrderInFirestore");
    await el.submitStripePayment();
    expect(finalize).not.toHaveBeenCalled();
    expect(el.errorMessage).toMatch(/non confirmé|not confirmed/i);
  });
});
