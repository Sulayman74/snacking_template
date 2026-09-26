// 🔐 Chargement des clés Stripe TEST pour les harnais d'intégration et les helpers E2E.
// Sources (gitignorées, jamais commitées), par priorité croissante :
//   functions/.env  <  functions/.env.local  <  functions/.secret.local
// Une variable déjà présente dans l'environnement (CI) n'est jamais écrasée.
// Aucune clé en dur : sans clé TEST, on s'arrête avec un message clair.
const fs = require("node:fs");
const path = require("node:path");

const FUNC_DIR = path.join(__dirname, "..", "..", "functions");
const FILES = [".env", ".env.local", ".secret.local"];

function loadTestEnv() {
  const fromFiles = {};
  for (const name of FILES) {
    const file = path.join(FUNC_DIR, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) fromFiles[m[1]] = m[2].trim();
    }
  }
  for (const [key, value] of Object.entries(fromFiles)) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }

  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) {
    console.error("💥 STRIPE_SECRET_KEY absente : renseignez functions/.secret.local (cf. docs/STRIPE-GO-LIVE.md).");
    process.exit(1);
  }
  if (!key.startsWith("sk_test_")) {
    console.error("💥 ABORT : STRIPE_SECRET_KEY n'est pas une clé TEST (sk_test_). Refus d'exécuter les tests sur une clé live.");
    process.exit(1);
  }
  return key;
}

module.exports = { loadTestEnv, FUNC_DIR };
