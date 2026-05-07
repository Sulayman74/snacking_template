// ============================================================================
// 🎁 CARTE FIDÉLITÉ & NOTIFICATIONS
// ============================================================================
// Dépendances : window.auth, window.fs, window.db
//               window.showToast, window.triggerVibration, window.snackConfig
//               window.authTools (getToken), window.messaging

let unsubscribeClientCard = null;

function openClientCard() {
  const user = window.auth?.currentUser;
  if (!user) return;

  const cfg = window.snackConfig;

  // 🔔 GESTION DU BOUTON NOTIFICATIONS
  const notifBtn = document.getElementById("promo-notif-btn");
  if (notifBtn) {
    if (Notification.permission === "default") {
      notifBtn.classList.remove("hidden");
    } else {
      notifBtn.classList.add("hidden");
    }
  }

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
  if (qrImg)
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${user.uid}`;

  // 3. Affichage de la modale avec animation
  const modal = document.getElementById("client-card-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    setTimeout(() => {
      modal.classList.remove("opacity-0");
      const vCard = document.getElementById("virtual-card");
      if (vCard) vCard.classList.remove("scale-95");
    }, 10);

    document.body.style.overflow = "hidden";
  }

  // 4. Écouteur temps réel des points
  const { doc, onSnapshot } = window.fs;
  const db = window.db;

  if (typeof unsubscribeClientCard === "function") unsubscribeClientCard();

  const currentSnackId = window.snackConfig?.identity?.id;
  unsubscribeClientCard = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
    if (docSnap.exists()) {
      const points = (docSnap.data().pointsBySnack || {})[currentSnackId] || 0;
      animerCarteFidelite(points);
    }
  });
}

function animerCarteFidelite(points) {
  const maxPoints = 10;
  const ratio = Math.min((points / maxPoints) * 100, 100);

  const pointsText = document.getElementById("card-points");
  const progressBar = document.getElementById("card-progress-bar");
  const progressLabel = document.getElementById("progress-text");
  const giftIcon = document.getElementById("gift-icon");

  if (pointsText) pointsText.innerText = points;
  if (progressBar) progressBar.style.width = `${ratio}%`;

  if (points >= maxPoints) {
    if (progressLabel) {
      progressLabel.innerText = "🎉 MENU OFFERT ! PRÉSENTEZ CE CODE";
      progressLabel.classList.add("text-green-300", "animate-pulse");
    }
    if (giftIcon) giftIcon.classList.add("animate-bounce", "text-green-300");
    if (typeof window.triggerVibration === "function")
      window.triggerVibration("jackpot");
  } else {
    const restants = maxPoints - points;
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
  const vCard = document.getElementById("virtual-card");
  if (vCard) vCard.classList.add("scale-95");

  setTimeout(() => {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }, 300);
}

async function requestNotif() {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      const registration = await navigator.serviceWorker.ready;
      const { getToken } = window.authTools;
      const { updateDoc, doc } = window.fs;
      const db = window.db;
      const messaging = window.messaging;

      const currentToken = await getToken(messaging, {
        vapidKey:
          "BGsq0EjCQPNq2_r5LC-41oxktxZtCfBCD0GvYjiKV7n2HgEOwKWnFGwgddQfPl9ZoFi6z8AvSM1rQUJkxa1-098",
        serviceWorkerRegistration: registration,
      });

      if (currentToken) {
        const user = window.auth.currentUser;
        if (user)
          await updateDoc(doc(db, "users", user.uid), { fcmToken: currentToken });

        const notifBtn = document.getElementById("promo-notif-btn");
        if (notifBtn) notifBtn.classList.add("hidden");
        window.showToast("🔔 Parfait ! Vous recevrez nos promos.", "success");
      }
    } else {
      window.showToast("Notifications refusées.", "error");
      const notifBtn = document.getElementById("promo-notif-btn");
      if (notifBtn) notifBtn.classList.add("hidden");
    }
  } catch (error) {
    console.error("❌ Erreur : ", error);
  }
}

// Re-fetch silencieux du FCM token. Couvre le cas où l'utilisateur a déjà
// "granted" la permission mais où le token Firestore est devenu stale
// (PWA réinstallée, SW changé, token invalidé par FCM puis nettoyé en base).
async function syncFcmToken() {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const user = window.auth?.currentUser;
  if (!user) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const { getToken } = window.authTools;
    const { doc, getDoc, updateDoc } = window.fs;
    const db = window.db;
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
  const user = window.auth?.currentUser;
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
window.syncFcmToken = syncFcmToken;
window.shareReferralLink = shareReferralLink;
