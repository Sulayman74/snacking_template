// ============================================================================
// 🚚 DeliveryUI — Choix Emporter/Livraison + adresse/géoloc + devis (ETA/frais)
// ============================================================================
// SOLID : aucune logique métier ici (géométrie/ETA dans geoService, état dans
// Store). Cette classe = présentation + capture d'inputs. Rendu dans
// #delivery-section (footer du panier). Réagit à config/cart/delivery-updated.
// Theming : couleurs via classes Tailwind du thème (bg-primary/text-on-primary).

import { store } from "./core/Store.js";
import {
  quoteDelivery,
  getCurrentPosition,
  isGeolocationSupported,
  etaPrepMin,
  formatDistance,
  formatEta,
  isLatLng,
} from "./services/geoService.js";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

class DeliveryUI {
  constructor() {
    this.container = document.getElementById("delivery-section");
    this.busy = false; // verrou anti double-clic géoloc
    if (!this.container) return;
    this.init();
  }

  init() {
    // Délégation scopée au conteneur (même style que CartUI) → pas de pollution
    // du routeur global.
    this.container.addEventListener("click", (e) => this.onClick(e));
    this.container.addEventListener("submit", (e) => this.onSubmit(e));

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
        : "bg-transparent text-gray-500 hover:text-gray-800";
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

  renderCollectBody() {
    const d = this.cfg?.delivery || {};
    const prep = etaPrepMin(d.prepBaseMin, 0, 0);
    return `
      <div class="flex items-center gap-2 mb-4 text-sm text-gray-600 bg-white border border-line rounded-xl p-3">
        <i data-lucide="clock" class="text-primary"></i>
        <span>Prêt en magasin dans <b class="text-gray-900">${formatEta(prep)}</b> environ.</span>
      </div>`;
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
        <div class="bg-white border border-line rounded-xl p-3 mb-4 space-y-3">
          <button type="button" data-delivery-action="locate"
            class="w-full bg-primary text-on-primary font-bold py-3 rounded-lg flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50">
            <i data-lucide="locate-fixed"></i> Me localiser
          </button>
          <div class="flex items-center gap-2 text-[11px] text-gray-400">
            <span class="flex-1 h-px bg-surface-3"></span>ou<span class="flex-1 h-px bg-surface-3"></span>
          </div>
          <form data-delivery-form="address" class="flex gap-2">
            <input name="address" type="text" autocomplete="street-address" required
              placeholder="Saisir mon adresse (ville, rue…)"
              class="flex-1 min-w-0 border border-line rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
            <button type="submit" class="shrink-0 bg-gray-900 text-white font-bold px-4 rounded-lg text-sm active:scale-95 transition">OK</button>
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

    const addrLine = `
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="flex items-start gap-2 min-w-0">
          <i data-lucide="map-pin" class="text-primary mt-1"></i>
          <p class="text-sm text-gray-800 font-medium truncate">${escapeText(addr.adresse || "Position GPS")}</p>
        </div>
        <button type="button" data-delivery-action="reset-address" class="shrink-0 text-xs text-primary font-bold underline">Changer</button>
      </div>`;

    if (outOfRange) {
      return `
        <div class="bg-white border border-line rounded-xl p-3 mb-4">
          ${addrLine}
          <div class="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2.5">
            <i data-lucide="triangle-alert"></i>
            <span>Hors zone de livraison (${formatDistance(quote.distanceKm)} > ${d.radiusKm} km).</span>
          </div>
        </div>`;
    }

    const etaRow = `
      <div class="flex items-center justify-between text-sm py-1.5">
        <span class="text-gray-500"><i data-lucide="clock" class="mr-1.5 text-primary"></i>Livraison estimée</span>
        <span class="font-bold text-gray-900">${formatEta(quote.totalMin)}${restoKnown ? ` · ${formatDistance(quote.distanceKm)}` : ""}</span>
      </div>`;

    const feeRow = `
      <div class="flex items-center justify-between text-sm py-1.5 border-t border-line">
        <span class="text-gray-500">Sous-total</span><span class="text-gray-700">${subtotal.toFixed(2)} €</span>
      </div>
      <div class="flex items-center justify-between text-sm py-1.5">
        <span class="text-gray-500"><i data-lucide="bike" class="mr-1.5 text-primary"></i>Frais de livraison</span>
        <span class="text-gray-700">${Number(quote.frais).toFixed(2)} €</span>
      </div>`;

    const minWarn = belowMin
      ? `<div class="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2.5 mt-2">
           <i data-lucide="info"></i><span>Minimum de commande : ${d.minOrder.toFixed(2)} € (il manque ${(d.minOrder - subtotal).toFixed(2)} €).</span>
         </div>`
      : "";

    return `
      <div class="bg-white border border-line rounded-xl p-3 mb-4">
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
    return `<p class="text-[11px] text-gray-400 mb-2">Géolocalisation indisponible : saisissez votre adresse.</p>`;
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
    }
  }

  onSubmit(e) {
    const form = e.target.closest('[data-delivery-form="address"]');
    if (!form) return;
    e.preventDefault();
    const value = form.querySelector('input[name="address"]')?.value?.trim();
    if (value) this.geocodeAndSet(value);
  }

  async locate(btn) {
    if (this.busy) return;
    this.busy = true;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin"></i> Localisation…`;
    try {
      const pos = await getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
      store.setDeliveryAddress({ adresse: "Ma position GPS", lat: pos.lat, lng: pos.lng });
      this.syncQuote();
      window.triggerVibration?.("success");
    } catch (err) {
      const msg =
        err.code === "denied"
          ? "Localisation refusée. Saisissez votre adresse ci-dessous."
          : "Localisation impossible. Saisissez votre adresse.";
      window.showToast?.(msg, "error");
      btn.disabled = false;
      btn.innerHTML = original;
    } finally {
      this.busy = false;
    }
  }

  async geocodeAndSet(text) {
    window.showToast?.("Recherche de l'adresse…", "success");
    try {
      const url = `${GEOCODING_URL}?name=${encodeURIComponent(text)}&count=1&language=fr&format=json`;
      const resp = await fetch(url);
      const data = resp.ok ? await resp.json() : null;
      const match = data?.results?.[0];
      if (!match?.latitude || !match?.longitude) {
        window.showToast?.("Adresse introuvable. Précisez la ville.", "error");
        return;
      }
      store.setDeliveryAddress({
        adresse: [match.name, match.admin1].filter(Boolean).join(", "),
        lat: match.latitude,
        lng: match.longitude,
      });
      this.syncQuote();
    } catch {
      window.showToast?.("Erreur de recherche d'adresse.", "error");
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
