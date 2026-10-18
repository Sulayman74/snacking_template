// ============================================================================
// 🎨 PALETTES SAAS — SOURCE UNIQUE (build + runtime)
// ============================================================================
// Module SANS dépendance (comme src/theme-fonts.js) → importable à la fois par le
// build (vite.config.js, contexte Node) ET le runtime (src/snack-config.js, navigateur).
// `colorPalette` (Firestore + snacks-seo.json) est la source de vérité de la couleur ;
// le build dérive theme_color/accent/light d'ici pour le splash, le <meta theme-color>
// et le manifest PWA → plus de désynchronisation avec l'UI runtime.
// Couleurs en HEX. Les utilitaires Tailwind (bg-primary, text-accent, …) sont générés
// par le bloc @theme de styles.css à partir des CSS custom properties.
export const SAAS_THEMES = {
  "ruby":      { primaryHex: "#dc2626", accentHex: "#dc2626", lightHex: "#fee2e2", onPrimaryHex: "#ffffff" },
  "ocean": {
    primaryHex: "#0077b6",   // Bleu lagon profond
    accentHex: "#00b4d8",    // Bleu cristal de surface
    lightHex: "#caf0f8",     // Écume / Eau peu profonde
    onPrimaryHex: "#ffffff"  // Texte blanc pur pour le contraste
  },
  "forest":    { primaryHex: "#16a34a", accentHex: "#16a34a", lightHex: "#dcfce7", onPrimaryHex: "#ffffff" },
  "midnight":  { primaryHex: "#4c1d95", accentHex: "#c084fc", lightHex: "#f3e9ff", onPrimaryHex: "#ffffff" },
  "sunflower": { primaryHex: "#eab308", accentHex: "#ca8a04", lightHex: "#fef9c3", onPrimaryHex: "#111827" },
  "belly": {
    primaryHex:   "#0A1B3F",  // Belly Blue — navy profond du logo
    accentHex:    "#B88A44",  // Golden Bun — or gourmand (chaud, appétence)
    lightHex:     "#C8D8E9",  // Logo Light — teinte bleu clair du primary
    onPrimaryHex: "#FFFFFF",  // Texte blanc sur navy (contraste WCAG AAA ~16:1)
  },
};

// Palette de repli quand un snack n'a pas (encore) de colorPalette.
export const DEFAULT_PALETTE_KEY = "sunflower";

// ---------------------------------------------------------------------------
// 🎯 Contraste WCAG (sRGB). Sert à choisir le texte posé sur un fond de marque
// (--color-on-accent) et aux tests des jetons. Pur, sans DOM.
// ---------------------------------------------------------------------------
const hexToRgb = (hex) => {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => { const [r, g, b] = hexToRgb(hex).map(linear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** Ratio de contraste WCAG 2 entre deux couleurs hex (1 à 21). */
export function contrastRatio(hexA, hexB) {
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Couleur de texte à poser sur `bgHex` : la plus contrastée entre clair et sombre.
 * @param {string} bgHex - Fond (ex. accent du tenant).
 * @param {{ light?: string, dark?: string }} [opts]
 */
export function pickOnColor(bgHex, { light = "#ffffff", dark = "#1f2937" } = {}) {
  if (!/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(bgHex || ""))) return light;
  return contrastRatio(light, bgHex) >= contrastRatio(dark, bgHex) ? light : dark;
}

/** Teinte OKLCH (0-360) d'une couleur hex, pour dériver des tons de la marque. */
function oklchHue(hex) {
  const [r, g, b] = hexToRgb(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}

/**
 * Couleurs des segments de la roue de fidélité : la teinte du primaire du tenant tournée
 * autour du cercle OKLCH, luminosité et chroma fixes (lisible avec un texte sombre).
 * Remplace huit hex figés : la roue suit la palette de chaque restaurant.
 * @param {string} [primaryHex]
 * @param {string} [accentHex] - Réservé : l'accent occupe le premier segment s'il est fourni.
 * @param {number} [count=8]
 * @returns {string[]} Couleurs CSS `oklch(...)`.
 */
export function wheelSegmentColors(primaryHex = "#dc2626", accentHex, count = 8) {
  const valid = (h) => /^#?[0-9a-f]{6}$/i.test(String(h || ""));
  const base = oklchHue(valid(primaryHex) ? primaryHex : "#dc2626");
  const hues = Array.from({ length: count }, (_, i) => Math.round((base + (i * 360) / count) % 360));
  if (valid(accentHex)) hues[0] = Math.round(oklchHue(accentHex));
  return hues.map((h) => `oklch(0.78 0.14 ${h})`);
}
