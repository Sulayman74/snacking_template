// ============================================================================
// 🔔 ADMIN-NOTIFS — Activation guidée des alertes "nouvelle commande" (push)
// ============================================================================
// Le push est ENVOYÉ par la Cloud Function notifyAdminsOnNewOrder. Ici on gère
// seulement l'OPT-IN côté cuisine : permission + enregistrement de l'appareil
// (callable registerPushToken, cf. src/push-register.js).
// Dépendances : window.messaging, window.showToast.
import { registerDevicePush, syncDevicePush } from "./push-register.js";

const banner = () => document.getElementById("admin-notif-banner");
const showBanner = () => banner()?.classList.remove("translate-y-32", "opacity-0", "pointer-events-none");
const hideBanner = () => banner()?.classList.add("translate-y-32", "opacity-0", "pointer-events-none");

// Superadmin qui pilote un resto : pas d'alertes cuisine sur son compte.
const pushOpts = () =>
  window.isSuperadminImpersonating
    ? null
    : { messaging: window.messaging, snackId: window.currentAdminSnackId, app: "admin" };

async function writeToken() {
  const opts = pushOpts();
  return opts ? registerDevicePush(opts) : null;
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
    const opts = pushOpts();
    if (opts) await syncDevicePush(opts);
  } else if (Notification.permission === "default") {
    setTimeout(showBanner, 1500);
  }
}

export function initAdminNotifs() {
  document.getElementById("admin-notif-btn")?.addEventListener("click", enableAdminNotifs);
  document.getElementById("admin-notif-close")?.addEventListener("click", hideBanner);
  window.maybePromptAdminNotifs = maybePromptAdminNotifs;
}
