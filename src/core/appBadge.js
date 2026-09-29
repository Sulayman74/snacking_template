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
  const p = n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge();
  p?.catch?.(() => {}); // non autorisé (app non installée…) : sans conséquence
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
