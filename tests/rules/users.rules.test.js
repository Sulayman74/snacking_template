// 🔒 Tests des Firestore Security Rules — collection `users` (audit R3).
// Cible : (1) cross-tenant sur users.update (un admin ne touche que SON snack),
// (2) verrouillage de users.create (pas de points/snackId/loyaltyLastScan forgés).
// Exige l'émulateur Firestore.
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
    await setDoc(doc(db, "users", "driver_A"), { role: "livreur", snackId: "snackA", actif: true, nom: "Driver A" });
    await setDoc(doc(db, "users", "driver_B"), { role: "livreur", snackId: "snackB", actif: true, nom: "Driver B" });
    await setDoc(doc(db, "users", "client_C"), { role: "client", pointsBySnack: {}, nom: "Client C" });
  });
});

describe("users.update — tenant-scope strict (R3)", () => {
  it("AUTORISE l'admin à éditer un user de SON snack (champ non sensible)", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertSucceeds(updateDoc(doc(db, "users", "driver_A"), { actif: false }));
  });

  it("REFUSE l'admin d'éditer un user d'un AUTRE snack (cross-tenant)", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(updateDoc(doc(db, "users", "driver_B"), { actif: false }));
  });

  it("REFUSE l'admin de toucher un champ sensible (role) même dans son snack", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(updateDoc(doc(db, "users", "driver_A"), { role: "admin" }));
  });

  it("REFUSE l'admin d'éditer une fiche client (sans snackId)", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(updateDoc(doc(db, "users", "client_C"), { nom: "Hacked" }));
  });
});

describe("users.create — verrouillage (R3)", () => {
  it("AUTORISE la création légitime (role client, pointsBySnack vide)", async () => {
    const db = testEnv.authenticatedContext("newU").firestore();
    await assertSucceeds(setDoc(doc(db, "users", "newU"), {
      role: "client", pointsBySnack: {}, email: "n@x.fr", nom: "Nouveau",
    }));
  });

  it("REFUSE de forger un solde de points à la création", async () => {
    const db = testEnv.authenticatedContext("forge1").firestore();
    await assertFails(setDoc(doc(db, "users", "forge1"), {
      role: "client", pointsBySnack: {}, points: 9999,
    }));
  });

  it("REFUSE de s'auto-attribuer un snackId à la création", async () => {
    const db = testEnv.authenticatedContext("forge2").firestore();
    await assertFails(setDoc(doc(db, "users", "forge2"), {
      role: "client", pointsBySnack: {}, snackId: "snackA",
    }));
  });

  it("REFUSE un rôle non-client à la création", async () => {
    const db = testEnv.authenticatedContext("forge3").firestore();
    await assertFails(setDoc(doc(db, "users", "forge3"), {
      role: "admin", pointsBySnack: {},
    }));
  });

  it("REFUSE la création sans pointsBySnack (champ absent)", async () => {
    const db = testEnv.authenticatedContext("forge4").firestore();
    await assertFails(setDoc(doc(db, "users", "forge4"), {
      role: "client", nom: "Sans carte",
    }));
  });
});
