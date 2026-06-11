// 🔒 Tests des Firestore Security Rules — collection `commandes`.
// Cible : la GARDE D'ÉTAT SOURCE du Lot 6 (audit-lots-4-5-6 §1) qui empêche le
// client propriétaire de renvoyer en file cuisine une commande déjà avancée.
// Exige l'émulateur Firestore (lancé par `firebase emulators:exec`).
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";

const OWNER = "alice";

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

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed (rules désactivées) : deux commandes du même propriétaire, états différents.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = {
      userId: OWNER,
      snackId: "snack1",
      total: 12.5,
      paiement: { statut: "paye" },
      mode: "collect",
    };
    await setDoc(doc(db, "commandes", "cmd_prete"), { ...base, statut: "prete" });
    await setDoc(doc(db, "commandes", "cmd_attente"), {
      ...base,
      statut: "en_attente_client",
    });
  });
});

describe("commandes — garde d'état source (Lot 6)", () => {
  it("REFUSE prete → nouvelle par le propriétaire (renvoi en file interdit)", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      updateDoc(doc(db, "commandes", "cmd_prete"), {
        statut: "nouvelle",
        dateArriveeClient: serverTimestamp(),
      }),
    );
  });

  it("AUTORISE en_attente_client → nouvelle par le propriétaire (parcours légitime)", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "commandes", "cmd_attente"), {
        statut: "nouvelle",
        dateArriveeClient: serverTimestamp(),
      }),
    );
  });

  it("REFUSE en_attente_client → terminee (cible non 'nouvelle', garde existante intacte)", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      updateDoc(doc(db, "commandes", "cmd_attente"), {
        statut: "terminee",
        dateArriveeClient: serverTimestamp(),
      }),
    );
  });

  it("REFUSE la modification d'un champ non autorisé (total) même vers nouvelle", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      updateDoc(doc(db, "commandes", "cmd_attente"), {
        statut: "nouvelle",
        total: 0.01,
      }),
    );
  });

  it("REFUSE à un non-propriétaire de toucher la commande", async () => {
    const db = testEnv.authenticatedContext("mallory").firestore();
    await assertFails(
      updateDoc(doc(db, "commandes", "cmd_attente"), {
        statut: "nouvelle",
        dateArriveeClient: serverTimestamp(),
      }),
    );
  });
});
