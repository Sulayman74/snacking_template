// ============================================================================
// 🚚 DeliveryUI — Choix Emporter/Livraison + adresse/géoloc + devis (ETA/frais)
// ============================================================================
// SOLID : aucune logique métier ici (géométrie/ETA dans geoService, état dans
// Store). Cette classe = présentation + capture d'inputs. Rendu dans
// #delivery-section (footer du panier). Réagit à config/cart/delivery-updated.
// Theming : couleurs via classes Tailwind du thème (bg-primary/text-on-primary).

import { store } from "./core/Store.js";
import { t } from "./i18n/index.js";
import {
  quoteDelivery,
  getCurrentPosition,
  isGeolocationSupported,
  etaPrepMin,
  formatDistance,
  formatEta,
  isLatLng,
} from "./services/geoService.js";
import { searchAddresses, reverseGeocode, isPreciseAddress } from "./services/addressService.js";

const SUGGEST_DEBOUNCE_MS = 250;

class DeliveryUI {
  constructor() {
    this.container = document.getElementById("delivery-section");
    this.busy = false; // verrou anti double-clic géoloc
    this.suggestions = []; // dernières suggestions d'adresse affichées
    this.suggestTimer = null;
    this.suggestAbort = null;
    if (!this.container) return;
    this.init();
  }

  init() {
    // Délégation scopée au conteneur (même style que CartUI) → pas de pollution
    // du routeur global.
    this.container.addEventListener("click", (e) => this.onClick(e));
    this.container.addEventListener("submit", (e) => this.onSubmit(e));
    this.container.addEventListener("input", (e) => this.onInput(e));

    // config-updated : la géo resto a pu se charger → on resynchronise le quote.
    store.addEventListener("config-updated", () => { this.syncQuote(); this.render(); });
    store.addEventListener("delivery-updated", () => this.render());
    store.addEventListener("cart-updated", () => this.render());

    this.render();
  }

  get cfg() {
    return store.state.config;
  }

  get deliveryEnabled() {
    return Boolean(this.cfg?.features?.enableDelivery);
  }

  get collectEnabled() {
    // Par défaut true si la feature n'est pas explicitement coupée (legacy).
    return this.cfg?.features?.enableClickAndCollect !== false;
  }

  subtotal() {
    return store.state.cart.reduce((acc, i) => acc + i.prix * i.quantity, 0);
  }

  // --- Rendu --------------------------------------------------------------
  render() {
    if (!this.container) return;

    // Livraison désactivée → on n'affiche RIEN (comportement collect legacy).
    if (!this.deliveryEnabled) {
      this.container.innerHTML = "";
      return;
    }

    // Si seule la livraison est active, on force le mode delivery.
    if (!this.collectEnabled && store.state.delivery.mode !== "delivery") {
      store.setDeliveryMode("delivery"); // déclenche un re-render via l'event
      return;
    }

    const mode = store.state.delivery.mode;
    const toggle = this.collectEnabled ? this.renderToggle(mode) : "";
    const body = mode === "delivery" ? this.renderDeliveryBody() : this.renderCollectBody();

    this.container.innerHTML = `${toggle}${body}`;
  }

  renderToggle(mode) {
    const seg = (m, icon, label) => {
      const active = mode === m;
      const cls = active
        ? "bg-primary text-on-primary shadow"
        : "bg-transparent text-text-muted hover:text-text";
      return `<button type="button" data-delivery-action="set-mode" data-mode="${m}"
        aria-pressed="${active}"
        class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all ${cls}">
        <i data-lucide="${icon}"></i> ${label}</button>`;
    };
    return `
      <div class="flex gap-1 p-1 bg-surface-3/70 rounded-xl mb-4" role="group" aria-label="Mode de retrait">
        ${seg("collect", "shopping-bag", "Emporter")}
        ${seg("delivery", "bike", "Livraison")}
      </div>`;
  }

