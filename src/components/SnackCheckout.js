import { html } from 'lit';
import { SnackElement } from './SnackElement.js';
import { store } from '../core/Store.js';
import { upsellUI } from '../ui/UpsellUI.js';
import { t } from "../i18n/index.js";
import { auth, functions, httpsCallable, signInAnonymously } from '../core/firebase.js';
import { ensureUserDoc } from '../auth.js';

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
    this.stripePublicKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "pk_test_51TG1RfIfiBxoqwsycKUz6o8Mxf5keYpRfFPCgbDE2GkQiz4USCS5tE0lQaO160YDBoXb6mDgWzgzvbosexR6ORKn002PFzjj7J";
  }

  getCartTotal() {
    if (typeof window.getCartTotal === 'function') {
      return window.getCartTotal();
    }
    const subtotal = (store.state.cart || []).reduce((acc, item) => acc + (Number(item.prix) || 0) * (Number(item.quantity) || 1), 0);
    const fee = typeof store.getDeliveryFee === 'function' ? store.getDeliveryFee() : 0;
    return subtotal + fee;
  }

  async processCheckout() {
    const cfg = window.snackConfig;
    if (store.state.cart.length === 0) return window.showToast(t("toasts.checkout.emptyCart") || "Votre panier est vide", "error");

    window.logEvent?.("begin_checkout", {
      itemCount: store.state.cart.length,
      amountCents: Math.round(this.getCartTotal() * 100),
    });

    const delivery = store.state.delivery || { mode: "collect" };
    const isDelivery = delivery.mode === "delivery";

    const featureOk = isDelivery ? cfg?.features?.enableDelivery : cfg?.features?.enableClickAndCollect;
    if (!featureOk) {
      return window.showToast(isDelivery ? t("toasts.checkout.deliveryDisabled") : t("toasts.checkout.clickCollectDisabled"), "error");
    }

    if (cfg?.features?.maintenanceMode) return window.showToast(t("toasts.checkout.maintenance"), "error");

    if (cfg?.servicePausedUntil) {
      const pausedUntil = cfg.servicePausedUntil.toDate ? cfg.servicePausedUntil.toDate() : new Date(cfg.servicePausedUntil);
      if (pausedUntil > new Date()) {
        const timeStr = pausedUntil.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        return window.showToast(`Cuisine en pause jusqu'à ${timeStr} pour cause de forte affluence.`, "error");
      }
    }

    if (isDelivery) {
      if (!delivery.address) {
        window.openCartModal?.();
        return window.showToast(t("toasts.checkout.addressRequired"), "error");
      }
      if (delivery.quote && delivery.quote.inRange === false) return window.showToast(t("toasts.checkout.outOfZone"), "error");
      
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
    if (cfg?.features?.enableUpsell) {
      let rushMode = false;
      try {
        const getKitchenLoad = httpsCallable(functions, "getKitchenLoad");
        const res = await getKitchenLoad({ snackId: cfg.identity?.id });
        rushMode = res?.data?.rushMode === true;
      } catch (e) {}
      const upsellChoice = await upsellUI.show({ rushMode });
      if (upsellChoice === "cancel") return;
    }

    window.closeCartModal?.();
    this.totalAmount = this.getCartTotal();
    this.openPaymentSheet();
    this.errorMessage = '';
    this._mountStripeElement(auth?.currentUser, cfg);
  }

  async _mountStripeElement(currentUser, cfg) {
    try {
      if (typeof Stripe === "undefined") await this._loadStripeSdk();
      if (!this.stripeInstance) this.stripeInstance = Stripe(this.stripePublicKey);

      const paymentContainer = this.shadowRoot.getElementById("payment-element");
      paymentContainer.innerHTML = '<div class="text-center py-8"><i data-lucide="loader-circle" class="animate-spin text-3xl text-gray-400"></i></div>';
      window.lucide?.createIcons({ root: this.shadowRoot });

      const createPaymentIntent = httpsCallable(functions, "createPaymentIntent");

      const ticketSummary = store.state.cart.map((item) => `${item.quantity}x ${item.nom}`).join(", ");
      const { mode, livraison } = this._getDeliveryPayload();

      const response = await createPaymentIntent({
        snackId: cfg.identity.id || "Ym1YiO4Ue5Fb5UXlxr06",
        amount: Math.round(this.totalAmount * 100),
        currency: "eur",
        description: `Commande Web - ${cfg.identity.name}`,
        cartItems: this._buildOrderItemsPayload(),
        mode,
        livraison,
        metadata: {
          ticket: ticketSummary.substring(0, 500),
          clientEmail: currentUser?.email || "",
        },
      });

      const clientSecret = response.data?.clientSecret;
      if (!clientSecret) throw new Error("Réponse de paiement invalide (clientSecret manquant).");
      
      const connectedAccountId = response.data?.stripeAccountId || null;
      this.stripeInstance = Stripe(this.stripePublicKey, connectedAccountId ? { stripeAccount: connectedAccountId } : undefined);

      const appearance = { theme: "stripe" };
      this.stripeElements = this.stripeInstance.elements({ appearance, clientSecret });
      
      const paymentElement = this.stripeElements.create("payment");
      paymentContainer.innerHTML = "";
      paymentElement.mount(paymentContainer);

      // Guest checkout email element
      this.guestEmail = "";
      const linkContainer = this.shadowRoot.getElementById("link-authentication-element");
      if (currentUser?.isAnonymous && linkContainer) {
        linkContainer.classList.remove("hidden");
        const linkEl = this.stripeElements.create("linkAuthentication");
        linkEl.mount(linkContainer);
        linkEl.on("change", (e) => {
          this.guestEmail = (e?.value?.email || "").trim();
        });
      } else if (linkContainer) {
        linkContainer.classList.add("hidden");
        linkContainer.innerHTML = "";
      }

    } catch (error) {
      console.error("❌ Erreur préparation paiement :", error);
      const code = error?.code || "";
      const isBusiness = /failed-precondition|out-of-range|invalid-argument|resource-exhausted/.test(code);
      window.showToast(isBusiness && error?.message ? error.message : t("toasts.checkout.secureConnectionError"), "error");
      this.closePaymentSheet();
    }
  }

  async submitStripePayment() {
    if (!this.stripeInstance || !this.stripeElements) {
      window.showToast(t("toasts.checkout.secureConnectionWait"), "error");
      return;
    }

    const currentUser = auth?.currentUser;
    if (currentUser?.isAnonymous && !this.guestEmail) {
      this.errorMessage = "Renseignez votre email pour recevoir le reçu.";
      window.triggerVibration?.("error");
      const linkEl = this.shadowRoot.getElementById("link-authentication-element");
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

    this.isProcessing = true;
    this.errorMessage = '';

    try {
      const { error, paymentIntent } = await this.stripeInstance.confirmPayment({
        elements: this.stripeElements,
        confirmParams: { return_url: window.location.origin + window.location.pathname },
        redirect: "if_required",
      });

      if (error) {
        this.errorMessage = error.message;
        window.triggerVibration?.("error");
      } else if (paymentIntent && paymentIntent.status === "succeeded") {
        window.showToast(t("toasts.checkout.paymentSuccess"), "success");
        this.closePaymentSheet();
        await this.finalizeOrderInFirestore(paymentIntent.id);
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
      const clientNom = currentUser?.displayName || (email ? email.split("@")[0] : "Client");

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

      store.clearCart();
      window.triggerVibration?.("jackpot");

      if (window.snackConfig?.features?.enableClickAndCollect || window.snackConfig?.features?.enableDelivery) {
        localStorage.setItem("activeOrderId", orderId);
        window.startOrderTracking?.(orderId);
      }

      store.resetDelivery?.();

      setTimeout(() => {
        window.openTrackingModal?.();
      }, 500);

    } catch (err) {
      console.error("Erreur finalisation commande :", err);
      window.showToast(t("toasts.checkout.orderFinalizeError"), "error");
    }
  }

  _buildOrderItemsPayload() {
    return store.state.cart.map((item) => ({
      id: item.id,
      productId: item.productId || (typeof item.id === "string" ? item.id.split("-")[0] : null),
      nom: item.nom,
      type: item.formule || item.type || "seul",
      boissonNom: item.boisson || null,
      sauces: item.sauces || [],
      sansCrudites: item.sansCrudites || [],
      tailleChoisie: item.taille || item.tailleChoisie || null,
      prix: item.prix || item.prixBase || 0,
      prixBase: item.prixBase || item.prix,
      prixMenuAdd: item.prixMenuAdd || 0,
      quantity: item.quantity,
      viaUpsell: item.viaUpsell === true,
    }));
  }

  _getDeliveryPayload() {
    const delivery = store.state.delivery || { mode: "collect" };
    const isDelivery = delivery.mode === "delivery";
    const livraison = isDelivery && delivery.address ? {
      adresse: delivery.address.adresse || "",
      lat: delivery.address.lat,
      lng: delivery.address.lng,
    } : null;
    return { mode: isDelivery ? "delivery" : "collect", livraison };
  }

  _loadStripeSdk() {
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

  openPaymentSheet() {
    this.isOpen = true;
    document.body.style.overflow = "hidden";
  }

  closePaymentSheet() {
    this.isOpen = false;
    document.body.style.overflow = "";
    const paymentContainer = this.shadowRoot.getElementById("payment-element");
    if (paymentContainer) paymentContainer.innerHTML = "";
    const linkContainer = this.shadowRoot.getElementById("link-authentication-element");
    if (linkContainer) linkContainer.innerHTML = "";
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
              <h3 class="text-xl font-black text-text">Paiement Sécurisé</h3>
              <p class="text-lg font-bold text-red-600">Total : ${this.totalAmount.toFixed(2)} €</p>
            </div>

            <div id="link-authentication-element" class="mb-3 hidden"></div>
            <div id="payment-element" class="min-h-[250px]"></div>

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
                ? html`<i data-lucide="loader-circle" class="animate-spin mr-2"></i> Vérification banque...` 
                : html`<i data-lucide="lock" class="mr-2"></i> Payer ${this.totalAmount.toFixed(2)} €`}
            </button>
            <button @click="${this.closePaymentSheet}" class="w-full py-3 text-sm font-bold text-text-muted hover:text-text">
              Annuler
            </button>
          </div>
          
        </div>
      </div>
    `;
  }
}

customElements.define('snack-checkout', SnackCheckout);
