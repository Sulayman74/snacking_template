// ============================================================================
// 📱 platform — détection iOS / mode app installée (module PUR, testable)
// ============================================================================
// Sur iPhone/iPad, les notifications web n'existent QUE dans l'app installée sur
// l'écran d'accueil (iOS 16.4+) : dans un onglet Safari, `Notification` est absent.

/** iPhone / iPod / iPad (iPadOS se présente comme un Mac tactile). */
export function isIOSDevice(nav = globalThis.navigator) {
  const ua = String(nav?.userAgent || "");
  return /iphone|ipad|ipod/i.test(ua) || (nav?.platform === "MacIntel" && Number(nav?.maxTouchPoints) > 1);
}

/** L'app tourne-t-elle installée (écran d'accueil) plutôt que dans un onglet ? */
export function isStandaloneDisplay(win = globalThis.window) {
  return Boolean(win?.matchMedia?.("(display-mode: standalone)")?.matches || win?.navigator?.standalone === true);
}

/** iOS dans Safari : il faut d'abord installer l'app pour recevoir des notifications. */
export function needsInstallForPush(win = globalThis.window) {
  return isIOSDevice(win?.navigator) && !isStandaloneDisplay(win);
}
