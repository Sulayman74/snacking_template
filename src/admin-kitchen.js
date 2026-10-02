// ============================================================================
// 🍳 CUISINE — Radar temps réel, Tickets, Statuts, Wake Lock
// ============================================================================
// Dépendances : window.currentAdminSnackId, window.currentAdminTab,
//               window.showToast

import { escapeHTML, telHref } from "./utils.js";
import { setAppBadgeCount, countPendingKitchenOrders } from "./core/appBadge.js";
import { getOrderingState, snackTimezone } from "./core/openingHours.js";
import { adminStore } from "./core/AdminStore.js";
import {
  db,
  query,
  collection,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
  writeBatch,
  getDoc,
  increment,
  serverTimestamp,
  functions,
  httpsCallable,
} from "./core/firebase.js";

// ============================================================================
// 🔥 SIGNAL DE CAPACITÉ — charge cuisine (rushMode décidé serveur)
// ============================================================================
// Throttlé : la décision rushMode vit côté serveur (getKitchenLoad, cache 30s).
// On ne l'interroge qu'au plus une fois toutes les 30s, déclenché par les
// changements du radar — pas à chaque docChange (coût + cache serveur).
// Doc snack suivi en temps réel pendant le service (pause, horaires, heure limite) :
// indépendant de l'onglet Config (adminStore.config n'est chargé qu'à son ouverture).
let kitchenSnack = null;
let unsubscribeKitchenSnack = null;
let kitchenClockTimer = null;
let closingNotifiedKey = null;
const CLOSING_WARNING_MIN = 15;

let lastKitchenLoadAt = 0;
const KITCHEN_LOAD_THROTTLE_MS = 30_000;

async function refreshKitchenLoad(force = false) {
  const snackId = window.currentAdminSnackId;
  if (!snackId) return;
  const now = Date.now();
  if (!force && now - lastKitchenLoadAt < KITCHEN_LOAD_THROTTLE_MS) return;
  lastKitchenLoadAt = now;
  try {
    const getKitchenLoad = httpsCallable(functions, "getKitchenLoad");
    const res = await getKitchenLoad({ snackId });
    const load = res?.data || {};
    adminStore.setKitchenLoad(load);
    renderKitchenLoadBadge(load);
  } catch (e) {
    console.warn("[cuisine] charge indisponible (non bloquant) :", e?.message || e);
  }
}

function renderKitchenLoadBadge(load) {
  const badge = document.getElementById("kitchen-load-badge");
  const dot = document.getElementById("kitchen-load-dot");
  const text = document.getElementById("kitchen-load-text");
  if (!badge || !dot || !text) return;

  const rush = load?.rushMode === true;
  const queue = Number(load?.queue) || 0;
  const avg = Number(load?.avgPrepMin) || 0;

  text.innerText = `Charge : ${queue} · ~${avg} min · ${rush ? "RUSH" : "OK"}`;
  // Couleurs sémantiques (statut), cohérentes avec les compteurs cuisine existants
  // (bg-red-600 / bg-green-600) — pas une couleur de marque.
  badge.classList.remove("hidden", "bg-red-100", "text-red-700", "bg-green-100", "text-green-700");
  badge.classList.add("flex", rush ? "bg-red-100" : "bg-green-100", rush ? "text-red-700" : "text-green-700");
  dot.classList.remove("bg-red-600", "bg-green-600");
  dot.classList.add(rush ? "bg-red-600" : "bg-green-600");
}

// ============================================================================
// 💡 ANTI-VEILLE (WAKE LOCK API)
// ============================================================================
let wakeLock = null;

async function requestWakeLock() {
  if ("wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      console.log("💡 [Cuisine] Écran maintenu allumé pour le service !");
      wakeLock.addEventListener("release", () => {
        console.log("💡 [Cuisine] Le maintien de l'écran a été relâché.");
      });
    } catch (err) {
      console.error("❌ Erreur Wake Lock :", err.name, err.message);
    }
  }
}

document.addEventListener("visibilitychange", async () => {
  if (wakeLock !== null && document.visibilityState === "visible") {
    await requestWakeLock();
  }
});

