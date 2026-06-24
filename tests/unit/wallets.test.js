import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerApplePayDomains, isAlreadyRegistered } from "../../functions/lib/wallets.js";

describe("wallets — isAlreadyRegistered", () => {
  it("détecte le code d'erreur Stripe resource_already_exists", () => {
    const err = { code: "resource_already_exists" };
    expect(isAlreadyRegistered(err)).toBe(true);
  });

  it("détecte le message d'erreur Stripe contenant 'already exists'", () => {
    const err = { message: "The domain already exists." };
    expect(isAlreadyRegistered(err)).toBe(true);
    
    const errUpper = { message: "ALREADY EXISTS" };
    expect(isAlreadyRegistered(errUpper)).toBe(true);
  });

  it("renvoie false pour les autres erreurs", () => {
    const err1 = { code: "invalid_request_error" };
    expect(isAlreadyRegistered(err1)).toBe(false);

    const err2 = { message: "Cannot verify domain ownership." };
    expect(isAlreadyRegistered(err2)).toBe(false);

    expect(isAlreadyRegistered(null)).toBe(false);
    expect(isAlreadyRegistered(undefined)).toBe(false);
  });
});

describe("wallets — registerApplePayDomains", () => {
  let mockStripe;

  beforeEach(() => {
    mockStripe = {
      paymentMethodDomains: {
        create: vi.fn(),
      },
    };
  });

  it("retourne un bilan vide si stripe ou stripeAccountId est manquant", async () => {
    const res1 = await registerApplePayDomains(null, "acct_123");
    expect(res1).toEqual({ registered: [], skipped: [], failed: [] });

    const res2 = await registerApplePayDomains(mockStripe, "");
    expect(res2).toEqual({ registered: [], skipped: [], failed: [] });
  });

  it("enregistre les domaines avec succès", async () => {
    mockStripe.paymentMethodDomains.create.mockResolvedValue({ id: "pmd_123" });

    const res = await registerApplePayDomains(mockStripe, "acct_123", ["domain1.com", "domain2.com"]);

    expect(mockStripe.paymentMethodDomains.create).toHaveBeenCalledTimes(2);
    expect(mockStripe.paymentMethodDomains.create).toHaveBeenNthCalledWith(
      1,
      { domain_name: "domain1.com" },
      { stripeAccount: "acct_123" }
    );
    expect(mockStripe.paymentMethodDomains.create).toHaveBeenNthCalledWith(
      2,
      { domain_name: "domain2.com" },
      { stripeAccount: "acct_123" }
    );

    expect(res).toEqual({
      registered: ["domain1.com", "domain2.com"],
      skipped: [],
      failed: [],
    });
  });

  it("ignore de façon idempotente les domaines déjà enregistrés", async () => {
    mockStripe.paymentMethodDomains.create.mockRejectedValueOnce({
      code: "resource_already_exists",
    });
    mockStripe.paymentMethodDomains.create.mockResolvedValueOnce({ id: "pmd_456" });

    const res = await registerApplePayDomains(mockStripe, "acct_123", ["already.com", "new.com"]);

    expect(mockStripe.paymentMethodDomains.create).toHaveBeenCalledTimes(2);
    expect(res).toEqual({
      registered: ["new.com"],
      skipped: ["already.com"],
      failed: [],
    });
  });

  it("collecte dans failed les autres erreurs Stripe et continue l'enregistrement", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockStripe.paymentMethodDomains.create.mockRejectedValueOnce(new Error("Stripe API down"));
    mockStripe.paymentMethodDomains.create.mockResolvedValueOnce({ id: "pmd_789" });

    const res = await registerApplePayDomains(mockStripe, "acct_123", ["bad.com", "good.com"]);

    expect(mockStripe.paymentMethodDomains.create).toHaveBeenCalledTimes(2);
    expect(res).toEqual({
      registered: ["good.com"],
      skipped: [],
      failed: ["bad.com"],
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
