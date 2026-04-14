// ============================================================================
// 💳 CHECKOUT — Stripe, Commande Firebase
// ============================================================================
// Dépendances : window.cart, window.getCartTotal, window.closeCartModal,
//               window.toggleAuthModal, window.auth, window.fs, window.db,
//               window.snackConfig, window.showToast, window.triggerVibration,
//               window.startOrderTracking

let stripeElements = null;
let stripeInstance = null;
const stripePublicKey =
  "pk_test_51TG1RfIfiBxoqwsycKUz6o8Mxf5keYpRfFPCgbDE2GkQiz4USCS5tE0lQaO160YDBoXb6mDgWzgzvbosexR6ORKn002PFzjj7J"; // ⚠️ REMPLACE PAR TA CLÉ PUBLIQUE STRIPE (pk_test_...)

async function processCheckout() {
  const cfg = window.snackConfig;
  if (window.cart.length === 0)
    return window.showToast("Votre panier est vide", "error");

  if (!cfg?.features?.enableClickAndCollect) {
    return window.showToast("La commande en ligne est désactivée.", "error");
  }

  const currentUser = window.auth?.currentUser;
  const btn = document.getElementById("checkout-btn");

  if (!currentUser) {
    window.showToast("Veuillez vous connecter pour commander", "error");
    window.toggleAuthModal();
    return;
  }

  const originalText = btn.innerHTML;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Connexion banque...`;
  btn.disabled = true;

  try {
    if (typeof Stripe === "undefined") {
      throw new Error("Stripe n'est pas chargé !");
    }

    if (!stripeInstance) {
      stripeInstance = Stripe(stripePublicKey);
    }

    const totalAmount = window.getCartTotal();

    // 1. Fermer le panier pour éviter les conflits de z-index
    window.closeCartModal();

    // 2. Mettre à jour et ouvrir la modale Stripe EN PREMIER
    document.getElementById("payment-amount-display").textContent =
      `Total : ${totalAmount.toFixed(2)} €`;

    const paymentContainer = document.getElementById("payment-element");
    paymentContainer.innerHTML =
      '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i></div>';

    openPaymentSheet();

    // 3. Demander le PaymentIntent à la Cloud Function
    const { httpsCallable, functions } = window.fs;
    const createPaymentIntent = httpsCallable(functions, "createPaymentIntent");

    const ticketSummary = window.cart
      .map((item) => `${item.quantity}x ${item.nom}`)
      .join(", ");

    const response = await createPaymentIntent({
      amount: Math.round(totalAmount * 100),
      currency: "eur",
      description: `Commande Web - ${cfg.identity.name}`,
      metadata: {
        ticket: ticketSummary.substring(0, 500),
        clientEmail: currentUser.email,
      },
    });

    const clientSecret = response.data.clientSecret;

    // 4. Créer et injecter le formulaire Stripe
    const appearance = { theme: "stripe" };
    stripeElements = stripeInstance.elements({ appearance, clientSecret });

    const paymentElement = stripeElements.create("payment");
    paymentContainer.innerHTML = "";
    paymentElement.mount("#payment-element");
  } catch (error) {
    console.error("❌ Erreur préparation paiement :", error);
    window.showToast("Erreur de connexion sécurisée au paiement.", "error");
    if (typeof closePaymentSheet === "function") closePaymentSheet();
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function openPaymentSheet() {
  const sheet = document.getElementById("payment-bottom-sheet");
  const content = document.getElementById("payment-sheet-content");

  sheet.classList.remove("hidden");
  sheet.classList.add("flex");
  
  // Bloque le scroll du site en arrière-plan
  document.body.style.overflow = "hidden"; 

  setTimeout(() => {
    sheet.classList.remove("opacity-0");
    content.classList.remove("translate-y-full");
  }, 10);
}

function closePaymentSheet() {
  const sheet = document.getElementById("payment-bottom-sheet");
  const content = document.getElementById("payment-sheet-content");

  sheet.classList.add("opacity-0");
  content.classList.add("translate-y-full");
  
  // Libère le scroll
  document.body.style.overflow = ""; 

  setTimeout(() => {
    sheet.classList.add("hidden");
    sheet.classList.remove("flex");
  }, 300);
}

async function submitStripePayment() {
  const submitPaymentBtn = document.getElementById("submit-payment-btn");

  if (!stripeInstance || !stripeElements) {
    window.showToast(
      "Veuillez patienter, connexion sécurisée en cours...",
      "error",
    );
    return;
  }

  const btnOriginalText = submitPaymentBtn.innerHTML;
  submitPaymentBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Vérification banque...`;
  submitPaymentBtn.disabled = true;

  try {
    const { error, paymentIntent } = await stripeInstance.confirmPayment({
      elements: stripeElements,
      confirmParams: {},
      redirect: "if_required",
    });

    if (error) {
      const messageContainer = document.getElementById("payment-message");
      messageContainer.textContent = error.message;
      messageContainer.classList.remove("hidden");
      window.triggerVibration?.("error");
    } else if (paymentIntent && paymentIntent.status === "succeeded") {
      window.showToast("Paiement validé ! 🎉", "success");

      closePaymentSheet();
      await finalizeOrderInFirestore(paymentIntent.id);
    }
  } catch (err) {
    console.error("Erreur critique au moment du paiement :", err);
    window.showToast(
      "Une erreur est survenue avec le terminal de paiement.",
      "error",
    );
  } finally {
    submitPaymentBtn.innerHTML = btnOriginalText;
    submitPaymentBtn.disabled = false;
  }
}

async function finalizeOrderInFirestore(stripePaymentId) {
  const currentSnackId = window.snackConfig?.identity?.id || "Ym1YiO4Ue5Fb5UXlxr06";
  const currentUser = window.auth?.currentUser;
  const { httpsCallable, functions } = window.fs;

  try {
    const cartItems = window.cart.map((item) => ({
      id: item.id,
      productId: item.productId || item.id.split("-")[0],
      nom: item.nom,
      type: item.type || "seul",
      boissonNom: item.boisson || null,
      sauces: item.sauces || [],
      sansCrudites: item.sansCrudites || [],
      tailleChoisie: item.tailleChoisie || null,
      prixBase: item.prixBase || item.prix,
      prixMenuAdd: item.prixMenuAdd || 0,
      quantity: item.quantity,
    }));

    // Montant en centimes pour vérification côté serveur
    const totalCents = Math.round(window.getCartTotal() * 100);

    const finalizeOrder = httpsCallable(functions, "finalizeOrder");
    const result = await finalizeOrder({
      paymentIntentId: stripePaymentId,
      snackId: currentSnackId,
      cartItems,
      totalCents,
      clientEmail: currentUser.email,
      clientNom: currentUser.displayName || currentUser.email.split("@")[0],
    });

    const orderId = result.data.orderId;

    window.cart.splice(0, window.cart.length);
    window.triggerVibration?.("jackpot");

    if (window.snackConfig?.features?.enableClickAndCollect) {
      localStorage.setItem("activeOrderId", orderId);
      window.startOrderTracking(orderId);
    }
    setTimeout(() => {
    window.openTrackingModal();
  }, 500);
  } catch (err) {
    console.error("Erreur finalisation commande :", err);
    window.showToast(
      "Paiement réussi, mais erreur d'envoi du ticket. Contactez le restaurant.",
      "error",
    );
  }
}

window.processCheckout = processCheckout;
window.openPaymentSheet = openPaymentSheet;
window.closePaymentSheet = closePaymentSheet;
window.submitStripePayment = submitStripePayment;