  // L'heure de retrait (dès que possible / plus tard) est rendue par pickup.js
  // (#pickup-section), y compris pour les snacks sans livraison.
  renderCollectBody() {
    return "";
  }

  renderDeliveryBody() {
    const d = this.cfg?.delivery || {};
    const resto = this.cfg?.geo;
    const addr = store.state.delivery.address;
    const subtotal = this.subtotal();

    // Pas encore d'adresse → invite à se localiser / saisir.
    if (!addr || !isLatLng(addr)) {
      return `
        ${this.geoSupportNote()}
        <div class="bg-surface border border-line rounded-xl p-3 mb-4 space-y-3">
          <button type="button" data-delivery-action="locate"
            class="w-full bg-primary text-on-primary font-bold py-3 rounded-lg flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50">
            <i data-lucide="locate-fixed"></i> Me localiser
          </button>
          <div class="flex items-center gap-2 text-[11px] text-text-muted">
            <span class="flex-1 h-px bg-surface-3"></span>ou<span class="flex-1 h-px bg-surface-3"></span>
          </div>
          <form data-delivery-form="address" class="relative">
            <div class="flex gap-2">
              <input name="address" type="text" autocomplete="street-address" required
                role="combobox" aria-autocomplete="list" aria-controls="delivery-suggestions" aria-expanded="false"
                aria-label="${escapeText(t("delivery.addressLabel"))}"
                placeholder="${escapeText(t("delivery.addressPlaceholder"))}"
                class="flex-1 min-w-0 bg-surface text-text border border-line rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
              <button type="submit" class="shrink-0 bg-primary text-on-primary font-bold px-4 rounded-lg text-sm active:scale-95 transition">OK</button>
            </div>
            <ul id="delivery-suggestions" role="listbox" class="mt-2 bg-surface border border-line rounded-lg overflow-hidden divide-y divide-line hidden"></ul>
          </form>
        </div>`;
    }

    // Devis (Haversine) pour AFFICHAGE uniquement — render ne mute jamais le
    // store (sinon boucle delivery-updated → render). Le store est tenu à jour
    // par syncQuote() depuis les handlers.
    const restoKnown = isLatLng(resto);
    const quote = this.computeQuote() || quoteDelivery({ resto, client: addr, delivery: d, queueCount: 0 });

    const belowMin = d.minOrder > 0 && subtotal < d.minOrder;
    const outOfRange = restoKnown && !quote.inRange;

    const contact = store.state.delivery.contact || {};
    const addrLine = `
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="flex items-start gap-2 min-w-0">
          <i data-lucide="map-pin" class="text-primary mt-1"></i>
          <p class="text-sm text-text font-medium break-words">${escapeText(addr.adresse || t("delivery.gpsPosition"))}</p>
        </div>
        <button type="button" data-delivery-action="reset-address" class="shrink-0 text-xs text-primary font-bold underline">Changer</button>
      </div>
      <div class="grid gap-2 mb-3">
        <label class="grid gap-1 text-xs font-bold text-text-muted">
          ${escapeText(t("delivery.complementLabel"))}
          <input name="complement" data-delivery-contact="complement" type="text" autocomplete="address-line2" maxlength="200"
            value="${escapeText(contact.complement || "")}"
            placeholder="${escapeText(t("delivery.complementPlaceholder"))}"
            class="bg-surface text-text font-normal border border-line rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
        </label>
        <label class="grid gap-1 text-xs font-bold text-text-muted">
          ${escapeText(t("delivery.phoneLabel"))}
          <input name="telephone" data-delivery-contact="telephone" type="tel" inputmode="tel" autocomplete="tel" maxlength="25" required
            value="${escapeText(contact.telephone || "")}"
            placeholder="06 12 34 56 78"
            class="bg-surface text-text font-normal border border-line rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
        </label>
      </div>`;

    if (outOfRange) {
      return `
        <div class="bg-surface border border-line rounded-xl p-3 mb-4">
          ${addrLine}
          <div class="flex items-center gap-2 text-sm text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
            <i data-lucide="triangle-alert"></i>
            <span>Hors zone de livraison (${formatDistance(quote.distanceKm)} > ${d.radiusKm} km).</span>
          </div>
        </div>`;
    }

    const etaRow = `
      <div class="flex items-center justify-between text-sm py-1.5">
        <span class="text-text-muted"><i data-lucide="clock" class="mr-1.5 text-primary"></i>Livraison estimée</span>
        <span class="font-bold text-text">${formatEta(quote.totalMin)}${restoKnown ? ` · ${formatDistance(quote.distanceKm)}` : ""}</span>
      </div>`;

    const feeRow = `
      <div class="flex items-center justify-between text-sm py-1.5 border-t border-line">
        <span class="text-text-muted">Sous-total</span><span class="text-text">${subtotal.toFixed(2)} €</span>
      </div>
      <div class="flex items-center justify-between text-sm py-1.5">
        <span class="text-text-muted"><i data-lucide="bike" class="mr-1.5 text-primary"></i>Frais de livraison</span>
        <span class="text-text">${Number(quote.frais).toFixed(2)} €</span>
      </div>`;

    const minWarn = belowMin
      ? `<div class="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mt-2">
           <i data-lucide="info"></i><span>Minimum de commande : ${d.minOrder.toFixed(2)} € (il manque ${(d.minOrder - subtotal).toFixed(2)} €).</span>
         </div>`
      : "";

    return `
      <div class="bg-surface border border-line rounded-xl p-3 mb-4">
        ${addrLine}${etaRow}${feeRow}${minWarn}
      </div>`;
  }

