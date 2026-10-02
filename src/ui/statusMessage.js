// 🚦 Textes pour le client : état de la boutique (core/storefrontStatus) et
// correction du panier (Store.reconcileCart). Présentation seule.
import { t } from "../i18n/index.js";

/** @returns {{title: string, detail: string}|null} null = rien à dire (ouvert). */
export function statusMessage(status) {
  const p = status?.params || {};
  switch (status?.kind) {
    case "maintenance": return { title: t("status.maintenance"), detail: "" };
    case "offline": return { title: t("status.offline"), detail: "" };
    case "mode_disabled":
      return { title: t(p.delivery ? "status.deliveryDisabled" : "status.collectDisabled"), detail: "" };
    case "paused": return { title: t("status.paused", p), detail: t("status.pausedDetail", p) };
    case "closing_soon": return { title: t("status.closingSoon", p), detail: "" };
    case "closed":
    case "closed_schedule": {
      const what = t(p.reason === "cutoff" ? "status.ordersClosed" : "status.closed");
      const when = p.time && p.dayOffset === 0 ? t("status.reopenToday", p)
        : p.time && p.dayOffset === 1 ? t("status.reopenTomorrow", p) : "";
      const detail = status.kind === "closed_schedule" ? t("status.scheduleDetail", { time: p.firstSlot }) : "";
      return { title: when ? `${what} · ${when}` : what, detail };
    }
    default: return null;
  }
}

/** Une phrase (toasts). */
export function statusSentence(status) {
  const m = statusMessage(status);
  return m ? [m.title, m.detail].filter(Boolean).join(". ") : "";
}

/** Texte du toast après correction du panier (Store.reconcileCart). */
export function cartSyncMessage({ removed = [], repriced = [] } = {}) {
  const quote = (n) => `« ${n} »`;
  const parts = [];
  if (removed.length) {
    const names = removed.map(quote).join(", ");
    parts.push(t(removed.length > 1 ? "cartSync.removedMany" : "cartSync.removed", { names }));
  }
  if (repriced.length === 1) {
    parts.push(t("cartSync.repriced", { name: quote(repriced[0].nom), price: repriced[0].prix.toFixed(2) }));
  } else if (repriced.length > 1) {
    parts.push(t("cartSync.repricedMany"));
  }
  return parts.join(" ");
}
