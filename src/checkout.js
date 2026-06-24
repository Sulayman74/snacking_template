// ============================================================================
// 💳 CHECKOUT — Stripe, Commande Firebase
// ============================================================================
// Dépendances : window.cart, window.getCartTotal, window.closeCartModal,
//               window.toggleAuthModal, window.snackConfig, window.showToast,
//               window.triggerVibration, window.startOrderTracking, window.upsellUI

import { upsellUI } from "./ui/UpsellUI.js";
import { auth, functions, httpsCallable, signInAnonymously } from "./core/firebase.js";
import { ensureUserDoc } from "./auth.js";

// 🛒 Guest checkout (LOT 2) : email saisi dans le Link Authentication Element
// (invité anonyme). Sert de clientEmail/contactKey à finalizeOrder. Réinitialisé
// à chaque ouverture du tunnel de paiement.
let guestEmail = "";

let stripeElements = null;
let stripeInstance = null;

/**
 * Construit le payload `cartItems` envoyé au serveur (createPaymentIntent ET
 * finalizeOrder). Source UNIQUE (DRY) : le serveur recalcule les prix depuis la
 * base, donc les deux appels doivent décrire le MÊME panier (le total du PI et le
 * total de la commande sont recalculés à l'identique côté serveur).
 * @returns {Array<Object>} Articles normalisés pour les Cloud Functions.
 */
function buildOrderItemsPayload() {
  return window.cart.map((item) => ({
    id: item.id,
    productId: item.productId || (typeof item.id === "string" ? item.id.split("-")[0] : null),
    nom: item.nom,
    // Le panier stocke `formule`/`taille` (cf. product-modal #buildCartItem).
    // On garde `item.type`/`item.tailleChoisie` en fallback pour tout item legacy.
    type: item.formule || item.type || "seul",
    boissonNom: item.boisson || null,
    sauces: item.sauces || [],
    sansCrudites: item.sansCrudites || [],
    tailleChoisie: item.taille || item.tailleChoisie || null,
    prix: item.prix || item.prixBase || 0, // Requis par la Cloud Function (recalculé serveur)
    prixBase: item.prixBase || item.prix,
    prixMenuAdd: item.prixMenuAdd || 0,
    quantity: item.quantity,
    // 📊 Attribution upsell : tag posé par UpsellUI lors d'un ajout via la bottom-sheet.
    viaUpsell: item.viaUpsell === true,
  }));
}

/**
 * Snapshot du mode + adresse de livraison (collect par défaut). Le SERVEUR recalcule
 * distance/frais/zone à partir de l'adresse — on n'envoie que les coordonnées capturées.
 * @returns {{mode: "collect"|"delivery", livraison: (Object|null)}}
 */
function getDeliveryPayload() {
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
  return { mode: isDelivery ? "delivery" : "collect", livraison };
}
// 🔑 Clé PUBLISHABLE Stripe (pk_…) — publique par nature, mais doit varier par
// environnement (F7). Source : VITE_STRIPE_PUBLISHABLE_KEY (injectée au build).
// Fallback : clé de TEST pour que le dev local fonctionne sans config ; en build de
// prod, l'absence de la variable est signalée (évite de partir en pk_test sans le voir).
const STRIPE_TEST_PUBLISHABLE_KEY =
  "pk_test_51TG1RfIfiBxoqwsycKUz6o8Mxf5keYpRfFPCgbDE2GkQiz4USCS5tE0lQaO160YDBoXb6mDgWzgzvbosexR6ORKn002PFzjj7J";
const stripePublicKey =
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || STRIPE_TEST_PUBLISHABLE_KEY;
if (!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY && !import.meta.env.DEV) {
  console.warn(
    "⚠️ VITE_STRIPE_PUBLISHABLE_KEY non configurée — build en clé de TEST. Définis la clé live pour la prod.",
  );
}

/**
 * Charge le SDK Stripe.js à la demande (1ère ouverture du tunnel de paiement).
 * Retiré du <head> de la home pour ne pas pénaliser le LCP/INP (CLAUDE.md §8.2).
 * Idempotent : résout immédiatement si déjà chargé / en cours.
 * @returns {Promise<void>}
 */