  // --- Devis (état) -------------------------------------------------------
  // Calcule le devis courant (ou null si pas applicable). Fonction PURE de lecture.
  computeQuote() {
    if (store.state.delivery.mode !== "delivery") return null;
    const addr = store.state.delivery.address;
    if (!isLatLng(addr)) return null;
    return quoteDelivery({
      resto: this.cfg?.geo,
      client: addr,
      delivery: this.cfg?.delivery || {},
      queueCount: 0, // estimation pré-paiement ; le serveur affinera avec la file réelle
    });
  }

  // Met à jour le quote dans le Store (→ getDeliveryFee/getCartTotal corrects).
  // Appelé depuis les handlers (jamais depuis render).
  syncQuote() {
    store.setDeliveryQuote(this.computeQuote());
  }

  geoSupportNote() {
    if (isGeolocationSupported()) return "";
    return `<p class="text-[11px] text-text-muted mb-2">Géolocalisation indisponible : saisissez votre adresse.</p>`;
  }

  // --- Interactions -------------------------------------------------------
  onClick(e) {
    const btn = e.target.closest("[data-delivery-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-delivery-action");

    if (action === "set-mode") {
      store.setDeliveryMode(btn.getAttribute("data-mode"));
      this.syncQuote();
      window.triggerVibration?.("light");
    } else if (action === "locate") {
      this.locate(btn);
    } else if (action === "reset-address") {
      store.setDeliveryAddress(null);
      this.syncQuote();
    } else if (action === "pick-suggestion") {
      const picked = this.suggestions[Number(btn.getAttribute("data-index"))];
      if (picked) this.setAddress(picked);
    }
  }

  onInput(e) {
    const contactField = e.target.closest("[data-delivery-contact]");
    if (contactField) {
      store.setDeliveryContact({ [contactField.getAttribute("data-delivery-contact")]: contactField.value });
      return;
    }
    if (e.target.name !== "address") return;
    clearTimeout(this.suggestTimer);
    const value = e.target.value;
    this.suggestTimer = setTimeout(() => this.suggest(value), SUGGEST_DEBOUNCE_MS);
  }

