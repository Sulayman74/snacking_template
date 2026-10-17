/**
 * 🏢 tenantIdentifier.js — Extraction pure de l'identifiant tenant (sans dépendance Firebase).
 */

/**
 * Extrait l'identifiant (id ou slug) du snack depuis l'environnement d'exécution (URL, sous-domaine).
 *
 * @param {Location|URL} [loc=window.location] - Objet URL ou Location pour faciliter les tests.
 * @returns {string|null} L'identifiant trouvé ou null.
 */
export function extractTenantIdentifier(loc = typeof window !== "undefined" ? window.location : null) {
  if (!loc) return null;

  const url = new URL(loc.href || loc.toString(), "http://localhost");

  // 1. Query Param (?s=... ou ?snack=...)
  const queryParam = url.searchParams.get("s") || url.searchParams.get("snack");
  if (queryParam) return queryParam.trim();

  // 2. Path Param (/s/mon-snack/...)
  const pathParts = url.pathname.split("/").filter(Boolean);
  const sIndex = pathParts.indexOf("s");
  if (sIndex !== -1 && pathParts[sIndex + 1]) {
    return pathParts[sIndex + 1].trim();
  }

  // 3. Sous-domaine (ex: tacos-king.monsaas.com)
  const hostname = url.hostname || "";
  const rootDomains = ["localhost", "127.0.0.1", "web.app", "firebaseapp.com"];
  const isRoot = rootDomains.some((root) => hostname.endsWith(root));

  if (!isRoot) {
    const parts = hostname.split(".");
    if (parts.length >= 3 && parts[0] !== "www" && parts[0] !== "app") {
      return parts[0].trim();
    }
  }

  // 4. Fallback statique optionnel au build
  if (typeof window !== "undefined") {
    if (window.__INITIAL_SNACK_ID__) return window.__INITIAL_SNACK_ID__;
    if (window.CURRENT_SNACK_ID) return window.CURRENT_SNACK_ID;
  }

  return null;
}
