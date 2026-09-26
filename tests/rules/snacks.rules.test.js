// 🔒 Tests rules — `snacks` : l'admin édite sa vitrine mais PAS la facturation
// plateforme (lue par createPaymentIntent → application_fee_amount) ni le
// routage tenant (domaine/slug). Exige l'émulateur.
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "snacking-template",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", "admin_A"), { role: "admin", snackId: "snackA" });
    await setDoc(doc(db, "users", "admin_B"), { role: "admin", snackId: "snackB" });
    await setDoc(doc(db, "users", "super"), { role: "superadmin" });
    await setDoc(doc(db, "snacks", "snackA"), {
      nom: "Snack A", phoneNumber: "0102030405", enableDelivery: false,
      pricingPlan: "starter", commissionRate: 0.08, minFeeCents: 50,
      trialPeriodMonths: 1, prixAbonnement: 29, domaine: "snack-a", slug: "snack-a",
    });
  });
});

const BILLING_AND_ROUTING = {
  pricingPlan: "pro",
  commissionRate: 0,
  minFeeCents: 0,
  trialPeriodMonths: 999,
  prixAbonnement: 0,
  stripeCustomerId: "cus_evil",
  domaine: "concurrent",
  slug: "concurrent",
};

describe("snacks — champs éditables par l'admin", () => {
  it("AUTORISE l'admin à éditer sa vitrine (téléphone, livraison, pause)", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertSucceeds(updateDoc(doc(db, "snacks", "snackA"), {
      phoneNumber: "0600000000", enableDelivery: true, servicePausedUntil: null,
    }));
  });

  it("AUTORISE une sauvegarde qui réécrit la facturation À L'IDENTIQUE", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertSucceeds(updateDoc(doc(db, "snacks", "snackA"), {
      pricingPlan: "starter", trialPeriodMonths: 1, nom: "Snack A bis",
    }));
  });

  it.each(Object.entries(BILLING_AND_ROUTING))("REFUSE l'admin de modifier %s", async (field, value) => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(updateDoc(doc(db, "snacks", "snackA"), { [field]: value }));
  });

  it("REFUSE l'admin d'un autre snack", async () => {
    const db = testEnv.authenticatedContext("admin_B").firestore();
    await assertFails(updateDoc(doc(db, "snacks", "snackA"), { phoneNumber: "0" }));
  });

  it("AUTORISE le superadmin à régler la facturation", async () => {
    const db = testEnv.authenticatedContext("super").firestore();
    await assertSucceeds(updateDoc(doc(db, "snacks", "snackA"), BILLING_AND_ROUTING));
  });
});
