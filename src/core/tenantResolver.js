/**
 * 🏢 tenantResolver.js — Résolution dynamique du tenant SaaS (Mission 4).
 *
 * Détermine le snackId au démarrage sans recompilation :
 * 1. Query Param : ?s=xxx ou ?snack=xxx
 * 2. Path Param  : /s/:slug
 * 3. Sous-domaine: https://mon-snack.monsaas.com
 * 4. Fallback build : window.CURRENT_SNACK_ID ou window.__INITIAL_SNACK_ID__
 *
 * Met en cache la configuration dans sessionStorage (TTL 15 min)
 * pour éviter les facturations répétées de lectures Firestore.
 */

import { db, doc, getDoc, collection, query, where, getDocs } from "./firebase.js";

export const CACHE_KEY_PREFIX = "snack_tenant_config_";
export const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

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

/**
 * Résout la configuration complète du tenant courant et la met en cache.
 *
 * @param {Object} [options]
 * @param {Location|URL} [options.location] - Override de l'URL pour les tests.
 * @param {boolean} [options.forceRefresh=false] - Ignore le cache de session si vrai.
 * @returns {Promise<Object>} Les données de configuration du snack.
 */
export async function resolveCurrentTenant(options = {}) {
    const { location = typeof window !== "undefined" ? window.location : null, forceRefresh = false } = options;

    const identifier = extractTenantIdentifier(location);
    if (!identifier) {
        throw new Error("Impossible de déterminer le snack. Accédez via ?s=mon-snack, /s/mon-snack ou un sous-domaine dédié.");
    }

    const cacheKey = `${CACHE_KEY_PREFIX}${identifier}`;

    // 1. Vérification du cache sessionStorage
    if (!forceRefresh && typeof sessionStorage !== "undefined") {
        try {
            const cachedStr = sessionStorage.getItem(cacheKey);
            if (cachedStr) {
                const cached = JSON.parse(cachedStr);
                if (Date.now() - cached.timestamp < CACHE_TTL_MS && cached.data) {
                    if (typeof window !== "undefined") {
                        window.currentTenant = cached.data;
                    }
                    return cached.data;
                }
            }
        } catch (_) {
            sessionStorage.removeItem(cacheKey);
        }
    }

    // 2. Recherche Firestore
    let tenantData = null;

    // Tentative directe par document ID
    const docSnap = await getDoc(doc(db, "snacks", identifier));
    if (docSnap.exists()) {
        tenantData = { id: docSnap.id, ...docSnap.data() };
    } else {
        // Tentative alternative par slug unique
        const q = query(collection(db, "snacks"), where("slug", "==", identifier));
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
            const matchDoc = querySnap.docs[0];
            tenantData = { id: matchDoc.id, ...matchDoc.data() };
        }
    }

    if (!tenantData) {
        throw new Error(`Snack introuvable pour l'identifiant : ${identifier}`);
    }

    // 3. Persistance en cache
    if (typeof sessionStorage !== "undefined") {
        try {
            sessionStorage.setItem(
                cacheKey,
                JSON.stringify({
                    data: tenantData,
                    timestamp: Date.now(),
                })
            );
        } catch (e) {
            console.warn("[tenantResolver] Impossible d'écrire dans sessionStorage :", e);
        }
    }

    if (typeof window !== "undefined") {
        window.currentTenant = tenantData;
    }

    return tenantData;
}
