// ============================================================================
// 🔌 FIREBASE ADMIN — initialisation centralisée (une seule fois)
// ============================================================================
// Importé (en side-effect) tout en haut du barrel index.js AVANT tout domaine, et
// par chaque module qui a besoin de Firestore/Admin SDK. Le require est mémoïsé par
// Node → initializeApp() ne tourne qu'UNE fois quel que soit le nombre d'imports.
//
// setGlobalOptions pose la région PAR DÉFAUT (europe-west9). Les functions qui veulent
// une autre région la précisent au cas par cas via onCall({ region: "europe-west1" }, …).

const admin = require("firebase-admin");
// API MODULAIRE pour FieldValue/Timestamp : les accesseurs statiques namespaced
// (admin.firestore.FieldValue / .Timestamp) sont `undefined` dans l'émulateur de
// fonctions. On réexporte ici les versions modulaires (point unique, DRY).
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");

admin.initializeApp();
setGlobalOptions({ region: "europe-west9" });

const db = admin.firestore();

module.exports = { admin, db, FieldValue, Timestamp };
