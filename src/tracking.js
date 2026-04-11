// ============================================================================
// 📡 TRACKING DE COMMANDE EN TEMPS RÉEL
// ============================================================================
// Dépendances : window.fs (onSnapshot, doc, updateDoc, serverTimestamp)
//               window.db, window.snackConfig
//               window.showToast, window.triggerVibration
//               window.switchView, window.closeProductModal, window.closeCartModal

// ============================================================================
// 🎟️ GESTION DE L'UI DE LA MODALE TRACKING
// ============================================================================
function openTrackingModal() {
  const modal = document.getElementById("order-tracking-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector(".bg-white").classList.remove("scale-95");
  }, 10);
}

function closeTrackingModal() {
  const modal = document.getElementById("order-tracking-modal");
  modal.classList.add("opacity-0");
  modal.querySelector(".bg-white").classList.add("scale-95");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
}

window.openTrackingModal = openTrackingModal;
window.closeTrackingModal = closeTrackingModal;

// ============================================================================
// 📡 NOTIFICATION ARRIVÉE (POUR LE CHEF)
// ============================================================================
async function notifyArrival(orderId) {
  try {
    const btn = document.getElementById("tracking-action-btn");
    if (!btn) return;

    btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Transmission au chef...`;
    btn.disabled = true;

    const { doc, updateDoc } = window.fs;
    const db = window.db;

    await updateDoc(doc(db, "commandes", orderId), {
      statut: "nouvelle",
      dateArriveeClient: window.fs.serverTimestamp(),
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

  unsubscribeClientRadar = window.fs.onSnapshot(
    window.fs.doc(window.db, "commandes", orderId),
    (docSnap) => {
      if (docSnap.exists()) {
        const commande = docSnap.data();

        // ⚪ STATUT 1 : EN ATTENTE DU CLIENT
        if (commande.statut === "en_attente_client") {
          trackingBadge.className =
            "hidden md:flex fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-full shadow-xl font-black items-center gap-3 z-[60] transition-all hover:scale-105";
          badgeText.textContent = "En attente de votre arrivée";

          iconContainer.className =
            "w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500";
          icon.className =
            "fas fa-car text-5xl text-gray-500 transition-transform duration-500 animate-pulse";
          title.textContent = "Commande reçue !";
          title.className = "text-3xl font-black text-gray-900 tracking-tight";
          subtitle.innerHTML =
            "Cliquez ci-dessous quand vous êtes <b>à 5 minutes</b> pour qu'on lance la cuisson.";

          if (actionBtn) {
            actionBtn.innerHTML =
              "<i class='fas fa-car mr-2' aria-hidden='true'></i> Je suis à 5 min / Sur place";
            actionBtn.className =
              "w-full bg-blue-600 text-white font-black py-4 rounded-xl text-lg shadow-lg hover:bg-blue-700 transition active:scale-95";
            actionBtn.setAttribute("aria-label", "Signaler mon arrivée au restaurant pour lancer la cuisson");
            actionBtn.removeAttribute("onclick");
            actionBtn.setAttribute("data-action", "notify-arrival");
            actionBtn.setAttribute("data-id", orderId);
          }
        }
        // 🟡 STATUT 2 : NOUVELLE (En préparation)
        else if (commande.statut === "nouvelle") {
          trackingBadge.className =
            "hidden md:flex fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-white px-6 py-3 rounded-full shadow-[0_10px_25px_rgba(234,179,8,0.5)] font-black items-center gap-3 z-[60] transition-all hover:scale-105 animate-bounce";
          badgeText.textContent = "Commande en cours";

          iconContainer.className =
            "w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500";
          icon.className =
            "fas fa-fire text-5xl text-yellow-500 transition-transform duration-500 animate-pulse";
          title.textContent = "En cuisine !";
          title.className = "text-3xl font-black text-gray-900 tracking-tight";
          subtitle.textContent = "Le chef prépare votre commande.";

          if (actionBtn) {
            actionBtn.textContent = "Super, j'attends !";
            actionBtn.className =
              "w-full bg-gray-900 text-white font-black py-4 rounded-xl text-lg shadow-lg hover:bg-black transition active:scale-95";
            actionBtn.setAttribute("aria-label", "Fermer la fenêtre de suivi de commande");
            actionBtn.removeAttribute("onclick");
            actionBtn.setAttribute("data-action", "close-tracking-modal");
            actionBtn.removeAttribute("data-id");
          }
        }

        // 🟢 STATUT : PRÊTE
        else if (commande.statut === "prete") {
          trackingBadge.className =
            "hidden md:flex fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-8 py-4 rounded-full shadow-[0_10px_30px_rgba(22,163,74,0.6)] font-black items-center gap-3 z-[60] transition-all hover:scale-105 animate-pulse";
          badgeText.textContent = "C'EST PRÊT !";

          iconContainer.className =
            "w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner transition-colors duration-500 scale-110";
          icon.className =
            "fas fa-check text-5xl text-green-600 transition-transform duration-500";
          title.textContent = "C'est prêt !";
          title.className = "text-4xl font-black text-green-600 tracking-tight";
          subtitle.textContent = "Présentez-vous au comptoir pour la récupérer.";

          if (actionBtn) {
            actionBtn.innerHTML =
              "<i class='fas fa-running mr-2' aria-hidden='true'></i> J'arrive au comptoir !";
            actionBtn.className =
              "w-full bg-green-600 text-white font-black py-4 rounded-xl text-lg shadow-lg hover:bg-green-700 transition active:scale-95";
            actionBtn.setAttribute("aria-label", "Fermer la fenêtre. Commande prête à être retirée.");
            actionBtn.removeAttribute("onclick");
            actionBtn.setAttribute("data-action", "close-tracking-modal");
            actionBtn.removeAttribute("data-id");
          }

          window.showToast("🔔 DING ! Votre commande est PRÊTE !", "success");
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

          openTrackingModal();
        }

        // ⚪ STATUT : TERMINÉE
        else if (commande.statut === "terminee") {
          window.showToast("Bon appétit ! À bientôt.", "success");
          localStorage.removeItem("activeOrderId");

          if (trackingBadge) trackingBadge.className = "hidden";

          try { closeTrackingModal(); } catch (e) {}

          if (unsubscribeClientRadar) {
            unsubscribeClientRadar();
            unsubscribeClientRadar = null;
          }
        }
      }
    },
  );
}

window.startOrderTracking = startOrderTracking;

// ============================================================================
// 🔄 PAUSE / REPRISE DU RADAR (visibilitychange)
// ============================================================================
document.addEventListener("visibilitychange", () => {
  const activeOrderId = localStorage.getItem("activeOrderId");
  if (!activeOrderId) return;

  if (document.hidden) {
    if (unsubscribeClientRadar) {
      unsubscribeClientRadar();
      unsubscribeClientRadar = null;
      console.log("🔴 Radar Client EN PAUSE (Économie de requêtes).");
    }
  } else {
    if (window.snackConfig?.features?.enableClickAndCollect) {
      console.log("📡 Reprise du tracking pour la commande :", activeOrderId);
      startOrderTracking(activeOrderId);
    }
  }
});

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
