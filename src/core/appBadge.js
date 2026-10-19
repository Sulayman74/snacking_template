// ============================================================================
// 🔴 appBadge — pastille chiffrée sur l'icône de l'app installée (Badging API)
// ============================================================================
// Supporté sur iOS/iPadOS 16.4+ (app installée + notifications autorisées) et
// Chromium desktop. Absent ailleurs → no-op silencieux.

/** Commandes qui attendent une action cuisine (même définition que lib/kitchen). */
export const PENDING_KITCHEN_STATUSES = Object.freeze(["en_attente_client", "nouvelle"]);

/**
 * Affiche `count` sur l'icône de l'app (0 → pastille retirée).
 * @param {number} count
 */
export function setAppBadgeCount(count) {
  if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n > 0) {
    navigator.setAppBadge(n)?.catch?.(() => {});
  } else {
    clearAppBadge();
  }
}

/**
 * Retire immédiatement la pastille de l'icône de l'app et réinitialise le compteur du SW.
 */
export function clearAppBadge() {
  if (typeof navigator !== "undefined" && "clearAppBadge" in navigator) {
    navigator.clearAppBadge()?.catch?.(() => {});
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "CLEAR_BADGE" });
      } else {
        navigator.serviceWorker.ready
          ?.then((reg) => reg.active?.postMessage({ type: "CLEAR_BADGE" }))
          ?.catch?.(() => {});
      }
    } catch {}
  }
}

/**
 * Configure la remise à zéro automatique du badge dès le chargement
 * et à chaque retour au premier plan (visibilitychange).
 * À inclure sur chaque surface (client, admin, livreur).
 */
export function setupAppBadgeAutoClear() {
  clearAppBadge();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        clearAppBadge();
      }
    });
  }
}

/**
 * Nombre de commandes en attente parmi des commandes (Map id → commande ou tableau).
 * @param {Iterable<{statut?: string}>} orders
 * @returns {number}
 */
export function countPendingKitchenOrders(orders) {
  let n = 0;
  for (const o of orders) if (PENDING_KITCHEN_STATUSES.includes(o?.statut)) n++;
  return n;
}
