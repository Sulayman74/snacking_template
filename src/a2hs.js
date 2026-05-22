// ============================================================================
// 📲 a2hs — "Add to Home Screen" : bannière d'installation + fallback iOS (DRY)
// ============================================================================
// Mutualisé par les surfaces installables (livreur, admin). La page fournit :
//   #<bannerId> (conteneur), #<btnId> (bouton installer), #<closeId> (croix),
//   #<hintId> (texte d'aide, optionnel — remplacé par les instructions iOS).
//
// Android/Chromium : capture `beforeinstallprompt` (émis seulement si installable :
// HTTPS + manifest + SW actif, et pas déjà installée) → propose l'install native.
// iOS/Safari : pas d'événement → on affiche les instructions manuelles.

export function setupA2HS({ bannerId, btnId, closeId, hintId } = {}) {
  const banner = document.getElementById(bannerId);
  if (!banner) return;

  const show = () => banner.classList.remove("translate-y-32", "opacity-0", "pointer-events-none");
  const hide = () => banner.classList.add("translate-y-32", "opacity-0", "pointer-events-none");

  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    setTimeout(show, 1500);
  });

  document.getElementById(btnId)?.addEventListener("click", async () => {
    if (!deferred) return;
    hide();
    deferred.prompt();
    try { await deferred.userChoice; } finally { deferred = null; }
  });

  document.getElementById(closeId)?.addEventListener("click", hide);
  window.addEventListener("appinstalled", hide);

  // iOS : instructions manuelles (Partager → Sur l'écran d'accueil).
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isIOS && !isStandalone) {
    document.getElementById(btnId)?.classList.add("hidden");
    const hint = hintId ? document.getElementById(hintId) : null;
    if (hint) hint.innerHTML = 'Partager <i class="fas fa-arrow-up-from-bracket"></i> → « Sur l\'écran d\'accueil »';
    setTimeout(show, 1500);
  }
}
