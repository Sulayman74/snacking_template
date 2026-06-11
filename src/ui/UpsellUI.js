/**
 * ➕ UpsellUI — Bottom-sheet de suggestions juste avant le paiement.
 *
 * SOLID : présentation pure, aucune logique métier.
 *   - Source des suggestions : store.getUpsellSuggestions()
 *   - Action "Ajouter"      : store.addToCart()
 *   - Décision finale       : Promise<"continue"|"cancel">
 *
 * Pattern Promise (cf. ModalManager.confirmAction) : show() ouvre la sheet,
 * cleanup() la ferme et résout. Permet `await upsellUI.show()` dans le checkout.
 *
 * Dépendances DOM (déclarées dans index.html) :
 *   #upsell-bottom-sheet, #upsell-sheet-content, #upsell-suggestions,
 *   #upsell-item-template, [data-upsell-action="continue"|"cancel"]
 */

import { store } from "../core/Store.js";
import { escapeHTML } from "../utils.js";
import { functions, httpsCallable } from "../core/firebase.js";

class UpsellUI {
    constructor() {
        this.sheet = document.getElementById("upsell-bottom-sheet");
        this.content = document.getElementById("upsell-sheet-content");
        this.list = document.getElementById("upsell-suggestions");
        this.template = document.getElementById("upsell-item-template");
        this.titleEl = document.getElementById("upsell-title");

        this.boundKeydown = (e) => this.#handleKeydown(e);
        this.lastFocused = null;
    }

    /**
     * Ouvre la modale avec les suggestions courantes.
     * @param {Object} [opts]
     * @param {boolean} [opts.rushMode=false] - Charge cuisine (décidée serveur) ;
     *   transmise telle quelle au Store qui filtre les suggestions. L'UI ne décide
     *   de rien — elle relaie juste le flag (cf. règle d'or : pas de métier dans l'UI).
     * @returns {Promise<"continue"|"cancel">} action choisie par l'utilisateur.
     *   Si aucune suggestion disponible, résout "continue" sans afficher la modale.
     */
    show({ rushMode = false } = {}) {
        return new Promise((resolve) => {
            if (!this.sheet || !this.content || !this.list || !this.template) {
                console.warn("UpsellUI : DOM manquant, skip upsell.");
                return resolve("continue");
            }

            const suggestions = store.getUpsellSuggestions(3, { rushMode });
            if (suggestions.length === 0) return resolve("continue");

            this.#renderSuggestions(suggestions);
            this.#open();

            // 📊 Instrumentation "shown" (fire-and-forget) : ne bloque ni ne
            // rejette jamais le tunnel (cf. règle d'or : un upsell ne casse
            // jamais le checkout).
            this.#trackShown(suggestions.map((p) => p.id));

            const cleanup = (action) => {
                this.sheet.removeEventListener("click", onSheetClick);
                document.removeEventListener("keydown", this.boundKeydown);
                this.#close();
                setTimeout(() => resolve(action), 300);
            };

            const onSheetClick = (e) => {
                const trigger = e.target.closest("[data-upsell-action]");
                if (!trigger) return;
                const action = trigger.getAttribute("data-upsell-action");
                if (action === "continue" || action === "cancel") cleanup(action);
            };

            this.sheet.addEventListener("click", onSheetClick);
            this._resolveCurrent = (action) => cleanup(action);
            document.addEventListener("keydown", this.boundKeydown);
        });
    }

    #renderSuggestions(suggestions) {
        this.list.innerHTML = "";
        const fragment = document.createDocumentFragment();

