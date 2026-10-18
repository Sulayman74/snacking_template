#!/usr/bin/env node
/**
 * 📸 Captures des 16 palettes × 2 thèmes sur le build de prod servi en local (émulateurs
 * seedés) : relecture visuelle avant chaque PR de la refonte. Lancer via `npm run theme:shots`
 * (= perf:build + emulators:exec). Sorties : .perf/theme-shots/<palette>-<thème>-<largeur>.png
 *
 * Options : --palettes=belly,ruby   --widths=375,1240   --snack=<id du seed>
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (name, def) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? def;
const PORT = 4180;
const DIST = join(".perf", "dist");
const OUT = join(".perf", "theme-shots");
const SNACK_ID = opt("snack", "Ym1YiO4Ue5Fb5UXlxr06");
const WIDTHS = opt("widths", "375,1240").split(",").map(Number);
// theme-palettes.js est un module ESM dans un paquet CommonJS : Node ne peut pas l'importer
// hors de Vite, on lit donc les clés du catalogue dans le source.
import { readFileSync } from "node:fs";
const palettesSrc = readFileSync(new URL("../src/theme-palettes.js", import.meta.url), "utf8");
const ALL_PALETTES = [...palettesSrc.matchAll(/^\s*"([a-z]+)":\s*\{/gm)].map((m) => m[1]);
const PALETTES = opt("palettes", ALL_PALETTES.join(",")).split(",");

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error("⛔ À lancer via `npm run theme:shots` (firebase emulators:exec)."); process.exit(1); }
if (!existsSync(join(DIST, "index.html"))) { console.error("⛔ Build absent : npm run perf:build"); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const { spawnSync } = await import("node:child_process");
spawnSync(process.execPath, ["functions/seed-emulator.js"], { stdio: "ignore" });
const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--outDir", DIST, "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
process.on("exit", () => { try { preview.kill(); } catch { /* déjà arrêté */ } });
const t0 = Date.now();
while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://localhost:${PORT}/robots.txt`)).ok) break; } catch { /* pas prêt */ } await new Promise((r) => setTimeout(r, 300)); }

// firebase-admin vit dans functions/node_modules (comme sharp pour generate-icons.mjs).
const admin = createRequire(join(process.cwd(), "functions", "index.js"))("firebase-admin");
admin.initializeApp({ projectId: "snacking-template" });
const db = admin.firestore();
const { chromium } = require("@playwright/test");
const browser = await chromium.launch();

for (const palette of PALETTES) {
  if (!ALL_PALETTES.includes(palette)) { console.warn(`palette inconnue : ${palette}`); continue; }
  await db.collection("snacks").doc(SNACK_ID).update({ colorPalette: palette });
  for (const theme of ["light", "dark"]) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme });
      await ctx.addInitScript((m) => { try { localStorage.setItem("theme-mode", m); } catch { /* privé */ } }, theme);
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${PORT}/?lang=fr`, { waitUntil: "domcontentloaded" });
      await page.locator("#loyalty-card").waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(OUT, `${palette}-${theme}-${w}.png`), fullPage: true });
      await ctx.close();
    }
  }
  console.log(`📸 ${palette}`);
}
await browser.close();
console.log(`\n${PALETTES.length} palette(s) × 2 thèmes × ${WIDTHS.length} largeur(s) → ${OUT}/`);
process.exit(0);
