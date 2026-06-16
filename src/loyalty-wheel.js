// ============================================================================
// 🎡 ROUE DE LA FORTUNE — UI client (autonome)
// ----------------------------------------------------------------------------
// À 10 points, une récompense est banquée (rewardsAvailable). Le client "joue" la
// roue : le LOT est tiré CÔTÉ SERVEUR (CF spinLoyaltyWheel, anti-triche), l'anim se
// contente de s'arrêter sur le segment renvoyé. Module isolé (empreinte minimale sur
// loyalty.js) : il injecte son propre overlay et expose des globals consommés par la carte.
//
// UI : segments COLORÉS sans texte (illisible sur une roue qui tourne) → le lot gagné
// est révélé en GRAND avec sa photo à la fin. Récupération : OFFERT sur la prochaine commande.
// ============================================================================

import { functions, httpsCallable, auth, db, doc, onSnapshot, onAuthStateChanged } from "./core/firebase.js";

const PALETTE = ["#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"];

let overlayEl = null;
let spinning = false;

/** Échappe le texte/URL injecté (nom & image de produit) — anti-XSS (CLAUDE.md §6.3). */
function esc(s) {
  const div = document.createElement("div");
  div.textContent = String(s ?? "");
  return div.innerHTML;
}

/**
 * Rend le CTA roue dans #card-wheel-cta selon l'état fidélité du client.
 * @param {number} rewardsAvailable - Récompenses jouables (banque + legacy).
 * @param {{nom?:string}|null} pending - Lot déjà gagné en attente (offert prochaine commande).
 * @returns {void}
 */
export function renderWheelCta(rewardsAvailable, pending) {
  const host = document.getElementById("card-wheel-cta");
  if (!host) return;

  if (pending?.nom) {
    host.innerHTML = `
      <div class="mt-4 w-full bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/25 text-center">
        <p class="text-xs uppercase tracking-widest opacity-80 mb-1">🎁 Lot gagné</p>
        <p class="font-black text-lg">${esc(pending.nom)}</p>
        <p class="text-[11px] opacity-80 mt-1">🛍️ Offert sur ta prochaine commande</p>
      </div>`;
    return;
  }

  if (rewardsAvailable >= 1) {
    host.innerHTML = `
      <button type="button" data-action="open-loyalty-wheel"
        class="mt-4 w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-black py-4 rounded-2xl transition active:scale-95 shadow-lg flex items-center justify-center gap-2">
        <span class="text-xl">🎡</span> Tourne la roue !
      </button>`;
    return;
  }

  host.innerHTML = "";
}

/** Construit (une fois) l'overlay plein écran de la roue. */
function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "loyalty-wheel-overlay";
  overlayEl.className =
    "fixed inset-0 z-[120] hidden flex-col items-center justify-center bg-gray-900/95 backdrop-blur-md p-6 opacity-0 transition-opacity duration-300";
  overlayEl.innerHTML = `
    <h3 class="text-on-dark text-2xl font-black mb-6 text-center">🎡 Roue de la fortune</h3>
    <div class="relative w-72 h-72 max-w-[78vw] max-h-[78vw]">
      <!-- pointeur -->
      <div class="absolute left-1/2 -top-1 -translate-x-1/2 z-20 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[20px] border-l-transparent border-r-transparent border-t-yellow-300 drop-shadow-lg"></div>
      <!-- disque (segments colorés, sans texte) -->
      <div id="loyalty-wheel-disc" class="w-full h-full rounded-full border-[6px] border-yellow-300 shadow-2xl will-change-transform"
           style="transition: transform 4.4s cubic-bezier(0.16,1,0.3,1);"></div>
      <!-- moyeu central -->
      <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-yellow-300 border-4 border-gray-900 z-10 flex items-center justify-center text-2xl">🎁</div>
    </div>
    <p id="loyalty-wheel-status" class="text-on-dark/80 text-center mt-5 min-h-[1.5rem] text-sm font-medium"></p>
    <!-- reveal du lot gagné (gros + photo) -->
    <div id="loyalty-wheel-reveal" class="hidden opacity-0 scale-90 transition-all duration-500 mt-2 text-center"></div>
    <button type="button" data-action="close-loyalty-wheel"
      class="mt-6 text-on-dark/70 hover:text-on-dark text-sm uppercase tracking-widest font-bold">Fermer</button>`;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

/** Dessine les segments COLORÉS (sans texte) à partir du pool. */
function drawWheel(pool) {
  const disc = document.getElementById("loyalty-wheel-disc");
  const n = Math.max(1, pool.length);
  const seg = 360 / n;
  const stops = pool
    .map((_, i) => `${PALETTE[i % PALETTE.length]} ${i * seg}deg ${(i + 1) * seg}deg`)
    .join(", ");
  disc.style.background = `conic-gradient(from -${seg / 2}deg, ${stops})`;
  disc.style.transform = "rotate(0deg)";
}

