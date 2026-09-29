// 🧯 Remplace dist/<snack>/sw.js par le service worker d'urgence (scripts/sw-kill-switch.js).
// Utilisé par `npm run deploy:sw-kill` APRÈS le build, AVANT le déploiement Hosting.
import { readdirSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const KILL = "scripts/sw-kill-switch.js";
const targets = readdirSync("dist", { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join("dist", d.name, "sw.js")))
  .map((d) => join("dist", d.name, "sw.js"));

if (targets.length === 0) {
  console.error("🚨 Aucun dist/<snack>/sw.js : lancer le build avant (npm run build:all).");
  process.exit(1);
}
for (const t of targets) {
  copyFileSync(KILL, t);
  console.log(`🧯 ${t} ← service worker d'urgence`);
}
