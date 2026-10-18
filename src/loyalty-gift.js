// ============================================================================
// 🎁 CADEAU SURPRISE — UI client (autonome)
// ----------------------------------------------------------------------------
// À 10 points, une récompense est banquée (rewardsAvailable). Le client OUVRE son
// cadeau : le produit offert est choisi CÔTÉ SERVEUR (CF spinLoyaltyWheel, nom historique
// conservé — jamais renommer une Cloud Function) parmi les produits que le restaurateur
// a cochés « cadeau ». Aucune mise, aucune case perdante : un don dont seul l'objet est
// tiré au sort, présenté comme une boîte cadeau qui s'ouvre, pas comme un jeu de hasard.
// Module isolé : il injecte son propre overlay et expose des globals consommés par la
// carte fidélité (loyalty.js), le panier et l'accueil (événement loyalty:progress).
// ============================================================================

import { functions, httpsCallable, auth, db, doc, onSnapshot, onAuthStateChanged } from "./core/firebase.js";
import { t } from "./i18n/index.js";
import { progressSummary } from "./core/loyaltyProgress.js";

let overlayEl = null;
let opening = false;

/** Échappe le texte/URL injecté (nom & image de produit) — anti-XSS (CLAUDE.md §6.3). */
function esc(s) {
  const div = document.createElement("div");
  div.textContent = String(s ?? "");
  return div.innerHTML;
}

/**
 * Rend le bloc cadeau dans #card-gift-cta selon l'état fidélité du client.
 * @param {number} rewardsAvailable - Cadeaux prêts à ouvrir (banque + legacy).
 * @param {{nom?:string}|null} pending - Cadeau déjà ouvert, offert sur la prochaine commande.
 * @returns {void}
 */
export function renderGiftCta(rewardsAvailable, pending) {
  const host = document.getElementById("card-gift-cta");
  if (!host) return;

  if (pending?.nom) {
    host.innerHTML = `
      <div class="mt-4 w-full bg-on-dark/15 rounded-2xl p-4 border border-on-dark/25 text-center">
        <p class="text-xs uppercase tracking-widest opacity-80 mb-1">🎁 ${esc(t("loyalty.giftPendingTitle"))}</p>
        <p class="font-black text-lg">${esc(pending.nom)}</p>
        <p class="text-[11px] opacity-80 mt-1">🛍️ ${esc(t("loyalty.giftNextOrder"))}</p>
      </div>`;
    return;
  }

  if (rewardsAvailable >= 1) {
    const more = rewardsAvailable > 1 ? ` <span class="text-xs opacity-80">(×${rewardsAvailable})</span>` : "";
    host.innerHTML = `
      <button type="button" data-action="open-loyalty-gift"
        class="mt-4 w-full bg-gold-strong hover:bg-gold text-screen font-black py-4 rounded-2xl transition active:scale-95 shadow-lg flex items-center justify-center gap-2">
        <span class="text-xl">🎁</span> ${esc(t("loyalty.openGift"))}${more}
      </button>`;
    return;
  }

  host.innerHTML = "";
}

/** Construit (une fois) l'overlay plein écran du cadeau. */
function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "loyalty-gift-overlay";
  overlayEl.className =
    "fixed inset-0 z-[120] hidden flex-col items-center justify-center bg-screen/95 p-6 opacity-0 transition-opacity duration-300";
  overlayEl.innerHTML = `
    <h3 class="text-on-dark text-2xl font-black mb-8 text-center">🎁 ${esc(t("loyalty.giftTitle"))}</h3>
    <div id="loyalty-gift-box" class="gift-box w-40 h-40 rounded-3xl bg-gold-strong text-screen flex items-center justify-center shadow-2xl" aria-hidden="true">
      <i data-lucide="gift" class="text-8xl"></i>
    </div>
    <p id="loyalty-gift-status" class="text-on-dark/80 text-center mt-6 min-h-[1.5rem] text-sm font-medium"></p>
    <!-- reveal du cadeau (gros + photo) -->
    <div id="loyalty-gift-reveal" class="hidden opacity-0 scale-90 transition-all duration-500 mt-2 text-center"></div>
    <button type="button" data-action="close-loyalty-gift"
      class="mt-8 text-on-dark/70 hover:text-on-dark text-sm uppercase tracking-widest font-bold">${esc(t("common.close"))}</button>`;
  document.body.appendChild(overlayEl);
  window.lucide?.createIcons?.();
  return overlayEl;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ouvre l'overlay, appelle la CF (choix serveur), anime la boîte, révèle le produit. */
