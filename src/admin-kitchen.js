// ============================================================================
// 🍳 CUISINE — Radar temps réel, Tickets, Statuts, Wake Lock
// ============================================================================
// Dépendances : window.currentAdminSnackId, window.currentAdminTab,
//               window.showToast

import { escapeHTML } from "./utils.js";
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
  functions,
  httpsCallable,
} from "./core/firebase.js";

// ============================================================================
// 🔥 SIGNAL DE CAPACITÉ — charge cuisine (rushMode décidé serveur)
// ============================================================================
// Throttlé : la décision rushMode vit côté serveur (getKitchenLoad, cache 30s).
// On ne l'interroge qu'au plus une fois toutes les 30s, déclenché par les
// changements du radar — pas à chaque docChange (coût + cache serveur).
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

  const isWaiting = commande.statut === "en_attente_client";
  const isNew = commande.statut === "nouvelle";

  // 🚚 Bandeau livraison (mode delivery) : le staff voit l'adresse + distance.
  const isDelivery = commande.mode === "delivery";
  const deliveryHtml = isDelivery
    ? `<div class="mb-3 flex items-start gap-2 bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
         <i data-lucide="bike" class="text-blue-600 dark:text-blue-400 mt-0.5"></i>
         <div class="text-sm min-w-0">
           <p class="font-black text-blue-700 dark:text-blue-400 uppercase text-xs tracking-wide">Livraison</p>
           <p class="text-text font-bold">${escapeHTML(commande.livraison?.adresse || "Adresse non renseignée")}</p>
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

  let ticketColor = "bg-surface text-text border-l-8 border-green-500";
  let textColor = "text-green-700 dark:text-green-400";
  let btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="terminee" class="w-full bg-green-600 hover:bg-green-700 text-white font-black py-4 rounded-xl text-xl shadow-lg transition active:scale-95"><i data-lucide="package" class="mr-2"></i> DONNÉE AU CLIENT</button>`;

  if (isWaiting) {
    ticketColor = "bg-surface text-text border-l-8 border-gray-400 opacity-80";
    textColor = "text-text-muted";
    btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="nouvelle" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-black py-3 rounded-xl text-sm shadow-sm transition active:scale-95"><i data-lucide="flame" class="mr-2"></i> Forcer Cuisson</button>`;
  } else if (isNew) {
    ticketColor = "bg-surface text-text border-l-8 border-red-500";
    textColor = "text-red-700 dark:text-red-400";
    btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="prete" class="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 rounded-xl text-xl shadow-lg transition active:scale-95"><i data-lucide="check" class="mr-2"></i> MARQUER PRÊTE</button>`;
  }

  const paymentStatus = commande.paiement?.statut || "en_attente";
  const isPaid = paymentStatus === "paye";

  const priceDisplay = isPaid
    ? `<p class="font-black text-2xl text-green-600 dark:text-green-400 opacity-50 line-through">${(Number(commande.total) || 0).toFixed(2)} €</p>`
    : `<p class="font-black text-2xl ${textColor}">${(Number(commande.total) || 0).toFixed(2)} €</p>`;

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
  ticketDiv.className = `${ticketColor} rounded-2xl shadow-md p-5 animate-fade-in-up border border-line`;
  ticketDiv.setAttribute("data-status", commande.statut);

  ticketDiv.innerHTML = `
        <div class="flex justify-between items-start mb-4 pb-3 border-b border-line">
            <div>
                <div class="flex items-center gap-2">
                  <h3 class="font-black text-2xl text-text">${safeClientName}</h3>
                  <span class="bg-surface-2 text-text border border-line px-2 py-0.5 rounded text-sm font-mono font-bold">${secretCode}</span>
                </div>
                <p class="text-sm text-text-muted font-bold mt-1"><i data-lucide="clock"></i> ${timeString}</p>
            </div>
            <div class="flex flex-col items-end">
                <div class="price-display-container">${priceDisplay}</div>
                <div class="payment-badge-container">${paymentBadgeHtml}</div>
            </div>
        </div>
        ${deliveryHtml}
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
let isFirstLoad = true;

function updateTicketDOM(ticketDiv, commande, id) {
  const paymentStatus = commande.paiement?.statut || "en_attente";
  const isPaid = paymentStatus === "paye";
  const isWaiting = commande.statut === "en_attente_client";
  const isNew = commande.statut === "nouvelle";

  let ticketColor = "bg-surface text-text border-l-8 border-green-500";
  let textColor = "text-green-700 dark:text-green-400";
  let btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="terminee" class="w-full bg-green-600 hover:bg-green-700 text-white font-black py-4 rounded-xl text-xl shadow-lg transition active:scale-95"><i data-lucide="package" class="mr-2"></i> DONNÉE AU CLIENT</button>`;

  if (isWaiting) {
    ticketColor = "bg-surface text-text border-l-8 border-gray-400 opacity-80";
    textColor = "text-text-muted";
    btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="nouvelle" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-black py-3 rounded-xl text-sm shadow-sm transition active:scale-95"><i data-lucide="flame" class="mr-2"></i> Forcer Cuisson</button>`;
  } else if (isNew) {
    ticketColor = "bg-surface text-text border-l-8 border-red-500";
    textColor = "text-red-700 dark:text-red-400";
    btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="prete" class="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 rounded-xl text-xl shadow-lg transition active:scale-95"><i data-lucide="check" class="mr-2"></i> MARQUER PRÊTE</button>`;
  }

  ticketDiv.className = `${ticketColor} rounded-2xl shadow-md p-5 animate-fade-in-up border border-line`;
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

function startKitchenRadar() {
  if (unsubscribeKitchenRadar) {
    unsubscribeKitchenRadar();
    unsubscribeKitchenRadar = null;
  }
  
  requestWakeLock();

  const waitingOrdersContainer = document.getElementById("orders-waiting");
  const newOrdersContainer = document.getElementById("orders-new");
  const readyOrdersContainer = document.getElementById("orders-ready");
  
  if (waitingOrdersContainer) waitingOrdersContainer.innerHTML = "";
  if (newOrdersContainer) newOrdersContainer.innerHTML = "";
  if (readyOrdersContainer) readyOrdersContainer.innerHTML = "";

  const q = query(
    collection(db, "commandes"),
    where("snackId", "==", window.currentAdminSnackId),
    where("statut", "in", ["en_attente_client", "nouvelle", "prete"]),
    orderBy("date", "asc"),
  );

  const bell = document.getElementById("kitchen-bell");

  unsubscribeKitchenRadar = onSnapshot(q, (snapshot) => {
    let ringTheBell = false;

    snapshot.docChanges().forEach((change) => {
      const commande = change.doc.data();
      const id = change.doc.id;
      const existingTicket = document.getElementById(`ticket-${id}`);

      if (change.type === "added") {
        kitchenOrdersMap.set(id, commande);
        if (existingTicket) existingTicket.remove();
        const newTicket = createTicketElement(id, commande);
        if (commande.statut === "en_attente_client" && waitingOrdersContainer)
          waitingOrdersContainer.appendChild(newTicket);
        if (commande.statut === "nouvelle" && newOrdersContainer)
          newOrdersContainer.appendChild(newTicket);
        if (commande.statut === "prete" && readyOrdersContainer)
          readyOrdersContainer.appendChild(newTicket);
        if (commande.statut === "en_attente_client" && !isFirstLoad) ringTheBell = true;
      } else if (change.type === "modified") {
        kitchenOrdersMap.set(id, commande);
        if (existingTicket) {
          // Mise à jour ciblée O(1)
          updateTicketDOM(existingTicket, commande, id);
          
          // Si le statut a changé, on déplace le ticket vers la colonne correspondante
          const currentContainer = existingTicket.parentElement;
          let targetContainer = null;
          if (commande.statut === "en_attente_client") targetContainer = waitingOrdersContainer;
          else if (commande.statut === "nouvelle") targetContainer = newOrdersContainer;
          else if (commande.statut === "prete") targetContainer = readyOrdersContainer;

          if (targetContainer && currentContainer !== targetContainer) {
            targetContainer.appendChild(existingTicket);
          }
        } else {
          // Fallback si le ticket n'existe pas encore (cas rare d'un patch simultané)
          const newTicket = createTicketElement(id, commande);
          if (commande.statut === "en_attente_client" && waitingOrdersContainer)
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
    if (countWaiting && waitingOrdersContainer)
      countWaiting.innerText = waitingOrdersContainer.children.length;
    const countNew = document.getElementById("count-new");
    if (countNew && newOrdersContainer)
      countNew.innerText = newOrdersContainer.children.length;
    const countReady = document.getElementById("count-ready");
    if (countReady && readyOrdersContainer)
      countReady.innerText = readyOrdersContainer.children.length;

    if (ringTheBell && bell) bell.play().catch((e) => console.log("Son bloqué"));

    refreshKitchenLoad(isFirstLoad);
    isFirstLoad = false;
  }, (err) => {
    console.error("Radar cuisine (onSnapshot) erreur :", err);
    window.showToast?.("Connexion au radar interrompue (réseau).", "error");
  });

  console.log("🟢 Radar Cuisine ACTIVÉ.");
}

function stopKitchenRadar() {
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
    await updateDoc(doc(db, "commandes", orderId), { statut: newStatus });
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
function renderKitchenPauseStatus() {
  const cfg = adminStore.state.config;
  const banner = document.getElementById("kitchen-pause-banner");
  const timerText = document.getElementById("kitchen-pause-timer-text");
  const triggerBtn = document.getElementById("btn-kitchen-pause-trigger");

  if (!cfg) return;

  const pausedUntil = cfg.servicePausedUntil
    ? (cfg.servicePausedUntil.toDate ? cfg.servicePausedUntil.toDate() : new Date(cfg.servicePausedUntil))
    : null;
  const isPaused = pausedUntil && pausedUntil > new Date();

  if (banner) {
    banner.classList.toggle("hidden", !isPaused);
    if (isPaused && timerText) {
      const timeStr = pausedUntil.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      const minLeft = Math.max(1, Math.round((pausedUntil.getTime() - Date.now()) / 60000));
      timerText.innerText = `Reprise automatique à ${timeStr} (encore ~${minLeft} min)`;
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

async function setKitchenServicePause(minutes) {
  const snackId = window.currentAdminSnackId;
  if (!snackId) return;

  const untilDate = new Date(Date.now() + minutes * 60000);

  try {
    window.showToast?.(`Mise en pause pour ${minutes} min…`, "info");
    await updateDoc(doc(db, "snacks", snackId), {
      servicePausedUntil: untilDate
    });
    closeKitchenPauseModal();
    if (adminStore.state.config) {
      adminStore.state.config.servicePausedUntil = untilDate;
    }
    renderKitchenPauseStatus();
    window.showToast?.(`Commandes suspendues pour ${minutes} minutes ⏸️`, "success");
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
    renderKitchenPauseStatus();
    window.showToast?.("Service et commandes réactivés ! ▶️", "success");
  } catch (err) {
    console.error("Erreur reprise service:", err);
    window.showToast?.("Impossible de réactiver le service.", "error");
  }
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
