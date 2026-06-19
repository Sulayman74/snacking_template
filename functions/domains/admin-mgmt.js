// ============================================================================
// 👤 ADMIN MGMT — création livreur & admin de snack (custom claims)
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db, FieldValue } = require("../lib/admin");
const { V, require_ } = require("../lib/validation");
const { enforceRateLimit, callerKey } = require("../lib/rateLimit");
const { assertCallerIsSnackAdmin } = require("../lib/auth");
const { generateSecretCode } = require("../lib/util");

// ============================================================================
// 🚚 FONCTION : CRÉER UN LIVREUR (réservé admin du snack)
// ============================================================================
// Crée le compte Auth + le doc users/{uid} avec role 'livreur' (admin SDK →
// contourne la règle 'create' qui force role:'client'). Le livreur se connecte
// ensuite sur /livreur.html.
exports.createDriver = onCall({ region: "europe-west1" }, async (request) => {
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");

  const { snackId, nom, email, password, telephone } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isNonEmptyString(nom, 100), "Nom invalide.");
  require_(V.isEmail(email), "Email invalide.");
  require_(
    V.isString(password) && password.length >= 6 && password.length <= 100,
    "Mot de passe invalide (6 à 100 caractères)."
  );
  require_(
    telephone === undefined || telephone === null || (V.isString(telephone) && telephone.length <= 30),
    "Téléphone invalide."
  );

  await assertCallerIsSnackAdmin(request, snackId);
  await enforceRateLimit({ key: callerKey(request, "createDriver"), max: 20, windowMs: 3_600_000 });

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: nom });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email est déjà utilisé.");
    }
    if (e.code === "auth/invalid-password" || e.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Email ou mot de passe invalide.");
    }
    console.error("createDriver auth error:", e);
    throw new HttpsError("internal", "Création du compte impossible.");
  }

  await db.collection("users").doc(userRecord.uid).set({
    role: "livreur",
    snackId,
    nom,
    email,
    telephone: telephone || "",
    actif: true,
    points: 0,
    createdBy: request.auth.uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { uid: userRecord.uid };
});

// Crée le compte admin d'un snack (Auth + users/{uid} role:'admin'). SUPERADMIN
// uniquement. Mot de passe temporaire généré serveur, renvoyé UNE fois pour être
// transmis au restaurateur (qui le changera). Débloque l'accès à /admin.html.
exports.createSnackAdmin = onCall({ region: "europe-west1" }, async (request) => {
  const data = request.data;
  require_(V.isPlainObject(data), "Payload invalide.");
  const { snackId, email, nom } = data;
  require_(V.isDocId(snackId), "snackId invalide.");
  require_(V.isEmail(email), "Email invalide.");
  require_(
    nom === undefined || nom === null || (V.isString(nom) && nom.length <= 100),
    "Nom invalide."
  );

  // 🛡️ Superadmin uniquement (création d'un compte admin = action sensible).
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const callerDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== "superadmin") {
    throw new HttpsError("permission-denied", "Réservé au superadmin.");
  }
  await enforceRateLimit({ key: callerKey(request, "createSnackAdmin"), max: 20, windowMs: 3_600_000 });

  const snackSnap = await db.collection("snacks").doc(snackId).get();
  require_(snackSnap.exists, "Snack introuvable.");

  const tempPassword = generateSecretCode(10); // affiché 1 fois au superadmin
  const displayName = nom || email.split("@")[0];

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password: tempPassword, displayName });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Cet email est déjà utilisé.");
    }
    if (e.code === "auth/invalid-password" || e.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Email ou mot de passe invalide.");
    }
    console.error("createSnackAdmin auth error:", e);
    throw new HttpsError("internal", "Création du compte impossible.");
  }

  await db.collection("users").doc(userRecord.uid).set({
    role: "admin",
    snackId,
    nom: displayName,
    email,
    pointsBySnack: {},
    createdBy: request.auth.uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { uid: userRecord.uid, email, tempPassword };
});

