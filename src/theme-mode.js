// ============================================================================
// 🌗 THEME MODE — clair / sombre / système (orthogonal à la palette tenant)
// ----------------------------------------------------------------------------
// Mode = classe .dark sur <html> ; palette = data-theme (posé par AppUI). Les deux
// coexistent. La logique métier (résolution + persistance) vit ici (SRP/KISS) ; l'UI
// ne fait que déclencher via data-action="cycle-theme" (cf. router.js).
//
// 3 états persistés dans localStorage :
//   - "light"  : force le clair (classe .light -> exclut le fallback @media de styles.css) ;
//   - "dark"   : force le sombre ;
//   - "system" : suit prefers-color-scheme, réévalué en live au changement d'OS.
//
// ⚠️ Le 1er rendu est déjà géré AVANT le paint par le script anti-flash inline injecté
// dans <head> (cf. vite.config.js) : ce module RESYNCHRONISE proprement après boot et
// gère le cycle + l'écoute des changements OS. Pas de flash.
// ============================================================================

const STORAGE_KEY = "theme-mode";
const MODES = ["light", "dark", "system"];
const mql = window.matchMedia("(prefers-color-scheme: dark)");

/** Libellés + noms d'icône Lucide par mode. */
const META = {
  light: { icon: "sun", label: "Thème clair" },
  dark: { icon: "moon", label: "Thème sombre" },
  system: { icon: "contrast", label: "Thème système" },
};

/**
 * Lit le mode courant depuis localStorage (défaut : "system").
 * @returns {"light"|"dark"|"system"} Mode persisté valide.
 */
function getMode() {
  const value = localStorage.getItem(STORAGE_KEY);
  return MODES.includes(value) ? value : "system";
}

/**
 * Résout si le rendu effectif doit être sombre pour un mode donné.
 * @param {"light"|"dark"|"system"} mode - Mode choisi.
 * @returns {boolean} true si le sombre doit s'appliquer.
 */
function resolveDark(mode) {
  return mode === "dark" || (mode === "system" && mql.matches);
}

/**
 * Applique un mode au DOM : pose/retire .dark et .light sur <html>, accorde color-scheme
 * et resynchronise l'UI des toggles. N'effectue AUCUNE écriture localStorage (pure projection).
 * @param {"light"|"dark"|"system"} mode - Mode à appliquer.
 * @returns {void}
 */
function apply(mode) {
  const root = document.documentElement;
  const dark = resolveDark(mode);
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", mode === "light"); // override clair explicite (fallback @media)
  root.style.colorScheme = dark ? "dark" : "light";
  syncToggleUI(mode);
}

/**
 * Met à jour tous les boutons toggle (icône + aria-label + title) selon le mode courant.
 * Robuste aux toggles multiples (nav desktop + menu mobile) et aux re-renders.
 * @param {"light"|"dark"|"system"} mode - Mode courant.
 * @returns {void}
 */
function syncToggleUI(mode) {
  const { icon, label } = META[mode];
  document.querySelectorAll('[data-action="cycle-theme"]').forEach((btn) => {
    const current = btn.querySelector("svg, [data-lucide]");
    // swapIcon vient d'icons.js (importé après theme-mode) ; au 1er apply il peut être absent,
    // l'icône par défaut (data-lucide="contrast" du markup) couvre alors l'état système.
    if (current) window.swapIcon?.(current, icon);
    btn.setAttribute("aria-label", `${label} — changer de thème`);
    btn.setAttribute("title", label);
  });
}

/**
 * Passe au mode suivant (light -> dark -> system -> …), persiste et applique.
 * Exposé en global pour le routeur d'événements (data-action="cycle-theme").
 * @returns {void}
 */
function cycleThemeMode() {
  const next = MODES[(MODES.indexOf(getMode()) + 1) % MODES.length];
  localStorage.setItem(STORAGE_KEY, next);
  window.triggerVibration?.("light");
  apply(next);
}

// Réévalue en live quand l'OS bascule, uniquement si l'utilisateur est en mode "système".
mql.addEventListener("change", () => {
  if (getMode() === "system") apply("system");
});

// Expose le cycle au routeur (event delegation centralisé).
window.cycleThemeMode = cycleThemeMode;

// Resync au boot : le script anti-flash a déjà posé la classe avant le paint ; on s'assure
// que color-scheme + l'UI des toggles sont cohérents (les boutons existent dès le parse HTML).
apply(getMode());
document.addEventListener("DOMContentLoaded", () => syncToggleUI(getMode()));