// ============================================================================
// 🎟️ GÉNÉRATEUR DE TICKET HTML
// ============================================================================
export function createTicketElement(id, commande) {
  const timeString = commande.date
    ? commande.date
        .toDate()
        .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "";

  const safeClientName = escapeHTML(commande.clientNom || "Client Anonyme");
  const secretCode = commande.secretCode || "---";

  let itemsHtml = (commande.items || [])
    .map((item) => {
      let optionsHTML = "";
      if (item.tailleChoisie) {
        optionsHTML += `<div class="text-text font-bold text-sm mt-1 ml-6 flex items-center gap-2"><i data-lucide="ruler" class="text-text-muted"></i> Taille : ${escapeHTML(item.tailleChoisie)}</div>`;
      }
      if (item.boissonNom) {
        optionsHTML += `<div class="text-blue-600 dark:text-blue-400 font-bold text-sm mt-1 ml-6 flex items-center gap-2"><i data-lucide="glass-water"></i> ${escapeHTML(item.boissonNom)}</div>`;
      }
      if (item.sauces && Array.isArray(item.sauces) && item.sauces.length > 0) {
        const safeSauces = item.sauces.map((s) => escapeHTML(s)).join(" + ");
        optionsHTML += `<div class="text-orange-600 dark:text-orange-400 font-bold text-sm mt-1 ml-6 flex items-center gap-2"><i data-lucide="cooking-pot"></i> Sauces : ${safeSauces}</div>`;
      }
      if (item.supplements && Array.isArray(item.supplements) && item.supplements.length > 0) {
        const safeSupps = item.supplements.map((s) => escapeHTML(s.nom)).join(" + ");
        optionsHTML += `<div class="text-emerald-700 dark:text-emerald-400 font-black text-sm mt-1 ml-6 flex items-center gap-2"><i data-lucide="plus-circle" class="text-emerald-600 dark:text-emerald-400"></i> Extra : ${safeSupps}</div>`;
      }
      if (
        item.sansCrudites &&
        Array.isArray(item.sansCrudites) &&
        item.sansCrudites.length > 0
      ) {
        const safeCrudites = item.sansCrudites
          .map((c) => escapeHTML(c))
          .join(", ");
        optionsHTML += `<div class="mt-2 ml-6"><span class="bg-red-600 text-white px-2 py-1 rounded-md font-black text-xs uppercase shadow-sm border border-red-800">⚠️ ${safeCrudites}</span></div>`;
      }

      return `
            <li class="flex flex-col border-b border-line/50 py-3 last:border-0">
                <div class="flex items-start">
                    <span class="font-black text-lg text-red-600 dark:text-red-400" aria-hidden="true">${escapeHTML(String(item.quantity))}x</span>
                    <span class="font-bold ml-2 text-text text-lg">${escapeHTML(item.nom)}</span>
                </div>
                ${optionsHTML}
            </li>`;
    })
    .join("");

  const isWaiting = isWaitingStatut(commande.statut);
  const isNew = commande.statut === "nouvelle";

  // 🕒 Créneau « plus tard » : heure promise au client et heure de lancement.
  const slotHtml = commande.retrait?.mode === "creneau" ? slotBanner(commande.retrait) : "";

  // 🚚 Bandeau livraison (mode delivery) : le staff voit l'adresse + distance.
  const isDelivery = commande.mode === "delivery";
  const deliveryHtml = isDelivery
    ? `<div class="mb-3 flex items-start gap-2 bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
         <i data-lucide="bike" class="text-blue-600 dark:text-blue-400 mt-0.5"></i>
         <div class="text-sm min-w-0">
           <p class="font-black text-blue-700 dark:text-blue-400 uppercase text-xs tracking-wide">Livraison</p>
           <p class="text-text font-bold">${escapeHTML(commande.livraison?.adresse || "Adresse non renseignée")}</p>
           ${commande.livraison?.complement ? `<p class="text-text text-xs">${escapeHTML(commande.livraison.complement)}</p>` : ""}
           ${telHref(commande.livraison?.telephone) ? `<a href="${telHref(commande.livraison.telephone)}" class="text-xs font-bold text-blue-700 dark:text-blue-400 underline">${escapeHTML(commande.livraison.telephone)}</a>` : ""}
           ${commande.livraison?.distanceKm != null ? `<p class="text-text-muted text-xs">${escapeHTML(String(commande.livraison.distanceKm))} km du resto</p>` : ""}
         </div>
       </div>`
    : "";

  // 🎡 Lot de roue OFFERT sur cette commande (fidélité) : le staff doit l'ajouter gratuitement.
  const wheelPrizeHtml = commande.wheelPrize?.nom
    ? `<div class="mb-3 flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
         <span class="text-xl">🎁</span>
         <div class="text-sm min-w-0">
           <p class="font-black text-amber-700 dark:text-amber-400 uppercase text-xs tracking-wide">Lot fidélité — OFFERT</p>
           <p class="text-text font-bold">${escapeHTML(commande.wheelPrize.nom)}</p>
         </div>
       </div>`
    : "";

  let ticketColor = "bg-surface text-text border-l-6 md:border-l-8 border-green-500";
  let textColor = "text-green-700 dark:text-green-400";
  let btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="terminee" class="w-full bg-green-600 hover:bg-green-700 text-white font-black py-3 md:py-4 rounded-xl text-base md:text-xl shadow-lg transition active:scale-95 flex items-center justify-center gap-2"><i data-lucide="package"></i> DONNÉE AU CLIENT</button>`;

  if (isWaiting) {
    ticketColor = "bg-surface text-text border-l-6 md:border-l-8 border-gray-400 opacity-80";
    textColor = "text-text-muted";
    btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="nouvelle" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-black py-2.5 md:py-3 rounded-xl text-sm shadow-sm transition active:scale-95 flex items-center justify-center gap-2"><i data-lucide="flame"></i> ${commande.statut === "programmee" ? "Lancer maintenant" : "Forcer Cuisson"}</button>`;
  } else if (isNew) {
    ticketColor = "bg-surface text-text border-l-6 md:border-l-8 border-red-500";
    textColor = "text-red-700 dark:text-red-400";
    btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="prete" class="w-full bg-red-600 hover:bg-red-700 text-white font-black py-3 md:py-4 rounded-xl text-base md:text-xl shadow-lg transition active:scale-95 flex items-center justify-center gap-2"><i data-lucide="check"></i> MARQUER PRÊTE</button>`;
  }

  const paymentStatus = commande.paiement?.statut || "en_attente";
  const isPaid = paymentStatus === "paye";

  const priceDisplay = isPaid
    ? `<p class="font-black text-xl md:text-2xl text-green-600 dark:text-green-400 opacity-50 line-through">${(Number(commande.total) || 0).toFixed(2)} €</p>`
    : `<p class="font-black text-xl md:text-2xl ${textColor}">${(Number(commande.total) || 0).toFixed(2)} €</p>`;

  const paymentBadgeHtml = isPaid
    ? `<button type="button" data-action="update-payment" data-id="${id}" data-status="paye" class="mt-2 bg-green-500/10 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg text-xs font-black border border-green-500/30 shadow-sm transition flex items-center gap-1 hover:bg-green-500/20"><i data-lucide="circle-check"></i> PAYÉ</button>`
    : `<button type="button" data-action="update-payment" data-id="${id}" data-status="en_attente" class="mt-2 bg-orange-500/10 text-orange-700 dark:text-orange-400 px-3 py-1.5 rounded-lg text-xs font-black border border-orange-500/30 shadow-md transition flex items-center gap-1 animate-pulse hover:bg-orange-500/20"><i data-lucide="receipt"></i> ENCAISSER</button>`;

  // 💸 Remboursement (LOT B → UI).
  const onlineCard = (commande.paiement?.methode || "carte_bancaire") === "carte_bancaire";
  const refundBtnHtml = onlineCard && (paymentStatus === "paye" || paymentStatus === "partiellement_rembourse")
    ? `<button type="button" data-action="refund-order" data-id="${id}" aria-label="Rembourser cette commande" class="w-full mt-2 bg-surface text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-surface-2 font-bold py-2 rounded-xl text-sm transition active:scale-95 flex items-center justify-center gap-2"><i class="fas fa-rotate-left"></i> Rembourser${paymentStatus === "partiellement_rembourse" ? " (partiel)" : ""}</button>`
    : paymentStatus === "rembourse"
      ? `<p class="w-full mt-2 text-center text-xs font-bold text-text-muted"><i class="fas fa-circle-check mr-1"></i>Remboursé</p>`
      : "";

  const ticketDiv = document.createElement("div");
  ticketDiv.id = `ticket-${id}`;
  ticketDiv.className = `${ticketColor} rounded-2xl shadow-md p-3.5 md:p-5 animate-fade-in-up border border-line`;
  ticketDiv.setAttribute("data-status", commande.statut);

  ticketDiv.innerHTML = `
        <div class="flex justify-between items-start mb-4 pb-3 border-b border-line">
            <div class="min-w-0 flex-1 pr-2">
                <div class="flex items-center gap-2">
                  <h3 class="font-black text-xl md:text-2xl text-text truncate">${safeClientName}</h3>
                  <span class="bg-surface-2 text-text border border-line px-2 py-0.5 rounded text-xs font-mono font-bold shrink-0">${escapeHTML(secretCode)}</span>
                </div>
                <p class="text-xs md:text-sm text-text-muted font-bold mt-1 flex items-center gap-1"><i data-lucide="clock" class="text-xs"></i> ${timeString}</p>
            </div>
            <div class="flex flex-col items-end shrink-0">
                <div class="price-display-container">${priceDisplay}</div>
                <span data-ready-age class="hidden" role="status"></span>
                <div class="payment-badge-container">${paymentBadgeHtml}</div>
            </div>
        </div>
        ${slotHtml}${deliveryHtml}
        <ul class="mb-5 text-text space-y-1">${itemsHtml}</ul>
        ${wheelPrizeHtml}
        <div class="action-button-container">${btnHtml}</div>
        <div class="refund-button-container">${refundBtnHtml}</div>
    `;

  return ticketDiv;
}

// ============================================================================
// 📡 RADAR FIREBASE (COMMANDES TEMPS RÉEL)
// ============================================================================
let unsubscribeKitchenRadar = null;

function slotBanner(retrait) {
  const fmt = (ts) => {
    const d = ts?.toDate ? ts.toDate() : null;
    return d ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: snackTimezone(kitchenSnack) }) : "--:--";
  };
  return `<div class="mb-3 flex items-center gap-2 bg-surface-2 border border-line rounded-xl p-3 text-sm">
       <i data-lucide="clock" class="text-primary"></i>
       <span class="font-black text-text">Retrait ${escapeHTML(fmt(retrait.heure))}</span>
       <span class="text-text-muted">· lancement ${escapeHTML(fmt(retrait.lancerA))}</span>
     </div>`;
}

// Colonne « En attente » : commandes programmées (créneau « plus tard ») et
// anciennes commandes en attente du client (transition, cf. lib/orderClock).
const WAITING_STATUSES = new Set(["programmee", "en_attente_client"]);
const isWaitingStatut = (statut) => WAITING_STATUSES.has(statut);

/**
 * Faut-il alerter la cuisine pour ce changement ? (fonction PURE)
 * - "nouvelle" : une commande arrive (click & collect en attente du client) ;
 * - "a-cuisiner" : une commande passe en « à cuisiner » — livraison payée, ou
 *   client de click & collect qui signale son arrivée. C'est le moment de lancer.
 * Jamais au chargement initial (tickets déjà là à l'ouverture du service).
 * @returns {null|"nouvelle"|"a-cuisiner"}
 */
export function kitchenAlertFor(changeType, prev, next, isInitialLoad) {
  if (isInitialLoad || !next) return null;
  if (changeType === "added") {
    if (next.statut === "nouvelle") return "a-cuisiner";
    if (isWaitingStatut(next.statut)) return "nouvelle";
    return null;
  }
  if (changeType === "modified" && next.statut === "nouvelle" && prev?.statut !== "nouvelle") return "a-cuisiner";
  return null;
}

function updateTicketDOM(ticketDiv, commande, id) {
  const paymentStatus = commande.paiement?.statut || "en_attente";
  const isPaid = paymentStatus === "paye";
  const isWaiting = isWaitingStatut(commande.statut);
  const isNew = commande.statut === "nouvelle";

  let ticketColor = "bg-surface text-text border-l-6 md:border-l-8 border-green-500";
  let textColor = "text-green-700 dark:text-green-400";
  let btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="terminee" class="w-full bg-green-600 hover:bg-green-700 text-white font-black py-3 md:py-4 rounded-xl text-base md:text-xl shadow-lg transition active:scale-95 flex items-center justify-center gap-2"><i data-lucide="package"></i> DONNÉE AU CLIENT</button>`;

  if (isWaiting) {
    ticketColor = "bg-surface text-text border-l-6 md:border-l-8 border-gray-400 opacity-80";
    textColor = "text-text-muted";
    btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="nouvelle" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-black py-2.5 md:py-3 rounded-xl text-sm shadow-sm transition active:scale-95 flex items-center justify-center gap-2"><i data-lucide="flame"></i> ${commande.statut === "programmee" ? "Lancer maintenant" : "Forcer Cuisson"}</button>`;
  } else if (isNew) {
    ticketColor = "bg-surface text-text border-l-6 md:border-l-8 border-red-500";
    textColor = "text-red-700 dark:text-red-400";
    btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="prete" class="w-full bg-red-600 hover:bg-red-700 text-white font-black py-3 md:py-4 rounded-xl text-base md:text-xl shadow-lg transition active:scale-95 flex items-center justify-center gap-2"><i data-lucide="check"></i> MARQUER PRÊTE</button>`;
  }

  ticketDiv.className = `${ticketColor} rounded-2xl shadow-md p-3.5 md:p-5 animate-fade-in-up border border-line`;
  ticketDiv.setAttribute("data-status", commande.statut);

  const priceContainer = ticketDiv.querySelector(".price-display-container");
  if (priceContainer) {
    priceContainer.innerHTML = isPaid
      ? `<p class="font-black text-2xl text-green-600 dark:text-green-400 opacity-50 line-through">${(Number(commande.total) || 0).toFixed(2)} €</p>`
      : `<p class="font-black text-2xl ${textColor}">${(Number(commande.total) || 0).toFixed(2)} €</p>`;
  }

  const paymentBadgeContainer = ticketDiv.querySelector(".payment-badge-container");
  if (paymentBadgeContainer) {
    paymentBadgeContainer.innerHTML = isPaid
      ? `<button type="button" data-action="update-payment" data-id="${id}" data-status="paye" class="mt-2 bg-green-500/10 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg text-xs font-black border border-green-500/30 shadow-sm transition flex items-center gap-1 hover:bg-green-500/20"><i data-lucide="circle-check"></i> PAYÉ</button>`
      : `<button type="button" data-action="update-payment" data-id="${id}" data-status="en_attente" class="mt-2 bg-orange-500/10 text-orange-700 dark:text-orange-400 px-3 py-1.5 rounded-lg text-xs font-black border border-orange-500/30 shadow-md transition flex items-center gap-1 animate-pulse hover:bg-orange-500/20"><i data-lucide="receipt"></i> ENCAISSER</button>`;
  }

  const actionBtnContainer = ticketDiv.querySelector(".action-button-container");
  if (actionBtnContainer) {
    actionBtnContainer.innerHTML = btnHtml;
  }

  const onlineCard = (commande.paiement?.methode || "carte_bancaire") === "carte_bancaire";
  const refundBtnContainer = ticketDiv.querySelector(".refund-button-container");
  if (refundBtnContainer) {
    refundBtnContainer.innerHTML = onlineCard && (paymentStatus === "paye" || paymentStatus === "partiellement_rembourse")
      ? `<button type="button" data-action="refund-order" data-id="${id}" aria-label="Rembourser cette commande" class="w-full mt-2 bg-surface text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-surface-2 font-bold py-2 rounded-xl text-sm transition active:scale-95 flex items-center justify-center gap-2"><i class="fas fa-rotate-left"></i> Rembourser${paymentStatus === "partiellement_rembourse" ? " (partiel)" : ""}</button>`
      : paymentStatus === "rembourse"
        ? `<p class="w-full mt-2 text-center text-xs font-bold text-text-muted"><i class="fas fa-circle-check mr-1"></i>Remboursé</p>`
        : "";
  }

  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

const kitchenOrdersMap = new Map();

// Idempotent : l'écoute reste active pendant tout le service (changement d'onglet
// admin, tablette en veille). Un second appel ne recharge pas les tickets.
function startKitchenRadar() {
  if (unsubscribeKitchenRadar) {
    requestWakeLock();
    return;
  }

  requestWakeLock();
  watchKitchenSnack();

  const waitingOrdersContainer = document.getElementById("orders-waiting");
  const newOrdersContainer = document.getElementById("orders-new");
  const readyOrdersContainer = document.getElementById("orders-ready");
  
  if (waitingOrdersContainer) waitingOrdersContainer.innerHTML = "";
  if (newOrdersContainer) newOrdersContainer.innerHTML = "";
  if (readyOrdersContainer) readyOrdersContainer.innerHTML = "";

  const q = query(
    collection(db, "commandes"),
    where("snackId", "==", window.currentAdminSnackId),
    where("statut", "in", ["programmee", "en_attente_client", "nouvelle", "prete"]),
    orderBy("date", "asc"),
  );

  const bell = document.getElementById("kitchen-bell");

  let isFirstLoad = true; // propre à CET abonnement (réinitialisé à chaque démarrage)

  unsubscribeKitchenRadar = onSnapshot(q, (snapshot) => {
    let ringTheBell = false;
    let alertCount = 0;

    snapshot.docChanges().forEach((change) => {
      const commande = change.doc.data();
      const id = change.doc.id;
      const existingTicket = document.getElementById(`ticket-${id}`);
      // Changement fait sur CETTE tablette (ex. « Forcer cuisson ») : pas de sonnerie.
      const isOwnWrite = change.doc.metadata?.hasPendingWrites === true;
      if (!isOwnWrite && kitchenAlertFor(change.type, kitchenOrdersMap.get(id), commande, isFirstLoad)) {
        ringTheBell = true;
        alertCount++;
      }

      if (change.type === "added") {
        kitchenOrdersMap.set(id, commande);
        if (existingTicket) existingTicket.remove();
        const newTicket = createTicketElement(id, commande);
        if (isWaitingStatut(commande.statut) && waitingOrdersContainer)
          waitingOrdersContainer.appendChild(newTicket);
        if (commande.statut === "nouvelle" && newOrdersContainer)
          newOrdersContainer.appendChild(newTicket);
        if (commande.statut === "prete" && readyOrdersContainer)
          readyOrdersContainer.appendChild(newTicket);
      } else if (change.type === "modified") {
        kitchenOrdersMap.set(id, commande);
        if (existingTicket) {
          // Mise à jour ciblée O(1)
          updateTicketDOM(existingTicket, commande, id);
          
          // Si le statut a changé, on déplace le ticket vers la colonne correspondante
          const currentContainer = existingTicket.parentElement;
          let targetContainer = null;
          if (isWaitingStatut(commande.statut)) targetContainer = waitingOrdersContainer;
          else if (commande.statut === "nouvelle") targetContainer = newOrdersContainer;
          else if (commande.statut === "prete") targetContainer = readyOrdersContainer;

          if (targetContainer && currentContainer !== targetContainer) {
            targetContainer.appendChild(existingTicket);
          }
        } else {
          // Fallback si le ticket n'existe pas encore (cas rare d'un patch simultané)
          const newTicket = createTicketElement(id, commande);
          if (isWaitingStatut(commande.statut) && waitingOrdersContainer)
            waitingOrdersContainer.appendChild(newTicket);
          if (commande.statut === "nouvelle" && newOrdersContainer)
            newOrdersContainer.appendChild(newTicket);
          if (commande.statut === "prete" && readyOrdersContainer)
            readyOrdersContainer.appendChild(newTicket);
        }
      } else if (change.type === "removed") {
        kitchenOrdersMap.delete(id);
        if (existingTicket) existingTicket.remove();
      }
    });

    const countWaiting = document.getElementById("count-waiting");
    const tabCountWaiting = document.getElementById("tab-count-waiting");
    if (waitingOrdersContainer) {
      const len = waitingOrdersContainer.children.length;
      if (countWaiting) countWaiting.innerText = len;
      if (tabCountWaiting) tabCountWaiting.innerText = len;
    }

    const countNew = document.getElementById("count-new");
    const tabCountNew = document.getElementById("tab-count-new");
    if (newOrdersContainer) {
      const len = newOrdersContainer.children.length;
      if (countNew) countNew.innerText = len;
      if (tabCountNew) tabCountNew.innerText = len;
    }

    const countReady = document.getElementById("count-ready");
    const tabCountReady = document.getElementById("tab-count-ready");
    if (readyOrdersContainer) {
      const len = readyOrdersContainer.children.length;
      if (countReady) countReady.innerText = len;
      if (tabCountReady) tabCountReady.innerText = len;
    }

    if (ringTheBell) {
      bell?.play().catch(() => console.warn("Sonnerie bloquée par le navigateur (touchez l'écran)."));
      // Hors de l'onglet Cuisine : le son seul ne dit pas où regarder.
      if (window.currentAdminTab !== "cuisine") {
        window.showToast?.(`🛎️ ${alertCount > 1 ? `${alertCount} commandes` : "Une commande"} à traiter en cuisine`, "info");
      }
    }

    // 🔴 Pastille de l'app = commandes en attente (se met à jour dans les deux sens).
    setAppBadgeCount(countPendingKitchenOrders(kitchenOrdersMap.values()));
    renderReadyAges();

    refreshKitchenLoad(isFirstLoad);
    isFirstLoad = false;
  }, (err) => {
    console.error("Radar cuisine (onSnapshot) erreur :", err);
    window.showToast?.("Connexion au radar interrompue (réseau).", "error");
  });

  console.log("🟢 Radar Cuisine ACTIVÉ.");
}

function stopKitchenRadar() {
  unwatchKitchenSnack();
  if (unsubscribeKitchenRadar) {
    unsubscribeKitchenRadar();
    unsubscribeKitchenRadar = null;
    kitchenOrdersMap.clear();
    console.log("🔴 Radar Cuisine DÉSACTIVÉ.");
  }
}

// Pause/reprise automatique pilotée par l'orchestrateur global
// (Suppression de l'écouteur local visibilitychange)

// ============================================================================
// 💳 ACTIONS MÉTIER : STATUT COMMANDE & CAISSE
// ============================================================================
async function updateOrderStatus(orderId, newStatus) {
  try {
    // `datePrete` : base du « prête depuis X min » et du rappel client (horloge).
    await updateDoc(doc(db, "commandes", orderId), {
      statut: newStatus,
      ...(newStatus === "prete" ? { datePrete: serverTimestamp() } : {}),
    });
  } catch (error) {
    console.error("Erreur Statut :", error);
  }
}

async function updatePaymentStatus(orderId, currentStatus, commandeData = null) {
  try {
    const newStatus = currentStatus === "paye" ? "en_attente" : "paye";

    const batch = writeBatch(db);
    const orderRef = doc(db, "commandes", orderId);
    batch.update(orderRef, { "paiement.statut": newStatus });

    if (newStatus === "paye") {
      // Optimisation O(1) : Récupération des données locales pour économiser un getDoc réseau
      const localData = commandeData || kitchenOrdersMap.get(orderId);
      
      let items = [];
      if (localData) {
        items = localData.items || [];
      } else {
        // Fallback rétrocompatible (ex: lors de tests unitaires ou d'un appel externe)
        const orderDoc = await getDoc(orderRef);
        if (orderDoc.exists()) {
          items = orderDoc.data().items || [];
        }
      }

      for (const item of items) {
        const realProductId =
          item.productId || (typeof item.id === "string" ? item.id.split("-")[0] : null);
        if (!realProductId) continue; // item dégradé : on n'incrémente pas les ventes
        const productRef = doc(db, "produits", realProductId);
        batch.update(productRef, { ventes: increment(item.quantity) });
      }
    }

    await batch.commit();

    if (newStatus === "paye") {
      window.showToast("Caisse enregistrée et Best-Sellers mis à jour ! 📈", "success");
    } else {
      window.showToast("Paiement annulé.", "success");
    }
  } catch (error) {
    console.error("Erreur lors de l'encaissement :", error);
    window.showToast("Impossible de mettre à jour le paiement.", "error");
  }
}

/**
 * Rembourse une commande via la Cloud Function refundOrder (LOT B). Tout est
 * (re)validé serveur (admin du snack, montant ≤ restant, idempotence). Ici on ne
 * fait qu'ouvrir le flux : montant total par défaut, ou partiel si saisi.
 * @param {string} orderId
 */
async function handleRefundOrder(orderId) {
  // Saisie du montant : vide = total. Virgule FR acceptée.
  const raw = window.prompt(
    "Remboursement — montant en € (laisser VIDE pour un remboursement TOTAL) :",
    ""
  );
  if (raw === null) return; // annulé

  const trimmed = raw.trim();
  let amountCents; // undefined = total
  if (trimmed !== "") {
    const euros = parseFloat(trimmed.replace(",", "."));
    if (!Number.isFinite(euros) || euros <= 0) {
      window.showToast("Montant invalide.", "error");
      return;
    }
    amountCents = Math.round(euros * 100);
  }

  const confirmMsg =
    amountCents === undefined
      ? "Rembourser la TOTALITÉ de cette commande ?"
      : `Rembourser ${(amountCents / 100).toFixed(2).replace(".", ",")} € ?`;
  if (!window.confirm(confirmMsg)) return;

  try {
    window.showToast("Remboursement en cours…", "info");
    const callable = httpsCallable(functions, "refundOrder");
    const payload = amountCents === undefined ? { orderId } : { orderId, amount: amountCents };
    const res = await callable(payload);
    const rembourse = (Number(res?.data?.amount) || 0) / 100;
    window.showToast(
      `Remboursé ${rembourse.toFixed(2).replace(".", ",")} €${res?.data?.fullyRefunded ? " (total)" : " (partiel)"} ✓`,
      "success"
    );
    // Le radar (onSnapshot) reflète le nouveau paiement.statut automatiquement.
    // Si la fiche commande (onglet Compta) est ouverte : on rafraîchit la liste
    // puis on ré-affiche la fiche avec le bloc remboursement à jour.
    const detail = document.getElementById("order-detail-modal");
    if (detail && !detail.classList.contains("hidden") && typeof window.loadComptaDashboard === "function") {
      try { await window.loadComptaDashboard(); window.openOrderDetail?.(orderId); } catch (_) { /* non bloquant */ }
    }
  } catch (e) {
    console.error("refundOrder :", e);
    const code = e?.code || "";
    const msg =
      code.includes("permission-denied")
        ? "Action réservée à l'administrateur du snack."
        : code.includes("not-found")
          ? "Commande introuvable."
          : /hors limites|déjà intégralement|non remboursable/i.test(e?.message || "")
            ? e.message
            : "Échec du remboursement. Réessayez.";
    window.showToast(msg, "error");
  }
}

// ============================================================================
// ⏸️ PAUSE DE SERVICE CUISINE (COUP DE FEU)
// ============================================================================
function watchKitchenSnack() {
  unwatchKitchenSnack();
  const snackId = window.currentAdminSnackId;
  if (!snackId) return;
  unsubscribeKitchenSnack = onSnapshot(
    doc(db, "snacks", snackId),
    (snap) => {
      kitchenSnack = snap.exists() ? snap.data() : null;
      refreshKitchenClock();
    },
    (err) => console.warn("Suivi snack (pause/horaires) indisponible :", err?.message),
  );
  // Le temps passe sans écriture Firestore : on réévalue horaires/pause toutes les 30 s.
  kitchenClockTimer = setInterval(refreshKitchenClock, 30_000);
}

function unwatchKitchenSnack() {
  unsubscribeKitchenSnack?.();
  unsubscribeKitchenSnack = null;
  if (kitchenClockTimer) clearInterval(kitchenClockTimer);
  kitchenClockTimer = null;
}

function refreshKitchenClock() {
  renderKitchenPauseStatus();
  renderClosingSoon();
  renderReadyAges();
}

// Seuils « prête depuis » : l'équipe sait quoi garder au chaud (frites ~5 min).
const READY_WARN_MIN = 5;
const READY_LATE_MIN = 10;

/**
 * Ancienneté d'une commande prête (fonction PURE).
 * @returns {null|{minutes:number, level:"ok"|"warn"|"late"}} null sans horodatage.
 */
export function readyAgeInfo(datePrete, nowMs = Date.now()) {
  const at = datePrete?.toMillis ? datePrete.toMillis() : (datePrete?.toDate ? datePrete.toDate().getTime() : null);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.floor((nowMs - at) / 60000));
  const level = minutes >= READY_LATE_MIN ? "late" : minutes >= READY_WARN_MIN ? "warn" : "ok";
  return { minutes, level };
}

const READY_AGE_CLASSES = {
  ok: "bg-surface-2 text-text-muted border-line",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
  late: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/40 animate-pulse",
};

// Met à jour le badge « Prête depuis X min » des tickets de la colonne Prête.
function renderReadyAges(nowMs = Date.now()) {
  document.querySelectorAll("#orders-ready [data-ready-age]").forEach((el) => {
    const id = el.closest("[id^='ticket-']")?.id.slice("ticket-".length);
    const info = readyAgeInfo(kitchenOrdersMap.get(id)?.datePrete, nowMs);
    if (!info) {
      el.className = "hidden";
      el.textContent = "";
      return;
    }
    el.className = `mt-1 inline-flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-full border ${READY_AGE_CLASSES[info.level]}`;
    el.textContent = info.minutes < 1 ? "Prête à l'instant" : `Prête depuis ${info.minutes} min`;
  });
}

function kitchenOrderingState() {
  if (!kitchenSnack) return null;
  return getOrderingState(
    kitchenSnack.hours, new Date(), snackTimezone(kitchenSnack), kitchenSnack.lastOrderMinutesBeforeClose,
  );
}

function currentPauseEnd() {
  const src = kitchenSnack || adminStore.state.config;
  const raw = src?.servicePausedUntil;
  const until = raw ? (raw.toDate ? raw.toDate() : new Date(raw)) : null;
  return until && until > new Date() ? until : null;
}

// 🔔 Bandeau « arrêt des commandes dans ≤ 15 min » + bouton pour arrêter tout de suite.
function renderClosingSoon() {
  const banner = document.getElementById("kitchen-closing-banner");
  if (!banner) return;
  const state = kitchenOrderingState();
  const show = !!state && state.configured && state.accepting && !currentPauseEnd()
    && state.minutesToCutoff !== null && state.minutesToCutoff <= CLOSING_WARNING_MIN;
  banner.classList.toggle("hidden", !show);
  banner.classList.toggle("flex", show);
  if (!show) return;

  const title = document.getElementById("kitchen-closing-title");
  const detail = document.getElementById("kitchen-closing-detail");
  if (title) title.innerText = `Arrêt des commandes en ligne à ${state.cutoffTime}`;
  if (detail) {
    detail.innerText = state.lastOrderMinutes > 0
      ? `Fermeture à ${state.closeTime} (dernière commande ${state.lastOrderMinutes} min avant) — encore ~${state.minutesToCutoff} min`
      : `Fermeture à ${state.closeTime} — encore ~${state.minutesToCutoff} min`;
  }

  // Alerte sonore/vibrante une seule fois par service.
  const key = `${new Date().toDateString()}-${state.cutoffTime}`;
  if (closingNotifiedKey !== key) {
    closingNotifiedKey = key;
    window.triggerVibration?.("warning");
    window.showToast?.(`Les commandes en ligne s'arrêtent à ${state.cutoffTime}.`, "info");
  }
}

