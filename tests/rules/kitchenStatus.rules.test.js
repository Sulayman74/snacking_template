// 🔒 Tests rules — signe de vie de l'écran cuisine (kitchenStatus) et journal
// d'observation (kitchenIncidents). Exige l'émulateur.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, addDoc, collection, serverTimestamp, Timestamp } from "firebase/firestore";
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
    await setDoc(doc(db, "users", "client_x"), { role: "client" });
    await setDoc(doc(db, "kitchenIncidents", "inc1"), { snackId: "snackA", type: "pause_simulee" });
  });
});

const as = (uid) => testEnv.authenticatedContext(uid).firestore();

describe("kitchenStatus — battement de l'écran cuisine", () => {
  it("AUTORISE l'admin du snack à battre, à l'heure du serveur (création puis mise à jour)", async () => {
    await assertSucceeds(setDoc(doc(as("admin_A"), "kitchenStatus", "snackA"), { lastSeenAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(setDoc(doc(as("admin_A"), "kitchenStatus", "snackA"), { lastSeenAt: serverTimestamp() }, { merge: true }));
  });

  it("REFUSE une heure choisie par l'appareil (faux signe de vie)", async () => {
    await assertFails(setDoc(doc(as("admin_A"), "kitchenStatus", "snackA"), { lastSeenAt: Timestamp.fromMillis(Date.now() + 3600000) }));
  });

  it("REFUSE d'effacer les marques d'alerte posées par le serveur", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "kitchenStatus", "snackA"), { lastSeenAt: Timestamp.now(), offlineAlertFor: 123 });
    });
    await assertFails(setDoc(doc(as("admin_A"), "kitchenStatus", "snackA"), { lastSeenAt: serverTimestamp(), offlineAlertFor: 0 }, { merge: true }));
  });

  it("REFUSE l'admin d'un autre snack et un client", async () => {
    await assertFails(setDoc(doc(as("admin_B"), "kitchenStatus", "snackA"), { lastSeenAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as("client_x"), "kitchenStatus", "snackA"), { lastSeenAt: serverTimestamp() }));
    await assertFails(getDoc(doc(as("client_x"), "kitchenStatus", "snackA")));
  });
});

describe("kitchenIncidents — journal d'observation", () => {
  it("lisible par l'admin du snack, pas par un autre ni par un client", async () => {
    await assertSucceeds(getDoc(doc(as("admin_A"), "kitchenIncidents", "inc1")));
    await assertFails(getDoc(doc(as("admin_B"), "kitchenIncidents", "inc1")));
    await assertFails(getDoc(doc(as("client_x"), "kitchenIncidents", "inc1")));
  });

  it("personne n'écrit côté client (journal serveur)", async () => {
    await assertFails(addDoc(collection(as("admin_A"), "kitchenIncidents"), { snackId: "snackA", type: "x" }));
  });
});
