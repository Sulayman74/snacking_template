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

let html5Qrcode = null;

window.openAdminScanner = async () => {
  const modal = document.getElementById("admin-scanner-modal");
  modal.classList.remove("hidden");

  // On laisse la modale s'afficher correctement (taille 0x0)
  await new Promise((resolve) => setTimeout(resolve, 150));

  try {
    if (!window.Html5Qrcode) {
      window.showToast("Chargement de la caméra...", "info");

      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://unpkg.com/html5-qrcode";
        script.type = "text/javascript";
        script.onload = resolve;
        script.onerror = () => reject("Impossible de charger le script QR Code");
        document.body.appendChild(script);
      });
    }

    html5Qrcode = new window.Html5Qrcode("reader");

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
    const { points, max, reward } = res.data || {};

    if (reward) {
      window.showToast("🎉 BINGO ! Donnez un Menu Gratuit ! (Carte remise à 0)", "success");
    } else if (points === max) {
      window.showToast("✅ Point ajouté ! Le client gagne son menu ! 🎁", "success");
    } else {
      window.showToast(`✅ Point ajouté ! Total actuel : ${points}/${max}`, "success");
    }
  } catch (error) {
    console.error("❌ Erreur scan fidélité :", error);
    // Les HttpsError du serveur exposent un message lisible (QR inconnu, cooldown…).
    window.showToast(error?.message || "Erreur de communication avec le serveur.", "error");
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
