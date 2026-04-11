// ============================================================================
// 📸 SCANNER QR CODE (Admin - Fidélité)
// ============================================================================
// Dépendances : window.fs (doc, getDoc, updateDoc, increment)
//               window.db, window.snackConfig
//               window.showToast, window.triggerVibration

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
    alert("ERREUR CAMÉRA : " + (err.message || err));
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
    const { doc, getDoc, updateDoc, increment } = window.fs;
    const db = window.db;

    const clientRef = doc(db, "users", decodedText);
    const clientDoc = await getDoc(clientRef);

    if (!clientDoc.exists()) {
      window.showToast("❌ Erreur : Ce QR Code n'est pas dans notre base.", "error");
      return;
    }

    const clientData = clientDoc.data();
    if (clientData.snackId !== adminSnackId) {
      window.showToast("⚠️ Ce client appartient à un autre établissement !", "error");
      return;
    }

    const currentPoints = clientDoc.data().points || 0;
    const maxPoints = 10;

    if (currentPoints >= maxPoints) {
      await updateDoc(clientRef, { points: 0 });
      window.showToast("🎉 BINGO ! Donnez un Menu Gratuit ! (Carte remise à 0)", "success");
    } else {
      await updateDoc(clientRef, { points: increment(1) });
      const newTotal = currentPoints + 1;
      if (newTotal === maxPoints) {
        window.showToast(`✅ Point ajouté ! Le client gagne son menu ! 🎁`, "success");
      } else {
        window.showToast(`✅ Point ajouté ! Total actuel : ${newTotal}/${maxPoints}`, "success");
      }
    }
  } catch (error) {
    console.error("❌ Erreur critique lors du scan :", error);
    window.showToast("Erreur de communication avec le serveur.", "error");
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