function loadStripeSdk() {
  if (window.Stripe) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById("stripe-js");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Échec du chargement de Stripe.")));
      return;
    }
    const s = document.createElement("script");
    s.id = "stripe-js";
    s.src = "https://js.stripe.com/v3/";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Échec du chargement de Stripe."));
    document.head.appendChild(s);
  });
}

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

  // 📊 Funnel : début de checkout (no-op si flag analytics tenant OFF). Émis ici,
  // après le garde-fou panier non vide, AVANT l'upsell/Stripe → mesure le drop-off
  // checkout→purchase (et alimente la détection de panier abandonné, LOT 7).
  window.logEvent?.("begin_checkout", {
    itemCount: window.cart.length,
    amountCents: Math.round((window.getCartTotal?.() || 0) * 100),
  });

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

  let currentUser = auth?.currentUser;
  const btn = document.getElementById("checkout-btn");

  if (!currentUser) {
    // 🛒 Guest checkout (LOT 2) : si le tenant l'active, on crée un utilisateur
    // ANONYME (uid réel, règles Firestore inchangées, fidélité créditée sur ce
    // uid) au lieu de barrer l'accès. Flag OFF → barrage auth historique intact.
    if (cfg?.features?.enableGuestCheckout) {
      try {
        const cred = await signInAnonymously(auth);
        currentUser = cred.user;
        // Crée le doc users/{uid} dès maintenant : finalizeOrder fait un update()
        // qui throw si le doc n'existe pas. Best-effort : un échec ici n'empêche
        // pas la commande (le try/catch de post-création dans finalizeOrder absorbe
        // l'éventuel 'not-found' — mais le créer maintenant est plus propre).
        try { await ensureUserDoc(currentUser); } catch (e) {
          console.warn("ensureUserDoc (invité anonyme) échouée :", e);
        }
      } catch (e) {
        window.showToast("Connexion impossible, réessayez.", "error");
        return;
      }
    } else {
      window.showToast("Veuillez vous connecter pour commander", "error");
      window.toggleAuthModal();
      return;
    }
  }

  // 🪜 ÉTAPE UPSELL — gate facultatif avant init Stripe.
  // - Skippé si le snack n'a pas activé la feature (cfg.features.enableUpsell)
  //   via le toggle superadmin → flow inchangé pour les snacks legacy.
  // - Pas de suggestions => résout "continue" instantanément (pas de modale).
  // - Sinon, l'utilisateur voit la sheet et choisit continue/cancel.
  // - "cancel" abort proprement : pas de spinner, pas d'appel Stripe.
  if (cfg?.features?.enableUpsell) {
    // 🔥 Charge cuisine (autorité serveur) : en rush, l'upsell se limite aux
    // produits prêts à servir. FAIL-OPEN absolu — la capacité ne doit JAMAIS
    // bloquer le paiement : tout échec/lenteur → rushMode=false (upsell complet).
    let rushMode = false;
    try {
      const getKitchenLoad = httpsCallable(functions, "getKitchenLoad");
      const res = await getKitchenLoad({ snackId: cfg.identity?.id });
      rushMode = res?.data?.rushMode === true;
    } catch (e) {
      rushMode = false;
    }
    const upsellChoice = await upsellUI.show({ rushMode });
    if (upsellChoice === "cancel") return;
  }

  const originalText = btn.innerHTML;
  btn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin"></i> Connexion banque...`;
  btn.disabled = true;

  try {
    // Chargement paresseux du SDK Stripe (retiré du <head> de la home pour le LCP).
    await loadStripeSdk();
    // ⚠️ L'instance Stripe.js est (ré)initialisée plus bas, APRÈS la réponse de la
    // CF : en charge directe (Connect), elle DOIT cibler le compte connecté
    // (`{ stripeAccount }`), sinon le Payment Element ne se monte pas (400 sur
    // elements/sessions). On a besoin du `stripeAccountId` renvoyé par la CF.

    // 💡 Total recalculé APRÈS l'upsell pour intégrer les éventuels ajouts.
    const totalAmount = window.getCartTotal();

    // 1. Fermer le panier pour éviter les conflits de z-index
    window.closeCartModal();

    // 2. Mettre à jour et ouvrir la modale Stripe EN PREMIER
    document.getElementById("payment-amount-display").textContent =
      `Total : ${totalAmount.toFixed(2)} €`;

    const paymentContainer = document.getElementById("payment-element");
    paymentContainer.innerHTML =
      '<div class="text-center py-8"><i data-lucide="loader-circle" class="animate-spin text-3xl text-gray-400"></i></div>';

    openPaymentSheet();

    // 3. Demander le PaymentIntent à la Cloud Function
    const createPaymentIntent = httpsCallable(functions, "createPaymentIntent");

    const ticketSummary = window.cart
      .map((item) => `${item.quantity}x ${item.nom}`)
      .join(", ");

    // 🛡️ Le SERVEUR recalcule le montant du PaymentIntent depuis le panier + la
    // config livraison (anti charge orpheline F1) : on lui envoie le panier et le
    // mode. `amount` reste transmis pour compat/traçabilité mais n'est plus l'autorité.
    const { mode, livraison } = getDeliveryPayload();
    const response = await createPaymentIntent({
      snackId: cfg.identity?.id || "Ym1YiO4Ue5Fb5UXlxr06",
      amount: Math.round(totalAmount * 100),
      currency: "eur",
      description: `Commande Web - ${cfg.identity.name}`,
      cartItems: buildOrderItemsPayload(),
      mode,
      livraison,
      metadata: {
        ticket: ticketSummary.substring(0, 500),
        // Invité anonyme : email encore inconnu ici (capté au Link Element ci-dessous,
        // avant confirmation). Métadonnée best-effort, pas l'autorité.
        clientEmail: currentUser.email || "",
      },
    });

    const clientSecret = response?.data?.clientSecret;
    if (!clientSecret) {
      throw new Error("Réponse de paiement invalide (clientSecret manquant).");
    }
    // Compte connecté (charge directe) renvoyé par la CF, ou null (charge plateforme).
    const connectedAccountId = response?.data?.stripeAccountId || null;

    // (Ré)initialise Stripe.js EN CIBLANT le compte connecté si charge directe :
    // sans `{ stripeAccount }`, Elements ne peut pas charger un PI du compte connecté
    // (400 sur elements/sessions) et confirmPayment échoue (Element non monté).
    stripeInstance = Stripe(
      stripePublicKey,
      connectedAccountId ? { stripeAccount: connectedAccountId } : undefined
    );

    // 4. Créer et injecter le formulaire Stripe
    const appearance = { theme: "stripe" };
    stripeElements = stripeInstance.elements({ appearance, clientSecret });

    const paymentElement = stripeElements.create("payment");
    paymentContainer.innerHTML = "";
    paymentElement.mount("#payment-element");

    // 🛒 Guest checkout (LOT 2) : pour un invité ANONYME, on monte le Link
    // Authentication Element (natif Stripe) qui capte l'email (→ reçu + contactKey)
    // et débloque Link 1-clic. Le flux CONNECTÉ ne le monte pas → inchangé.
    guestEmail = "";
    const linkContainer = document.getElementById("link-authentication-element");
    if (currentUser?.isAnonymous && linkContainer) {
      linkContainer.classList.remove("hidden");
      const linkEl = stripeElements.create("linkAuthentication");
      linkEl.mount("#link-authentication-element");
      linkEl.on("change", (e) => {
        guestEmail = (e?.value?.email || "").trim();
      });
    } else if (linkContainer) {
      linkContainer.classList.add("hidden");
      linkContainer.innerHTML = "";
    }
  } catch (error) {
    console.error("❌ Erreur préparation paiement :", error);
    // Rejet métier AVANT débit (panier/zone/minimum recalculés serveur) → on affiche
    // le motif lisible. Erreurs techniques → message générique (pas de fuite interne).
    const code = error?.code || "";
    const isBusiness = /failed-precondition|out-of-range|invalid-argument|resource-exhausted/.test(code);
    window.showToast(
      isBusiness && error?.message ? error.message : "Erreur de connexion sécurisée au paiement.",
      "error",
    );
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

  // 🛒 Garde-fou invité : on exige l'email AVANT le débit. Sans lui, finalizeOrder
  // rejetterait (clientEmail invalide) APRÈS la charge → risque de charge orpheline.
  if (auth?.currentUser?.isAnonymous && !guestEmail) {
    const messageContainer = document.getElementById("payment-message");
    messageContainer.textContent = "Renseignez votre email pour recevoir le reçu.";
    messageContainer.classList.remove("hidden");
    window.triggerVibration?.("error");
    return;
  }

  const btnOriginalText = submitPaymentBtn.innerHTML;
  submitPaymentBtn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Vérification banque...`;
  submitPaymentBtn.disabled = true;

  try {
    const { error, paymentIntent } = await stripeInstance.confirmPayment({
      elements: stripeElements,
      // return_url OBLIGATOIRE dès qu'un moyen de paiement redirige (3DS mobile, wallets…) :
      // sans elle, confirmPayment THROW (≠ erreur retournée) -> échec mobile. Avec
      // redirect:"if_required", la majorité des cartes restent inline (return_url = filet).
      confirmParams: { return_url: window.location.origin + window.location.pathname },
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
  const currentUser = auth?.currentUser;

  try {
    // Mêmes helpers que createPaymentIntent (DRY) : le serveur recalcule prix +
    // total à l'identique pour les deux appels. `totalCents` reste envoyé pour
    // traçabilité mais n'est pas l'autorité (recalcul serveur, cf. CLAUDE.md §6.1).
    const cartItems = buildOrderItemsPayload();
    const totalCents = Math.round(window.getCartTotal() * 100);
    const { mode, livraison } = getDeliveryPayload();

    // 🛒 Invité anonyme : email/nom non portés par le compte → on prend l'email
    // saisi au Link Element. `email.split` ne s'exécute JAMAIS sur null (fallback).
    const email = currentUser.email || guestEmail;
    const clientNom = currentUser.displayName || (email ? email.split("@")[0] : "Client");

    const finalizeOrder = httpsCallable(functions, "finalizeOrder");
    const result = await finalizeOrder({
      paymentIntentId: stripePaymentId,
      snackId: currentSnackId,
      cartItems,
      totalCents,
      clientEmail: email,
      clientNom,
      referrerId: localStorage.getItem("referralBy") || null,
      mode,
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
