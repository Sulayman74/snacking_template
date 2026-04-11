// ============================================================================
// 🍳 CUISINE — Radar temps réel, Tickets, Statuts, Wake Lock
// ============================================================================
// Dépendances : window.currentAdminSnackId, window.currentAdminTab,
//               window.db, window.fs, window.showToast

import { escapeHTML } from "./utils.js";

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
function createTicketElement(id, commande) {
  const timeString = commande.date
    ? commande.date
        .toDate()
        .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : "";

  const safeClientName = escapeHTML(commande.clientNom || "Client Anonyme");

  let itemsHtml = commande.items
    .map((item) => {
      let optionsHTML = "";
      if (item.tailleChoisie) {
        optionsHTML += `<div class="text-gray-800 font-bold text-sm mt-1 ml-6 flex items-center gap-2"><i class="fas fa-ruler-horizontal text-gray-500"></i> Taille : ${escapeHTML(item.tailleChoisie)}</div>`;
      }
      if (item.boissonNom) {
        optionsHTML += `<div class="text-blue-600 font-bold text-sm mt-1 ml-6 flex items-center gap-2"><i class="fas fa-glass-water"></i> ${escapeHTML(item.boissonNom)}</div>`;
      }
      if (item.sauces && Array.isArray(item.sauces) && item.sauces.length > 0) {
        const safeSauces = item.sauces.map((s) => escapeHTML(s)).join(" + ");
        optionsHTML += `<div class="text-orange-600 font-bold text-sm mt-1 ml-6 flex items-center gap-2"><i class="fas fa-blender"></i> Sauces : ${safeSauces}</div>`;
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
            <li class="flex flex-col border-b border-gray-100/50 py-3 last:border-0">
                <div class="flex items-start">
                    <span class="font-black text-lg text-red-600" aria-hidden="true">${escapeHTML(String(item.quantity))}x</span>
                    <span class="font-bold ml-2 text-gray-900 text-lg">${escapeHTML(item.nom)}</span>
                </div>
                ${optionsHTML}
            </li>`;
    })
    .join("");

  const isWaiting = commande.statut === "en_attente_client";
  const isNew = commande.statut === "nouvelle";

  let ticketColor = "bg-white border-l-8 border-green-500";
  let textColor = "text-green-700";
  let btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="terminee" class="w-full bg-green-600 hover:bg-green-700 text-white font-black py-4 rounded-xl text-xl shadow-lg transition active:scale-95"><i class="fas fa-hand-holding-box mr-2"></i> DONNÉE AU CLIENT</button>`;

  if (isWaiting) {
    ticketColor = "bg-white border-l-8 border-gray-400 opacity-80";
    textColor = "text-gray-600";
    btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="nouvelle" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-black py-3 rounded-xl text-sm shadow-sm transition active:scale-95"><i class="fas fa-fire mr-2"></i> Forcer Cuisson</button>`;
  } else if (isNew) {
    ticketColor = "bg-white border-l-8 border-red-500";
    textColor = "text-red-700";
    btnHtml = `<button type="button" data-action="update-order" data-id="${id}" data-status="prete" class="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 rounded-xl text-xl shadow-lg transition active:scale-95"><i class="fas fa-check mr-2"></i> MARQUER PRÊTE</button>`;
  }

  const paymentStatus = commande.paiement?.statut || "en_attente";
  const isPaid = paymentStatus === "paye";

  const priceDisplay = isPaid
    ? `<p class="font-black text-2xl text-green-600 opacity-50 line-through">${commande.total.toFixed(2)} €</p>`
    : `<p class="font-black text-2xl ${textColor}">${commande.total.toFixed(2)} €</p>`;

  const paymentBadgeHtml = isPaid
    ? `<button type="button" data-action="update-payment" data-id="${id}" data-status="paye" class="mt-2 bg-green-100 text-green-700 px-3 py-1.5 rounded-lg text-xs font-black border border-green-300 shadow-sm transition flex items-center gap-1 hover:bg-green-200"><i class="fas fa-check-circle"></i> PAYÉ</button>`
    : `<button type="button" data-action="update-payment" data-id="${id}" data-status="en_attente" class="mt-2 bg-orange-100 text-orange-800 px-3 py-1.5 rounded-lg text-xs font-black border border-orange-300 shadow-md transition flex items-center gap-1 animate-pulse hover:bg-orange-200"><i class="fas fa-cash-register"></i> ENCAISSER</button>`;

  const ticketDiv = document.createElement("div");
  ticketDiv.id = `ticket-${id}`;
  ticketDiv.className = `${ticketColor} rounded-2xl shadow-md p-5 animate-fade-in-up`;
  ticketDiv.setAttribute("data-status", commande.statut);

  ticketDiv.innerHTML = `
        <div class="flex justify-between items-start mb-4 pb-3 border-b border-gray-100">
            <div>
                <h3 class="font-black text-2xl text-gray-900">${safeClientName}</h3>
                <p class="text-sm text-gray-500 font-bold mt-1"><i class="far fa-clock"></i> ${timeString}</p>
            </div>
            <div class="flex flex-col items-end">
                ${priceDisplay}
                ${paymentBadgeHtml}
            </div>
        </div>
        <ul class="mb-5 text-gray-800 space-y-1">${itemsHtml}</ul>
        ${btnHtml}
    `;

  return ticketDiv;
}

// ============================================================================
// 📡 RADAR FIREBASE (COMMANDES TEMPS RÉEL)
// ============================================================================
let unsubscribeKitchenRadar = null;
let isFirstLoad = true;

function startKitchenRadar() {
  if (unsubscribeKitchenRadar) unsubscribeKitchenRadar();
  requestWakeLock();

  const { query, collection, where, orderBy, onSnapshot } = window.fs;

  const q = query(
    collection(window.db, "commandes"),
    where("snackId", "==", window.currentAdminSnackId),
    where("statut", "in", ["en_attente_client", "nouvelle", "prete"]),
    orderBy("date", "asc"),
  );

  const waitingOrdersContainer = document.getElementById("orders-waiting");
  const newOrdersContainer = document.getElementById("orders-new");
  const readyOrdersContainer = document.getElementById("orders-ready");
  const bell = document.getElementById("kitchen-bell");

  unsubscribeKitchenRadar = onSnapshot(q, (snapshot) => {
    let ringTheBell = false;

    snapshot.docChanges().forEach((change) => {
      const commande = change.doc.data();
      const id = change.doc.id;
      const existingTicket = document.getElementById(`ticket-${id}`);

      if (change.type === "added") {
        const newTicket = createTicketElement(id, commande);
        if (commande.statut === "en_attente_client" && waitingOrdersContainer)
          waitingOrdersContainer.appendChild(newTicket);
        if (commande.statut === "nouvelle" && newOrdersContainer)
          newOrdersContainer.appendChild(newTicket);
        if (commande.statut === "prete" && readyOrdersContainer)
          readyOrdersContainer.appendChild(newTicket);
        if (commande.statut === "nouvelle" && !isFirstLoad) ringTheBell = true;
      } else if (change.type === "modified") {
        if (existingTicket) existingTicket.remove();
        const updatedTicket = createTicketElement(id, commande);
        if (commande.statut === "en_attente_client" && waitingOrdersContainer)
          waitingOrdersContainer.appendChild(updatedTicket);
        if (commande.statut === "nouvelle" && newOrdersContainer)
          newOrdersContainer.appendChild(updatedTicket);
        if (commande.statut === "prete" && readyOrdersContainer)
          readyOrdersContainer.appendChild(updatedTicket);
        if (commande.statut === "nouvelle" && !isFirstLoad) ringTheBell = true;
      } else if (change.type === "removed") {
        if (existingTicket) existingTicket.remove();
      }
    });

    if (document.getElementById("count-waiting") && waitingOrdersContainer)
      document.getElementById("count-waiting").innerText =
        waitingOrdersContainer.children.length;
    if (newOrdersContainer)
      document.getElementById("count-new").innerText =
        newOrdersContainer.children.length;
    if (readyOrdersContainer)
      document.getElementById("count-ready").innerText =
        readyOrdersContainer.children.length;

    if (ringTheBell && bell) bell.play().catch((e) => console.log("Son bloqué"));
    isFirstLoad = false;
  });

  console.log("🟢 Radar Cuisine ACTIVÉ.");
}

function stopKitchenRadar() {
  if (unsubscribeKitchenRadar) {
    unsubscribeKitchenRadar();
    unsubscribeKitchenRadar = null;
    console.log("🔴 Radar Cuisine DÉSACTIVÉ.");
  }
}

// Pause/reprise automatique sur changement d'onglet navigateur
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopKitchenRadar();
  } else {
    if (window.currentAdminTab === "cuisine" && window.currentAdminSnackId) {
      startKitchenRadar();
    }
  }
});

