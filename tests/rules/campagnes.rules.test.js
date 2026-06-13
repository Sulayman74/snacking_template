// 🔒 Tests des Firestore Security Rules — collection `campagnes_push` (push P1).
// Cible : la création est désormais SERVEUR-ONLY (create:if false) — même un admin
// du snack ne peut plus écrire directement (le quota est enforcé dans la CF
// schedulePushCampaign). Exige l'émulateur Firestore.
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "snacking-template",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", "admin_A"), { role: "admin", snackId: "snackA" });
    await setDoc(doc(db, "users", "client_C"), { role: "client", pointsBySnack: {} });
    // Campagne seedée (comme si créée par la CF Admin SDK) pour tester read/update.
    await setDoc(doc(db, "campagnes_push", "camp1"), {
      snackId: "snackA", titre: "T", message: "M", cible: "all",
      statut: "en_attente", stats: { envoye: 0, clics: 0 },
    });
  });
});

describe("campagnes_push — création serveur-only (P1)", () => {
  it("REFUSE la création directe par l'admin du snack (create:false)", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(setDoc(doc(db, "campagnes_push", "forged"), {
      snackId: "snackA", titre: "Forgée", message: "x", cible: "all",
      statut: "en_attente", stats: { envoye: 0, clics: 0 },
    }));
  });

  it("AUTORISE l'admin du snack à LIRE ses campagnes", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertSucceeds(getDoc(doc(db, "campagnes_push", "camp1")));
  });

  it("REFUSE un client de lire les campagnes", async () => {
    const db = testEnv.authenticatedContext("client_C").firestore();
    await assertFails(getDoc(doc(db, "campagnes_push", "camp1")));
  });
});
