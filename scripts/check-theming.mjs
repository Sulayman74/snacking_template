#!/usr/bin/env node
/**
 * 🎛️ Garde-fou theming — refonte Phase 0 : ZÉRO couleur brute dans la surface client.
 *
 * Balaye index.html et tout src/ (hors back-office admin / livreur / superadmin, service
 * worker, et les modules qui DÉFINISSENT les couleurs : theme-palettes.js,
 * theme-neutrals.js, theme-fonts.js, icons.js). Toute classe Tailwind de couleur brute (text-gray-300,
 * bg-white, border-red-500…), tout hex, tout `style=""` porteur de couleur, tout
 * `text-primary` brut (lire text-primary-ink) et tout `backdrop-blur` (un seul, en CSS,
 * pour la barre basse) font échouer `npm run lint:theming`.
 *
 * Jetons disponibles : src/styles.css (@theme) — surface*, text*, line, danger*, on-dark*,
 * screen*, status-*, rating, gold*, weather-*, primary-ink, on-accent.
 * Exceptions ASSUMÉES (comptées dans BASELINE, jamais ailleurs) : le badge panier
 * `bg-on-dark text-primary` (fond blanc dans les deux thèmes). Les marques (Google,
 * réseaux sociaux) vivent dans les classes `.brand-*` de styles.css, hors périmètre.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const EXCLUDE = /(^|\/)(admin|livreur|superadmin|scanner|sw)[^/]*\.js$|\/sw\/|\/ui\/(Admin|Livreur)|theme-palettes\.js$|theme-neutrals\.js$|theme-fonts\.js$|icons\.js$/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".js")) out.push(relative(ROOT, full));
  }
  return out;
}
const FILES = ["index.html", ...walk(join(ROOT, "src")).filter((f) => !EXCLUDE.test(f))].sort();

const PALETTE = "gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
const PATTERNS = {
  "classe couleur brute": new RegExp(`\\b(bg|text|border|from|to|via|ring|fill|stroke|divide|placeholder|decoration|shadow|outline|accent|caret)-(${PALETTE})(-[0-9]{2,3})?(/[0-9]+)?\\b`, "g"),
  "hex en dur": /(?<!&)#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g, // (?<!&) : entités HTML &#039;
  "style= couleur": /style="[^"]*(?:color|background|fill|stroke)/g,
  "text-primary brut": /(?:^|[\s"'`])text-primary(?![-\w/])/g,
  "backdrop-blur": /backdrop-blur/g,
};

/** Exceptions assumées — baisser BASELINE quand l'une disparaît. */
const BASELINE = 1;

let total = 0;
const hits = [];
for (const file of FILES) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const lines = src.split("\n");
  for (const [name, re] of Object.entries(PATTERNS)) {
    lines.forEach((line, i) => {
      for (const m of line.matchAll(re)) { hits.push({ name, file, line: i + 1, match: m[0].trim() }); total++; }
    });
  }
}

console.log(`🎛️  Couleurs brutes (surface client, ${FILES.length} fichiers) : ${total} (baseline ${BASELINE})`);
for (const h of hits) console.log(`   ${h.name.padEnd(22)} ${h.file}:${h.line}  ${h.match}`);

if (total > BASELINE) {
  console.error(`\n❌ Régression theming : ${total} > baseline ${BASELINE}. Remplace par un jeton de src/styles.css (@theme).`);
  process.exit(1);
}
if (total < BASELINE) console.log(`\n✅ ${BASELINE - total} de moins que la baseline : abaisse BASELINE à ${total} (ratchet).`);
else console.log("\n✅ Aucune régression theming.");
