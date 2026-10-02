#!/usr/bin/env node
/**
 * 🖼️ Génère les icônes PWA PNG d'un snack (ou de tous) à partir de son logo.
 *
 * Source : `iconUrl` (sinon `logoUrl`) de snacks-seo.json, ou un fichier local
 * (`--from=chemin`). Sortie : public/icons/<snackId>/
 *   - icon-192.png, icon-512.png      → manifest `purpose: any`, favicons
 *   - maskable-192.png, maskable-512.png → manifest `purpose: maskable` (Android) :
 *     logo réduit à 70 % (zone sûre), marges = couleur de bord du logo, ou bords
 *     prolongés si c'est un dégradé, ou `theme_color` si le logo est transparent
 *   - apple-touch-icon.png (180)      → iOS (opaque, iOS arrondit lui-même)
 * Les fichiers sont COMMITÉS : aucun téléchargement au build (CI sans réseau).
 *
 * Avec `--apps` : variantes maskable des 3 apps internes (admin / livreur / superadmin)
 * à partir de public/<app>-icon-512.png → public/<app>-icon-maskable-{192,512}.png.
 *
 * Usage (racine du repo, Node 24, `npm ci --prefix functions` fait — sharp y vit) :
 *   npm run icons:generate                        # tous les snacks de snacks-seo.json
 *   npm run icons:generate -- --snack=<id>        # un seul
 *   npm run icons:generate -- --snack=<id> --from=./logo.png   # depuis un fichier local
 *   npm run icons:generate -- --apps              # apps internes
 *
 * Options par snack dans snacks-seo.json : `iconMaskableScale` (0-1, défaut 0.7),
 * `iconBackground` (#rrggbb, fond forcé des marges maskable / apple-touch-icon).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ICON_FILES, DEFAULT_MASKABLE_SCALE, edgeStats, isFlatEdge, hexToRgb, maskableLayout,
} from "./lib/icons.mjs";

// PNG sans perte, compression maximale (≈ ÷3 par rapport au défaut ; icônes = fichiers froids).
const PNG = { compressionLevel: 9, effort: 10 };

// sharp est une dépendance des Cloud Functions (redimensionnement des photos) :
// on la réutilise plutôt que d'alourdir la racine d'un binaire natif.
const sharp = createRequire(join(process.cwd(), "functions", "index.js"))("sharp");

const args = process.argv.slice(2);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const ONLY = opt("snack");
const FROM = opt("from");
const APPS = args.includes("--apps");

const seo = JSON.parse(readFileSync("snacks-seo.json", "utf8"));

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Fond des marges maskable / apple-touch-icon :
 *   option explicite > bord du logo (aplat → couleur unie ; dégradé/motif → pixels de
 *   bord prolongés, cf. maskableIcon) > theme_color si le logo est transparent.
 * @returns {Promise<{ color: object, extendEdges: boolean, origin: string }>}
 */
async function pickBackground(source, { iconBackground, theme_color }) {
  const forced = hexToRgb(iconBackground);
  if (forced) return { color: { ...forced, alpha: 1 }, extendEdges: false, origin: "iconBackground" };
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const edge = edgeStats(data, info.width, info.height);
  if (edge) {
    const flat = isFlatEdge(edge);
    return { color: { ...edge.color, alpha: 1 }, extendEdges: !flat, origin: `bord du logo, ${flat ? "uni" : "dégradé → bords prolongés"} (σ=${edge.stddev.toFixed(1)})` };
  }
  const theme = hexToRgb(theme_color) || { r: 30, g: 41, b: 56 };
  return { color: { ...theme, alpha: 1 }, extendEdges: false, origin: "theme_color (logo transparent)" };
}

/**
 * Icône maskable de `size` px : logo réduit et centré, marges remplies
 *   - d'une couleur unie (bord du logo en aplat, ou theme_color) ;
 *   - sinon (bord en dégradé) en PROLONGEANT les pixels de bord vers l'extérieur
 *     (`extendWith: "copy"`) : continuité garantie à la jointure, pas de carré visible.
 */
