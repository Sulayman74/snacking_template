import { html } from 'lit';
import { SnackElement } from './SnackElement.js';
import { store } from '../core/Store.js';
import { buildOrderItemsPayload } from '../core/orderPayload.js';
import { getStorefrontStatus } from '../core/storefrontStatus.js';
import { statusSentence } from '../ui/statusMessage.js';
import { isValidPhone } from '../services/addressService.js';
import { pickupUI } from '../pickup.js';
import { upsellUI } from '../ui/UpsellUI.js';
import { t } from "../i18n/index.js";
import { auth, functions, httpsCallable, signInAnonymously } from '../core/firebase.js';
import { ensureUserDoc } from '../auth.js';

// ⏱️ Délai max par étape du chargement du paiement : au-delà, on affiche une
// erreur au lieu de laisser le squelette tourner indéfiniment.
const STEP_TIMEOUT_MS = 20000;
const KITCHEN_LOAD_TIMEOUT_MS = 1500;

function withTimeout(promise, ms, step) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`Délai dépassé (${step})`), { code: "checkout/timeout", step })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class SnackCheckout extends SnackElement {
  static properties = {
    isOpen: { type: Boolean },
    isProcessing: { type: Boolean },
    totalAmount: { type: Number },
    errorMessage: { type: String },
    guestEmail: { type: String }
  };

  constructor() {
    super();
    this.isOpen = false;
    this.isProcessing = false;
    this.totalAmount = 0;
    this.errorMessage = '';
    this.guestEmail = '';
    
    this.stripeInstance = null;
    this.stripeElements = null;
    // Aucune clé de secours : le build de prod échoue sans VITE_STRIPE_PUBLISHABLE_KEY
    // (vite.config.js), le dev la lit dans .env.development.
    this.stripePublicKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  }

  connectedCallback() {
    super.connectedCallback();
    this._stripeHost("express-checkout-element", "stripe-express", "mb-4 hidden");
    this._stripeHost("link-authentication-element", "stripe-link", "mb-3 hidden");
    this._stripeHost("payment-element", "stripe-payment", "min-h-[250px]");
  }

  /**
   * Stripe Elements ne fonctionne pas dans un Shadow DOM : monté dedans, le Payment
   * Element reste sur son squelette sans jamais devenir prêt. Ses conteneurs vivent
   * donc dans le light DOM du composant et s'affichent dans la feuille via <slot>.
   */
  _stripeHost(id, slot, className) {
    let el = this.querySelector(`#${id}`);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.slot = slot;
      el.className = className;
      this.appendChild(el);
    }
    return el;
  }

  getCartTotal() {
    if (typeof window.getCartTotal === 'function') {
      return window.getCartTotal();
    }
    const subtotal = (store.state.cart || []).reduce((acc, item) => acc + (Number(item.prix) || 0) * (Number(item.quantity) || 1), 0);
    const fee = typeof store.getDeliveryFee === 'function' ? store.getDeliveryFee() : 0;
    return subtotal + fee;
  }

  // 🛡️ Verrou anti double-clic : sans lui, deux clics rapides sur « Valider »
  // créaient deux PaymentIntents et deux montages Stripe concurrents. Le verrou
  // couvre tout le tunnel (auth invité, upsell, création du PI).
  async processCheckout() {
    if (this._checkoutInFlight) return;
    this._checkoutInFlight = true;
    // Indicateur : auth invité + charge cuisine peuvent prendre 1 à 2 s.
    const btn = document.getElementById("checkout-btn");
    btn?.setAttribute("aria-busy", "true");
    try {
      await this._processCheckout();
    } finally {
      this._checkoutInFlight = false;
      btn?.removeAttribute("aria-busy");
    }
  }

  async _processCheckout() {
    const cfg = window.snackConfig;
    if (store.state.cart.length === 0) return window.showToast(t("toasts.checkout.emptyCart") || "Votre panier est vide", "error");

    window.logEvent?.("begin_checkout", {
      itemCount: store.state.cart.length,
      amountCents: Math.round(this.getCartTotal() * 100),
    });

    const delivery = store.state.delivery || { mode: "collect" };
    const isDelivery = delivery.mode === "delivery";

    // 🚦 Même état que la pastille du panier (fermé, pause, mode coupé, heure
    // limite) : le client ne découvre rien ici qu'il n'ait déjà vu.
    const status = getStorefrontStatus(cfg, new Date(), { mode: isDelivery ? "delivery" : "collect" });
    if (!status.canOrder) return window.showToast(statusSentence(status), "error");

    // 🕒 Retrait « plus tard » : le créneau (revalidé par le serveur) remplace la
    // règle « ouvert maintenant » — on peut programmer avant l'ouverture.
    this._pickupRequest = isDelivery ? null : pickupUI.currentRequest();
    if (!status.canOrderNow && !this._pickupRequest) return window.showToast(statusSentence(status), "error");

    if (isDelivery) {
      if (!delivery.address) {
        window.openCartModal?.();
        return window.showToast(t("toasts.checkout.addressRequired"), "error");
      }
      if (delivery.quote && delivery.quote.inRange === false) return window.showToast(t("toasts.checkout.outOfZone"), "error");
      // Le livreur doit pouvoir joindre le client (interphone, adresse introuvable).
      if (!isValidPhone(delivery.contact?.telephone || "")) {
        window.openCartModal?.();
        document.querySelector('[data-delivery-contact="telephone"]')?.focus();
        return window.showToast(t("toasts.checkout.phoneRequired"), "error");
      }
      
      const minOrder = cfg?.delivery?.minOrder || 0;
      const subtotal = (store.state.cart || []).reduce((acc, item) => acc + (Number(item.prix) || 0) * (Number(item.quantity) || 1), 0);
      if (minOrder > 0 && subtotal < minOrder) {
        window.openCartModal?.();
        return window.showToast(t("toasts.checkout.minOrderRequired", { min: minOrder.toFixed(2) }), "error");
      }
    }

    const currentUser = auth?.currentUser;
    if (!currentUser) {
      if (cfg?.features?.enableGuestCheckout) {
        try {
          const cred = await signInAnonymously(auth);
          store.setUser(cred.user, "client");
          try { await ensureUserDoc(cred.user); } catch (e) {
            console.warn("ensureUserDoc (invité anonyme) échouée :", e);
          }
        } catch (e) {
          window.showToast(t("toasts.checkout.connectionError"), "error");
          return;
        }
      } else {
        store.setPendingCheckout(true);
        window.showToast(t("toasts.checkout.loginRequired"), "error");
        window.toggleAuthModal?.();
        return;
      }
    }

    // Upsell
    if (cfg?.features?.enableUpsell && upsellUI.shouldOffer()) {
      let rushMode = false;
      try {
        // Jamais plus de 1,5 s d'attente : sans réponse, upsell normal.
        const getKitchenLoad = httpsCallable(functions, "getKitchenLoad");
        const res = await Promise.race([
          getKitchenLoad({ snackId: cfg.identity?.id }),
          new Promise((resolve) => setTimeout(() => resolve(null), KITCHEN_LOAD_TIMEOUT_MS)),
        ]);
        rushMode = res?.data?.rushMode === true;
      } catch (e) {}
      const upsellChoice = await upsellUI.show({ rushMode });
      if (upsellChoice === "cancel") return;
    }

    window.closeCartModal?.();
    this.totalAmount = this.getCartTotal();
    this.openPaymentSheet();
    this.errorMessage = '';
    await this._mountStripeElement(auth?.currentUser, cfg);
  }

  async _mountStripeElement(currentUser, cfg) {
    try {
      console.info("[checkout] 1/4 chargement de Stripe.js");
      if (typeof Stripe === "undefined") await withTimeout(this._loadStripeSdk(), STEP_TIMEOUT_MS, "stripe-js");
      if (!this.stripeInstance) this.stripeInstance = Stripe(this.stripePublicKey);

      const paymentContainer = this.querySelector("#payment-element");
      paymentContainer.innerHTML = '<div class="text-center py-8"><i data-lucide="loader-circle" class="animate-spin text-3xl text-gray-400"></i></div>';
      window.lucide?.createIcons({ root: paymentContainer });

      const createPaymentIntent = httpsCallable(functions, "createPaymentIntent");

      const ticketSummary = store.state.cart.map((item) => `${item.quantity}x ${item.nom}`).join(", ");
      const { mode, livraison } = this._getDeliveryPayload();

      console.info("[checkout] 2/4 createPaymentIntent");
      const response = await withTimeout(createPaymentIntent({
        snackId: cfg.identity.id || "Ym1YiO4Ue5Fb5UXlxr06",
        amount: Math.round(this.totalAmount * 100),
        currency: "eur",
        description: `${t('payment.webOrder')} - ${cfg.identity.name}`,
        cartItems: this._buildOrderItemsPayload(),
        mode,
        livraison,
        ...(this._pickupRequest ? { retrait: this._pickupRequest } : {}),
        metadata: {
          ticket: ticketSummary.substring(0, 500),
          clientEmail: currentUser?.email || "",
        },
      }), STEP_TIMEOUT_MS, "createPaymentIntent");

      const clientSecret = response.data?.clientSecret;
      if (!clientSecret) throw new Error(t('payment.invalidResponse'));
      
      const connectedAccountId = response.data?.stripeAccountId || null;
      this.stripeInstance = Stripe(this.stripePublicKey, connectedAccountId ? { stripeAccount: connectedAccountId } : undefined);

      console.info(`[checkout] 3/4 montage du Payment Element (compte connecté : ${connectedAccountId ? "oui" : "non"})`);
      // 🎨 Formulaire Stripe aux couleurs du snack (variable de thème posée par AppUI).
      const primary = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim();
      const appearance = { theme: "stripe", variables: /^#[0-9a-f]{3,8}$/i.test(primary) ? { colorPrimary: primary } : {} };
      const elements = this.stripeInstance.elements({ appearance, clientSecret });
      this.stripeElements = elements;

      const paymentElement = elements.create("payment");
      // Sans ces écouteurs, un échec de chargement Stripe laissait son squelette
      // tourner indéfiniment, sans aucun message.
      let ready = false;
      paymentElement.on("ready", () => {
        ready = true;
        console.info("[checkout] 4/4 Payment Element prêt");
      });
      paymentElement.on("loaderror", (e) => {
        console.error("[checkout] Payment Element — échec de chargement :", e?.error);
        this._failPaymentSheet(e?.error?.message);
      });
      setTimeout(() => {
        if (!ready && this.isOpen && this.stripeElements === elements) {
          console.error(`[checkout] Payment Element toujours pas prêt après ${STEP_TIMEOUT_MS / 1000} s`);
          this._failPaymentSheet();
        }
      }, STEP_TIMEOUT_MS);
      paymentContainer.innerHTML = "";
      paymentElement.mount(paymentContainer);

      // ⚡ Paiement express (Apple Pay / Google Pay / Link en 1 clic). Affiché seulement
      // si un wallet est disponible (HTTPS + domaine enregistré + carte dans le wallet).
      // Un échec ici ne touche pas au formulaire carte ci-dessous.
      const expressContainer = this.querySelector("#express-checkout-element");
      if (expressContainer) {
        expressContainer.classList.add("hidden");
        expressContainer.innerHTML = "";
        try {
          const express = elements.create("expressCheckout", { emailRequired: !!currentUser?.isAnonymous });
          express.on("ready", ({ availablePaymentMethods }) => {
            expressContainer.classList.toggle("hidden", !availablePaymentMethods);
          });
          express.on("loaderror", (e) => {
            console.warn("[checkout] Paiement express indisponible :", e?.error?.message);
            expressContainer.classList.add("hidden");
          });
          express.on("confirm", (event) => this._onExpressConfirm(event));
          express.mount(expressContainer);
        } catch (e) {
          console.warn("[checkout] Paiement express non monté :", e?.message);
        }
      }

      // Guest checkout email element
      this.guestEmail = "";
      const linkContainer = this.querySelector("#link-authentication-element");
      if (currentUser?.isAnonymous && linkContainer) {
        linkContainer.classList.remove("hidden");
        const linkEl = this.stripeElements.create("linkAuthentication");
        linkEl.on("loaderror", (e) => console.error("[checkout] Link (email invité) — échec de chargement :", e?.error));
        linkEl.mount(linkContainer);
        linkEl.on("change", (e) => {
          this.guestEmail = (e?.value?.email || "").trim();
        });
      } else if (linkContainer) {
        linkContainer.classList.add("hidden");
        linkContainer.innerHTML = "";
      }

    } catch (error) {
      console.error(`❌ Erreur préparation paiement${error?.step ? ` (étape : ${error.step})` : ""} :`, error);
      const code = error?.code || "";
      const isBusiness = /failed-precondition|out-of-range|invalid-argument|resource-exhausted/.test(code);
      // Prix changé côté restaurant : le panier se met au prix du menu courant.
      if (error?.details?.reason === "price-changed") store.reconcileCart();
      window.showToast(isBusiness && error?.message ? error.message : t("toasts.checkout.secureConnectionError"), "error");
      this.closePaymentSheet();
    }
  }

  async submitStripePayment() {
    // 🛡️ Anti double-clic : `?disabled` n'est appliqué qu'au prochain rendu Lit.
    if (this.isProcessing) return;
    if (!this.stripeInstance || !this.stripeElements) {
      window.showToast(t("toasts.checkout.secureConnectionWait"), "error");
      return;
    }

    const currentUser = auth?.currentUser;
    if (currentUser?.isAnonymous && !this.guestEmail) {
      this.errorMessage = t('payment.emailRequired');
      window.triggerVibration?.("error");
      const linkEl = this.querySelector("#link-authentication-element");
      if (linkEl) {
        linkEl.scrollIntoView({ behavior: "smooth", block: "center" });
        linkEl.style.outline = "2px solid var(--color-error, #ef4444)";
        linkEl.style.borderRadius = "6px";
        setTimeout(() => {
          linkEl.style.outline = "";
          linkEl.style.borderRadius = "";
        }, 2000);
      }
      return;
    }

    await this._confirmAndFinalize();
  }

  /**
   * Paiement express confirmé dans la feuille Apple Pay / Google Pay : l'email de
   * l'invité vient du wallet, puis même chemin que le bouton « Payer ».
   */
  async _onExpressConfirm(event) {
    if (this.isProcessing) return;
    const walletEmail = (event?.billingDetails?.email || "").trim();
    if (walletEmail && !this.guestEmail) this.guestEmail = walletEmail;
    if (auth?.currentUser?.isAnonymous && !this.guestEmail) {
      event?.paymentFailed?.({ reason: "fail" });
      this.errorMessage = t("payment.emailRequired");
      return;
    }
    await this._confirmAndFinalize();
  }

  /** Confirme le paiement (formulaire OU express) puis crée la commande. */
  async _confirmAndFinalize() {
    this.isProcessing = true;
    this.errorMessage = '';

    try {
      // Reçu par e-mail envoyé par Stripe (gratuit) : confirmation hors de l'app,
      // utile si les notifications sont refusées ou indisponibles (iPhone sans PWA).
      const receiptEmail = (auth?.currentUser?.email || this.guestEmail || "").trim();
      const { error, paymentIntent } = await this.stripeInstance.confirmPayment({
        elements: this.stripeElements,
        confirmParams: {
          return_url: window.location.origin + window.location.pathname,
          ...(receiptEmail ? { receipt_email: receiptEmail } : {}),
        },
        redirect: "if_required",
      });

      if (error) {
        this.errorMessage = error.message;
        window.triggerVibration?.("error");
      } else if (paymentIntent && paymentIntent.status === "succeeded") {
        window.showToast(t("toasts.checkout.paymentSuccess"), "success");
        this.closePaymentSheet();
        await this.finalizeOrderInFirestore(paymentIntent.id);
      } else {
        // processing / requires_* sans `error` : ne JAMAIS laisser l'écran muet.
        this.errorMessage = t("payment.notConfirmed");
        window.triggerVibration?.("error");
      }
    } catch (err) {
      console.error("Erreur critique au moment du paiement :", err);
      window.showToast(t("toasts.checkout.paymentTerminalError"), "error");
    } finally {
      this.isProcessing = false;
    }
  }

  async finalizeOrderInFirestore(stripePaymentId) {
    const currentSnackId = window.snackConfig?.identity?.id || "Ym1YiO4Ue5Fb5UXlxr06";
    const currentUser = auth?.currentUser;

    try {
      const cartItems = this._buildOrderItemsPayload();
      const totalCents = Math.round(this.getCartTotal() * 100);
      const { mode, livraison } = this._getDeliveryPayload();
      
      const email = currentUser?.email || this.guestEmail;
      const clientNom = currentUser?.displayName || (email ? email.split("@")[0] : t("payment.clientDefault"));

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
      if (!orderId) throw new Error(t('payment.invalidResponse'));

      store.clearCart();
      window.triggerVibration?.("jackpot");

      if (window.snackConfig?.features?.enableClickAndCollect || window.snackConfig?.features?.enableDelivery) {
        localStorage.setItem("activeOrderId", orderId);
        window.startOrderTracking?.(orderId);
        window.dispatchEvent(new CustomEvent("snack:order-placed", { detail: { orderId } }));
      }

      store.resetDelivery?.();
      store.resetPickup?.();

      setTimeout(() => {
        window.openTrackingModal?.();
      }, 500);

    } catch (err) {
      console.error("Erreur finalisation commande :", err);
      window.showToast(t("toasts.checkout.orderFinalizeError"), "error");
    }
  }

  _buildOrderItemsPayload() {
    return buildOrderItemsPayload(store.state.cart);
  }

  _getDeliveryPayload() {
    const delivery = store.state.delivery || { mode: "collect" };
    const isDelivery = delivery.mode === "delivery";
    const livraison = isDelivery && delivery.address ? {
      adresse: delivery.address.adresse || "",
      lat: delivery.address.lat,
      lng: delivery.address.lng,
      complement: (delivery.contact?.complement || "").trim(),
      telephone: (delivery.contact?.telephone || "").trim(),
    } : null;
    return { mode: isDelivery ? "delivery" : "collect", livraison };
  }

  _loadStripeSdk() {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById("stripe-js");
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error(t("payment.stripeError"))));
        return;
      }
      const s = document.createElement("script");
      s.id = "stripe-js";
      s.src = "https://js.stripe.com/v3/";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(t("payment.stripeError")));
      document.head.appendChild(s);
    });
  }

  openPaymentSheet() {
    this.isOpen = true;
    document.body.style.overflow = "hidden";
  }

  /** Échec du chargement du paiement : message clair + fermeture (au lieu d'un squelette infini). */
  _failPaymentSheet(message) {
    window.showToast(message || t("toasts.checkout.secureConnectionError"), "error");
    this.closePaymentSheet();
  }

  closePaymentSheet() {
    this.isOpen = false;
    document.body.style.overflow = "";
    const paymentContainer = this.querySelector("#payment-element");
    if (paymentContainer) paymentContainer.innerHTML = "";
    const linkContainer = this.querySelector("#link-authentication-element");
    if (linkContainer) linkContainer.innerHTML = "";
    const expressContainer = this.querySelector("#express-checkout-element");
    if (expressContainer) {
      expressContainer.innerHTML = "";
      expressContainer.classList.add("hidden");
    }
  }

  updated() {
    if (this.isOpen && window.lucide) {
      window.lucide.createIcons({ root: this.shadowRoot });
    }
  }

  render() {
    return html`
      <div id="payment-bottom-sheet" class="fixed inset-0 z-[100] items-end justify-center bg-black/60 backdrop-blur-sm transition-all duration-300 ${this.isOpen ? 'flex opacity-100' : 'hidden opacity-0'}">
        
        <!-- Backdrop -->
        <div class="absolute inset-0" @click="${this.closePaymentSheet}"></div>
        
        <!-- Sheet Content -->
        <div class="relative w-full max-w-lg transform rounded-t-3xl bg-surface p-6 shadow-2xl transition-transform duration-300 flex flex-col max-h-[92vh] ${this.isOpen ? 'translate-y-0' : 'translate-y-full'}">
          
          <div class="mx-auto mb-4 h-1.5 w-12 flex-shrink-0 rounded-full bg-surface-3"></div>

          <div class="overflow-y-auto pr-1 custom-scrollbar">
            <div class="mb-6 text-center">
              <h3 class="text-xl font-black text-text">${t('payment.secureTitle')}</h3>
              <p class="text-lg font-bold text-red-600">${t('payment.total')} ${this.totalAmount.toFixed(2)} €</p>
            </div>

            <!-- Conteneurs Stripe en light DOM (cf. _stripeHost), projetés ici. -->
            <slot name="stripe-express"></slot>
            <slot name="stripe-link"></slot>
            <slot name="stripe-payment"></slot>

            ${this.errorMessage ? html`
              <div class="mt-4 rounded-lg bg-danger-subtle p-3 text-center text-sm font-medium text-danger">
                ${this.errorMessage}
              </div>
            ` : ''}
          </div>

          <div class="mt-6 flex flex-col gap-3 flex-shrink-0 pb-4 md:pb-0">
            <button @click="${this.submitStripePayment}" 
                    ?disabled="${this.isProcessing}"
                    class="flex w-full items-center justify-center rounded-xl bg-green-600 py-4 text-lg font-black text-on-dark shadow-lg transition active:scale-95 hover:bg-green-700 disabled:opacity-70 disabled:active:scale-100">
              ${this.isProcessing 
                ? html`<i data-lucide="loader-circle" class="animate-spin mr-2"></i> ${t('payment.processing')}` 
                : html`<i data-lucide="lock" class="mr-2"></i> ${t('payment.pay')} ${this.totalAmount.toFixed(2)} €`}
            </button>
            <button @click="${this.closePaymentSheet}" class="w-full py-3 text-sm font-bold text-text-muted hover:text-text">
              ${t('common.cancel')}
            </button>
          </div>
          
        </div>
      </div>
    `;
  }
}

customElements.define('snack-checkout', SnackCheckout);
