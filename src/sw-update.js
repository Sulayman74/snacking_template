// ============================================================================
// 🔄 sw-update — Enregistrement SW + prompt de mise à jour (DRY)
// ============================================================================
// Pattern "prompt" partagé par les 3 surfaces PWA (client, livreur, admin) :
// on NE recharge JAMAIS automatiquement (un paiement, une photo de preuve ou
// un coup de feu en cuisine ne doivent pas être interrompus). registerSW
// déclenche onNeedRefresh → on affiche le bandeau #pwa-update-banner, et c'est
// l'utilisateur qui décide. updateSW(true) gère skipWaiting + reload proprement.
//
// La page doit fournir : #pwa-update-banner, #pwa-refresh-btn, #pwa-close-update-btn.
import { registerSW } from "virtual:pwa-register";

export function setupSWUpdatePrompt({ context = "App" } = {}) {
  const toggle = (show) => {
    const banner = document.getElementById("pwa-update-banner");
    if (!banner) return;
    banner.classList.toggle("translate-y-32", !show);
    banner.classList.toggle("opacity-0", !show);
    banner.classList.toggle("pointer-events-none", !show);
    if (show && typeof window.triggerVibration === "function") window.triggerVibration("light");
  };

  const updateSW = registerSW({
    onNeedRefresh() {
      toggle(true);
    },
    onRegisteredSW(swUrl) {
      console.log(`🚀 ${context} PWA: Service Worker prêt`, swUrl);
    },
    onRegisterError(err) {
      console.error(`❌ ${context} PWA: échec SW`, err);
    },
  });

  document.getElementById("pwa-refresh-btn")?.addEventListener("click", () => {
    toggle(false);
    updateSW(true); // skipWaiting + reload géré par virtual:pwa-register
  });
  document.getElementById("pwa-close-update-btn")?.addEventListener("click", () => toggle(false));

  return updateSW;
}
