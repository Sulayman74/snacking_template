// ============================================================================
// 🌐 ORIGINES DES TENANTS — source unique « snackId → domaine »
// ============================================================================
// Chaque snack a son propre site Hosting (cf. firebase.json / .firebaserc /
// scripts deploy:* de package.json). Utilisé pour les liens des notifications
// push (sinon un client Pizza était renvoyé sur le site Tacos) et pour la liste
// des domaines Apple Pay (lib/wallets). À tenir à jour à chaque nouveau site
// ou domaine custom BRANCHÉ.

/** @type {Readonly<Record<string, string>>} snackId → host déployé. */
const TENANT_HOSTS = Object.freeze({
  Ym1YiO4Ue5Fb5UXlxr06: "snacking-template.web.app", // tacos
  PsobiuoeUzNmHnwGtaRu: "o-bois-pizza.web.app", // pizza
  "4L9THuI6hIAqKjjZUn4s": "pizzeriadelagare.web.app", // pizzeria
  umaGD0nOIWwgpyy8Ta4h: "belly-smash-burger.web.app", // belly
});

const DEFAULT_ORIGIN = "https://snacking-template.web.app";

// Nom d'hôte simple (pas de schéma, port, chemin ni caractères exotiques).
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Origine publique (https://host, sans slash final) du site d'un snack.
 * Priorité : site déployé connu → champ `domaine` du snack (superadmin) → défaut.
 * @param {string} snackId
 * @param {Object} [snackData] - Doc snack (pour `domaine`).
 * @returns {string}
 */
function resolveSnackOrigin(snackId, snackData) {
  if (Object.prototype.hasOwnProperty.call(TENANT_HOSTS, snackId)) {
    return `https://${TENANT_HOSTS[snackId]}`;
  }
  const domaine = String(snackData?.domaine || "").trim().toLowerCase();
  if (HOST_RE.test(domaine)) return `https://${domaine}`;
  return DEFAULT_ORIGIN;
}

/**
 * Variante asynchrone : ne lit le doc snack que si le tenant n'est pas connu.
 * @param {string} snackId
 * @returns {Promise<string>}
 */
async function getSnackOrigin(snackId) {
  if (Object.prototype.hasOwnProperty.call(TENANT_HOSTS, snackId)) {
    return resolveSnackOrigin(snackId);
  }
  try {
    const { db } = require("./admin"); // lazy : garde ce module pur pour les tests unitaires
    const snap = await db.collection("snacks").doc(snackId).get();
    return resolveSnackOrigin(snackId, snap.exists ? snap.data() : {});
  } catch (e) {
    console.error(`getSnackOrigin(${snackId}) :`, e);
    return DEFAULT_ORIGIN;
  }
}

module.exports = { TENANT_HOSTS, DEFAULT_ORIGIN, resolveSnackOrigin, getSnackOrigin };
