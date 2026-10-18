// ============================================================================
// 🪵 NEUTRES « Papier & Ardoise » — SOURCE UNIQUE côté JS (refonte, Phase 1)
// ============================================================================
// Module SANS dépendance (comme theme-palettes.js) : importé par le build
// (vite.config.js → fond de page injecté dès le 1er octet) et par les tests, qui
// vérifient que src/styles.css (@theme / :root / .dark) porte EXACTEMENT ces valeurs.
// Neutres légèrement chauds (teinte OKLCH ~70-80, chroma 0,004-0,010) : le premium
// vient des neutres, la couleur de marque reste celle de chaque restaurant.
export const NEUTRALS = {
  light: {
    bgBase: "#faf8f5",     // fond de page (papier)
    surface: "#ffffff",    // cartes, modales
    surface2: "#f3f0eb",   // panneaux, champs
    surface3: "#e8e3dc",   // fills marqués, grabbers
    line: "#dcd6cd",       // bordures
    text: "#1c1917",       // texte principal
    textMuted: "#5c564f",  // texte secondaire (≥ 5,67 sur surface-3)
    danger: "#b91c1c",     // erreurs (≥ 5,07 sur surface-3)
    footer: "#1f1b18",     // pied de page ardoise, même en clair
  },
  dark: {
    bgBase: "#121010",
    surface: "#1c1917",
    surface2: "#262220",
    surface3: "#332e2a",
    line: "#3d3732",
    text: "#f3efe9",
    textMuted: "#b3aba2",
    danger: "#f87171",
    footer: "#0d0b0a",
  },
};
