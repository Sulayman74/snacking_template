// ============================================================================
// 🔔 push-payload — lecture des messages push (module PUR, testé unitairement)
// ============================================================================
// Utilisé par src/sw.js. Deux formats entrants :
//   • FCM (Admin SDK) : { notification: {title, body, image, icon}, data: {...},
//     fcmOptions: { link } }
//   • Declarative Web Push (Safari 18.4+) : { web_push: 8030, notification:
//     { title, body, navigate, app_badge, ... } } — prévu pour la suite.
// Aucun lien n'ouvre une AUTRE origine que celle du site (anti-redirection).

const DEFAULT_TITLE = "Nouvelle notification";

/**
 * Ramène une URL (absolue ou relative) sur l'origine du site.
 * Une URL d'une autre origine garde seulement son chemin + query.
 * @param {string|undefined} raw
 * @param {string} origin - ex. self.location.origin
 * @returns {string} URL absolue sur `origin`.
 */
export function toSameOriginUrl(raw, origin) {
  if (typeof raw !== "string" || !raw.trim()) return `${origin}/`;
  try {
    const u = new URL(raw.trim(), `${origin}/`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return `${origin}/`;
    return u.origin === origin ? u.href : `${origin}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return `${origin}/`;
  }
}

/**
 * Icône de notification selon la surface ciblée (admin / livreur / client).
 * @param {string} url - URL absolue de destination.
 * @returns {string|undefined} undefined → icône de l'app choisie par le navigateur.
 */
export function iconForUrl(url) {
  try {
    const path = new URL(url).pathname;
    if (path.startsWith("/admin")) return "/admin-icon-192.png";
    if (path.startsWith("/livreur")) return "/livreur-icon-192.png";
  } catch {
    /* URL invalide : icône par défaut */
  }
  return undefined;
}

/**
 * Normalise un payload push (FCM ou déclaratif) en notification affichable.
 * @param {unknown} payload - JSON du message (ou null si illisible).
 * @param {string} origin
 * @returns {{ title: string, body: string, url: string, icon?: string, image?: string,
 *            badgeCount: number|null, campaignId: string, snackId: string }}
 */
export function parsePushPayload(payload, origin) {
  const p = payload && typeof payload === "object" ? payload : {};
  const n = p.notification && typeof p.notification === "object" ? p.notification : {};
  const data = p.data && typeof p.data === "object" ? p.data : {};
  const declarative = p.web_push === 8030;

  // Destination : actionUrl (deep link campagne) > lien déclaratif > lien FCM > accueil.
  const rawUrl = data.actionUrl || (declarative ? n.navigate : null) || p.fcmOptions?.link || n.click_action;
  const url = toSameOriginUrl(rawUrl, origin);

  const rawBadge = declarative ? n.app_badge : data.badge;
  const badge = Number(rawBadge);
  const badgeCount = rawBadge !== undefined && rawBadge !== null && rawBadge !== "" && Number.isFinite(badge) && badge >= 0
    ? Math.floor(badge)
    : null;

  return {
    title: String(n.title || DEFAULT_TITLE).slice(0, 200),
    body: String(n.body || "").slice(0, 1000),
    url,
    icon: typeof n.icon === "string" && n.icon ? n.icon : iconForUrl(url),
    image: typeof n.image === "string" && n.image ? n.image : undefined,
    badgeCount,
    campaignId: typeof data.campaignId === "string" ? data.campaignId : "",
    snackId: typeof data.snackId === "string" ? data.snackId : "",
  };
}

/**
 * Safari (WebKit) exige une notification visible pour CHAQUE push, même app au
 * premier plan, sous peine de révoquer l'abonnement.
 * @param {string} userAgent
 * @returns {boolean}
 */
export function mustAlwaysShowNotification(userAgent) {
  const ua = String(userAgent || "");
  return /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|Edg|Android)\//.test(ua);
}