        suggestions.forEach((p) => {
            const clone = this.template.content.cloneNode(true);
            const li = clone.querySelector("li");

            const img = clone.querySelector(".upsell-item-image");
            const fallback = clone.querySelector(".upsell-item-fallback");

            if (p.image && p.image.trim() !== "") {
                img.src = p.image;
                img.alt = p.nom || "";
                img.onerror = () => {
                    img.style.display = "none";
                    fallback.classList.remove("hidden");
                    fallback.classList.add("flex");
                };
            } else {
                img.style.display = "none";
                fallback.classList.remove("hidden");
                fallback.classList.add("flex");
            }

            clone.querySelector(".upsell-item-name").textContent = p.nom || "";
            const prix = typeof p.prix === "number" ? p.prix : 0;
            clone.querySelector(".upsell-item-price").textContent = `${prix.toFixed(2)} €`;

            const addBtn = clone.querySelector(".upsell-add-btn");
            addBtn.setAttribute("aria-label", `Ajouter ${p.nom || "ce produit"} au panier`);
            addBtn.onclick = () => this.#handleAdd(p, li, addBtn);

            fragment.appendChild(clone);
        });

        this.list.appendChild(fragment);
    }

    #handleAdd(product, liElement, btnElement) {
        // L'ajout passe par le Store, qui émet "cart-updated" et persiste.
        store.addToCart({
            id: product.id,
            productId: product.id,
            nom: product.nom,
            prix: product.prix,
            prixBase: product.prix,
            image: product.image || "",
            type: "seul",
            viaUpsell: true, // 📊 tag d'attribution (mesure accepted/revenue serveur)
        });

        window.triggerVibration?.("light");

        // Feedback visuel inline : pas de re-render complet (l'item disparaîtra
        // si on rouvre la modale, c'est suffisant pour ce flow court).
        btnElement.disabled = true;
        btnElement.innerHTML = `<i class="fas fa-check mr-1"></i> Ajouté`;
        btnElement.classList.add("bg-green-600");
        btnElement.classList.remove("bg-primary");
        liElement.classList.add("opacity-60");
    }

    /**
     * Incrémente le compteur `shown` côté serveur (onCall trackUpsellShown).
     * Fire-and-forget : tout échec (réseau, auth) est silencieux pour ne jamais
     * impacter l'affichage ni le checkout. Source de vérité de l'agrégat = serveur.
     * @param {string[]} productIds — IDs des produits affichés dans la sheet.
     */
    #trackShown(productIds) {
        try {
            const snackId = window.snackConfig?.identity?.id;
            if (!snackId || !Array.isArray(productIds) || productIds.length === 0) return;
            const track = httpsCallable(functions, "trackUpsellShown");
            track({ snackId, productIds: productIds.slice(0, 10) }).catch((e) => {
                console.warn("trackUpsellShown échec (non bloquant) :", e?.message || e);
            });
        } catch (e) {
            console.warn("trackUpsellShown skip :", e?.message || e);
        }
    }

    #open() {
        this.lastFocused = document.activeElement;
        this.sheet.classList.remove("hidden");
        this.sheet.classList.add("flex");
        document.body.style.overflow = "hidden";
        setTimeout(() => {
            this.sheet.classList.remove("opacity-0");
            this.content.classList.remove("translate-y-full");
            // Focus initial sur le bouton "Continuer" (action principale)
            const continueBtn = this.sheet.querySelector('[data-upsell-action="continue"]');
            continueBtn?.focus();
        }, 10);
    }

    #close() {
        this.sheet.classList.add("opacity-0");
        this.content.classList.add("translate-y-full");
        document.body.style.overflow = "";
        setTimeout(() => {
            this.sheet.classList.add("hidden");
            this.sheet.classList.remove("flex");
            // Restaure le focus précédent (A11Y)
            if (this.lastFocused && typeof this.lastFocused.focus === "function") {
                this.lastFocused.focus();
            }
        }, 300);
    }

    #handleKeydown(e) {
        if (e.key === "Escape") {
            this._resolveCurrent?.("cancel");
            return;
        }
        if (e.key !== "Tab") return;

        // Focus trap minimal
        const focusables = this.sheet.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            last.focus();
            e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
            first.focus();
            e.preventDefault();
        }
    }
}

export const upsellUI = new UpsellUI();

// Bridge global (cohérent avec le reste du projet : window.processCheckout, etc.)
window.upsellUI = upsellUI;
