// ============================================================================
// 🔤 DICTIONNAIRE DES POLICES SAAS — module PUR
// ============================================================================
// Aucune dépendance (ni Firebase, ni DOM) : importable à la fois côté RUNTIME
// (snack-config.js -> config.theme.fonts) ET côté BUILD (vite.config.js -> {{FONT_LINK}}).
// C'est la SOURCE UNIQUE des polices : ne pas dupliquer les `href` ailleurs.
//
// Pour activer une police web sur un tenant, poser `fontKey` :
//   - dans Firestore (runtime, source de vérité, éditable admin) ET
//   - dans snacks-seo.json (build-time, injecte le <link> dès le 1er octet -> zéro FOUT).
//
// Contraintes perf (CLAUDE.md §8.1) : 1 famille, 2 graisses max, &display=swap obligatoire
// (texte visible immédiatement, pas de FOIT). `display: null` => hérite de `body`.
export const SAAS_FONTS = {
  // Défaut système : 0 octet réseau, aucune requête.
  system: {
    body: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    display: null,
    href: null,
  },
  // Poppins : rondeur chaleureuse, lisible — adaptée au food / snacking.
  poppins: {
    body: "'Poppins', ui-sans-serif, system-ui, sans-serif",
    display: "'Poppins', ui-sans-serif, system-ui, sans-serif",
    href: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap",
  },
  // Inter : grotesque moderne, très neutre et net sur petits écrans.
  inter: {
    body: "'Inter', ui-sans-serif, system-ui, sans-serif",
    display: "'Inter', ui-sans-serif, system-ui, sans-serif",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap",
  },
  // Montserrat : géométrique large, premium urbain — pizza au feu de bois.
  montserrat: {
    body: "'Montserrat', ui-sans-serif, system-ui, sans-serif",
    display: "'Montserrat', ui-sans-serif, system-ui, sans-serif",
    href: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap",
  },
  // Space Grotesk : grotesque au caractère marqué, moderne et tech.
  spacegrotesk: {
    body: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    display: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600&display=swap",
  },
  // Outfit : sans serré et net, branding trendy — smash burger.
  outfit: {
    body: "'Outfit', ui-sans-serif, system-ui, sans-serif",
    display: "'Outfit', ui-sans-serif, system-ui, sans-serif",
    href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&display=swap",
  },
};

/**
 * Résout une clé de police en sa définition, avec fallback système robuste.
 * @param {string} [key] - Clé de police (ex: "poppins"). Insensible aux valeurs nulles.
 * @returns {{body: string, display: string|null, href: string|null}} Définition de police.
 */
export function resolveFont(key) {
  return SAAS_FONTS[key] || SAAS_FONTS.system;
}
