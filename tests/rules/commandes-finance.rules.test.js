// 🔒 Tests rules — protection des champs financiers de compta sur `commandes` (LOT A).
// L'admin gère sa commande (statut/paiement) mais ne peut PAS muter commission/
// stripeFee/stripeNet/tvaBreakdown/refund (source de vérité serveur). Exige l'émulateur.
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
    await setDoc(doc(db, "commandes", "cmd1"), {
      snackId: "snackA", userId: "client_x", statut: "nouvelle", mode: "collect",
      total: 20, commission: 160, stripeFee: 55, stripeNet: 1785,
      tvaBreakdown: { "10": { ttc: 2000, ht: 1818, tva: 182 }, livraison: null },
      refund: { total: 0, commission: 0, count: 0, fullyRefunded: false, items: [] },
      paiement: { statut: "paye" },
    });
  });
});

describe("commandes — champs financiers serveur-only (LOT A)", () => {
  it("AUTORISE l'admin à changer le statut cuisine", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertSucceeds(updateDoc(doc(db, "commandes", "cmd1"), { statut: "prete" }));
  });

  it("AUTORISE l'admin à basculer paiement.statut (caisse)", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertSucceeds(updateDoc(doc(db, "commandes", "cmd1"), { "paiement.statut": "en_attente" }));
  });

  it("REFUSE l'admin de muter tvaBreakdown", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(updateDoc(doc(db, "commandes", "cmd1"), {
      tvaBreakdown: { "10": { ttc: 1, ht: 1, tva: 0 }, livraison: null },
    }));
  });

  it("REFUSE l'admin de muter le bloc refund (réservé à refundOrder)", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(updateDoc(doc(db, "commandes", "cmd1"), {
      refund: { total: 9999, commission: 0, count: 1, fullyRefunded: true, items: [] },
    }));
  });

  it("REFUSE l'admin de muter la commission / stripeFee / stripeNet", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(updateDoc(doc(db, "commandes", "cmd1"), { commission: 0 }));
    await assertFails(updateDoc(doc(db, "commandes", "cmd1"), { stripeFee: 0 }));
    await assertFails(updateDoc(doc(db, "commandes", "cmd1"), { stripeNet: 999999 }));
  });
});
