// 🔒 Tests des Firestore Security Rules — collection `produits`.
// Cible : cloisonnement multi-tenant en ÉCRITURE. Le cas central
// ("hijack cross-tenant") échoue sur les anciennes règles (la clause d'écriture
// ne testait que le NOUVEAU snackId) et passe sur les règles corrigées
// (snackId immuable + admin du snack PROPRIÉTAIRE requis). Exige l'émulateur Firestore.
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from "firebase/firestore";
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
    // Deux tenants distincts + un superadmin global + un client lambda.
    await setDoc(doc(db, "users", "admin_A"), { role: "admin", snackId: "snackA" });
    await setDoc(doc(db, "users", "admin_B"), { role: "admin", snackId: "snackB" });
    await setDoc(doc(db, "users", "super_S"), { role: "superadmin" });
    await setDoc(doc(db, "users", "client_C"), { role: "client", pointsBySnack: {} });
    // Un produit appartenant à CHAQUE snack (seedés comme via l'Admin SDK).
    await setDoc(doc(db, "produits", "prodA"), { snackId: "snackA", nom: "Tacos", prix: 8.5 });
    await setDoc(doc(db, "produits", "prodB"), { snackId: "snackB", nom: "Pizza", prix: 11 });
  });
});

describe("produits — lecture publique", () => {
  it("AUTORISE un visiteur non authentifié à lire le menu", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "produits", "prodA")));
  });
});

describe("produits — création (tenant de l'appelant uniquement)", () => {
  it("AUTORISE l'admin A à créer un produit DANS son snack", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertSucceeds(setDoc(doc(db, "produits", "newA"), { snackId: "snackA", nom: "Frites", prix: 3 }));
  });

  it("REFUSE l'admin A de créer un produit dans le snack B", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(setDoc(doc(db, "produits", "newB"), { snackId: "snackB", nom: "Frites", prix: 3 }));
  });

  it("REFUSE un client de créer un produit", async () => {
    const db = testEnv.authenticatedContext("client_C").firestore();
    await assertFails(setDoc(doc(db, "produits", "newC"), { snackId: "snackA", nom: "X", prix: 1 }));
  });
});

describe("produits — mise à jour (snackId immuable, propriétaire requis)", () => {
  it("AUTORISE l'admin A à modifier le prix de SON produit", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertSucceeds(updateDoc(doc(db, "produits", "prodA"), { prix: 9 }));
  });

  // 🎯 CŒUR DU CORRECTIF — sur les anciennes règles ce hijack RÉUSSIT (faille).
  // Avec le snackId immuable + propriétaire requis, il doit ÉCHOUER.
  it("REFUSE l'admin A de s'approprier le produit du snack B (hijack snackId → snackA)", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(updateDoc(doc(db, "produits", "prodB"), { snackId: "snackA", prix: 1 }));
  });

  it("REFUSE l'admin A d'écraser le produit du snack B (snackId inchangé)", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(updateDoc(doc(db, "produits", "prodB"), { prix: 1 }));
  });

  it("REFUSE l'admin A de changer le snackId de SON PROPRE produit (immuabilité)", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(updateDoc(doc(db, "produits", "prodA"), { snackId: "snackB" }));
  });

  it("AUTORISE le superadmin à modifier n'importe quel produit", async () => {
    const db = testEnv.authenticatedContext("super_S").firestore();
    await assertSucceeds(updateDoc(doc(db, "produits", "prodB"), { prix: 12 }));
  });
});

describe("produits — suppression (propriétaire ou superadmin)", () => {
  it("AUTORISE l'admin A à supprimer SON produit", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertSucceeds(deleteDoc(doc(db, "produits", "prodA")));
  });

  it("REFUSE l'admin A de supprimer le produit du snack B", async () => {
    const db = testEnv.authenticatedContext("admin_A").firestore();
    await assertFails(deleteDoc(doc(db, "produits", "prodB")));
  });
});