/** Ouvre l'overlay, appelle la CF (tirage serveur), anime jusqu'au lot gagné. */
async function openWheel() {
  if (spinning) return;
  const snackId = window.snackConfig?.identity?.id;
  if (!snackId) return;

  ensureOverlay();
  const status = document.getElementById("loyalty-wheel-status");
  const reveal = document.getElementById("loyalty-wheel-reveal");
  reveal.classList.add("hidden", "opacity-0", "scale-90");
  overlayEl.classList.remove("hidden");
  overlayEl.classList.add("flex");
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => overlayEl.classList.remove("opacity-0"));

  spinning = true;
  status.textContent = "Tirage en cours…";
  try {
    const spin = httpsCallable(functions, "spinLoyaltyWheel");
    const { data } = await spin({ snackId });
    const pool = data?.pool || [];
    const won = data?.won;
    if (!pool.length || !won) throw new Error("Réponse roue invalide.");

    drawWheel(pool);
    status.textContent = "";
    const wonIndex = Math.max(0, pool.findIndex((p) => p.id === won.id));
    const seg = 360 / pool.length;
    // 6 tours + alignement du centre du segment gagné sous le pointeur (haut).
    const target = 360 * 6 - (wonIndex * seg);
    const disc = document.getElementById("loyalty-wheel-disc");
    requestAnimationFrame(() => { disc.style.transform = `rotate(${target}deg)`; });

    // Reveal à la fin de l'anim (≈ durée de la transition CSS).
    setTimeout(() => {
      reveal.innerHTML = `
        <p class="text-on-dark/80 text-xs uppercase tracking-widest mb-2">🎉 Tu as gagné</p>
        ${won.image ? `<img src="${esc(won.image)}" alt="" class="w-24 h-24 object-cover rounded-2xl mx-auto mb-3 shadow-lg border-2 border-yellow-300" />` : ""}
        <p class="text-on-dark text-2xl font-black leading-tight">${esc(won.nom)}</p>
        <p class="text-on-dark/70 text-xs mt-2">🛍️ Offert sur ta prochaine commande</p>`;
      reveal.classList.remove("hidden");
      requestAnimationFrame(() => reveal.classList.remove("opacity-0", "scale-90"));
      window.triggerVibration?.("jackpot");
      spinning = false;
    }, 4400);
  } catch (err) {
    console.error("[wheel] spin échoué :", err);
    status.textContent = err?.message || "La roue n'a pas pu tourner. Réessaie.";
    window.showToast?.(err?.message || "Erreur roue de la fortune.", "error");
    spinning = false;
  }
}

/** Ferme l'overlay (le re-render de la carte via onSnapshot affichera le lot gagné). */
function closeWheel() {
  if (!overlayEl || spinning) return;
  overlayEl.classList.add("opacity-0");
  document.body.style.overflow = "";
  setTimeout(() => {
    overlayEl.classList.add("hidden");
    overlayEl.classList.remove("flex");
  }, 300);
}

// ── Bandeau PANIER « lot gratuit sur cette commande » ────────────────────────
// Listener persistant du doc user (indépendant de l'ouverture de la carte fidélité) →
// maintient window.currentWheelPrize + remplit #cart-wheel-prize. Le bandeau vit dans le
// pied (statique) du panier → non écrasé par le re-render des lignes. Effacé dès que le
// lot est consommé (finalizeOrder efface pendingWheelReward → snapshot → null).
let unsubWheelPrize = null;

/** Met à jour le bandeau panier selon window.currentWheelPrize (no-op si absent). */
function updateCartWheelBanner() {
  const host = document.getElementById("cart-wheel-prize");
  if (!host) return;
  const prize = window.currentWheelPrize;
  host.innerHTML = prize?.nom
    ? `<div class="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-3">
         <span class="text-2xl">🎁</span>
         <div class="text-sm min-w-0">
           <p class="font-black text-amber-700 uppercase text-[11px] tracking-wide">Lot gagné — offert</p>
           <p class="font-bold text-gray-900 truncate">${esc(prize.nom)} <span class="text-green-600">· gratuit sur cette commande</span></p>
         </div>
       </div>`
    : "";
}
window.updateCartWheelBanner = updateCartWheelBanner;

onAuthStateChanged(auth, (user) => {
  if (unsubWheelPrize) { unsubWheelPrize(); unsubWheelPrize = null; }
  window.currentWheelPrize = null;
  updateCartWheelBanner();
  if (!user) return;
  unsubWheelPrize = onSnapshot(doc(db, "users", user.uid), (snap) => {
    const sid = window.snackConfig?.identity?.id;
    window.currentWheelPrize = snap.exists() ? (snap.data().pendingWheelReward || {})[sid] || null : null;
    updateCartWheelBanner();
  });
});

window.renderWheelCta = renderWheelCta;
window.openLoyaltyWheel = openWheel;
window.closeLoyaltyWheel = closeWheel;
