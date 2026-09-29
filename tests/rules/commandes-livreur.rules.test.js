// 🔒 Tests des Firestore Security Rules — transitions LIVREUR sur `commandes`.
// Cible : une écriture livreur (éventuellement rejouée après une coupure réseau)
// ne peut faire avancer une course que vers l'avant, et seulement la sienne.
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

const base = { userId: "client", snackId: "snackA", mode: "delivery", total: 20, livreur: null };

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", "driver_A"), { role: "livreur", snackId: "snackA" });
    await setDoc(doc(db, "users", "driver_A2"), { role: "livreur", snackId: "snackA" });
    await setDoc(doc(db, "commandes", "libre"), { ...base, statut: "prete", livreurId: null });
    await setDoc(doc(db, "commandes", "enCours"), { ...base, statut: "en_livraison", livreurId: "driver_A", livreur: { nom: "A" } });
    await setDoc(doc(db, "commandes", "livree"), { ...base, statut: "livree", livreurId: "driver_A", livreur: { nom: "A" } });
    await setDoc(doc(db, "commandes", "cuisine"), { ...base, statut: "nouvelle", livreurId: null });
  });
});

const as = (uid) => testEnv.authenticatedContext(uid).firestore();

describe("commandes — transitions livreur (vers l'avant uniquement)", () => {
  it("AUTORISE la prise en charge d'une course prête et libre", async () => {
    await assertSucceeds(updateDoc(doc(as("driver_A"), "commandes", "libre"), {
      statut: "en_livraison", livreurId: "driver_A", livreur: { nom: "A", position: null, lastNotifiedBucket: null },
    }));
  });

  it("REFUSE de prendre une course au nom d'un autre livreur", async () => {
    await assertFails(updateDoc(doc(as("driver_A"), "commandes", "libre"), {
      statut: "en_livraison", livreurId: "driver_A2",
    }));
  });

  it("REFUSE de sauter directement prete → livree", async () => {
    await assertFails(updateDoc(doc(as("driver_A"), "commandes", "libre"), { statut: "livree", livreurId: "driver_A" }));
  });

  it("AUTORISE la position / photo sur SA course en cours", async () => {
    await assertSucceeds(updateDoc(doc(as("driver_A"), "commandes", "enCours"), { "livreur.position": { lat: 1, lng: 2 } }));
  });

  it("AUTORISE le dépôt en_livraison → livree", async () => {
    await assertSucceeds(updateDoc(doc(as("driver_A"), "commandes", "enCours"), { statut: "livree", "livreur.position": null }));
  });

  it("REFUSE de faire reculer en_livraison → prete", async () => {
    await assertFails(updateDoc(doc(as("driver_A"), "commandes", "enCours"), { statut: "prete" }));
  });

  it("REFUSE de faire reculer livree → en_livraison (rejeu hors-ligne)", async () => {
    await assertFails(updateDoc(doc(as("driver_A"), "commandes", "livree"), { statut: "en_livraison" }));
  });

  it("REFUSE une position rejouée sur une course déjà livrée", async () => {
    await assertFails(updateDoc(doc(as("driver_A"), "commandes", "livree"), { "livreur.position": { lat: 1, lng: 2 } }));
  });

  it("REFUSE de toucher la course d'un autre livreur", async () => {
    await assertFails(updateDoc(doc(as("driver_A2"), "commandes", "enCours"), { statut: "livree" }));
  });

  it("REFUSE de se désattribuer une course en cours", async () => {
    await assertFails(updateDoc(doc(as("driver_A"), "commandes", "enCours"), { livreurId: null }));
  });

  it("REFUSE de toucher une commande encore en cuisine", async () => {
    await assertFails(updateDoc(doc(as("driver_A"), "commandes", "cuisine"), { statut: "prete" }));
  });
});
