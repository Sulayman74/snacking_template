// ============================================================================
// 🎁 CARTE FIDÉLITÉ & NOTIFICATIONS
// ============================================================================
// Dépendances : window.showToast, window.triggerVibration, window.snackConfig
//               window.messaging
import {
  auth,
  db,
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  getToken,
} from "./core/firebase.js";

let unsubscribeClientCard = null;

/**
 * Génère le QR de la carte fidélité LOCALEMENT (lib `qrcode` importée à la demande)
 * et l'injecte comme data-URL. Remplace l'ancien appel à api.qrserver.com (fuite de
 * l'uid client vers un tiers + dépendance réseau externe). Best-effort : un échec
 * laisse simplement l'image vide, sans casser l'ouverture de la carte.
 * @param {HTMLImageElement} imgEl - Élément <img> cible du QR.
 * @param {string} data - Donnée encodée (uid client, lu par le scanner admin).
 * @returns {Promise<void>}
 */
async function renderLoyaltyQr(imgEl, data) {
  try {
    const QRCode = (await import("qrcode")).default;
    imgEl.src = await QRCode.toDataURL(String(data), { width: 200, margin: 1 });
  } catch (e) {
    console.error("Erreur génération QR fidélité :", e);
  }
}

function openClientCard() {
  const user = auth?.currentUser;
  if (!user) return;

  const cfg = window.snackConfig;

  // 🔔 GESTION DES 3 ÉTATS DE PERMISSION
  updateNotifUIState();

  // 🔄 Re-sync silencieux du FCM token (cas PWA réinstallée → token devenu invalide)
  syncFcmToken();

  // 1. Mise à jour des textes et du design selon la config SaaS
  if (cfg?.loyalty) {
    const progName = document.getElementById("card-program-name");
    const cardBg = document.getElementById("card-bg-gradient");
    if (progName) progName.innerText = cfg.loyalty.programName;
    if (cardBg)
      cardBg.className = `absolute inset-0 z-0 bg-linear-to-br ${cfg.loyalty.cardDesign.backgroundGradient}`;
  }

  // 2. Identité du client et QR Code
  const userEmail = document.getElementById("card-user-email");
  const qrImg = document.getElementById("card-qr-img");
  if (userEmail) userEmail.innerText = user.email;
  // 🔒 QR généré LOCALEMENT (F5) — auparavant via api.qrserver.com, ce qui envoyait
  // l'uid du client à un tiers. La lib `qrcode` est importée dynamiquement (hors
  // bundle principal : la carte fidélité est ouverte à la demande, cf. perf §8.2).
  if (qrImg) renderLoyaltyQr(qrImg, user.uid);

  // 3. Affichage de la modale avec animation
  const modal = document.getElementById("client-card-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    setTimeout(() => {
      modal.classList.remove("opacity-0");
      // Bottom sheet : on fait remonter le calque (slide-up) au lieu d'un scale.
      document.getElementById("client-card-sheet")?.classList.remove("translate-y-full");
    }, 10);

    document.body.style.overflow = "hidden";
  }

  // 4. Écouteur temps réel des points
  if (typeof unsubscribeClientCard === "function") unsubscribeClientCard();

  const currentSnackId = window.snackConfig?.identity?.id;
  unsubscribeClientCard = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      const rawPoints = (data.pointsBySnack || {})[currentSnackId] || 0;
      const rawAvailable = (data.rewardsAvailable || {})[currentSnackId] || 0;
      animerCarteFidelite(rawPoints, rawAvailable);
      // 🎡 CTA roue de la fortune : récompenses jouables (banque + paliers legacy) +
      // lot déjà gagné en attente. Rendu par le module autonome loyalty-wheel.js.
      const effectiveRewards = rawAvailable + Math.floor(rawPoints / 10);
      window.renderWheelCta?.(effectiveRewards, (data.pendingWheelReward || {})[currentSnackId] || null);
    }
  });
}

/**
 * Anime la carte de fidélité : progression du palier courant + menus offerts banqués.
 * Modèle "report + banque" (LOT F2) : pointsBySnack reste théoriquement dans 0..MAX-1,
 * mais on normalise toute carte "legacy" restée à >= MAX (ancien modèle) pour afficher
 * la récompense implicite sans perte (progress = points % MAX, +floor(points/MAX) menus).
 * @param {number} rawPoints - Valeur brute de pointsBySnack.{snackId}.
 * @param {number} rawAvailable - Valeur brute de rewardsAvailable.{snackId} (menus banqués).
 * @returns {void}
 */
