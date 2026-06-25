// ============================================================================
// 🔁 RE-COMMANDE — « Recommander ma dernière commande » (SOLID: Service)
// ============================================================================
// La logique métier vit ici ; le rendu est dans ui/ReorderUI.js.
// Source : dernière commande de l'utilisateur sur le snack courant (collection
// `commandes`, partitionnée par snackId). Aucun nouveau stockage : on relit
// l'historique existant et on re-remplit le panier via Store.addToCart, après
// revalidation contre le menu courant (Store.validateAgainstMenu — LOT A).
// Sécurité : les prix re-injectés restent SANS confiance, finalizeOrder
// recalcule toujours le montant côté serveur (functions/index.js).

import { store } from "./core/Store.js";
import "./ui/ReorderUI.js";
import { showToast, triggerVibration } from "./utils.js";
import { t } from "./i18n/index.js";
import {
  db,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "./core/firebase.js";

class ReorderService {
  constructor() {
    // Mémo "uid|snackId" déjà chargé : évite de relancer la requête à chaque
    // refresh de token Firebase (~1h) qui ré-émet auth-updated.
    this.fetchedFor = null;
    this.#init();
  }

  #init() {
    store.addEventListener("auth-updated", () => this.#refresh());
    store.addEventListener("config-updated", () => this.#refresh());
  }

  /** snackId courant (partitionnement) — aligné sur favorites.js / checkout.js. */
  #snackId() {
    return (
      store.state.config?.identity?.id ||
      window.snackConfig?.identity?.id ||
      window.CURRENT_SNACK_ID ||
      "Ym1YiO4Ue5Fb5UXlxr06"
    );
  }

  /**
   * Charge (une fois par session/utilisateur) la dernière commande du snack
   * courant et la publie dans le Store (événement `last-order-updated`).
   * Requête couverte par l'index composite (snackId ASC, userId ASC, date DESC)
   * et par la rule de lecture isOwner(resource.data.userId).
   */
  async #refresh() {
    const user = store.state.user;
    const snackId = this.#snackId();

    if (!user) {
      this.fetchedFor = null;
      if (store.state.lastOrder) store.setLastOrder(null);
      return;
    }

    const key = `${user.uid}|${snackId}`;
    if (this.fetchedFor === key) return;
    this.fetchedFor = key;

    try {
      const q = query(
        collection(db, "commandes"),
        where("snackId", "==", snackId),
        where("userId", "==", user.uid),
        orderBy("date", "desc"),
        limit(1)
      );
      const snap = await getDocs(q);
      const docSnap = snap.docs[0];
      store.setLastOrder(docSnap ? { id: docSnap.id, ...docSnap.data() } : null);
    } catch (err) {
      console.error("Re-commande : lecture de la dernière commande impossible", err);
      store.setLastOrder(null);
    }
  }

  /**
   * Re-remplit le panier avec les articles de la dernière commande, après
   * revalidation de chaque ligne contre le menu courant, puis ouvre le panier
   * (chemin direct vers le checkout). Les lignes périmées sont exclues avec
   * un message ; les lignes reprixées sont ajoutées au prix courant.
   */
  reorderLastOrder() {
    const order = store.state.lastOrder;
    if (!Array.isArray(order?.items) || order.items.length === 0) {
      return showToast(t("toasts.reorder.notFound"), "error");
    }

    let added = 0;
    let skipped = 0;
    let repriced = 0;

    for (const item of order.items) {
      const check = store.validateAgainstMenu(item);
      if (!check.ok) {
        skipped++;
        continue;
      }
      if (check.reason === "reprice") repriced++;

      // addToCart ajoute 1 unité (ou incrémente la ligne existante par id) :
      // on rejoue la quantité commandée.
      const qty = Math.max(1, Number(item.quantity) || 1);
      for (let i = 0; i < qty; i++) store.addToCart({ ...check.currentItem });
      added++;
    }

    if (added === 0) {
      triggerVibration?.("error");
      return showToast(t("toasts.reorder.unavailable"), "error");
    }

    triggerVibration?.("success");
    if (skipped > 0) {
      showToast(t("toasts.reorder.itemsSkipped", { skipped, plural: skipped > 1 ? "s" : "" }), "error");
    }
    showToast(
      repriced > 0
        ? t("toasts.reorder.successReprice")
        : t("toasts.reorder.success"),
      "success"
    );
    window.openCartModal?.();
  }
}

export const reorderService = new ReorderService();

// --- PONTS GLOBAUX (cohérent avec le reste de l'app) ---
window.reorderService = reorderService;
window.reorderLastOrder = () => reorderService.reorderLastOrder();
