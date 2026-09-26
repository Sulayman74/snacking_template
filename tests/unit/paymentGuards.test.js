// 🛡️ Tests unitaires — garde-fous PaymentIntent de finalizeOrder (OWASP A04).
// Régression : un PI en devise sans décimales (KRW/JPY) ou émis pour un autre
// snack passait le contrôle de montant (1500 KRW ≈ 1 € pour une commande de 15 €).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ORDER_CURRENCY, assertPaymentIntentMatchesOrder } = require("../../functions/lib/paymentGuards.js");

const pi = (over = {}) => ({
  id: "pi_test",
  status: "succeeded",
  amount: 1500,
  currency: "eur",
  metadata: { snack_id: "snackA" },
  ...over,
});

describe("assertPaymentIntentMatchesOrder", () => {
  it("la devise encaissée est l'euro", () => {
    expect(ORDER_CURRENCY).toBe("eur");
  });

  it("PI EUR émis pour ce snack → accepté", () => {
    expect(() => assertPaymentIntentMatchesOrder(pi(), "snackA")).not.toThrow();
  });

  it.each(["krw", "jpy", "clp", "usd", undefined])("devise %s → rejet failed-precondition", (currency) => {
    expect(() => assertPaymentIntentMatchesOrder(pi({ currency }), "snackA")).toThrow(
      expect.objectContaining({ code: "failed-precondition", message: "Devise du paiement invalide." })
    );
  });

  it("PI émis pour un autre snack → rejet", () => {
    expect(() => assertPaymentIntentMatchesOrder(pi(), "snackB")).toThrow(
      expect.objectContaining({ code: "failed-precondition", message: "Paiement non rattaché à ce restaurant." })
    );
  });

  it("PI sans metadata.snack_id (créé hors createPaymentIntent) → rejet", () => {
    expect(() => assertPaymentIntentMatchesOrder(pi({ metadata: {} }), "snackA")).toThrow(/rattaché/);
    expect(() => assertPaymentIntentMatchesOrder(pi({ metadata: undefined }), "snackA")).toThrow(/rattaché/);
  });

  it("snackId vide ne matche pas un PI sans metadata", () => {
    expect(() => assertPaymentIntentMatchesOrder(pi({ metadata: {} }), undefined)).toThrow(/rattaché/);
  });
});
