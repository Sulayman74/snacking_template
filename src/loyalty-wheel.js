// ============================================================================
// 🎡 ROUE DE LA FORTUNE — UI client (autonome)
// ----------------------------------------------------------------------------
// À 10 points, une récompense est banquée (rewardsAvailable). Le client "joue" la
// roue : le LOT est tiré CÔTÉ SERVEUR (CF spinLoyaltyWheel, anti-triche), l'anim se
// contente de s'arrêter sur le segment renvoyé. Module isolé (empreinte minimale sur
// loyalty.js) : il injecte son propre overlay et expose 2 globals consommés par la carte.
// ============================================================================

import { functions, httpsCallable } from "./core/firebase.js";

const PALETTE = ["#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"];

/** Référence overlay (créé une seule fois, réutilisé). */
let overlayEl = null;
let spinning = false;

/**
 * Rend le CTA roue dans #card-wheel-cta selon l'état fidélité du client.
 * @param {number} rewardsAvailable - Récompenses jouables (banque + legacy).
 * @param {{nom?:string}|null} pending - Lot déjà gagné en attente de retrait (ou null).
 * @returns {void}
 */
export function renderWheelCta(rewardsAvailable, pending) {
  const host = document.getElementById("card-wheel-cta");
  if (!host) return;

  if (pending?.nom) {
    host.innerHTML = `
      <div class="mt-4 w-full bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/25 text-center">
        <p class="text-xs uppercase tracking-widest opacity-80 mb-1">🎁 Lot gagné</p>
        <p class="font-black text-lg">${escapeText(pending.nom)}</p>
        <p class="text-[11px] opacity-80 mt-1">Présente ce QR au comptoir pour le récupérer</p>
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

/** Échappe le texte injecté (nom de produit) — anti-XSS (CLAUDE.md §6.3). */
function escapeText(s) {
  const div = document.createElement("div");
  div.textContent = String(s ?? "");
  return div.innerHTML;
}

/** Construit (une fois) l'overlay plein écran de la roue. */
function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "loyalty-wheel-overlay";
  overlayEl.className =
    "fixed inset-0 z-[120] hidden flex-col items-center justify-center bg-gray-900/90 backdrop-blur-md p-6 opacity-0 transition-opacity duration-300";
  overlayEl.innerHTML = `
    <h3 class="text-on-dark text-2xl font-black mb-6 text-center">🎡 Roue de la fortune</h3>
    <div class="relative w-72 h-72 max-w-[80vw] max-h-[80vw]">
      <!-- pointeur -->
      <div class="absolute left-1/2 -top-1 -translate-x-1/2 z-10 w-0 h-0 border-l-8 border-r-8 border-t-[18px] border-l-transparent border-r-transparent border-t-yellow-300 drop-shadow"></div>
      <div id="loyalty-wheel-disc" class="w-full h-full rounded-full border-4 border-yellow-300 shadow-2xl relative overflow-hidden will-change-transform"
           style="transition: transform 4.2s cubic-bezier(0.16,1,0.3,1);"></div>
      <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-yellow-300 border-4 border-gray-900 z-10"></div>
    </div>
    <p id="loyalty-wheel-result" class="text-on-dark text-center mt-6 min-h-[3rem] font-bold"></p>
    <button type="button" data-action="close-loyalty-wheel"
      class="mt-2 text-on-dark/70 hover:text-on-dark text-sm uppercase tracking-widest font-bold">Fermer</button>`;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

/** Dessine les segments de la roue à partir du pool (conic-gradient + labels). */
function drawWheel(pool) {
  const disc = document.getElementById("loyalty-wheel-disc");
  const n = pool.length;
  const seg = 360 / n;
  const stops = pool
    .map((_, i) => `${PALETTE[i % PALETTE.length]} ${i * seg}deg ${(i + 1) * seg}deg`)
    .join(", ");
  disc.style.background = `conic-gradient(${stops})`;
  disc.style.transform = "rotate(0deg)";
  // Labels : un par segment, posé au centre angulaire, texte orienté vers le centre.
  disc.innerHTML = pool
    .map((p, i) => {
      const mid = i * seg + seg / 2;
      return `<div class="absolute left-1/2 top-1/2 origin-left text-[10px] font-black text-gray-900 truncate"
        style="transform: rotate(${mid}deg) translateX(8px); max-width: 42%; transform-origin: left center;">
        ${escapeText(p.nom)}</div>`;
    })
    .join("");
}

/** Ouvre l'overlay, appelle la CF (tirage serveur), anime jusqu'au lot gagné. */
async function openWheel() {
  if (spinning) return;
  const snackId = window.snackConfig?.identity?.id;
  if (!snackId) return;

  ensureOverlay();
  const result = document.getElementById("loyalty-wheel-result");
  result.textContent = "";
  overlayEl.classList.remove("hidden");
  overlayEl.classList.add("flex");
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => overlayEl.classList.remove("opacity-0"));

  spinning = true;
  result.textContent = "Tirage en cours…";
  try {
    const spin = httpsCallable(functions, "spinLoyaltyWheel");
    const { data } = await spin({ snackId });
    const pool = data?.pool || [];
    const won = data?.won;
    if (!pool.length || !won) throw new Error("Réponse roue invalide.");

    drawWheel(pool);
    const wonIndex = Math.max(0, pool.findIndex((p) => p.id === won.id));
    const seg = 360 / pool.length;
    // 5 tours + alignement du centre du segment gagné sous le pointeur (haut).
    const target = 360 * 5 - (wonIndex * seg + seg / 2);
    const disc = document.getElementById("loyalty-wheel-disc");
    requestAnimationFrame(() => { disc.style.transform = `rotate(${target}deg)`; });

    window.triggerVibration?.("jackpot");
    setTimeout(() => {
      result.innerHTML = `🎉 Tu as gagné <span class="text-yellow-300 font-black">${escapeText(won.nom)}</span> !<br><span class="text-xs opacity-80">À récupérer au comptoir.</span>`;
      spinning = false;
    }, 4300);
  } catch (err) {
    console.error("[wheel] spin échoué :", err);
    result.textContent = err?.message || "La roue n'a pas pu tourner. Réessaie.";
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

window.renderWheelCta = renderWheelCta;
window.openLoyaltyWheel = openWheel;
window.closeLoyaltyWheel = closeWheel;