function animerCarteFidelite(rawPoints, rawAvailable = 0) {
  const maxPoints = 10;
  const progress = rawPoints % maxPoints;                          // 0..9
  const available = rawAvailable + Math.floor(rawPoints / maxPoints); // banque + legacy
  const ratio = Math.min((progress / maxPoints) * 100, 100);

  const pointsText = document.getElementById("card-points");
  const progressBar = document.getElementById("card-progress-bar");
  const progressLabel = document.getElementById("progress-text");
  const giftIcon = document.getElementById("gift-icon");

  if (pointsText) pointsText.innerText = progress;
  if (progressBar) progressBar.style.width = `${ratio}%`;

  if (available > 0) {
    const suffix = available > 1 ? ` (x${available})` : "";
    if (progressLabel) {
      progressLabel.innerText = `🎉 MENU OFFERT${suffix} ! PRÉSENTEZ CE CODE`;
      progressLabel.classList.add("text-green-300", "animate-pulse");
    }
    if (giftIcon) giftIcon.classList.add("animate-bounce", "text-green-300");
    if (typeof window.triggerVibration === "function")
      window.triggerVibration("jackpot");
  } else {
    const restants = maxPoints - progress;
    if (progressLabel) {
      progressLabel.innerText = `Encore ${restants} point${restants > 1 ? "s" : ""} avant ta récompense`;
      progressLabel.classList.remove("text-green-300", "animate-pulse");
    }
    if (giftIcon) giftIcon.classList.remove("animate-bounce", "text-green-300");
  }
}

function closeClientCard() {
  const modal = document.getElementById("client-card-modal");
  if (!modal) return;

  if (typeof unsubscribeClientCard === "function") {
    unsubscribeClientCard();
    unsubscribeClientCard = null;
  }

  modal.classList.add("opacity-0");
  // Bottom sheet : on fait redescendre le calque (slide-down).
  document.getElementById("client-card-sheet")?.classList.add("translate-y-full");

  setTimeout(() => {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }, 300);
}

// Synchronise l'UI de la carte fidélité avec l'état réel de Notification.permission.
// 3 états : default → bouton "Activer", granted → tout caché, denied → message info.
function updateNotifUIState() {
  const btn = document.getElementById("promo-notif-btn");
  const deniedInfo = document.getElementById("promo-notif-denied");
  if (!btn || !deniedInfo) return;

  if (!("Notification" in window)) {
    btn.classList.add("hidden");
    deniedInfo.classList.add("hidden");
    return;
  }

  const optOutRow = document.getElementById("promo-optout-row");
  switch (Notification.permission) {
    case "default":
      btn.classList.remove("hidden");
      deniedInfo.classList.add("hidden");
      optOutRow?.classList.add("hidden");
      break;
    case "denied":
      btn.classList.add("hidden");
      deniedInfo.classList.remove("hidden");
      optOutRow?.classList.add("hidden");
      break;
    case "granted":
    default:
      btn.classList.add("hidden");
      deniedInfo.classList.add("hidden");
      // Notifs actives → on propose le réglage opt-out des offres marketing.
      syncOptOutToggle();
      break;
  }
}

// Reflète la préférence pushOptOut sur le toggle (coché = reçoit les offres).
// Visible uniquement si l'utilisateur est connecté ET les notifs sont accordées.
async function syncOptOutToggle() {
  const row = document.getElementById("promo-optout-row");
  const toggle = document.getElementById("promo-optout-toggle");
  if (!row || !toggle) return;
  const user = auth.currentUser;
  if (!user) {
    row.classList.add("hidden");
    return;
  }
  row.classList.remove("hidden");
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const optOut = snap.exists() && snap.data().pushOptOut === true;
    toggle.checked = !optOut; // coché = opt-IN (reçoit les offres)
  } catch (_e) {
    /* lecture best-effort : on laisse l'état par défaut du toggle */
  }
}

