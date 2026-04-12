// ============================================================================
// 🎨 TAILWIND v4 SAFELIST — Classes dynamiques (SaaS thème + product modal)
// ============================================================================
// Ce fichier n'est PAS importé par l'app. Tailwind v4 le scanne automatiquement
// et inclut ces classes dans le bundle CSS même si elles n'apparaissent pas
// dans du HTML statique.
// À mettre à jour si de nouveaux thèmes ou classes dynamiques sont ajoutés.
// ============================================================================

const _safelist = [
  // ── Thèmes SaaS (primary bg) ──────────────────────────────────────────────
  "bg-red-600",    "bg-blue-600",    "bg-green-600",
  "bg-purple-500", "bg-yellow-400",
  // ── Thèmes SaaS (accent text) ─────────────────────────────────────────────
  "text-red-600",  "text-blue-500",  "text-green-600",
  "text-purple-400","text-yellow-500",
  // ── Thèmes SaaS (textOnPrimary) ───────────────────────────────────────────
  "text-white",    "text-gray-900",
  // ── Thèmes SaaS (border) ──────────────────────────────────────────────────
  "border-red-600","border-blue-600","border-green-600",
  "border-purple-600","border-yellow-600",
  // ── Thèmes SaaS (blurBg) ──────────────────────────────────────────────────
  "bg-red-600/60", "bg-blue-600/60", "bg-green-600/60",
  "bg-purple-600/60","bg-yellow-600/60",
  // ── product-modal : accentBg (bg-*-500) ───────────────────────────────────
  "bg-red-500",    "bg-blue-500",    "bg-green-500",
  "bg-purple-500", "bg-yellow-500",
  // ── product-modal : accentLightBg (bg-*-50) ───────────────────────────────
  "bg-red-50",     "bg-blue-50",     "bg-green-50",
  "bg-purple-50",  "bg-yellow-50",
  // ── product-modal : accentBorder (border-*-500) ───────────────────────────
  "border-red-500","border-blue-500","border-green-500",
  "border-purple-500","border-yellow-500",
  // ── product-modal : peer-checked:* ────────────────────────────────────────
  "peer-checked:border-red-500",    "peer-checked:bg-red-50",
  "peer-checked:border-blue-500",   "peer-checked:bg-blue-50",
  "peer-checked:border-green-500",  "peer-checked:bg-green-50",
  "peer-checked:border-purple-500", "peer-checked:bg-purple-50",
  "peer-checked:border-yellow-500", "peer-checked:bg-yellow-50",
  // ── product-modal : primaryBg inside peer-checked ─────────────────────────
  "peer-checked:bg-red-600",   "peer-checked:bg-blue-600",
  "peer-checked:bg-green-600", "peer-checked:bg-purple-500",
  "peer-checked:bg-yellow-400",
  // ── snacks-seo.json shadowClass ────────────────────────────────────────────
  "shadow-red-600/40",    "shadow-purple-600/40",
  "shadow-green-600/40",  "shadow-blue-600/40",
  "shadow-orange-500/40", "shadow-yellow-500/40",
  // ── loyalty & UI ──────────────────────────────────────────────────────────
  "text-red-500",  "text-blue-400",  "text-green-500",
];
