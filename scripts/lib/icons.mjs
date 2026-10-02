// ============================================================================
// 🖼️ icons — règles PURES des icônes PWA (sans I/O), partagées par
//     scripts/generate-icons.mjs (génération) et vite.config.js (déclaration).
// ============================================================================
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Tailles produites par snack dans public/icons/<snackId>/. */
export const ICON_FILES = Object.freeze({
  any: [
    { file: "icon-192.png", size: 192 },
    { file: "icon-512.png", size: 512 },
  ],
  maskable: [
    { file: "maskable-192.png", size: 192 },
    { file: "maskable-512.png", size: 512 },
  ],
  apple: { file: "apple-touch-icon.png", size: 180 },
});

/**
 * Échelle du logo dans une icône « maskable » : Android peut rogner tout ce qui
 * dépasse le cercle central (80 % du côté). À 70 %, un logo carré dont le sujet
 * occupe jusqu'à ~80 % de sa surface reste entier. Surchargeable par snack
 * (`iconMaskableScale` dans snacks-seo.json, ex. 1 si le visuel est déjà conçu
 * en maskable).
 */
export const DEFAULT_MASKABLE_SCALE = 0.7;

/** Alpha moyen (0-255) en dessous duquel le bord est considéré transparent. */
const OPAQUE_ALPHA = 200;
/** Écart-type (par canal, 0-255) au-delà duquel le bord n'est plus un aplat (dégradé, motif). */
export const FLAT_EDGE_MAX_STDDEV = 10;

/**
 * Statistiques du bord (anneau de 1 px) d'une image RGBA brute : couleur moyenne,
 * pour prolonger le fond du logo sans couture dans les marges de l'icône maskable,
 * et dispersion, pour savoir si cet aplat existe vraiment.
 * @param {Uint8Array|Buffer} rgba - Pixels RGBA (4 octets par pixel).
 * @param {number} width
 * @param {number} height
 * @returns {{ color: {r:number,g:number,b:number}, stddev: number } | null} null si le bord est transparent.
 */
export function edgeStats(rgba, width, height) {
  const samples = [];
  let alpha = 0;
  const add = (x, y) => {
    const i = (y * width + x) * 4;
    samples.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
    alpha += rgba[i + 3];
  };
  for (let x = 0; x < width; x++) { add(x, 0); if (height > 1) add(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { add(0, y); if (width > 1) add(width - 1, y); }
  const n = samples.length;
  if (n === 0 || alpha / n < OPAQUE_ALPHA) return null;
  const mean = [0, 1, 2].map((c) => samples.reduce((acc, p) => acc + p[c], 0) / n);
  const variance = [0, 1, 2].map((c) => samples.reduce((acc, p) => acc + (p[c] - mean[c]) ** 2, 0) / n);
  return {
    color: { r: Math.round(mean[0]), g: Math.round(mean[1]), b: Math.round(mean[2]) },
    stddev: Math.sqrt(variance.reduce((a, v) => a + v, 0) / 3),
  };
}

/** Couleur moyenne du bord (null si transparent) — cf. edgeStats. */
export function edgeColor(rgba, width, height) {
  return edgeStats(rgba, width, height)?.color ?? null;
}

/** Le bord est-il un aplat (→ remplissage uni sans couture) plutôt qu'un dégradé ? */
export function isFlatEdge(stats, maxStddev = FLAT_EDGE_MAX_STDDEV) {
  return !!stats && stats.stddev <= maxStddev;
}

/** `#rrggbb` → {r,g,b} (null si invalide). */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/**
 * Placement du logo dans une icône maskable de `size` px.
 * @param {number} size - Côté de l'icône.
 * @param {number} [scale] - Part du côté occupée par le logo (0 < scale ≤ 1).
 * @returns {{ inner: number, offset: number }} côté du logo réduit et marge.
 */
export function maskableLayout(size, scale = DEFAULT_MASKABLE_SCALE) {
  const s = Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : DEFAULT_MASKABLE_SCALE;
  const inner = Math.round(size * s);
  return { inner, offset: Math.round((size - inner) / 2) };
}

/** Un jeu d'icônes PNG a-t-il été généré pour ce snack ? */
export function hasGeneratedIcons(publicDir, snackId) {
  return existsSync(join(publicDir, "icons", snackId, ICON_FILES.any[1].file));
}

/**
 * Entrées `icons` du manifest : le jeu PNG généré (any + maskable séparés, comme
 * le recommande Android) ou, à défaut, le logo distant historique (webp unique).
 * @param {{ publicDir: string, snackId: string, fallbackUrl: string }} p
 */
export function manifestIcons({ publicDir, snackId, fallbackUrl }) {
  if (!hasGeneratedIcons(publicDir, snackId)) {
    return [
      { src: fallbackUrl, sizes: "192x192", type: "image/webp" },
      { src: fallbackUrl, sizes: "512x512", type: "image/webp", purpose: "any maskable" },
    ];
  }
  const base = `/icons/${snackId}`;
  return [
    ...ICON_FILES.any.map(({ file, size }) => ({ src: `${base}/${file}`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" })),
    ...ICON_FILES.maskable.map(({ file, size }) => ({ src: `${base}/${file}`, sizes: `${size}x${size}`, type: "image/png", purpose: "maskable" })),
  ];
}

/**
 * Icônes référencées dans le <head> (favicons + apple-touch-icon), même repli.
 * @param {{ publicDir: string, snackId: string, fallbackUrl: string }} p
 * @returns {{ icon192: string, icon512: string, type: string, appleTouchIcon: string }}
 */
export function htmlIcons({ publicDir, snackId, fallbackUrl }) {
  if (!hasGeneratedIcons(publicDir, snackId)) {
    return { icon192: fallbackUrl, icon512: fallbackUrl, type: "image/webp", appleTouchIcon: fallbackUrl };
  }
  const base = `/icons/${snackId}`;
  return {
    icon192: `${base}/${ICON_FILES.any[0].file}`,
    icon512: `${base}/${ICON_FILES.any[1].file}`,
    type: "image/png",
    appleTouchIcon: `${base}/${ICON_FILES.apple.file}`,
  };
}
