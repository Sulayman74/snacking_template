// ============================================================================
// 📣 MARKETING — Campagnes Push Notifications
// ============================================================================
// Dépendances : window.currentAdminSnackId, window.adminProducts,
//               window.db, window.fs, window.showToast

// ============================================================================
// 🎯 DROPDOWN PRODUITS POUR LE DEEP LINK MARKETING
// ============================================================================
function populatePushProducts() {
  const select = document.getElementById("push-product-link");
  if (!select) return;

  select.innerHTML =
    '<option value="">📱 Aucune redirection (Ouvre l\'accueil)</option>';
  window.adminProducts.forEach((p) => {
    select.innerHTML += `<option value="${p.id}">🏷️ Promo sur : ${p.nom}</option>`;
  });
}

// ============================================================================
// 🚀 FORMULAIRE DE CAMPAGNE PUSH
// ============================================================================
const pushForm = document.getElementById("push-campaign-form");
if (pushForm) {
  pushForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = document.getElementById("btn-send-push");
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Préparation en cours...`;
    btn.disabled = true;

    try {
      const titre = document.getElementById("push-title").value;
      const message = document.getElementById("push-message").value;
      const cible = document.getElementById("push-target").value;
      const dateSaisie = document.getElementById("push-date").value;
      const selectedProductId = document.getElementById(
        "push-product-link",
      ).value;

      const dateEnvoi = dateSaisie ? new Date(dateSaisie) : new Date();

      // 🪄 DEEP LINK ET RICH NOTIFICATION
      let actionUrl = null;
      let imageUrl = null;
      if (selectedProductId) {
        actionUrl = `?action=product&id=${selectedProductId}`;
        const targetProduct = window.adminProducts.find(
          (p) => p.id === selectedProductId,
        );
        if (
          targetProduct &&
          targetProduct.image &&
          targetProduct.image.trim() !== ""
        ) {
          imageUrl = targetProduct.image;
        }
      }

      const { addDoc, collection, serverTimestamp } = window.fs;

      await addDoc(collection(window.db, "campagnes_push"), {
        snackId: window.currentAdminSnackId,
        titre,
        message,
        cible,
        ...(actionUrl && { actionUrl }),
        ...(imageUrl && { imageUrl }),
        dateCreation: serverTimestamp(),
        dateEnvoiPrevue: dateEnvoi,
        statut: "en_attente",
        stats: { envoye: 0, clics: 0 },
      });

      pushForm.reset();
      window.showToast("✅ Campagne programmée avec succès !", "success");
    } catch (error) {
      console.error("Erreur Push :", error);
      window.showToast("Erreur lors de la programmation de la campagne.", "error");
    } finally {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
  });
}

window.populatePushProducts = populatePushProducts;