// ============================================================================
// 💳 ACTIONS MÉTIER : STATUT COMMANDE & CAISSE
// ============================================================================
async function updateOrderStatus(orderId, newStatus) {
  try {
    const { updateDoc, doc } = window.fs;
    await updateDoc(doc(window.db, "commandes", orderId), { statut: newStatus });
  } catch (error) {
    console.error("Erreur Statut :", error);
  }
}

async function updatePaymentStatus(orderId, currentStatus) {
  try {
    const newStatus = currentStatus === "paye" ? "en_attente" : "paye";
    const { writeBatch, doc, getDoc, increment } = window.fs;

    const batch = writeBatch(window.db);
    const orderRef = doc(window.db, "commandes", orderId);
    batch.update(orderRef, { "paiement.statut": newStatus });

    if (newStatus === "paye") {
      const orderDoc = await getDoc(orderRef);
      if (orderDoc.exists()) {
        const items = orderDoc.data().items || [];
        for (const item of items) {
          const realProductId = item.productId || item.id.split("-")[0];
          if (realProductId) {
            const productRef = doc(window.db, "produits", realProductId);
            batch.update(productRef, { ventes: increment(item.quantity) });
          }
        }
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

window.startKitchenRadar = startKitchenRadar;
window.stopKitchenRadar = stopKitchenRadar;
window.updateOrderStatus = updateOrderStatus;
window.updatePaymentStatus = updatePaymentStatus;