async function openGift() {
  if (opening) return;
  const snackId = window.snackConfig?.identity?.id;
  if (!snackId) return;

  ensureOverlay();
  const box = document.getElementById("loyalty-gift-box");
  const status = document.getElementById("loyalty-gift-status");
  const reveal = document.getElementById("loyalty-gift-reveal");
  reveal.classList.add("hidden", "opacity-0", "scale-90");
  reveal.innerHTML = "";
  box.classList.remove("is-open", "hidden");
  box.classList.add("is-shaking");
  overlayEl.classList.remove("hidden");
  overlayEl.classList.add("flex");
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => overlayEl.classList.remove("opacity-0"));

  opening = true;
  status.textContent = t("loyalty.giftPreparing");
  try {
    const open = httpsCallable(functions, "spinLoyaltyWheel");
    // La boîte s'agite au moins 1,2 s : le serveur répond souvent plus vite.
    const [{ data }] = await Promise.all([open({ snackId }), wait(1200)]);
    const won = data?.won;
    if (!won?.nom) throw new Error(t("loyalty.giftError"));

    status.textContent = "";
    box.classList.remove("is-shaking");
    box.classList.add("is-open");
    await wait(450);
    box.classList.add("hidden");
    reveal.innerHTML = `
      <p class="text-on-dark/80 text-xs uppercase tracking-widest mb-2">🎁 ${esc(t("loyalty.giftForYou"))}</p>
      ${won.image ? `<img src="${esc(won.image)}" alt="" class="w-28 h-28 object-cover rounded-2xl mx-auto mb-3 shadow-lg border-2 border-gold" />` : ""}
      <p class="text-on-dark text-2xl font-black leading-tight">${esc(won.nom)}</p>
      <p class="text-on-dark/70 text-xs mt-2">🛍️ ${esc(t("loyalty.giftNextOrder"))}</p>`;
    reveal.classList.remove("hidden");
    requestAnimationFrame(() => reveal.classList.remove("opacity-0", "scale-90"));
    window.triggerVibration?.("jackpot");
  } catch (err) {
    console.error("[gift] ouverture échouée :", err);
    box.classList.remove("is-shaking");
    status.textContent = err?.message || t("loyalty.giftError");
    window.showToast?.(err?.message || t("loyalty.giftError"), "error");
  } finally {
    opening = false;
  }
}

/** Ferme l'overlay (le re-render de la carte via onSnapshot affichera le cadeau en attente). */
function closeGift() {
  if (!overlayEl || opening) return;
  overlayEl.classList.add("opacity-0");
  document.body.style.overflow = "";
  setTimeout(() => {
    overlayEl.classList.add("hidden");
    overlayEl.classList.remove("flex");
  }, 300);
}

// ── Bandeau PANIER « cadeau offert sur cette commande » + progression partagée ──────
// Listener persistant du doc user (indépendant de la carte fidélité) → maintient
// window.currentGiftPrize, remplit #cart-gift-prize et diffuse `loyalty:progress`
// (accueil, suivi de commande). Effacé dès que le cadeau est consommé (finalizeOrder
// efface pendingWheelReward → snapshot → null).
let unsubGift = null;

/** Met à jour le bandeau panier selon window.currentGiftPrize (no-op si absent). */
function updateCartGiftBanner() {
  const host = document.getElementById("cart-gift-prize");
  if (!host) return;
  const prize = window.currentGiftPrize;
  host.innerHTML = prize?.nom
    ? `<div class="mb-4 flex items-center gap-3 bg-status-wait/10 border border-status-wait/30 rounded-2xl p-3">
         <span class="text-2xl">🎁</span>
         <div class="text-sm min-w-0">
           <p class="font-black text-status-wait uppercase text-[11px] tracking-wide">${esc(t("loyalty.cartGiftTitle"))}</p>
           <p class="font-bold text-text truncate">${esc(prize.nom)} <span class="text-status-ok">· ${esc(t("loyalty.cartGiftFree"))}</span></p>
         </div>
       </div>`
    : "";
}
window.updateCartGiftBanner = updateCartGiftBanner;

/** Diffuse la progression (points, cadeaux prêts, cadeau en attente) à toute l'app. */
function broadcastProgress(progress) {
  window.loyaltyProgress = progress;
  window.dispatchEvent(new CustomEvent("loyalty:progress", { detail: progress }));
}

onAuthStateChanged(auth, (user) => {
  if (unsubGift) { unsubGift(); unsubGift = null; }
  window.currentGiftPrize = null;
  updateCartGiftBanner();
  broadcastProgress(null);
  if (!user) return;
  unsubGift = onSnapshot(doc(db, "users", user.uid), (snap) => {
    const sid = window.snackConfig?.identity?.id;
    const d = snap.exists() ? snap.data() : {};
    window.currentGiftPrize = (d.pendingWheelReward || {})[sid] || null;
    updateCartGiftBanner();
    const summary = progressSummary((d.pointsBySnack || {})[sid] || 0, (d.rewardsAvailable || {})[sid] || 0);
    broadcastProgress({ ...summary, pending: window.currentGiftPrize });
  });
});

window.renderGiftCta = renderGiftCta;
window.openLoyaltyGift = openGift;
window.closeLoyaltyGift = closeGift;
