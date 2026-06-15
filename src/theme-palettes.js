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
