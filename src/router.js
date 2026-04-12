// ============================================================================
// 🎮 ROUTEUR D'ÉVÉNEMENTS (Event Delegation)
// ============================================================================

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  event.preventDefault();

  const action = target.getAttribute("data-action");
  const id = target.getAttribute("data-id");

  switch (action) {
    case "switch-home":
      window.triggerVibration?.("light");
      window.switchView("home");
      break;

    case "switch-menu":
      window.triggerVibration?.("light");
      window.switchView("menu");
      break;

    case "open-product-modal":
      window.openProductModal(id);
      break;

    case "update-qty": {
      const delta = parseInt(target.getAttribute("data-delta"));
      window.updateQuantity(id, delta);
      break;
    }

    case "error-toast": {
      const message = target.getAttribute("data-message");
      window.showToast(message, "error");
      break;
    }

    case "open-cart":
      window.openCartModal();
      break;

    case "close-cart":
      window.closeCartModal();
      break;

    case "process-checkout":
      if (!window.processCheckout) {
        await import("./checkout.js");
      }
      window.processCheckout();
      break;

    case "close-product-modal":
      window.closeProductModal();
      break;

    case "add-to-cart":
      window.confirmAddToCart();
      break;

    case "switch-auth-mode":
      window.switchAuthMode();
      break;

    case "toggle-auth-modal":
      window.toggleAuthModal();
      break;

    case "logout-user":
      window.logoutUser();
      break;

    case "open-tracking-modal":
      window.openTrackingModal();
      break;

    case "close-tracking-modal":
      window.closeTrackingModal();
      break;

    case "close-payment-sheet":
      window.closePaymentSheet();
      break;

    case "submit-stripe-payment":
      window.submitStripePayment();
      break;

    case "reset-password":
      window.resetPassword();
      break;

    case "request-notif":
      window.requestNotif();
      break;

    case "call-phone": {
      const phone = target.getAttribute("data-phone");
      if (phone) window.location.href = `tel:${phone}`;
      else window.showToast("Numéro non renseigné", "error");
      break;
    }

    case "open-delivery": {
      const url = target.getAttribute("data-url");
      if (url) window.open(url, "_blank", "noopener");
      else window.showToast("Lien de livraison non configuré", "error");
      break;
    }

    case "open-client-card":
      window.triggerVibration?.("light");
      window.openClientCard();
      break;

    case "notify-arrival":
      window.notifyArrival(id);
      break;

    case "close-client-card":
      window.closeClientCard();
      break;

    case "open-admin-scanner":
      window.openAdminScanner();
      break;

    case "close-admin-scanner":
      window.closeAdminScanner();
      break;
  }
});

document.addEventListener("change", (event) => {
  if (event.target.name === "formule") {
    window.toggleDrinkSection();
  }
  if (event.target.name === "taille_produit") {
    window.updateProductSize(event.target);
  }
  if (event.target.classList.contains("sauce-checkbox")) {
    const max = parseInt(event.target.getAttribute("data-max")) || 2;
    window.checkSauceLimit(event, max);
  }
});
