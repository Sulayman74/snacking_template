// ============================================================================
// 🔔 push-register — enregistrement du push de CET appareil (client/admin/livreur)
// ============================================================================
// Un seul chemin pour les 3 surfaces : token FCM obtenu sur le SW unique
// (src/sw.js), puis enregistré côté serveur par le callable registerPushToken
// → pushSubscriptions/{sha256(token)} rattaché au snack et à l'app. Les
// Functions ciblent ainsi le BON site, sur TOUS les appareils de l'utilisateur.
import { auth, db, doc, updateDoc, getToken, functions, httpsCallable } from "./core/firebase.js";

export const VAPID_KEY =
  "BGsq0EjCQPNq2_r5LC-41oxktxZtCfBCD0GvYjiKV7n2HgEOwKWnFGwgddQfPl9ZoFi6z8AvSM1rQUJkxa1-098";

// Callable absent (Functions pas encore déployées) ou injoignable : on retombe
// sur l'ancien champ users.fcmToken pour ne perdre aucune notification.
const FALLBACK_CODES = ["functions/not-found", "functions/unavailable", "functions/internal"];

/**
 * Récupère le token push de l'appareil et l'enregistre pour ce snack / cette app.
 * La permission de notification doit déjà être accordée.
 * @param {{ messaging: object, snackId: string, app: "client"|"admin"|"livreur" }} opts
 * @returns {Promise<string|null>} le token, ou null si indisponible.
 */
export async function registerDevicePush({ messaging, snackId, app }) {
  const user = auth?.currentUser;
  if (!messaging || !snackId || !user) return null;

  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return null;

  try {
    await httpsCallable(functions, "registerPushToken")({ token, snackId, app });
  } catch (err) {
    if (!FALLBACK_CODES.includes(err?.code)) throw err;
    console.warn("registerPushToken indisponible, repli sur users.fcmToken :", err?.code);
    await updateDoc(doc(db, "users", user.uid), { fcmToken: token });
  }
  return token;
}

const SYNC_KEY = "pushRegistration";
const RESYNC_MS = 7 * 24 * 60 * 60 * 1000; // garde l'abonnement « vivant » (TTL serveur 60 j)

/**
 * Re-synchronisation silencieuse au démarrage (permission déjà accordée) :
 * n'appelle le serveur que si le token / compte / snack a changé, ou 1×/semaine.
 * Ne lève jamais.
 * @param {{ messaging: object, snackId: string, app: "client"|"admin"|"livreur" }} opts
 */
export async function syncDevicePush({ messaging, snackId, app }) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const user = auth?.currentUser;
    if (!messaging || !snackId || !user) return;

    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return;

    const key = `${user.uid}|${snackId}|${app}|${token}`;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); } catch { /* stockage indisponible */ }
    if (last?.key === key && Date.now() - last.at < RESYNC_MS) return;

    await registerDevicePush({ messaging, snackId, app });
    try { localStorage.setItem(SYNC_KEY, JSON.stringify({ key, at: Date.now() })); } catch { /* idem */ }
  } catch (err) {
    console.warn("Sync push silencieuse échouée :", err?.message || err);
  }
}
