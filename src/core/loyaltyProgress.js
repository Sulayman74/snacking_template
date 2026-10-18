// ============================================================================
// 🎁 loyaltyProgress — progression vers le cadeau fidélité (logique PURE)
// ============================================================================
// Modèle « report + banque » : pointsBySnack avance de 0 à MAX-1, et chaque palier
// atteint banque une récompense (rewardsAvailable). Une carte « legacy » restée
// à ≥ MAX est normalisée ici sans perte. Partagé par la carte fidélité, l'accueil
// et le suivi de commande, pour que tous disent la même chose.
export const LOYALTY_MAX_POINTS = 10;

/**
 * @param {number} rawPoints - pointsBySnack.{snackId}
 * @param {number} [rawAvailable=0] - rewardsAvailable.{snackId}
 * @param {number} [max=LOYALTY_MAX_POINTS]
 * @returns {{ progress: number, max: number, remaining: number, ready: number, ratio: number }}
 *   progress : points du palier en cours (0..max-1) · remaining : commandes avant le
 *   prochain cadeau · ready : cadeaux prêts à ouvrir · ratio : % pour la barre.
 */
export function progressSummary(rawPoints = 0, rawAvailable = 0, max = LOYALTY_MAX_POINTS) {
  const points = Math.max(0, Math.floor(Number(rawPoints) || 0));
  const available = Math.max(0, Math.floor(Number(rawAvailable) || 0));
  const progress = points % max;
  return {
    progress,
    max,
    remaining: max - progress,
    ready: available + Math.floor(points / max),
    ratio: Math.round((progress / max) * 100),
  };
}
