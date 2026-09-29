// 🔒 Tests des Firestore Security Rules — `pushSubscriptions` (tokens push).
// Écrits par le callable registerPushToken uniquement : aucun accès client,
// même pour son propre abonnement. Exige l'émulateur Firestore.
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where } from "firebase/firestore";
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
    await setDoc(doc(db, "users", "adminA"), { role: "admin", snackId: "snackA" });
    await setDoc(doc(db, "pushSubscriptions", "sub1"), { uid: "alice", snackId: "snackA", app: "client", token: "t" });
  });
});

describe("pushSubscriptions — aucun accès client", () => {
  it("REFUSE au propriétaire de lire son abonnement", async () => {
    await assertFails(getDoc(doc(testEnv.authenticatedContext("alice").firestore(), "pushSubscriptions", "sub1")));
  });

  it("REFUSE à l'admin du snack de lister les tokens", async () => {
    const db = testEnv.authenticatedContext("adminA").firestore();
    await assertFails(getDocs(query(collection(db, "pushSubscriptions"), where("snackId", "==", "snackA"))));
  });

  it("REFUSE de créer un abonnement en direct (contournement du callable)", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "pushSubscriptions", "forged"), { uid: "alice", snackId: "snackA", app: "admin", token: "x" }));
  });

  it("REFUSE de supprimer l'abonnement d'un autre", async () => {
    await assertFails(deleteDoc(doc(testEnv.authenticatedContext("bob").firestore(), "pushSubscriptions", "sub1")));
  });
});
