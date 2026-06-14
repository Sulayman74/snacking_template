#!/usr/bin/env node
/**
 * 🎛️ Garde-fou theming (ratchet anti-régression) — Chantier 1 (sweep tokens).
 *
 * Vérifie que le nombre de couleurs Tailwind codées EN DUR (neutres + danger) dans
 * la surface CLIENT n'augmente pas. On ne vise pas zéro : certains restes sont
 * intentionnels (prix/cœurs rouges, gris muted sur fonds SOMBRES du footer/overlays,
 * `bg-gray-50/100` de profondeur réservés à une passe ultérieure). Le but est
 * d'empêcher toute NOUVELLE couleur en dur dans ces fichiers : préférer les tokens
 * sémantiques (`text-text`, `text-text-muted`, `bg-surface`, `text-on-dark`,
 * `text-danger`/`bg-danger`) définis dans src/styles.css (@theme).
 *
 * Quand on réduit encore les restes, BAISSER BASELINE en conséquence (le ratchet
 * ne doit que descendre). Lancer : `npm run lint:theming`.
 */
import { readFileSync } from "node:fs";

/** Fichiers de la surface client balayés au Chantier 1. Le back-office (admin/kitchen/
 *  superadmin/livreur) n'est PAS encore migré : hors périmètre de ce garde-fou. */
const FILES = [
  "index.html",
  "src/ui/AppUI.js",
  "src/ui/CartUI.js",
  "src/ui/FavoritesUI.js",
  "src/ui/ReorderUI.js",
  "src/ui/UpsellUI.js",
  "src/menu.js",
  "src/product-modal.js",
  "src/tracking.js",
  "src/utils.js",
];

/** Classes neutres/danger codées en dur à surveiller (les statuts green/blue/yellow/
 *  purple sont hors theming et volontairement ignorés). */
const PATTERNS = {
  "text-white": /text-white/g,
  "text-gray-[0-9]": /text-gray-[0-9]/g,
  "bg-gray-[0-9]": /bg-gray-[0-9]/g,
  "bg-white": /bg-white/g,
  "text-red-[0-9]": /text-red-[0-9]/g,
  "bg-red-[0-9]": /bg-red-[0-9]/g,
};

/** Plafond figé au commit du sweep. Ne doit que DÉCROÎTRE. */
const BASELINE = 142;

let total = 0;
const breakdown = {};
for (const [name, re] of Object.entries(PATTERNS)) {
  let count = 0;
  for (const file of FILES) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    count += (src.match(re) || []).length;
  }
  breakdown[name] = count;
  total += count;
}

const pad = (s) => String(s).padEnd(16);
console.log("🎛️  Couleurs en dur (surface client) :");
for (const [name, count] of Object.entries(breakdown)) {
  console.log(`   ${pad(name)} ${count}`);
}
console.log(`   ${pad("TOTAL")} ${total}  (baseline ${BASELINE})`);

if (total > BASELINE) {
  console.error(
    `\n❌ Régression theming : ${total} > baseline ${BASELINE}.` +
      `\n   Une nouvelle couleur en dur a été introduite dans la surface client.` +
      `\n   Utilise un token sémantique (text-text / text-text-muted / bg-surface /` +
      `\n   text-on-dark / text-danger) au lieu de text-gray-* / bg-gray-* / text-white /` +
      `\n   bg-white / text-red-*. Tokens définis dans src/styles.css (@theme).`,
  );
  process.exit(1);
}

if (total < BASELINE) {
  console.log(
    `\n✅ ${BASELINE - total} couleur(s) en dur de moins que la baseline.` +
      `\n   Pense à abaisser BASELINE à ${total} dans scripts/check-theming.mjs (ratchet).`,
  );
} else {
  console.log("\n✅ Aucune régression theming.");
}
