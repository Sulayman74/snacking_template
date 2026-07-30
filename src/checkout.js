// ============================================================================
// 💳 CHECKOUT — Stripe, Commande Firebase (Refactored to Web Component)
// ============================================================================

window.processCheckout = async function() {
  const checkoutElement = document.getElementById("snack-checkout");
  if (checkoutElement) {
    await checkoutElement.processCheckout();
  } else {
    console.error("snack-checkout component not found");
  }
};

window.openPaymentSheet = function() {
  const checkoutElement = document.getElementById("snack-checkout");
  if (checkoutElement) checkoutElement.openPaymentSheet();
};

window.closePaymentSheet = function() {
  const checkoutElement = document.getElementById("snack-checkout");
  if (checkoutElement) checkoutElement.closePaymentSheet();
};

window.submitStripePayment = async function() {
  const checkoutElement = document.getElementById("snack-checkout");
  if (checkoutElement) await checkoutElement.submitStripePayment();
};

window.finalizeOrderInFirestore = async function(paymentId) {
  const checkoutElement = document.getElementById("snack-checkout");
  if (checkoutElement) await checkoutElement.finalizeOrderInFirestore(paymentId);
};

if (import.meta.env.VITE_E2E_TESTING) {
  window.setGuestEmailForTest = (email) => {
    const checkoutElement = document.getElementById("snack-checkout");
    if (checkoutElement) {
      checkoutElement.guestEmail = email;
    }
  };
}
