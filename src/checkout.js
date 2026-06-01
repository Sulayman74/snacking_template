// ============================================================================
// 💳 CHECKOUT — Stripe, Commande Firebase
// ============================================================================
// Dépendances : window.cart, window.getCartTotal, window.closeCartModal,
//               window.toggleAuthModal, window.auth, window.fs, window.db,
//               window.snackConfig, window.showToast, window.triggerVibration,
//               window.startOrderTracking, window.upsellUI

import { upsellUI } from "./ui/UpsellUI.js";

let stripeElements = null;
let stripeInstance = null;
const stripePublicKey =
  "pk_test_51TG1RfIfiBxoqwsycKUz6o8Mxf5keYpRfFPCgbDE2GkQiz4USCS5tE0lQaO160YDBoXb6mDgWzgzvbosexR6ORKn002PFzjj7J"; // ⚠️ REMPLACE PAR TA CLÉ PUBLIQUE STRIPE (pk_test_...)

/**
 * Tunnel de paiement complet, déclenché par #checkout-btn (router → process-checkout).
 *
 * Flow :
 *   1. Garde-fous : panier non vide, feature activée, user connecté.
 *   2. Étape upsell (NON-BLOQUANTE) :
 *      - On appelle upsellUI.show() qui résout :
 *          - immédiatement "continue" si aucune suggestion (pas de catégorie
 *            dessert/side/boisson disponible OU déjà tout au panier),
 *          - "continue" / "cancel" après interaction utilisateur.
 *      - L'utilisateur peut cliquer "Ajouter" sur une suggestion : store.addToCart()
 *        muta le panier, l'event "cart-updated" déclenche un re-render CartUI,
 *        et le total recalculé ci-dessous (window.getCartTotal après la modale)
 *        intègre bien les ajouts.
 *      - "cancel" interrompt le checkout (l'utilisateur peut continuer à shopper).
 *   3. Init Stripe + ouverture du payment-bottom-sheet avec le total à jour.
 *
 * Important : on lit window.getCartTotal() APRÈS l'upsell pour que les ajouts
 * soient pris en compte dans le PaymentIntent envoyé à Stripe.
 */
