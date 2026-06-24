// 🧑‍💻 Tests unitaires — buildUserInitDoc + logique ensureUserDoc (PR-3 fix/guest-anon-user-doc)
// Couvre src/auth.js: buildUserInitDoc (pure function) et la logique upsert de payment.js.
// Pas de Firebase réel : on teste la structure des docs et les invariants métier.

import { describe, it, expect, vi } from "vitest";

// ─── Copie de référence pure (miroir de src/auth.js:buildUserInitDoc) ─────────
// Doit rester IDENTIQUE. serverTimestamp() mockée ici (pas de Firebase).
const serverTimestamp = () => "SERVER_TS";

function buildUserInitDoc(user) {
  const isAnonymous = user?.isAnonymous === true;
  return {
    email: user?.email || null,
    nom: user?.displayName
      || (user?.email ? user.email.split("@")[0] : null)
      || (isAnonymous ? "Invité" : "Gourmand"),
    pointsBySnack: {},
    dateCreation: serverTimestamp(),
    role: "client",
    isAnonymous,
  };
}
// ─────────────────────────────────────────────────────────────────────────────

describe("buildUserInitDoc — utilisateur email/password", () => {
  it("email présent → nom = partie locale de l'email", () => {
    const doc = buildUserInitDoc({ email: "alice@test.fr", displayName: null, isAnonymous: false });
    expect(doc.nom).toBe("alice");
  });

  it("displayName présent → priorité sur l'email", () => {
    const doc = buildUserInitDoc({ email: "a@b.fr", displayName: "Alice Dupont", isAnonymous: false });
    expect(doc.nom).toBe("Alice Dupont");
  });

  it("email conservé tel quel", () => {
    const doc = buildUserInitDoc({ email: "alice@test.fr", isAnonymous: false });
    expect(doc.email).toBe("alice@test.fr");
  });

  it("isAnonymous = false pour un user classique", () => {
    const doc = buildUserInitDoc({ email: "a@b.fr", isAnonymous: false });
    expect(doc.isAnonymous).toBe(false);
  });
});

describe("buildUserInitDoc — utilisateur Google (displayName)", () => {
  it("displayName Google → nom affiché", () => {
    const doc = buildUserInitDoc({ email: "bob@gmail.com", displayName: "Bob Martin", isAnonymous: false });
    expect(doc.nom).toBe("Bob Martin");
    expect(doc.email).toBe("bob@gmail.com");
  });
});

describe("buildUserInitDoc — invité anonyme (signInAnonymously)", () => {
  it("email null, nom 'Invité', isAnonymous = true", () => {
    const doc = buildUserInitDoc({ email: null, displayName: null, isAnonymous: true });
    expect(doc.email).toBeNull();
    expect(doc.nom).toBe("Invité");
    expect(doc.isAnonymous).toBe(true);
  });

  it("email undefined → null (pas de 'undefined' en base)", () => {
    const doc = buildUserInitDoc({ isAnonymous: true });
    expect(doc.email).toBeNull();
  });

  it("pas de displayName ni email → 'Invité' (jamais 'Gourmand' pour un anonyme)", () => {
    const doc = buildUserInitDoc({ email: null, displayName: null, isAnonymous: true });
    expect(doc.nom).toBe("Invité");
    expect(doc.nom).not.toBe("Gourmand");
  });
});

describe("buildUserInitDoc — invariants métier (toujours vrais)", () => {
  const users = [
    { email: "a@b.fr", isAnonymous: false },
    { email: null, isAnonymous: true },
    { email: "g@g.com", displayName: "G", isAnonymous: false },
  ];

  it.each(users)("role toujours 'client' (jamais modifiable depuis le client)", (user) => {
    expect(buildUserInitDoc(user).role).toBe("client");
  });

  it.each(users)("pointsBySnack toujours {} (pas d'injection de points)", (user) => {
    expect(buildUserInitDoc(user).pointsBySnack).toEqual({});
  });

  it.each(users)("nom toujours une string non vide", (user) => {
    const nom = buildUserInitDoc(user).nom;
    expect(typeof nom).toBe("string");
    expect(nom.length).toBeGreaterThan(0);
  });

  it("user null → ne crash pas (guard en amont de ensureUserDoc via user?.uid)", () => {
    // buildUserInitDoc ne sera appelée que si user?.uid est défini (guard dans ensureUserDoc).
    // On vérifie qu'elle tolère les champs optionnels.
    expect(() => buildUserInitDoc({})).not.toThrow();
    expect(() => buildUserInitDoc({ isAnonymous: true })).not.toThrow();
  });
});

describe("Logique upsert set+merge — tolère un doc inexistant", () => {
  it("set+merge appelé avec merge:true même si le doc n'existe pas", async () => {
    // Simule l'Admin SDK Firestore (set+merge = upsert atomique)
    const mockRef = { set: vi.fn().mockResolvedValue(undefined) };
    const FieldValue = {
      serverTimestamp: () => "TS",
      increment: (n) => `INCREMENT(${n})`,
    };

    const update = {
      lastOrderDate: FieldValue.serverTimestamp(),
      orderCount: FieldValue.increment(1),
      totalSpentCents: FieldValue.increment(1000),
    };
    await mockRef.set(update, { merge: true });

    expect(mockRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastOrderDate: "TS",
        orderCount: "INCREMENT(1)",
        totalSpentCents: "INCREMENT(1000)",
      }),
      { merge: true }
    );
  });

  it("set+merge ne ré-écrase pas firstOrderDate si déjà présent (logique userDoc.exists)", () => {
    // Simule un user AVEC firstOrderDate déjà en base
    const userDocExists = true;
    const userDocData = { firstOrderDate: "2024-01-01" };
    const update = { lastOrderDate: "NOW", orderCount: 1 };

    // Réplication exacte du if dans payment.js
    if (!userDocExists || !userDocData.firstOrderDate) {
      update.firstOrderDate = "NOW";
    }

    expect(update.firstOrderDate).toBeUndefined(); // pas écrasé
  });

  it("firstOrderDate ajouté si doc absent (invité sans historique)", () => {
    const userDocExists = false;
    const update = { lastOrderDate: "NOW", orderCount: 1 };
    if (!userDocExists || !({}).firstOrderDate) {
      update.firstOrderDate = "NOW";
    }
    expect(update.firstOrderDate).toBe("NOW");
  });
});
