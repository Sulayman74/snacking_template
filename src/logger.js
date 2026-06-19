// ============================================================================
// 🐛 LOGGER CENTRALISÉ (MYSAAS HQ)
// ============================================================================
// Envoie discrètement les erreurs critiques ou événements importants 
// vers Firestore pour le monitoring SuperAdmin.
import {
    auth,
    db,
    collection,
    addDoc,
    serverTimestamp,
} from "./core/firebase.js";

export async function logError(action, message, details = {}) {
    try {
        if (!db) return; // Firestore pas encore prêt

        const snackId = window.snackConfig?.identity?.id || window.currentAdminSnackId || "inconnu";
        const userId = auth?.currentUser?.uid || "anonyme";
        
        const logEntry = {
            snackId,
            userId,
            action,
            message,
            details: JSON.stringify(details),
            level: "error", // info, warning, error
            timestamp: serverTimestamp(),
            userAgent: navigator.userAgent
        };

        await addDoc(collection(db, "system_logs"), logEntry);
        console.log("📡 [SaaS Logger] Erreur remontée au QG.");
    } catch (e) {
        // Fallback silencieux : on ne veut pas qu'un plantage du logger casse l'app.
        console.error("Échec du Logger Central:", e);
    }
}

// Rendre disponible globalement
window.logError = logError;

// ============================================================================
// 📊 EVENTS ANALYTIQUES UI (funnel client) — LOT 1 roadmap
// ============================================================================
// Émet les événements de parcours côté client (view_product, add_to_cart,
// begin_checkout) dans la collection `events` (même schéma que le serveur, cf.
// functions/lib/events.js). GARDÉ par le flag tenant `features.enableAnalyticsEvents`
// (défaut OFF) : un tenant doit l'activer (volume + coût d'écriture Firestore).
// Fire-and-forget STRICT, sans PII (uid seulement, jamais l'email).
const EVENT_TYPES_CLIENT = new Set(["view_product", "add_to_cart", "begin_checkout"]);
const EVENT_TTL_DAYS = 90;

export async function logEvent(type, props = {}) {
  try {
    if (!db) return;
    if (!EVENT_TYPES_CLIENT.has(type)) return;
    const cfg = window.snackConfig || window.store?.state?.config;
    // Opt-in tenant : rien n'est écrit tant que le flag n'est pas explicitement vrai.
    if (!cfg?.features?.enableAnalyticsEvents) return;
    const snackId = cfg?.identity?.id;
    if (!snackId) return;

    await addDoc(collection(db, "events"), {
      snackId,
      type,
      uid: auth?.currentUser?.uid || null,
      ...props,
      ts: serverTimestamp(),
      // Date → Firestore Timestamp (auto). Sert la TTL policy de rétention bornée.
      ttlAt: new Date(Date.now() + EVENT_TTL_DAYS * 86_400_000),
    });
  } catch (e) {
    // Silencieux : l'analytique ne doit jamais perturber le parcours.
  }
}

window.logEvent = logEvent;