// Écrit la préférence d'opt-out marketing. Décoché = opt-out (le transactionnel
// "commande prête" reste actif, géré hors gouvernance). Revert visuel si échec.
async function toggleMarketingOptOut(checkbox) {
  const user = auth.currentUser;
  if (!user) return;
  const optOut = !checkbox.checked;
  try {
    await updateDoc(doc(db, "users", user.uid), { pushOptOut: optOut });
    window.showToast(
      optOut ? "🔕 Offres désactivées." : "🔔 Vous recevrez nos offres.",
      "success",
    );
  } catch (_e) {
    window.showToast("Impossible de mettre à jour la préférence.", "error");
    checkbox.checked = !checkbox.checked; // revert
  }
}

async function requestNotif() {
  // Cas où le navigateur a déjà mémorisé la décision : pas de popup native.
  // On affiche un toast explicite pour que l'utilisateur comprenne ce qui se passe.
  if ("Notification" in window && Notification.permission === "denied") {
    window.showToast(
      "🔕 Notifications bloquées. Activez-les dans les réglages du navigateur.",
      "error"
    );
    updateNotifUIState();
    return;
  }

  try {
    const permission = await Notification.requestPermission();

    if (permission === "granted") {
      const registration = await navigator.serviceWorker.ready;
      const messaging = window.messaging;

      const currentToken = await getToken(messaging, {
        vapidKey:
          "BGsq0EjCQPNq2_r5LC-41oxktxZtCfBCD0GvYjiKV7n2HgEOwKWnFGwgddQfPl9ZoFi6z8AvSM1rQUJkxa1-098",
        serviceWorkerRegistration: registration,
      });

      if (currentToken) {
        const user = auth.currentUser;
        if (user)
          await updateDoc(doc(db, "users", user.uid), { fcmToken: currentToken });
        window.showToast("🔔 Parfait ! Vous recevrez nos promos.", "success");
      } else {
        window.showToast(
          "⚠️ Impossible de récupérer le jeton. Réessayez dans un instant.",
          "error"
        );
      }
    } else if (permission === "denied") {
      window.showToast("Notifications refusées.", "error");
    }
    // permission === "default" = popup fermée sans choix → pas de toast (silencieux)

    updateNotifUIState();
  } catch (error) {
    console.error("❌ Erreur : ", error);
    window.showToast("Erreur lors de l'activation. Réessayez.", "error");
  }
}

// Re-fetch silencieux du FCM token. Couvre le cas où l'utilisateur a déjà
// "granted" la permission mais où le token Firestore est devenu stale
// (PWA réinstallée, SW changé, token invalidé par FCM puis nettoyé en base).
async function syncFcmToken() {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const user = auth?.currentUser;
  if (!user) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const messaging = window.messaging;

    const currentToken = await getToken(messaging, {
      vapidKey:
        "BGsq0EjCQPNq2_r5LC-41oxktxZtCfBCD0GvYjiKV7n2HgEOwKWnFGwgddQfPl9ZoFi6z8AvSM1rQUJkxa1-098",
      serviceWorkerRegistration: registration,
    });

    if (!currentToken) return;

    const userRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userRef);
    const oldToken = userDoc.exists() ? userDoc.data().fcmToken : null;

    if (oldToken !== currentToken) {
      await updateDoc(userRef, { fcmToken: currentToken });
      console.log("🔄 FCM token resynchronisé.");
    }
  } catch (error) {
    console.error("❌ Erreur sync FCM token :", error);
  }
}

async function shareReferralLink() {
  const user = auth?.currentUser;
  if (!user) return;

  const shareData = {
    title: `🍟 Offre une frite chez ${window.snackConfig?.identity?.name || "ton snack préféré"} !`,
    text: `Salut ! Utilise mon lien pour ta première commande et je recevrai 2 points de fidélité. Merci ! 🍟`,
    url: `${window.location.origin}${window.location.pathname}?action=referral&by=${user.uid}`,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(shareData.url);
      window.showToast("Lien de parrainage copié ! 🍟", "success");
    }
  } catch (err) {
    console.error("Erreur partage :", err);
  }
}

window.openClientCard = openClientCard;
window.closeClientCard = closeClientCard;
window.requestNotif = requestNotif;
window.toggleMarketingOptOut = toggleMarketingOptOut;
window.syncFcmToken = syncFcmToken;
window.shareReferralLink = shareReferralLink;
