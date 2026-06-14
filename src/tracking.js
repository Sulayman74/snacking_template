// ============================================================================
// 📡 TRACKING DE COMMANDE EN TEMPS RÉEL
// ============================================================================
// Dépendances : window.snackConfig
//               window.showToast, window.triggerVibration
//               window.switchView, window.closeProductModal, window.closeCartModal

import { haversineKm, formatDistance, isLatLng } from "./services/geoService.js";
import {
  auth,
  db,
  doc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
} from "./core/firebase.js";

// ============================================================================
// 🎟️ GESTION DE L'UI DE LA MODALE TRACKING
// ============================================================================
function openTrackingModal() {
  const modal = document.getElementById("order-tracking-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    const inner = modal.querySelector(".bg-white");
    if (inner) inner.classList.remove("scale-95");
  }, 10);
}

function closeTrackingModal() {
  const modal = document.getElementById("order-tracking-modal");
  if (!modal) return;
  modal.classList.add("opacity-0");
  const inner = modal.querySelector(".bg-white");
  if (inner) inner.classList.add("scale-95");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
}

window.openTrackingModal = openTrackingModal;
window.closeTrackingModal = closeTrackingModal;

// Texte d'ETA intelligent (collect ou livraison) à partir de commande.eta.readyAt
// (calculé serveur dans finalizeOrder). Renvoie "" si indisponible.
function etaText(commande) {
  const readyAt = commande?.eta?.readyAt;
  const t = readyAt?.toDate ? readyAt.toDate() : null;
  if (!t || isNaN(t.getTime())) return "";
  const hh = t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return commande.mode === "delivery" ? `Livraison estimée vers ${hh}` : `Prêt vers ${hh}`;
}

// ============================================================================
// 🔔 PROMPT FCM CONTEXTUEL — "M'avertir quand c'est prêt"
// ============================================================================
// Le timing optimal pour demander la permission notif : après paiement validé,
// quand l'utilisateur attend sa commande. Bénéfice immédiat = meilleur opt-in.
function renderNotifPrompt() {
  const container = document.getElementById("tracking-notif-prompt");
  if (!container) return;

  container.innerHTML = "";

  if (!("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  if (!auth?.currentUser) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "w-full bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-3 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 border-2 border-blue-100 hover:border-blue-300 active:scale-95";
  btn.innerHTML =
    '<i data-lucide="bell"></i><span>M\'avertir quand c\'est prêt</span>';

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML =
      '<i data-lucide="loader-circle" class="animate-spin"></i><span>Activation...</span>';
    try {
      if (typeof window.requestNotif === "function") {
        await window.requestNotif();
      }
    } finally {
      // Re-render : si granted/denied, le bouton disparaît automatiquement
      renderNotifPrompt();
    }
  });

  container.appendChild(btn);
}