async function processCheckout() {
  const cfg = window.snackConfig;
  if (window.cart.length === 0)
    return window.showToast("Votre panier est vide", "error");

  // 🚚 Mode courant (collect par défaut → comportement legacy strictement inchangé).
  const delivery = window.store?.state?.delivery || { mode: "collect" };
  const isDelivery = delivery.mode === "delivery";

  // Garde-fou feature selon le mode : le collect exige enableClickAndCollect,
  // la livraison exige enableDelivery (permet un snack 100% livraison).
  const featureOk = isDelivery
    ? cfg?.features?.enableDelivery
    : cfg?.features?.enableClickAndCollect;
  if (!featureOk) {
    return window.showToast(
      isDelivery ? "La livraison est désactivée." : "La commande en ligne est désactivée.",
      "error",
    );
  }

  if (cfg?.features?.maintenanceMode) {
    return window.showToast("Service momentanément en maintenance.", "error");
  }

  // 🚚 Validation livraison : adresse présente, dans la zone, panier minimum.
  if (isDelivery) {
    if (!delivery.address) {
      window.openCartModal?.();
      return window.showToast("Indiquez votre adresse de livraison.", "error");
    }
    if (delivery.quote && delivery.quote.inRange === false) {
      return window.showToast("Votre adresse est hors zone de livraison.", "error");
    }
    const minOrder = cfg?.delivery?.minOrder || 0;
    const subtotal = window.getCartSubtotal ? window.getCartSubtotal() : window.getCartTotal();
    if (minOrder > 0 && subtotal < minOrder) {
      window.openCartModal?.();
      return window.showToast(`Minimum ${minOrder.toFixed(2)} € pour la livraison.`, "error");
    }
  }

  const currentUser = window.auth?.currentUser;
  const btn = document.getElementById("checkout-btn");

  if (!currentUser) {
    window.showToast("Veuillez vous connecter pour commander", "error");
    window.toggleAuthModal();
    return;
  }

  // 🪜 ÉTAPE UPSELL — gate facultatif avant init Stripe.
  // - Skippé si le snack n'a pas activé la feature (cfg.features.enableUpsell)
  //   via le toggle superadmin → flow inchangé pour les snacks legacy.
  // - Pas de suggestions => résout "continue" instantanément (pas de modale).
  // - Sinon, l'utilisateur voit la sheet et choisit continue/cancel.
  // - "cancel" abort proprement : pas de spinner, pas d'appel Stripe.
  if (cfg?.features?.enableUpsell) {
    const upsellChoice = await upsellUI.show();
    if (upsellChoice === "cancel") return;
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

    // 💡 Total recalculé APRÈS l'upsell pour intégrer les éventuels ajouts.
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
      snackId: cfg.identity.id || "Ym1YiO4Ue5Fb5UXlxr06",
      amount: Math.round(totalAmount * 100),
      currency: "eur",
      description: `Commande Web - ${cfg.identity.name}`,
      metadata: {
        ticket: ticketSummary.substring(0, 500),
        clientEmail: currentUser.email,
      },
    });

    const clientSecret = response?.data?.clientSecret;
    if (!clientSecret) {
      throw new Error("Réponse de paiement invalide (clientSecret manquant).");
    }

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
      // Le panier stocke `formule`/`taille` (cf. product-modal #buildCartItem).
      // On garde `item.type`/`item.tailleChoisie` en fallback pour tout item legacy.
      type: item.formule || item.type || "seul",
      boissonNom: item.boisson || null,
      sauces: item.sauces || [],
      sansCrudites: item.sansCrudites || [],
      tailleChoisie: item.taille || item.tailleChoisie || null,
      prix: item.prix || item.prixBase || 0, // IMPORTANT: Requis par la Cloud Function
      prixBase: item.prixBase || item.prix,
      prixMenuAdd: item.prixMenuAdd || 0,
      quantity: item.quantity,
    }));

    // Montant en centimes pour vérification côté serveur
    const totalCents = Math.round(window.getCartTotal() * 100);

    // 🚚 Données livraison (mode + adresse). Le SERVEUR recalcule distance/frais/ETA
    // (anti-manipulation) ; on n'envoie que l'adresse + coordonnées capturées.
    const delivery = window.store?.state?.delivery || { mode: "collect" };
    const isDelivery = delivery.mode === "delivery";
    const livraison =
      isDelivery && delivery.address
        ? {
            adresse: delivery.address.adresse || "",
            lat: delivery.address.lat,
            lng: delivery.address.lng,
          }
        : null;

    const finalizeOrder = httpsCallable(functions, "finalizeOrder");
    const result = await finalizeOrder({
      paymentIntentId: stripePaymentId,
      snackId: currentSnackId,
      cartItems,
      totalCents,
      clientEmail: currentUser.email,
      clientNom: currentUser.displayName || currentUser.email.split("@")[0],
      referrerId: localStorage.getItem("referralBy") || null,
      mode: isDelivery ? "delivery" : "collect",
      livraison,
    });

    const orderId = result?.data?.orderId;
    if (!orderId) throw new Error("Réponse serveur invalide : orderId manquant.");

    // Vide le panier via le Store (ce qui va déclencher les mises à jour UI)
    if (window.clearCart) {
      window.clearCart();
    } else {
      window.cart.splice(0, window.cart.length);
    }

    if (window.closeCartModal) window.closeCartModal();

    window.triggerVibration?.("jackpot");

    // Suivi temps réel pour le collect ET la livraison.
    if (
      window.snackConfig?.features?.enableClickAndCollect ||
      window.snackConfig?.features?.enableDelivery
    ) {
      localStorage.setItem("activeOrderId", orderId);
      window.startOrderTracking(orderId);
    }

    // Réinitialise le tunnel livraison une fois la commande passée.
    window.store?.resetDelivery?.();

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
