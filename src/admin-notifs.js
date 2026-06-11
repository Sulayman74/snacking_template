// ============================================================================
// 🔔 ADMIN-NOTIFS — Activation guidée des alertes "nouvelle commande" (push)
// ============================================================================
// Le push est ENVOYÉ par la Cloud Function notifyAdminsOnNewOrder. Ici on gère
// seulement l'OPT-IN côté cuisine : permission + enregistrement du fcmToken sur
// users/{uid} (autorisé par les règles : owner peut écrire fcmToken).
// Dépendances : window.messaging, window.showToast.
import { auth, db, doc, updateDoc, getToken } from "./core/firebase.js";

const VAPID_KEY =
  "BGsq0EjCQPNq2_r5LC-41oxktxZtCfBCD0GvYjiKV7n2HgEOwKWnFGwgddQfPl9ZoFi6z8AvSM1rQUJkxa1-098";

const banner = () => document.getElementById("admin-notif-banner");
const showBanner = () => banner()?.classList.remove("translate-y-32", "opacity-0", "pointer-events-none");
const hideBanner = () => banner()?.classList.add("translate-y-32", "opacity-0", "pointer-events-none");

async function writeToken() {
  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(window.messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: reg,
  });
  const uid = auth?.currentUser?.uid;
  if (token && uid) {
    await updateDoc(doc(db, "users", uid), { fcmToken: token });
  }
  return token;
}

// Clic "Activer" → demande la permission puis enregistre le token.
async function enableAdminNotifs() {
  try {
    if (!("Notification" in window)) return window.showToast?.("Notifications non supportées.", "error");
    if (Notification.permission === "denied") {
      return window.showToast?.("Notifications bloquées. Activez-les dans les réglages du navigateur.", "error");
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return window.showToast?.("Notifications refusées.", "error");
    const token = await writeToken();
    window.showToast?.(token ? "Alertes activées 🔔" : "Jeton indisponible, réessayez.", token ? "success" : "error");
  } catch (e) {
    console.error("Erreur activation alertes admin :", e);
    window.showToast?.("Erreur lors de l'activation des alertes.", "error");
  } finally {
    hideBanner();
  }
}

// Appelé après l'authentification admin : propose l'opt-in OU re-sync le token.
async function maybePromptAdminNotifs() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try { await writeToken(); } catch (e) { console.warn("sync token admin:", e?.message); }
  } else if (Notification.permission === "default") {
    setTimeout(showBanner, 1500);
  }
}

export function initAdminNotifs() {
  document.getElementById("admin-notif-btn")?.addEventListener("click", enableAdminNotifs);
  document.getElementById("admin-notif-close")?.addEventListener("click", hideBanner);
  window.maybePromptAdminNotifs = maybePromptAdminNotifs;
}
