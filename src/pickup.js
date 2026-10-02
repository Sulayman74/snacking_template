// ============================================================================
// 🕒 PickupUI — « Dès que possible » ou « Plus tard » (click & collect)
// ============================================================================
// Rendu dans #pickup-section (panier). Aucune logique horaire ici : créneaux et
// ouverture viennent de core/openingHours (même calcul que le serveur, qui
// revalide le créneau au paiement). État dans le Store (pickup).

import { store } from "./core/Store.js";
import { t } from "./i18n/index.js";
import { getOrderingState, getPickupSlots } from "./core/openingHours.js";

const REFRESH_MS = 60_000; // les créneaux avancent avec l'heure

const formatTime = (date, timeZone) =>
  date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: timeZone || "Europe/Paris" });

class PickupUI {
  constructor() {
    this.container = document.getElementById("pickup-section");
    if (!this.container) return;
    for (const evt of ["config-updated", "delivery-updated", "cart-updated", "pickup-updated"]) {
      store.addEventListener(evt, () => this.render());
    }
    this.container.addEventListener("change", (e) => this.onChange(e));
    // Ne pas re-rendre sous le doigt du client (liste de créneaux ouverte).
    setInterval(() => {
      if (!this.container.contains(document.activeElement)) this.render();
    }, REFRESH_MS);
    this.render();
  }

  get cfg() {
    return store.state.config || {};
  }

  /** Disponibilités au moment `now` (pur, testable). */
  options(now = new Date()) {
    const cfg = this.cfg;
    const prepMin = Number(cfg.delivery?.prepBaseMin) > 0 ? Number(cfg.delivery.prepBaseMin) : 12;
    const ordering = getOrderingState(cfg.hours, now, cfg.timezone, cfg.lastOrderMinutesBeforeClose);
    const slots = getPickupSlots(cfg.hours, now, cfg.timezone, { prepMin });
    return {
      ordering,
      slots,
      asapAvailable: ordering.accepting,
      asapLabel: formatTime(new Date(now.getTime() + prepMin * 60000), cfg.timezone),
    };
  }

  /**
   * Choix effectif à envoyer au serveur. « Dès que possible » indisponible
   * (fermé, heure limite) → premier créneau ; créneau choisi devenu passé →
   * premier créneau encore valable.
   * @returns {null|{mode:"creneau", heure:number}} null = dès que possible
   */
  currentRequest(now = new Date()) {
    const { asapAvailable, slots } = this.options(now);
    const { mode, atMs } = store.state.pickup || {};
    if (mode === "slot") {
      const chosen = slots.find((s) => s.atMs === atMs) || slots[0];
      if (chosen) return { mode: "creneau", heure: chosen.atMs };
    }
    if (!asapAvailable && slots[0]) return { mode: "creneau", heure: slots[0].atMs };
    return null;
  }

  isVisible() {
    const cfg = this.cfg;
    if (!store.state.cart?.length) return false;
    if (store.state.delivery?.mode === "delivery") return false;
    return cfg.features?.enableClickAndCollect !== false;
  }

  statusLine(ordering) {
    if (!ordering.configured) return "";
    if (ordering.accepting) {
      return ordering.cutoffTime
        ? t("pickup.openUntil", { time: ordering.cutoffTime })
        : "";
    }
    const reopen = ordering.nextOpenTime ? ` · ${t("pickup.reopens", { time: ordering.nextOpenTime })}` : "";
    return `${ordering.reason === "cutoff" ? t("pickup.ordersClosed") : t("pickup.closed")}${reopen}`;
  }

  render() {
    if (!this.container) return;
    if (!this.isVisible()) {
      this.container.innerHTML = "";
      return;
    }
    const now = new Date();
    const { ordering, slots, asapAvailable, asapLabel } = this.options(now);
    const request = this.currentRequest(now);
    const isSlot = request?.mode === "creneau";
    const status = this.statusLine(ordering);

    if (!asapAvailable && slots.length === 0) {
      this.container.innerHTML = `
        <p class="flex items-center gap-2 mb-4 text-sm font-bold text-danger bg-surface border border-line rounded-xl p-3">
          <i data-lucide="clock"></i><span>${status || t("pickup.closed")}</span>
        </p>`;
      return;
    }

    const option = (value, checked, disabled, title, extra = "") => `
      <label class="flex items-start gap-3 p-3 rounded-xl border-2 ${checked ? "border-primary bg-primary/5" : "border-line"} ${disabled ? "opacity-50" : "cursor-pointer"}">
        <input type="radio" name="pickup-mode" value="${value}" class="mt-1 accent-primary" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
        <span class="flex-1 min-w-0"><span class="block font-bold text-text text-sm">${title}</span>${extra}</span>
      </label>`;

    const slotSelect = slots.length
      ? `<select name="pickup-slot" aria-label="${t("pickup.chooseTime")}" class="mt-2 w-full bg-surface text-text border border-line rounded-lg px-3 py-2 text-sm" ${isSlot ? "" : "tabindex=\"-1\""}>
          ${slots.map((s) => `<option value="${s.atMs}" ${request?.heure === s.atMs ? "selected" : ""}>${s.label}</option>`).join("")}
        </select>`
      : "";

    this.container.innerHTML = `
      <fieldset class="mb-4 space-y-2">
        <legend class="flex items-center justify-between w-full mb-2 text-sm font-black text-text">
          <span>${t("pickup.title")}</span>
          ${status ? `<span class="text-xs font-bold ${ordering.accepting ? "text-text-muted" : "text-danger"}">${status}</span>` : ""}
        </legend>
        ${option("asap", !isSlot, !asapAvailable, asapAvailable ? t("pickup.asap", { time: asapLabel }) : t("pickup.asapUnavailable"))}
        ${slots.length ? option("slot", isSlot, false, t("pickup.later"), slotSelect) : ""}
      </fieldset>`;
  }

  onChange(e) {
    const target = e.target;
    if (target.name === "pickup-mode") {
      if (target.value === "slot") {
        const first = this.options().slots[0];
        store.setPickup({ mode: "slot", atMs: store.state.pickup?.atMs || first?.atMs });
      } else {
        store.setPickup({ mode: "asap" });
      }
    } else if (target.name === "pickup-slot") {
      store.setPickup({ mode: "slot", atMs: Number(target.value) });
    }
  }
}

export const pickupUI = new PickupUI();
if (typeof window !== "undefined") window.pickupUI = pickupUI;
