#!/usr/bin/env node
/**
 * 🔤 Télécharge les polices du thème (src/theme-fonts.js) pour les HÉBERGER dans le
 * projet : public/fonts/<clé>-<graisse>.woff2, ou <clé>-variable.woff2 pour une police
 * variable (sous-ensemble latin, suffisant pour le français) + public/fonts/fonts.json
 * (fichiers par graisse + unicode-range, lu au build).
 *
 * Pourquoi : chargées depuis Google Fonts, les polices bloquaient le rendu (HTML →
 * CSS externe → woff2 : ~0,9 s simulées sur mobile). Hébergées ici, le navigateur
 * les précharge directement, sans chaîne de requêtes ni domaine tiers.
 *
 * Licence : toutes les familles de SAAS_FONTS sont sous SIL Open Font License 1.1
 * (hébergement autorisé). Cf. public/fonts/LICENSE.txt.
 *
 * Usage (à relancer si une famille est ajoutée à SAAS_FONTS) :
 *   node scripts/fetch-fonts.mjs
 */
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Le projet est déclaré "type": "commonjs" : Node lirait src/theme-fonts.js (ESM pur, sans
// import) comme du CommonJS. On l'importe via une copie temporaire en .mjs.
const tmp = join(mkdtempSync(join(tmpdir(), "fonts-")), "theme-fonts.mjs");
copyFileSync(join("src", "theme-fonts.js"), tmp);
const { SAAS_FONTS } = await import(pathToFileURL(tmp).href);

const OUT = join("public", "fonts");
const WEIGHTS = ["400", "600"];
// UA Chrome récent → Google renvoie du woff2 découpé par sous-ensemble (unicode-range).
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

mkdirSync(OUT, { recursive: true });
const manifest = {};

for (const [key, font] of Object.entries(SAAS_FONTS)) {
  if (!font.href) continue;
  const css = await (await fetch(font.href, { headers: { "User-Agent": UA } })).text();
  const family = /font-family:\s*'([^']+)'/.exec(css)?.[1];
  const entry = { family, files: {}, unicodeRange: null };
  const urls = {};
  // Chaque bloc est précédé de son sous-ensemble : « /* latin */ @font-face { … } ».
  for (const [, subset, block] of css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (subset !== "latin") continue;
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1];
    const url = /url\(([^)]+\.woff2)\)/.exec(block)?.[1];
    if (!WEIGHTS.includes(weight) || !url) continue;
    urls[weight] = url;
    entry.unicodeRange = /unicode-range:\s*([^;]+);/.exec(block)?.[1] ?? entry.unicodeRange;
  }
  if (Object.keys(urls).length !== WEIGHTS.length) {
    console.error(`❌ ${key} : graisses trouvées ${Object.keys(urls)} (attendu ${WEIGHTS})`);
    process.exitCode = 1;
    continue;
  }
  // Police VARIABLE : Google renvoie le même fichier pour toutes les graisses → un seul
  // fichier, déclaré « font-weight: 400 600 » (évite de le télécharger deux fois).
  const variable = new Set(Object.values(urls)).size === 1;
  const downloads = variable ? { [WEIGHTS.join(" ")]: { url: urls[WEIGHTS[0]], file: `${key}-variable.woff2` } }
    : Object.fromEntries(WEIGHTS.map((w) => [w, { url: urls[w], file: `${key}-${w}.woff2` }]));
  for (const [weights, { url, file }] of Object.entries(downloads)) {
    writeFileSync(join(OUT, file), Buffer.from(await (await fetch(url)).arrayBuffer()));
    entry.files[weights] = `/fonts/${file}`;
  }
  manifest[key] = entry;
  console.log(`✅ ${key} (${family}${variable ? ", variable" : ""}) → ${Object.values(entry.files).join(", ")}`);
}

writeFileSync(join(OUT, "fonts.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(OUT, "LICENSE.txt"), `Polices hébergées (sous-ensemble latin, graisses 400/600), téléchargées depuis Google Fonts
par scripts/fetch-fonts.mjs. Toutes sont publiées sous SIL Open Font License 1.1 :
${Object.values(manifest).map((e) => `- ${e.family}`).join("\n")}
Texte de la licence : https://openfontlicense.org/open-font-license-official-text/
`);
console.log(`\n${OUT}/fonts.json écrit (${Object.keys(manifest).length} familles).`);