// ⏹️ Coupe les commandes jusqu'à la PROCHAINE ouverture (rush, sous-effectif, fin de service).
async function stopOrdersUntilReopening() {
  const state = kitchenOrderingState();
  if (!state?.configured) {
    return window.showToast?.("Renseignez vos horaires (onglet Config) pour utiliser cette option.", "error");
  }
  if (state.minutesToOpen === null) {
    return window.showToast?.("Aucune réouverture prévue dans vos horaires.", "error");
  }
  const when = state.nextOpenDayOffset === 0 ? `à ${state.nextOpenTime}` : state.nextOpenDayOffset === 1
    ? `demain à ${state.nextOpenTime}` : `à la prochaine ouverture (${state.nextOpenTime})`;
  await setKitchenServicePause(state.minutesToOpen, `Commandes coupées jusqu'à la réouverture ${when} ⏹️`);
}

function renderKitchenPauseStatus() {
  const cfg = kitchenSnack || adminStore.state.config;
  const banner = document.getElementById("kitchen-pause-banner");
  const timerText = document.getElementById("kitchen-pause-timer-text");
  const triggerBtn = document.getElementById("btn-kitchen-pause-trigger");

  if (!cfg) return;

  const pausedUntil = currentPauseEnd();
  const isPaused = !!pausedUntil;

  if (banner) {
    banner.classList.toggle("hidden", !isPaused);
    if (isPaused && timerText) {
      const minLeft = Math.max(1, Math.round((pausedUntil.getTime() - Date.now()) / 60000));
      // Heure du SNACK ; jour affiché si la reprise est lointaine (coupure jusqu'à la réouverture).
      const timeStr = pausedUntil.toLocaleString("fr-FR", {
        hour: "2-digit", minute: "2-digit", timeZone: snackTimezone(cfg),
        ...(minLeft > 12 * 60 ? { weekday: "long" } : {}),
      });
      timerText.innerText = minLeft > 90
        ? `Reprise automatique ${timeStr}`
        : `Reprise automatique à ${timeStr} (encore ~${minLeft} min)`;
    }
  }

  if (triggerBtn) {
    triggerBtn.classList.toggle("bg-amber-100", isPaused);
    triggerBtn.classList.toggle("text-amber-800", isPaused);
    triggerBtn.classList.toggle("border-amber-300", isPaused);
  }
}