async function maskableIcon(source, size, { color, extendEdges }, maskableScale) {
  const { inner, offset } = maskableLayout(size, maskableScale);
  const logo = sharp(source).resize(inner, inner, { fit: "cover", position: "centre" });
  if (extendEdges) {
    const right = size - inner - offset;
    return logo.flatten({ background: color }).extend({ top: offset, left: offset, bottom: right, right, extendWith: "copy" }).png(PNG);
  }
  const buf = await logo.png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: color } })
    .composite([{ input: buf, left: offset, top: offset }])
    .png(PNG);
}

const toHex = ({ r, g, b }) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * Produit le jeu complet dans `outDir`.
 * @returns {Promise<string[]>} fichiers écrits.
 */
async function generateSet(source, outDir, { background, maskableScale }) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  const square = (size) => sharp(source).resize(size, size, { fit: "cover", position: "centre" });

  // any : le logo tel quel (alpha conservé s'il en a).
  for (const { file, size } of ICON_FILES.any) {
    await square(size).png(PNG).toFile(join(outDir, file));
    written.push(file);
  }
  // maskable : logo réduit, centré sur un fond plein (zone sûre Android).
  for (const { file, size } of ICON_FILES.maskable) {
    await (await maskableIcon(source, size, background, maskableScale)).toFile(join(outDir, file));
    written.push(file);
  }
  // apple-touch-icon : opaque (iOS n'aime pas la transparence), plein cadre.
  const { file, size } = ICON_FILES.apple;
  await square(size).flatten({ background: background.color }).png(PNG).toFile(join(outDir, file));
  written.push(file);
  return written;
}

async function generateSnack(snackId, data) {
  const url = data.iconUrl || data.logoUrl;
  const source = FROM ? readFileSync(FROM) : await fetchBuffer(url);
  const background = await pickBackground(source, data);
  const { origin } = background;
  const maskableScale = Number.isFinite(data.iconMaskableScale) ? data.iconMaskableScale : DEFAULT_MASKABLE_SCALE;
  const outDir = join("public", "icons", snackId);
  const files = await generateSet(source, outDir, { background, maskableScale });
  const bg = toHex(background.color);
  console.log(`✅ ${snackId} (${(data.title || "").split("|")[0].trim()}) → ${outDir}/ : ${files.length} fichiers, fond ${bg} (${origin}), échelle maskable ${maskableScale}`);
  // Mémo de provenance (pour savoir d'où vient le jeu sans relire le script).
  writeFileSync(join(outDir, "SOURCE.txt"), `${FROM ? `fichier local ${FROM}` : url}\nfond ${bg} (${origin}) · échelle maskable ${maskableScale} · ${new Date().toISOString().slice(0, 10)}\n`);
}

async function generateApps() {
  for (const app of ["admin", "livreur", "superadmin"]) {
    const source = readFileSync(join("public", `${app}-icon-512.png`));
    const background = await pickBackground(source, {});
    for (const { size } of ICON_FILES.maskable) {
      await (await maskableIcon(source, size, background)).toFile(join("public", `${app}-icon-maskable-${size}.png`));
    }
    console.log(`✅ ${app} → public/${app}-icon-maskable-{192,512}.png (fond ${toHex(background.color)}, ${background.origin})`);
  }
}

async function main() {
  if (APPS) {
    await generateApps();
    if (!ONLY) return;
  }
  const ids = ONLY ? [ONLY] : Object.keys(seo);
  for (const id of ids) {
    if (!seo[id]) {
      console.error(`🚨 Snack ${id} absent de snacks-seo.json.`);
      process.exitCode = 1;
      continue;
    }
    try {
      await generateSnack(id, seo[id]);
    } catch (e) {
      console.error(`❌ ${id} : ${e.message}`);
      process.exitCode = 1;
    }
  }
}

main();
