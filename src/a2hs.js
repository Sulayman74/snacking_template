// ============================================================================
// 📲 a2hs — "Add to Home Screen" : bannière d'installation + fallback iOS (DRY)
// ============================================================================
// Mutualisé par les surfaces installables (client, livreur, admin). La page fournit :
//   #<bannerId> (conteneur), #<btnId> (bouton installer), #<closeId> (croix),
//   #<hintId> (texte d'aide, optionnel — remplacé par les instructions iOS).
//
// Android/Chromium : capture `beforeinstallprompt` (émis seulement si installable :
// HTTPS + manifest + SW actif, et pas déjà installée) → propose l'install native.
// iOS/Safari : pas d'événement → on affiche les instructions manuelles.

export function setupA2HS({ bannerId, btnId, closeId, hintId } = {}) {
  const banner = document.getElementById(bannerId);
  if (!banner) return;

  // 🔕 Dismiss persistant (snooze) : on ne re-harcèle pas après une fermeture
  // manuelle ou une installation. Clé par bannerId → chaque surface (client /
  // admin / livreur) a son propre état. Re-proposé après SNOOZE_MS.
  const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
  const storeKey = `a2hs_dismissed_${bannerId}`;
  const isSnoozed = () => {
    try {
      const ts = Number(localStorage.getItem(storeKey));
      return Number.isFinite(ts) && ts > 0 && Date.now() - ts < SNOOZE_MS;
    } catch { return false; }
  };
  const snooze = () => { try { localStorage.setItem(storeKey, String(Date.now())); } catch { /* quota / private mode */ } };

  // Déjà rejetée récemment → on ne câble rien et on n'affiche pas.
  if (isSnoozed()) return;

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

  // Fermeture manuelle ou installation → on mémorise (snooze).
  document.getElementById(closeId)?.addEventListener("click", () => { snooze(); hide(); });
  window.addEventListener("appinstalled", () => { snooze(); hide(); });

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