// ============================================================================
// 📡 NOTIFICATION ARRIVÉE (POUR LE CHEF)
// ============================================================================
async function notifyArrival(orderId) {
  try {
    const btn = document.getElementById("tracking-action-btn");
    if (!btn) return;

    btn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Transmission au chef...`;
    btn.disabled = true;

    await updateDoc(doc(db, "commandes", orderId), {
      statut: "nouvelle",
      dateArriveeClient: serverTimestamp(),
    });

    window.showToast("C'est noté ! Le chef lance la cuisson 🔥", "success");

    if (typeof window.triggerVibration === "function")
      window.triggerVibration("success");
  } catch (e) {
    console.error("Erreur notifyArrival:", e);
    window.showToast("Erreur lors de la notification du chef.", "error");
    const btn = document.getElementById("tracking-action-btn");
    if (btn) btn.disabled = false;
  }
}

window.notifyArrival = notifyArrival;

// ============================================================================
// 📡 RADAR CLIENT — ÉCOUTE FIREBASE EN TEMPS RÉEL
// ============================================================================
let unsubscribeClientRadar = null;

function startOrderTracking(orderId) {
  const trackingBadge = document.getElementById("order-tracking-badge");
  const badgeText = document.getElementById("badge-text");

  const orderIdText = document.getElementById("tracking-order-id");
  const iconContainer = document.getElementById("tracking-icon-container");
  const icon = document.getElementById("tracking-icon");
  const title = document.getElementById("tracking-title");
  const subtitle = document.getElementById("tracking-subtitle");
  const actionBtn = document.getElementById("tracking-action-btn");

  if (trackingBadge) trackingBadge.classList.remove("hidden");
  if (orderIdText) orderIdText.textContent = "#" + orderId.slice(-4).toUpperCase();

  if (typeof unsubscribeClientRadar === "function") unsubscribeClientRadar();
  console.log("🟢 Radar Client ACTIVÉ :", orderId);

  unsubscribeClientRadar = onSnapshot(
    doc(db, "commandes", orderId),
    (docSnap) => {
      if (docSnap.exists()) {
        const commande = docSnap.data();

        // ⚪ STATUT 1 : EN ATTENTE DU CLIENT
        if (commande.statut === "en_attente_client") {
          if (trackingBadge) {
            trackingBadge.className =
              "hidden md:flex fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-gray-800 text-on-dark px-6 py-3 rounded-full shadow-xl font-black items-center gap-3 z-[60] transition-all hover:scale-105";
          }
          if (badgeText) badgeText.textContent = "En attente de votre arrivée";

          if (iconContainer) {
            iconContainer.className =
              "w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500";
          }
          window.swapIcon?.(icon, "car", "text-5xl text-text-muted transition-transform duration-500 animate-pulse");
          if (title) {
            title.textContent = "Commande reçue !";
            title.className = "text-3xl font-black text-text tracking-tight";
          }
          if (subtitle) {
            subtitle.innerHTML =
              "Cliquez ci-dessous quand vous êtes <b>à 5 minutes</b> pour qu'on lance la cuisson.";
          }

          if (actionBtn) {
            actionBtn.innerHTML =
              "<i data-lucide='car' aria-hidden='true' class='mr-2'></i> Je suis à 5 min / Sur place";
            actionBtn.className =
              "w-full bg-blue-600 text-on-dark font-black py-4 rounded-xl text-lg shadow-lg hover:bg-blue-700 transition active:scale-95";
            actionBtn.setAttribute("aria-label", "Signaler mon arrivée au restaurant pour lancer la cuisson");
            actionBtn.removeAttribute("onclick");
            actionBtn.setAttribute("data-action", "notify-arrival");
            actionBtn.setAttribute("data-id", orderId);
          }
          renderNotifPrompt();
        }
        // 🟡 STATUT 2 : NOUVELLE (En préparation)
        else if (commande.statut === "nouvelle") {
          if (trackingBadge) {
            trackingBadge.className =
              "hidden md:flex fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-on-dark px-6 py-3 rounded-full shadow-[0_10px_25px_rgba(234,179,8,0.5)] font-black items-center gap-3 z-[60] transition-all hover:scale-105 animate-bounce";
          }
          if (badgeText) badgeText.textContent = "Commande en cours";

          if (iconContainer) {
            iconContainer.className =
              "w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500";
          }
          window.swapIcon?.(icon, "flame", "text-5xl text-yellow-500 transition-transform duration-500 animate-pulse");
          if (title) {
            title.textContent = "En cuisine !";
            title.className = "text-3xl font-black text-text tracking-tight";
          }
          if (subtitle) {
            const eta = etaText(commande);
            subtitle.innerHTML = `Le chef prépare votre commande.${
              eta
                ? `<span class="flex items-center justify-center gap-2 mt-3 text-primary font-bold"><i data-lucide="clock"></i> ${eta}</span>`
                : ""
            }`;
          }

          if (actionBtn) {
            actionBtn.textContent = "Super, j'attends !";
            actionBtn.className =
              "w-full bg-gray-900 text-on-dark font-black py-4 rounded-xl text-lg shadow-lg hover:bg-black transition active:scale-95";
            actionBtn.setAttribute("aria-label", "Fermer la fenêtre de suivi de commande");
            actionBtn.removeAttribute("onclick");
            actionBtn.setAttribute("data-action", "close-tracking-modal");
            actionBtn.removeAttribute("data-id");
          }
          renderNotifPrompt();
        }

        // 🟢 STATUT : PRÊTE
        else if (commande.statut === "prete") {
          if (trackingBadge) {
            trackingBadge.className =
              "hidden md:flex fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-green-600 text-on-dark px-8 py-4 rounded-full shadow-[0_10px_30px_rgba(22,163,74,0.6)] font-black items-center gap-3 z-[60] transition-all hover:scale-105 animate-pulse";
          }
          if (badgeText) badgeText.textContent = "C'EST PRÊT !";

          if (iconContainer) {
            iconContainer.className =
              "w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500 scale-110";
          }
          window.swapIcon?.(icon, "check", "text-5xl text-green-600 transition-transform duration-500");
          
          if (title) {
            title.textContent = "C'est prêt !";
            title.className = "text-4xl font-black text-green-600 tracking-tight";
          }
          
          // 🎟️ AFFICHAGE DU CODE SECRET ET NOM CLIENT
          if (subtitle) {
            const escape = window.escapeHTML;
            const secretCode = escape(commande.secretCode || "---");
            const clientDisplay = escape(
              commande.clientNom || commande.clientEmail?.split("@")[0] || "Client"
            );

            subtitle.innerHTML = `
              <div class="mt-6 p-6 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                <p class="text-xs text-text-muted uppercase font-black tracking-widest mb-1">Code de retrait</p>
                <p class="text-5xl font-black text-text mb-2 font-mono tracking-tighter">${secretCode}</p>
                <div class="h-px bg-gray-200 w-12 mx-auto my-3"></div>
                <p class="text-sm font-bold text-text-muted"><i data-lucide="user" class="mr-1 text-text-muted"></i> ${clientDisplay}</p>
              </div>
              <p class="mt-4 text-text-muted font-medium">${
                commande.mode === "delivery"
                  ? "Un livreur va récupérer votre commande. Gardez ce code pour la remise."
                  : "Présentez cet écran au comptoir pour récupérer votre commande."
              }</p>
            `;
          }
          if (actionBtn) {
            const deliv = commande.mode === "delivery";
            actionBtn.innerHTML = deliv
              ? "<i data-lucide='bike' aria-hidden='true' class='mr-2'></i> Super, j'attends le livreur"
              : "<i data-lucide='footprints' aria-hidden='true' class='mr-2'></i> J'arrive au comptoir !";
            actionBtn.className =
              "w-full bg-green-600 text-on-dark font-black py-4 rounded-xl text-lg shadow-lg hover:bg-green-700 transition active:scale-95";
            actionBtn.setAttribute("aria-label", deliv ? "Fermer la fenêtre. Un livreur va arriver." : "Fermer la fenêtre. Commande prête à être retirée.");
            actionBtn.removeAttribute("onclick");
            actionBtn.setAttribute("data-action", "close-tracking-modal");
            actionBtn.removeAttribute("data-id");
          }

          const notifPrompt = document.getElementById("tracking-notif-prompt");
          if (notifPrompt) notifPrompt.innerHTML = "";

          window.showToast("🔔 DING ! Votre commande est PRÊTE !", "success");
          if (typeof window.triggerVibration === "function")
            window.triggerVibration("success");

          openTrackingModal();
        }

        // 🛵 STATUT : EN LIVRAISON (distance live du livreur)
        else if (commande.statut === "en_livraison") {
          if (trackingBadge) {
            trackingBadge.className =
              "hidden md:flex fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-blue-600 text-on-dark px-6 py-3 rounded-full shadow-xl font-black items-center gap-3 z-[60] transition-all hover:scale-105 animate-pulse";
          }
          if (badgeText) badgeText.textContent = "EN LIVRAISON";
          if (iconContainer) {
            iconContainer.className =
              "w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500";
          }
          window.swapIcon?.(icon, "bike", "text-5xl text-blue-600 transition-transform duration-500 animate-pulse");
          if (title) {
            title.textContent = "En livraison !";
            title.className = "text-3xl font-black text-text tracking-tight";
          }
          if (subtitle) {
            const driverPos = commande.livreur?.position;
            const dest = commande.livraison;
            let distLine = "Votre livreur a récupéré la commande, il arrive !";
            if (isLatLng(driverPos) && isLatLng(dest)) {
              distLine = `Votre livreur est à <b class="text-blue-600">${formatDistance(haversineKm(driverPos, dest))}</b> de chez vous.`;
            }
            const driverName = window.escapeHTML(commande.livreur?.nom || "Votre livreur");
            subtitle.innerHTML = `<span class="block text-text-muted">${distLine}</span><span class="block mt-2 text-sm text-text-muted"><i data-lucide="user" class="mr-1"></i>${driverName}</span>`;
          }
          if (actionBtn) {
            actionBtn.innerHTML = "<i data-lucide='check' class='mr-2'></i> Suivre";
            actionBtn.className =
              "w-full bg-gray-900 text-on-dark font-black py-4 rounded-xl text-lg shadow-lg hover:bg-black transition active:scale-95";
            actionBtn.setAttribute("aria-label", "Fermer le suivi de livraison.");
            actionBtn.removeAttribute("onclick");
            actionBtn.setAttribute("data-action", "close-tracking-modal");
            actionBtn.removeAttribute("data-id");
          }
          const notifPrompt = document.getElementById("tracking-notif-prompt");
          if (notifPrompt) notifPrompt.innerHTML = "";
        }

        // 🎉 STATUT : LIVRÉE
        else if (commande.statut === "livree") {
          if (trackingBadge) trackingBadge.className = "hidden";
          if (iconContainer) {
            iconContainer.className =
              "w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner scale-110";
          }
          window.swapIcon?.(icon, "circle-check", "text-5xl text-green-600");
          if (title) {
            title.textContent = "Livré ! 🎉";
            title.className = "text-4xl font-black text-green-600 tracking-tight";
          }
          if (subtitle) {
            const photo = commande.livreur?.dropoffUrl;
            const safe = window.safeURL ? window.safeURL(photo) : photo;
            subtitle.innerHTML = `<p class="text-text-muted font-medium mb-3">Bon appétit ! Merci pour votre commande.</p>${
              photo
                ? `<a href="${safe}" target="_blank" rel="noopener" class="block">
                     <img src="${safe}" alt="Preuve de livraison" class="mx-auto rounded-2xl max-h-48 shadow-md border border-gray-200">
                     <span class="block mt-2 text-xs text-text-muted"><i data-lucide="zoom-in" class="mr-1"></i>Preuve de livraison · toucher pour agrandir</span>
                   </a>`
                : ""
            }`;
          }
          if (actionBtn) {
            actionBtn.innerHTML = "<i data-lucide='thumbs-up' class='mr-2'></i> Parfait, merci !";
            actionBtn.className =
              "w-full bg-green-600 text-on-dark font-black py-4 rounded-xl text-lg shadow-lg hover:bg-green-700 transition active:scale-95";
            actionBtn.setAttribute("aria-label", "Fermer. Commande livrée.");
            actionBtn.removeAttribute("onclick");
            actionBtn.setAttribute("data-action", "close-tracking-modal");
            actionBtn.removeAttribute("data-id");
          }
          openTrackingModal();
          localStorage.removeItem("activeOrderId");
          stopOrderTracking();
        }

        // ⚪ STATUT : TERMINÉE
        else if (commande.statut === "terminee") {
          window.showToast("Bon appétit ! À bientôt.", "success");
          localStorage.removeItem("activeOrderId");

          if (trackingBadge) trackingBadge.className = "hidden";

          try { closeTrackingModal(); } catch (e) {}

          stopOrderTracking();
        }
      }
    },
    (err) => {
      console.error("Radar Client (onSnapshot) erreur :", err);
      window.showToast?.("Suivi interrompu (réseau). Rouvrez la commande pour réessayer.", "error");
    },
  );
}

function stopOrderTracking() {
  if (unsubscribeClientRadar) {
    unsubscribeClientRadar();
    unsubscribeClientRadar = null;
    console.log("🔴 Radar Client ARRÊTÉ.");
  }
}

window.startOrderTracking = startOrderTracking;
window.stopOrderTracking = stopOrderTracking;

// ============================================================================
// 🔙 GESTION NATIVE DU BOUTON RETOUR (iOS / Android swipe back)
// ============================================================================
window.addEventListener("popstate", () => {
  if (window.location.hash !== "#menu") {
    const fullMenu = document.getElementById("full-menu");
    if (fullMenu && !fullMenu.classList.contains("hidden")) {
      window.switchView("home", true);
    }
  }

  try {
    window.closeProductModal(true);
    window.closeCartModal(true);
    closeTrackingModal();
  } catch (e) {
    console.log(e);
  }
});
