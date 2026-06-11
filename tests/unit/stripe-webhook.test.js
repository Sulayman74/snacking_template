// 🔌 Tests unitaires — résolution de l'ID d'abonnement Stripe dans le webhook
// (Lot 5, audit-lots-4-5-6 §2). Vérifie le pattern Read Old/New : ancien champ
// `invoice.subscription` ET nouveau `invoice.parent.subscription_details.subscription`
// (API Basil+), tel que configuré sur le endpoint (2026-03-25.dahlia).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveSubscriptionId } = require("../../functions/lib/stripe.js");

describe("resolveSubscriptionId (Lot 5 — webhook robuste)", () => {
  it("legacy : invoice.subscription (string) → l'ID", () => {
    expect(resolveSubscriptionId({ subscription: "sub_legacy" })).toBe("sub_legacy");
  });

  it("Basil+ : invoice.parent.subscription_details.subscription → l'ID", () => {
    expect(
      resolveSubscriptionId({
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: "sub_basil" },
        },
      }),
    ).toBe("sub_basil");
  });

  it("Basil sans subscription dans subscription_details → null", () => {
    expect(
      resolveSubscriptionId({
        parent: { type: "subscription_details", subscription_details: {} },
      }),
    ).toBeNull();
  });

  it("parent d'un autre type (quote_details) → null (pas de faux positif)", () => {
    expect(
      resolveSubscriptionId({
        parent: { type: "quote_details", quote_details: { quote: "q_1" } },
      }),
    ).toBeNull();
  });

  it("invoice sans subscription ni parent → null", () => {
    expect(resolveSubscriptionId({ id: "in_123" })).toBeNull();
  });

  it("invoice null / undefined → null (pas de throw)", () => {
    expect(resolveSubscriptionId(null)).toBeNull();
    expect(resolveSubscriptionId(undefined)).toBeNull();
  });

  it("subscription expandé en objet (non-string) → null (pas pris pour un ID)", () => {
    expect(resolveSubscriptionId({ subscription: { id: "sub_x" } })).toBeNull();
  });
});
