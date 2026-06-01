// ============================================================================
// ❤️ FAVORIS — Sauvegarde & re-commande des achats personnalisés (SOLID: Service)
// ============================================================================
// La logique métier des favoris vit ici ; le rendu est dans ui/FavoritesUI.js.
// Stockage : users/{uid}.favorites — tableau de snapshots d'articles personnalisés.
// Sécurité : un favori n'est qu'un raccourci d'UI. Le prix stocké N'EST PAS de
// confiance : le tunnel de commande (finalizeOrder) recalcule TOUJOURS le montant
// côté serveur et le confronte à Stripe. Cf. functions/index.js (finalizeOrder).

import { store } from "./core/Store.js";
import "./ui/FavoritesUI.js";
import { favoriteKey, showToast, triggerVibration } from "./utils.js";

/** Plafond anti-bloat du document utilisateur (favoris tous snacks confondus). */
const MAX_FAVORITES = 50;

class FavoritesService {
  constructor() {
    this.unsubscribe = null;
    this.#init();
  }

  #init() {
    // (Dé)branche l'écoute temps réel selon l'état d'authentification.
    store.addEventListener("auth-updated", () => this.#syncListener());
  }

  /** snackId courant (partitionnement) — aligné sur checkout.js. */
  #snackId() {
    return (
      store.state.config?.identity?.id ||
      window.snackConfig?.identity?.id ||
      window.CURRENT_SNACK_ID ||
      "Ym1YiO4Ue5Fb5UXlxr06"
    );
  }

  /**
   * Abonne/désabonne le listener Firestore sur users/{uid}.favorites.
   * Réutilise le doc utilisateur déjà écouté ailleurs (Firestore dédoublonne le réseau).
   */
  #syncListener() {
    const user = store.state.user;

    if (!user) {
      if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
      store.setFavorites([]);
      return;
    }

    // Déjà abonné (re-render d'auth sans changement d'utilisateur) → on ne double pas.
    if (this.unsubscribe) return;

    try {
      const { doc, onSnapshot } = window.fs;
      this.unsubscribe = onSnapshot(
        doc(window.db, "users", user.uid),
        (snap) => {
          const data = snap.exists() ? snap.data() : {};
          // On garde le tableau COMPLET (tous snacks) dans le store ; l'UI filtre
          // par snackId courant. Indispensable pour ne pas écraser les favoris
          // d'un autre snack lors d'une écriture.
          store.setFavorites(Array.isArray(data.favorites) ? data.favorites : []);
        },
        (err) => console.error("Favoris : écoute interrompue", err)
      );
    } catch (err) {
      console.error("Favoris : init listener impossible", err);
    }
  }

  /** Favoris du snack courant uniquement (pour l'affichage). */
  getForCurrentSnack() {
    const snackId = this.#snackId();
    return (store.state.favorites || []).filter((f) => f.snackId === snackId);
  }

  /** L'article personnalisé est-il déjà en favori (snack courant) ? */
  isFavorite(item) {
    const key = favoriteKey(item);
    const snackId = this.#snackId();
    return (store.state.favorites || []).some(
      (f) => f.favId === key && f.snackId === snackId
    );
  }

  /** Construit le snapshot favori à partir d'un article au format panier. */
  #buildFavorite(item) {
    return {
      favId: favoriteKey(item),
      snackId: this.#snackId(),
      label: item.nom || "Mon favori",
      createdAt: Date.now(),
      // Snapshot complet : tel quel, il se ré-ajoute au panier à l'identique.
      item: {
        id: item.id,
        productId: item.productId || null,
        nom: item.nom || "",
        prix: Number(item.prix) || 0,
        image: item.image || "",
        formule: item.formule || null,
        boisson: item.boisson || null,
        taille: item.taille || null,
        sauces: Array.isArray(item.sauces) ? item.sauces : [],
        sansCrudites: Array.isArray(item.sansCrudites) ? item.sansCrudites : [],
      },
    };
  }

  /**
   * Bascule l'état favori d'un article personnalisé (ajout ⇄ retrait).
   * @param {Object} item - Article au format panier.
   * @returns {Promise<boolean|undefined>} true si ajouté, false si retiré.
   */
  async toggle(item) {
    if (!store.state.user) {
      showToast("Connectez-vous pour enregistrer vos favoris", "error");
      window.toggleAuthModal?.();
      return;
    }
    if (this.isFavorite(item)) {
      await this.remove(favoriteKey(item));
      return false;
    }
    await this.add(item);
    return true;
  }

  /** Ajoute un article aux favoris (idempotent par favId + snackId). */
  async add(item) {
    const user = store.state.user;
    if (!user) {
      showToast("Connectez-vous pour enregistrer vos favoris", "error");
      window.toggleAuthModal?.();
      return;
    }

    const fav = this.#buildFavorite(item);
    const all = store.state.favorites || [];

    if (all.some((f) => f.favId === fav.favId && f.snackId === fav.snackId)) {
      showToast("Déjà dans vos favoris ❤️", "success");
      return;
    }
    if (this.getForCurrentSnack().length >= MAX_FAVORITES) {
      showToast(`Maximum ${MAX_FAVORITES} favoris atteint`, "error");
      return;
    }

    const next = [...all, fav];
    try {
      const { doc, updateDoc } = window.fs;
      await updateDoc(doc(window.db, "users", user.uid), { favorites: next });
      store.setFavorites(next); // optimiste (le snapshot confirmera)
      triggerVibration?.("success");
      showToast("Ajouté à vos favoris ❤️", "success");
    } catch (err) {
      console.error("Favoris : ajout impossible", err);
      showToast("Impossible d'enregistrer ce favori", "error");
    }
  }

  /** Retire un favori par sa clé (favId), sur le snack courant. */
  async remove(favId) {
    const user = store.state.user;
    if (!user) return;

    const snackId = this.#snackId();
    const next = (store.state.favorites || []).filter(
      (f) => !(f.favId === favId && f.snackId === snackId)
    );
    try {
      const { doc, updateDoc } = window.fs;
      await updateDoc(doc(window.db, "users", user.uid), { favorites: next });
      store.setFavorites(next); // optimiste
      triggerVibration?.("light");
      showToast("Retiré de vos favoris", "success");
    } catch (err) {
      console.error("Favoris : retrait impossible", err);
      showToast("Impossible de retirer ce favori", "error");
    }
  }

  /** Ré-ajoute un favori au panier (re-commande 1-tap). */
  reorder(favId) {
    const fav = (store.state.favorites || []).find((f) => f.favId === favId);
    if (!fav?.item) return showToast("Favori introuvable", "error");
    store.addToCart({ ...fav.item });
    triggerVibration?.("success");
    showToast("Ajouté au panier ! 🛒", "success");
  }
}

export const favoritesService = new FavoritesService();

// --- PONTS GLOBAUX (cohérent avec le reste de l'app) ---
window.favoritesService = favoritesService;
window.toggleFavorite = (item) => favoritesService.toggle(item);
window.reorderFavorite = (favId) => favoritesService.reorder(favId);
window.removeFavorite = (favId) => favoritesService.remove(favId);