  onSubmit(e) {
    const form = e.target.closest('[data-delivery-form="address"]');
    if (!form) return;
    e.preventDefault();
    clearTimeout(this.suggestTimer);
    const value = form.querySelector('input[name="address"]')?.value?.trim();
    if (value) this.geocodeAndSet(value);
  }

  // Autocomplétion : ne re-rend QUE la liste (le champ garde le focus).
  async suggest(text) {
    this.suggestAbort?.abort();
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    this.suggestAbort = ctrl;
    try {
      this.suggestions = await searchAddresses(text, { near: this.cfg?.geo, signal: ctrl?.signal });
    } catch (err) {
      if (err?.name === "AbortError") return;
      this.suggestions = [];
    }
    this.renderSuggestions();
  }

  renderSuggestions() {
    const list = this.container?.querySelector("#delivery-suggestions");
    const input = this.container?.querySelector('input[name="address"]');
    if (!list) return;
    const open = this.suggestions.length > 0;
    list.classList.toggle("hidden", !open);
    input?.setAttribute("aria-expanded", String(open));
    list.innerHTML = this.suggestions.map((s, i) => `
      <li role="option">
        <button type="button" data-delivery-action="pick-suggestion" data-index="${i}"
          class="w-full text-left px-3 py-2.5 text-sm text-text hover:bg-surface-2 flex items-start gap-2">
          <i data-lucide="map-pin" class="text-text-muted mt-0.5 shrink-0"></i>
          <span class="min-w-0 break-words">${escapeText(s.label)}</span>
        </button>
      </li>`).join("");
  }

  // Seule porte d'entrée d'une adresse saisie : refuse une commune entière.
  setAddress(address) {
    if (!isPreciseAddress(address)) {
      window.showToast?.(t("toasts.delivery.addressTooVague"), "error");
      return;
    }
    this.suggestions = [];
    store.setDeliveryAddress({ adresse: address.label, lat: address.lat, lng: address.lng, type: address.type });
    this.syncQuote();
    window.triggerVibration?.("success");
  }

  async locate(btn) {
    if (this.busy) return;
    this.busy = true;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin"></i> Localisation…`;
    try {
      const pos = await getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
      // Adresse lisible pour le livreur (géocodage inverse) ; la position GPS reste
      // la référence de distance. Service injoignable → on garde la position seule.
      let label = t("delivery.gpsPosition");
      try {
        const nearest = await reverseGeocode(pos);
        if (nearest?.label) label = nearest.label;
      } catch { /* libellé par défaut */ }
      store.setDeliveryAddress({ adresse: label, lat: pos.lat, lng: pos.lng, type: "gps" });
      this.syncQuote();
      window.triggerVibration?.("success");
    } catch (err) {
      const msg =
        err.code === "denied"
          ? t("toasts.delivery.locationDenied")
          : t("toasts.delivery.locationFailed");
      window.showToast?.(msg, "error");
      btn.disabled = false;
      btn.innerHTML = original;
    } finally {
      this.busy = false;
    }
  }

  async geocodeAndSet(text) {
    try {
      const results = await searchAddresses(text, { near: this.cfg?.geo });
      if (results.length === 0) {
        window.showToast?.(t("toasts.delivery.addressNotFound"), "error");
        return;
      }
      // Premier résultat précis ; sinon on montre les suggestions pour préciser.
      const precise = results.find(isPreciseAddress);
      if (precise) {
        this.setAddress(precise);
      } else {
        this.suggestions = results;
        this.renderSuggestions();
        window.showToast?.(t("toasts.delivery.addressTooVague"), "error");
      }
    } catch {
      window.showToast?.(t("toasts.delivery.searchError"), "error");
    }
  }
}

// Échappe le texte injecté en innerHTML (réutilise le helper global si présent).
function escapeText(s) {
  if (window.escapeHTML) return window.escapeHTML(s);
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

export const deliveryUI = new DeliveryUI();
if (typeof window !== "undefined") window.deliveryUI = deliveryUI;
