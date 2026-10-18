// ============================================================================
// 🎞️ footerMarquee — contenu du bandeau défilant du pied de page (logique PURE)
// ============================================================================
// Le bandeau est DÉCORATIF (aria-hidden) : nom du restaurant en accent, puis les
// services réellement activés dans la config (clés i18n). Aucun DOM ici : AppUI
// rend le HTML dans les deux copies de la piste, et le re-rend au changement de langue.

/**
 * Segments du bandeau, dans l'ordre d'affichage.
 * @param {object} cfg - Config snack (identity.name, features.*).
 * @returns {Array<{ text?: string, key?: string, accent?: boolean }>}
 */
export function marqueeSegments(cfg) {
  const name = String(cfg?.identity?.name || "").trim();
  const f = cfg?.features || {};
  const segments = [];
  if (name) segments.push({ text: name, accent: true });
  // Même sémantique que le serveur (lib/pricing.js) : seul un flag EXPLICITEMENT coupé
  // retire le Click & Collect ; la livraison, elle, doit être activée.
  if (f.enableClickAndCollect !== false) segments.push({ key: "footer.marqueeCollect" });
  if (f.enableDelivery === true) segments.push({ key: "footer.marqueeDelivery" });
  if (f.enableLoyaltyCard !== false) segments.push({ key: "footer.marqueeLoyalty" });
  return segments;
}

/**
 * HTML d'une copie de la piste : chaque segment est suivi d'un point médian, pour que
 * la boucle (translateX(-50 %) sur deux copies) se referme sans couture. La séquence est
 * répétée jusqu'à `minSegments` entrées : un restaurant avec deux segments garde un
 * vrai bandeau, pas un mot isolé.
 * @param {ReturnType<typeof marqueeSegments>} segments
 * @param {{ t: (key: string) => string, escape: (s: string) => string, minSegments?: number }} deps
 */
export function marqueeHTML(segments, { t, escape, minSegments = 6 }) {
  if (!segments.length) return "";
  const repeat = Math.max(1, Math.ceil(minSegments / segments.length));
  return Array.from({ length: repeat }, () => segments)
    .flat()
    .map((s) => {
      const label = escape(s.text ?? t(s.key));
      const cls = s.accent ? ' class="marquee-accent"' : "";
      return `<span${cls}>${label}</span><span class="marquee-dot">·</span>`;
    })
    .join("");
}
