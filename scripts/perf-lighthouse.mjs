#!/usr/bin/env node
/**
 * 📈 Lighthouse mobile REPRODUCTIBLE sur le build de prod servi en local.
 *
 * - Build `npm run perf:build` : config de prod, mais `VITE_E2E_TESTING=true` → l'app
 *   se branche sur les ÉMULATEURS Firebase (jamais la prod, cf. CLAUDE.md), seedés
 *   comme pour les E2E. Servi par `vite preview` (gzip, comme Firebase Hosting).
 * - N passages Lighthouse (défaut 3, throttling mobile simulé « slow 4G / CPU ×4 »),
 *   résumé par la médiane (LCP), rapports HTML dans .perf/ (gitignoré).
 *
 * Usage (racine, Node 24, Chrome : $CHROME_PATH, sinon le Chromium de Playwright) :
 *   npm run perf:lighthouse                 # build + émulateurs + 3 passages
 *   npm run perf:lighthouse -- --runs=5     # plus de passages (moins de variance)
 *   npm run perf:lighthouse -- --path=/admin.html
 *
 * Réserves : localhost (pas de latence réseau serveur), produits du seed sans image ;
 * l'image héros, les polices et Stripe.js viennent d'Internet comme en prod. À utiliser
 * pour comparer AVANT / APRÈS une optimisation, pas comme score absolu.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (name, def) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? def;
const RUNS = Math.max(1, Number(opt("runs", 3)));
const PORT = Number(opt("port", 4180));
const PAGE = opt("path", "/?lang=fr");
const OUT = ".perf";
const DIST = join(OUT, "dist");
const URL = `http://localhost:${PORT}${PAGE}`;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("⛔ À lancer via `npm run perf:lighthouse` (firebase emulators:exec).");
  process.exit(1);
}
if (!existsSync(join(DIST, "index.html"))) {
  console.error("⛔ Build absent : npm run perf:build");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const p = require("@playwright/test").chromium.executablePath();
    if (existsSync(p)) return p;
  } catch { /* chrome-launcher cherchera un Chrome installé */ }
  return undefined;
}

async function waitForServer(url, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Serveur injoignable : ${url}`);
}

const ms = (audit) => (Number.isFinite(audit?.numericValue) ? Math.round(audit.numericValue) : null);

/** Chiffres clés d'un rapport Lighthouse (lhr). */
function summarize(lhr, run) {
  const a = lhr.audits;
  const lcpItems = a["largest-contentful-paint-element"]?.details?.items ?? [];
  const lcpNode = lcpItems[0]?.items?.[0]?.node ?? lcpItems[0]?.node;
  return {
    run,
    score: Math.round((lhr.categories.performance.score ?? 0) * 100),
    fcp: ms(a["first-contentful-paint"]),
    lcp: ms(a["largest-contentful-paint"]),
    tbt: ms(a["total-blocking-time"]),
    si: ms(a["speed-index"]),
    cls: Number((a["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
    transferKb: Math.round((a["total-byte-weight"]?.numericValue ?? 0) / 1024),
    requests: a["network-requests"]?.details?.items?.length ?? null,
    jsExecMs: ms(a["bootup-time"]),
    mainThreadMs: ms(a["mainthread-work-breakdown"]),
    lcpElement: lcpNode?.snippet?.slice(0, 90) ?? lcpNode?.nodeLabel ?? null,
  };
}

/** Pistes d'amélioration (opportunités + diagnostics chiffrés), triées par gain. */
function opportunities(lhr) {
  const rows = [];
  for (const audit of Object.values(lhr.audits)) {
    if (audit.scoreDisplayMode === "notApplicable" || audit.score === 1 || audit.score === null) continue;
    const sav = audit.metricSavings ?? {};
    const gainMs = Math.round(Math.max(sav.LCP ?? 0, sav.FCP ?? 0) + (sav.TBT ?? 0) + (audit.details?.overallSavingsMs ?? 0));
    const gainKb = Math.round((audit.details?.overallSavingsBytes ?? 0) / 1024);
    if (gainMs <= 0 && gainKb <= 0) continue;
    rows.push({ id: audit.id, title: audit.title, gainMs, gainKb, detail: audit.displayValue ?? "" });
  }
  return rows.sort((x, y) => y.gainMs - x.gainMs || y.gainKb - x.gainKb).slice(0, 10);
}

async function main() {
  const seed = spawnSync(process.execPath, ["functions/seed-emulator.js"], { stdio: "inherit" });
  if (seed.status) process.exit(seed.status);

  const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--outDir", DIST, "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  const stop = () => { try { preview.kill(); } catch { /* déjà arrêté */ } };
  process.on("exit", stop);

  try {
    await waitForServer(`http://localhost:${PORT}/robots.txt`);
    const chrome = chromePath();
    console.log(`\n📈 Lighthouse mobile ×${RUNS} sur ${URL}\n   Chrome : ${chrome ?? "(détection automatique)"}\n`);

    const runs = [];
    let lastLhr = null;
    for (let i = 1; i <= RUNS; i++) {
      const base = join(OUT, `run-${i}`);
      const r = spawnSync(
        process.execPath,
        [
          "node_modules/lighthouse/cli/index.js", URL,
          "--only-categories=performance", "--form-factor=mobile",
          "--output=json", "--output=html", `--output-path=${base}`,
          "--chrome-flags=--headless=new --no-sandbox", "--quiet",
        ],
        { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) } }
      );
      if (r.status) { console.error(`❌ passage ${i} échoué (code ${r.status})`); continue; }
      lastLhr = JSON.parse(readFileSync(`${base}.report.json`, "utf8"));
      const s = summarize(lastLhr, i);
      runs.push(s);
      console.log(`   passage ${i} : score ${s.score} · LCP ${s.lcp} ms · TBT ${s.tbt} ms · ${s.transferKb} Ko`);
    }
    if (runs.length === 0) process.exit(1);

    const byLcp = [...runs].sort((x, y) => x.lcp - y.lcp);
    const median = byLcp[Math.floor(byLcp.length / 2)];
    const medianLhr = JSON.parse(readFileSync(join(OUT, `run-${median.run}.report.json`), "utf8"));
    const tips = opportunities(medianLhr);
    const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"]).stdout?.toString().trim() || "?";

    console.log(`\n=== Médiane (passage ${median.run}) — commit ${commit} — ${PAGE}`);
    console.log(`| Score | FCP | LCP | TBT | Speed Index | CLS | Transfert | Requêtes | JS (exécution) | Fil principal |`);
    console.log(`|---|---|---|---|---|---|---|---|---|---|`);
    console.log(`| ${median.score} | ${median.fcp} ms | ${median.lcp} ms | ${median.tbt} ms | ${median.si} ms | ${median.cls} | ${median.transferKb} Ko | ${median.requests} | ${median.jsExecMs} ms | ${median.mainThreadMs} ms |`);
    if (median.lcpElement) console.log(`Élément LCP : ${median.lcpElement}`);
    console.log(`\n=== Pistes (rapport médian)`);
    for (const t of tips) console.log(`   ${String(t.gainMs).padStart(5)} ms  ${String(t.gainKb).padStart(4)} Ko  ${t.title}${t.detail ? ` — ${t.detail}` : ""}`);
    console.log(`\nRapports HTML : ${OUT}/run-*.report.html`);

    writeFileSync(join(OUT, "summary.json"), JSON.stringify({ date: new Date().toISOString(), commit, url: URL, runs, median, tips }, null, 2));
  } finally {
    stop();
  }
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
