// ============================================================================
// 📸 SCANNER QR CODE (Admin - Fidélité)
// ============================================================================
// Dépendances : window.snackConfig
//               window.showToast, window.triggerVibration
// ⚠️ scanner.js est importé PAR firebase-init.js : on importe donc functions
// directement depuis le SDK (et non via le barrel core/firebase.js) pour éviter
// un cycle firebase-init → scanner → barrel → firebase-init. L'app par défaut
// est déjà initialisée par firebase-init au moment où ces handlers s'exécutent.
import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirestore, doc, getDoc } from "firebase/firestore";

let html5Qrcode = null;
let Html5QrcodeCls = null;

window.openAdminScanner = async () => {
  const modal = document.getElementById("admin-scanner-modal");
  modal.classList.remove("hidden");

  // On laisse la modale s'afficher correctement (taille 0x0)
  await new Promise((resolve) => setTimeout(resolve, 150));

  try {
    // 🔒 Lib chargée depuis le BUNDLE (dépendance npm html5-qrcode), plus depuis
    // unpkg (F5) : supprime le script CDN tiers sans SRI. Import dynamique → code
    // splitting (la caméra n'est chargée que par l'admin qui scanne, cf. perf §8.2).
    if (!Html5QrcodeCls) {
      window.showToast("Chargement de la caméra...", "info");
      ({ Html5Qrcode: Html5QrcodeCls } = await import("html5-qrcode"));
    }

    html5Qrcode = new Html5QrcodeCls("reader");

    await html5Qrcode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
      onScanSuccess,
      onScanFailure,
    );
  } catch (err) {
    console.error("Scanner erreur :", err);
    window.showToast("Erreur d'accès à la caméra", "error");
  }
};

window.closeAdminScanner = async () => {
  document.getElementById("admin-scanner-modal").classList.add("hidden");

  if (html5Qrcode) {
    try {
      if (html5Qrcode.isScanning) {
        await html5Qrcode.stop();
      }
      html5Qrcode.clear();
    } catch (error) {
      console.error("Erreur à la fermeture de la caméra :", error);
    }
  }
};

async function onScanSuccess(decodedText) {
  const adminSnackId = window.snackConfig?.identity?.id;
  console.log(`📸 Scan réussi ! UID du client : ${decodedText}`);

  window.closeAdminScanner();
  if (typeof window.triggerVibration === "function")
    window.triggerVibration("success");
  window.showToast("QR Code lu ! Vérification en cours...", "success");

  try {
    // 🔒 Crédit des points côté SERVEUR (transaction + anti double-scan).
    // L'admin n'écrit plus directement pointsBySnack (cf. firestore.rules).
    const functions = getFunctions(getApp(), "europe-west1");
    const awardLoyaltyPoint = httpsCallable(functions, "awardLoyaltyPoint");
    const res = await awardLoyaltyPoint({ clientUid: decodedText, snackId: adminSnackId });
    const { points, max, reward, rewardsAvailable = 0 } = res.data || {};

    if (reward) {
      // Le palier vient d'être franchi : le menu offert est BANQUÉ (plus de remise
      // à 0 silencieuse), il sera consommé explicitement ci-dessous si l'admin le donne.
      window.showToast("🎉 Palier atteint ! Un menu offert a été crédité.", "success");
    } else {
      window.showToast(`✅ Point ajouté ! Total actuel : ${points}/${max}`, "success");
    }

    // 🎟️ CONSOMMATION TRACÉE : si le client a au moins un menu offert disponible,
    // on propose à l'admin de l'utiliser maintenant (décrément + audit serveur).
    if (rewardsAvailable > 0) {
      await proposeRewardRedemption(functions, decodedText, adminSnackId, rewardsAvailable);
    }
  } catch (error) {
    console.error("❌ Erreur scan fidélité :", error);
    // Les HttpsError du serveur exposent un message lisible (QR inconnu, cooldown…).
    window.showToast(error?.message || "Erreur de communication avec le serveur.", "error");
  }

  // 🎡 Lot de roue gagné en attente ? INDÉPENDANT du crédit de point (qui peut être
  // skippé par le cooldown) → on lit le doc client et on propose de valider le lot.
  await proposeWheelRedemption(decodedText, adminSnackId);
}

/**
 * Si le client a un lot de roue en attente (pendingWheelReward.{snackId}), propose à
 * l'admin de le valider → CF redeemWheelReward (efface le lot + audit). No-op sinon.
 * @param {string} clientUid - uid du client (issu du QR).
 * @param {string} snackId - Snack courant de l'admin.
 * @returns {Promise<void>}
 */
async function proposeWheelRedemption(clientUid, snackId) {
  try {
    const dbRef = getFirestore(getApp());
    const snap = await getDoc(doc(dbRef, "users", clientUid));
    const pending = snap.exists() ? (snap.data().pendingWheelReward || {})[snackId] : null;
    if (!pending?.nom) return;

    const ok = window.confirm(
      `🎡 Ce client a gagné à la roue : ${pending.nom}\nValider le lot (le lui donner) ?`,
    );
    if (!ok) return;

    const functions = getFunctions(getApp(), "europe-west1");
    const redeem = httpsCallable(functions, "redeemWheelReward");
    const res = await redeem({ clientUid, snackId });
    window.showToast(`✅ Lot "${res?.data?.product || pending.nom}" validé !`, "success");
    if (typeof window.triggerVibration === "function") window.triggerVibration("jackpot");
  } catch (error) {
    console.error("❌ Erreur validation lot roue :", error);
    window.showToast(error?.message || "Erreur lors de la validation du lot.", "error");
  }
}

/**
 * Propose à l'admin de consommer un menu offert disponible et, si confirmé, appelle
 * la Cloud Function redeemLoyaltyReward (décrément rewardsAvailable + trace d'audit).
 * @param {import("firebase/functions").Functions} functions - Instance Functions (eu-west1).
 * @param {string} clientUid - uid du client (issu du QR).
 * @param {string} snackId - Snack courant de l'admin.
 * @param {number} available - Nombre de menus offerts disponibles avant consommation.
 * @returns {Promise<void>}
 */
async function proposeRewardRedemption(functions, clientUid, snackId, available) {
  const ok = window.confirm(
    `🎁 Ce client a ${available} menu(s) offert(s).\nEn utiliser un maintenant (offrir le menu) ?`,
  );
  if (!ok) return;

  try {
    const redeemLoyaltyReward = httpsCallable(functions, "redeemLoyaltyReward");
    const res = await redeemLoyaltyReward({ clientUid, snackId });
    const remaining = res?.data?.rewardsAvailable ?? 0;
    window.showToast(
      `✅ Menu offert validé ! Restant : ${remaining}.`,
      "success",
    );
    if (typeof window.triggerVibration === "function") window.triggerVibration("jackpot");
  } catch (error) {
    console.error("❌ Erreur consommation récompense :", error);
    window.showToast(error?.message || "Erreur lors de la validation du menu offert.", "error");
  }
}

function onScanFailure(error) {
  const errorMessage = typeof error === "string" ? error : error?.message || "";

  const isNormalNotFound =
    errorMessage.includes("NotFound") ||
    errorMessage.includes("No MultiFormat Readers") ||
    errorMessage.includes("not found");

  if (isNormalNotFound) return;
  // console.warn("⚠️ Avertissement Scanner (Non bloquant) :", errorMessage);
}