// Écouteur config admin pour mettre à jour l'état de pause
adminStore.addEventListener("admin-config-updated", () => renderKitchenPauseStatus());

function openKitchenPauseModal() {
  const modal = document.getElementById("kitchen-pause-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    window.lucide?.createIcons?.();
  }
}

function closeKitchenPauseModal() {
  const modal = document.getElementById("kitchen-pause-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

async function setKitchenServicePause(minutes, successMessage) {
  const snackId = window.currentAdminSnackId;
  if (!snackId) return;

  const untilDate = new Date(Date.now() + minutes * 60000);

  try {
    await updateDoc(doc(db, "snacks", snackId), {
      servicePausedUntil: untilDate
    });
    closeKitchenPauseModal();
    if (adminStore.state.config) {
      adminStore.state.config.servicePausedUntil = untilDate;
    }
    renderKitchenPauseStatus();
    renderClosingSoon();
    window.showToast?.(successMessage || `Commandes suspendues pour ${minutes} minutes ⏸️`, "success");
  } catch (err) {
    console.error("Erreur mise en pause service:", err);
    window.showToast?.("Impossible d'activer la pause.", "error");
  }
}

async function resumeKitchenService() {
  const snackId = window.currentAdminSnackId;
  if (!snackId) return;

  try {
    await updateDoc(doc(db, "snacks", snackId), {
      servicePausedUntil: null
    });
    if (adminStore.state.config) {
      adminStore.state.config.servicePausedUntil = null;
    }
    refreshKitchenClock();
    window.showToast?.("Service et commandes réactivés ! ▶️", "success");
  } catch (err) {
    console.error("Erreur reprise service:", err);
    window.showToast?.("Impossible de réactiver le service.", "error");
  }
}

export function switchKitchenTab(tab) {
  const tabs = ["waiting", "new", "ready"];
  const cols = {
    waiting: document.getElementById("col-kitchen-waiting"),
    new: document.getElementById("col-kitchen-new"),
    ready: document.getElementById("col-kitchen-ready"),
  };
  const btns = {
    waiting: document.getElementById("tab-btn-waiting"),
    new: document.getElementById("tab-btn-new"),
    ready: document.getElementById("tab-btn-ready"),
  };

  tabs.forEach((t) => {
    const col = cols[t];
    const btn = btns[t];
    const badge = document.getElementById(`tab-count-${t}`);
    if (!col || !btn) return;

    if (t === tab) {
      col.classList.remove("hidden");
      col.classList.add("flex");
      btn.setAttribute("aria-selected", "true");
      if (t === "new") {
        btn.className = "flex-1 py-2.5 px-2 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 bg-red-600 text-white shadow-sm";
        if (badge) badge.className = "bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md";
      } else if (t === "ready") {
        btn.className = "flex-1 py-2.5 px-2 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 bg-green-600 text-white shadow-sm";
        if (badge) badge.className = "bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md";
      } else {
        btn.className = "flex-1 py-2.5 px-2 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 bg-gray-600 text-white shadow-sm";
        if (badge) badge.className = "bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md";
      }
    } else {
      col.classList.add("hidden");
      col.classList.remove("flex");
      btn.setAttribute("aria-selected", "false");
      btn.className = "flex-1 py-2.5 px-2 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 text-text-muted hover:text-text";
      if (badge) badge.className = "bg-surface-2 text-text text-[10px] font-bold px-1.5 py-0.5 rounded-md";
    }
  });
}

window.startKitchenRadar = startKitchenRadar;
window.stopKitchenRadar = stopKitchenRadar;
window.updateOrderStatus = updateOrderStatus;
window.updatePaymentStatus = updatePaymentStatus;
window.handleRefundOrder = handleRefundOrder;
window.openKitchenPauseModal = openKitchenPauseModal;
window.closeKitchenPauseModal = closeKitchenPauseModal;
window.setKitchenServicePause = setKitchenServicePause;
window.resumeKitchenService = resumeKitchenService;
window.stopOrdersUntilReopening = stopOrdersUntilReopening;
window.switchKitchenTab = switchKitchenTab;

