// ============================================================================
// ✨ reveal — révélation au défilement, native et sobre (IntersectionObserver)
// ============================================================================
// UN observateur partagé, one-shot (unobserve dès l'apparition), aucune écoute de
// scroll, aucune lecture de layout : la classe .is-visible déclenche une transition
// CSS transform + opacity (styles.css → .reveal), composée par le GPU. Jamais posé
// sur le héros ni sur un texte utile avant le pli (élément LCP). Sans JavaScript,
// rien n'est caché (l'état masqué exige la classe html.js-reveal) ; sous
// prefers-reduced-motion, tout est visible d'emblée, sans transition.
const SELECTOR = ".reveal:not(.is-visible)";
const OPTIONS = { threshold: 0.12, rootMargin: "0px 0px -8% 0px" };
let observer = null;
const seen = new WeakSet();

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function sharedObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver((entries, obs) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      obs.unobserve(entry.target);
    }
  }, OPTIONS);
  return observer;
}

/**
 * Observe les éléments `.reveal` encore masqués d'une racine (document ou shadowRoot).
 * Idempotent : un élément déjà suivi n'est pas ré-observé. Sans IntersectionObserver
 * ou sous reduced-motion, les éléments sont révélés immédiatement.
 * @param {ParentNode} [root=document]
 * @returns {number} Nombre d'éléments pris en charge par cet appel.
 */
export function observeReveal(root = document) {
  const targets = root.querySelectorAll(SELECTOR);
  if (!targets.length) return 0;
  if (typeof IntersectionObserver !== "function" || reducedMotion()) {
    for (const el of targets) el.classList.add("is-visible");
    return targets.length;
  }
  const obs = sharedObserver();
  let count = 0;
  for (const el of targets) {
    if (seen.has(el)) continue;
    seen.add(el);
    obs.observe(el);
    count++;
  }
  return count;
}

/**
 * Active la révélation sur la page : pose html.js-reveal (qui autorise l'état masqué)
 * puis observe. Sous reduced-motion, la classe n'est pas posée : rien n'est jamais caché.
 * @param {Document} [doc=document]
 */
export function initReveal(doc = document) {
  if (!reducedMotion() && typeof IntersectionObserver === "function") {
    doc.documentElement.classList.add("js-reveal");
  }
  return observeReveal(doc);
}

/**
 * Pose `className` sur `el` tant qu'il est à l'écran, la retire sinon (observateur
 * continu, seuil 0). Sert à mettre en pause une animation décorative hors écran
 * (bandeau du pied de page). Sans IntersectionObserver : classe posée d'emblée.
 * @param {Element} el
 * @param {string} [className="in-view"]
 */
export function watchInView(el, className = "in-view") {
  if (!el) return null;
  if (typeof IntersectionObserver !== "function") { el.classList.add(className); return null; }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle(className, entry.isIntersecting);
  }, { threshold: 0 });
  io.observe(el);
  return io;
}
