// import "./bridge.js";
import "./firebase-init.js";
import "./snack-config.js";

import { escapeHTML } from "./utils.js";

const {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} = window.fs;
const { getDownloadURL, ref, uploadBytes } = window.storageTools;
const { onAuthStateChanged, signInWithEmailAndPassword, signOut } =
  window.authTools;

// ==========================================
// VARIABLES GLOBALES
// ==========================================
let currentAdminSnackId = null;
let isFirstLoad = true;
let adminProducts = [];
let currentEditingProductId = null;
let unsubscribeKitchenRadar = null;
let currentAdminTab = "cuisine"; // Pour savoir sur quel onglet on est
const bell = document.getElementById("kitchen-bell");

// ============================================================================
// 🍳 LE HACK DU CUISTOT : ANTI-VEILLE DE L'ÉCRAN (WAKE LOCK API)
// ============================================================================

let wakeLock = null;

// 1. La fonction pour allumer le verrou
async function requestWakeLock() {
    // On vérifie que la tablette supporte bien cette technologie
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('💡 [Cuisine] Écran maintenu allumé pour le service !');

            // Si le navigateur relâche le verrou pour une question de batterie faible
            wakeLock.addEventListener('release', () => {
                console.log('💡 [Cuisine] Le maintien de l\'écran a été relâché.');
            });
        } catch (err) {
            console.error('❌ Erreur Wake Lock (Anti-veille) :', err.name, err.message);
        }
    } else {
        console.warn("L'API Wake Lock n'est pas supportée sur ce navigateur/tablette.");
    }
}

// 2. La sécurité : Relancer si on change d'onglet
// Si le cuistot va voir ses mails et revient sur la caisse, le verrou saute. 
// On l'écoute et on le remet dès qu'il revient sur notre app.
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// ==========================================
// 1. SÉCURITÉ ET DÉMARRAGE
// ==========================================
// ==========================================
// 🎮 LE ROUTEUR D'ÉVÉNEMENTS ADMIN (Event Delegation)
// ==========================================
document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return; // Clic hors d'un bouton interactif

    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-id');

    // Aiguillage des actions Admin
    switch(action) {
        // --- ZONE CUISINE ---
        case 'update-order':
            const status = target.getAttribute('data-status');
            updateOrderStatus(id, status);
            break;
            
        case 'update-payment':
            const paymentStatus = target.getAttribute('data-status');
            updatePaymentStatus(id, paymentStatus);
            break;

        // --- ZONE MENU / PRODUITS ---
        case 'toggle-product':
            const currentStatus = target.getAttribute('data-current-status') === 'true';
            toggleProductStatus(id, currentStatus);
            break;

        case 'open-edit-modal':
            openEditModal(id);
            break;

        case 'open-delete-modal':
            openDeleteModal(id);
            break;

        // --- AUTRES ACTIONS ---
        case 'close-modal':
            // Gère la fermeture de n'importe quelle modale !
            const modalId = target.getAttribute('data-modal-id');
            closeModal(modalId);
            break;
    }
});

// ✅ LA FONCTION UNIVERSELLE DE FERMETURE
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if(!modal) return;
    
    modal.classList.add("opacity-0");
    modal.querySelector(".bg-white").classList.add("scale-95");
    
    setTimeout(() => {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
        // On nettoie la mémoire si on fermait la modale de suppression/édition
        currentEditingProductId = null;
        productToDeleteId = null; 
    }, 300);
}
// ==========================================
// 🔐 GESTION DE LA CONNEXION ADMIN
// ==========================================

// 1. Écouteur d'état de connexion (Le videur à l'entrée)
setTimeout(() => {
  onAuthStateChanged(window.auth, async (user) => {
    const loginSection = document.getElementById("admin-login-section");
    const startBtn = document.getElementById("start-shift-btn");
    const startupIcon = document.getElementById("startup-icon");
    const startupTitle = document.getElementById("startup-title");
    const startupDesc = document.getElementById("startup-desc");

    if (user) {
      // L'utilisateur est connecté, on vérifie ses droits
      const userDoc = await getDoc(doc(window.db, "users", user.uid));

      if (
        userDoc.exists() &&
        (userDoc.data().role === "admin" ||
          userDoc.data().role === "superadmin")
      ) {
        // ✅ SUCCÈS : C'EST UN VRAI PATRON
        currentAdminSnackId = userDoc.data().snackId;
        if (document.getElementById("admin-email"))
          document.getElementById("admin-email").innerText = user.email;

if (window.snackConfig && window.snackConfig.features && window.snackConfig.features.enablePushNotifs) {
    const tabDesktop = document.getElementById('tab-marketing-desktop');
    const tabMobile = document.getElementById('tab-marketing-mobile');
    
    if (tabDesktop) tabDesktop.classList.remove('hidden');
    if (tabMobile) tabMobile.classList.remove('hidden');
}
        // On met à jour l'UI
        loginSection.classList.add("hidden"); // On cache le formulaire
        startupIcon.className =
          "fas fa-check-circle text-6xl mb-6 text-green-500 animate-bounce";
        startupTitle.innerText = "Accès Autorisé";
        startupDesc.innerText =
          "Cliquez ci-dessous pour activer le radar de cuisine.";
        startBtn.classList.remove("hidden"); // On affiche le bouton "Démarrer"
      } else {
        // ❌ ÉCHEC : C'EST UN CLIENT QUI A TROUVÉ LA PAGE
        window.auth.signOut(); // On le déconnecte de force de cette page
        refuseAccess(
          "Accès refusé. Vous n'avez pas les droits d'administration.",
        );
      }
    } else {
      // 👤 UTILISATEUR NON CONNECTÉ : On affiche le formulaire !
      startupIcon.className = "fas fa-lock text-6xl mb-6 text-gray-300";
      startupTitle.innerText = "Espace Sécurisé";
      startupDesc.innerText =
        "Veuillez vous identifier pour accéder au terminal.";
      startBtn.classList.add("hidden");
      loginSection.classList.remove("hidden"); // On affiche le formulaire
      loginSection.classList.add("flex");
    }
  });
}, 500);

// 2. Écouteur du formulaire de connexion
const adminLoginForm = document.getElementById("admin-login-form");
if (adminLoginForm) {
  adminLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("admin-email-input").value;
    const password = document.getElementById("admin-password-input").value;
    const btn = document.getElementById("admin-login-btn");
    const errorMsg = document.getElementById("admin-login-error");

    // UX: On fait tourner le bouton
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Vérification...`;
    btn.disabled = true;
    errorMsg.classList.add("hidden");

    try {
      // On lance la connexion Firebase
      await signInWithEmailAndPassword(window.auth, email, password);
    } catch (error) {
      console.error("Erreur de connexion:", error);
      errorMsg.innerText = "Identifiants incorrects. Veuillez réessayer.";
      errorMsg.classList.remove("hidden");
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });
}

function refuseAccess(message) {
  document.getElementById("startup-icon").className =
    "fas fa-ban text-6xl mb-6 text-red-500";
  document.getElementById("startup-title").innerText = "Accès Refusé";
  document.getElementById("startup-desc").innerText = message;
  document.getElementById("back-home-btn").classList.remove("hidden");
}

// Débloquer l'audio via interaction utilisateur
document.getElementById("start-shift-btn").addEventListener("click", () => {
  bell.volume = 0;
  bell
    .play()
    .then(() => {
      bell.pause();
      bell.currentTime = 0;
      bell.volume = 1;
      document.getElementById("startup-overlay").classList.add("hidden");
      startKitchenRadar();
    })
    .catch((e) => console.error("Erreur Audio:", e));
});

// ==========================================
// 🎟️ GÉNÉRATEUR DE TICKET HTML
// ==========================================
function createTicketElement(id, commande) {
    const timeString = commande.date
        ? commande.date.toDate().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        : "";

    const safeClientName = escapeHTML(commande.clientNom || "Client Anonyme");

    let itemsHtml = commande.items.map((item) => {
        let optionsHTML = "";
        if (item.tailleChoisie) {
            optionsHTML += `<div class="text-gray-800 font-bold text-sm mt-1 ml-6 flex items-center gap-2"><i class="fas fa-ruler-horizontal text-gray-500"></i> Taille : ${escapeHTML(item.tailleChoisie)}</div>`;
        }
        if (item.boissonNom) {
            optionsHTML += `<div class="text-blue-600 font-bold text-sm mt-1 ml-6 flex items-center gap-2"><i class="fas fa-glass-water"></i> ${escapeHTML(item.boissonNom)}</div>`;
        }
        if (item.sauces && Array.isArray(item.sauces) && item.sauces.length > 0) {
            const safeSauces = item.sauces.map(s => escapeHTML(s)).join(' + ');
            optionsHTML += `<div class="text-orange-600 font-bold text-sm mt-1 ml-6 flex items-center gap-2"><i class="fas fa-blender"></i> Sauces : ${safeSauces}</div>`;
        }
        if (item.sansCrudites && Array.isArray(item.sansCrudites) && item.sansCrudites.length > 0) {
            const safeCrudites = item.sansCrudites.map(c => escapeHTML(c)).join(', ');
            optionsHTML += `<div class="mt-2 ml-6"><span class="bg-red-600 text-white px-2 py-1 rounded-md font-black text-xs uppercase shadow-sm border border-red-800">⚠️ ${safeCrudites}</span></div>`;
        }

        return `
            <li class="flex flex-col border-b border-gray-100/50 py-3 last:border-0">
                <div class="flex items-start">
                    <span class="font-black text-lg text-red-600" aria-hidden="true">${escapeHTML(item.quantity)}x</span> 
                    <span class="font-bold ml-2 text-gray-900 text-lg">${escapeHTML(item.nom)}</span>
                </div>
                ${optionsHTML}
            </li>`;
    }).join("");

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

    // On crée un élément DOM complet au lieu d'une simple chaîne HTML
    const ticketDiv = document.createElement('div');
    ticketDiv.id = `ticket-${id}`; // 🎯 CRUCIAL : Un ID unique pour retrouver le ticket plus tard
    ticketDiv.className = `${ticketColor} rounded-2xl shadow-md p-5 animate-fade-in-up`;
    ticketDiv.setAttribute('data-status', commande.statut); // Utile pour les compteurs
    
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

// ==========================================
// 2. RADAR FIREBASE (COMMANDES TEMPS RÉEL OPTIMISÉ)
// ==========================================
function startKitchenRadar() {
    if (unsubscribeKitchenRadar) unsubscribeKitchenRadar();
    requestWakeLock();
    
    const q = query(
        collection(window.db, "commandes"),
        where("snackId", "==", currentAdminSnackId),
        where("statut", "in", ["en_attente_client", "nouvelle", "prete"]),
        orderBy("date", "asc"), // 💡 Astuce : On trie en 'asc' pour que les vieux tickets restent en haut de la liste quand on les append
    );

    const waitingOrdersContainer = document.getElementById("orders-waiting");
    const newOrdersContainer = document.getElementById("orders-new");
    const readyOrdersContainer = document.getElementById("orders-ready");

    unsubscribeKitchenRadar = onSnapshot(q, (snapshot) => {
        let ringTheBell = false;

        snapshot.docChanges().forEach((change) => {
            const commande = change.doc.data();
            const id = change.doc.id;
            
            // 🎯 L'élément DOM du ticket (s'il existe déjà sur l'écran)
            const existingTicket = document.getElementById(`ticket-${id}`);

            if (change.type === "added") {
                // NOUVEAU TICKET : On le crée et on l'ajoute à la bonne colonne
                const newTicket = createTicketElement(id, commande);
                if (commande.statut === "en_attente_client" && waitingOrdersContainer) waitingOrdersContainer.appendChild(newTicket);
                if (commande.statut === "nouvelle" && newOrdersContainer) newOrdersContainer.appendChild(newTicket);
                if (commande.statut === "prete" && readyOrdersContainer) readyOrdersContainer.appendChild(newTicket);
                
                if (commande.statut === "nouvelle" && !isFirstLoad) ringTheBell = true;

            } else if (change.type === "modified") {
                // TICKET MODIFIÉ (Changement de statut ou de paiement)
                if (existingTicket) existingTicket.remove(); // On détruit l'ancien
                
                const updatedTicket = createTicketElement(id, commande); // On génère le nouveau (avec les nouvelles couleurs)
                
                // On le place dans sa nouvelle maison
                if (commande.statut === "en_attente_client" && waitingOrdersContainer) waitingOrdersContainer.appendChild(updatedTicket);
                if (commande.statut === "nouvelle" && newOrdersContainer) newOrdersContainer.appendChild(updatedTicket);
                if (commande.statut === "prete" && readyOrdersContainer) readyOrdersContainer.appendChild(updatedTicket);

                if (commande.statut === "nouvelle" && !isFirstLoad) ringTheBell = true;

            } else if (change.type === "removed") {
                // TICKET ARCHIVÉ : On le retire simplement de l'écran
                if (existingTicket) existingTicket.remove();
            }
        });

        // Mise à jour des compteurs (On compte simplement les enfants de chaque div)
        if (document.getElementById("count-waiting") && waitingOrdersContainer) {
             document.getElementById("count-waiting").innerText = waitingOrdersContainer.children.length;
        }
        if (newOrdersContainer) {
            document.getElementById("count-new").innerText = newOrdersContainer.children.length;
        }
        if (readyOrdersContainer) {
            document.getElementById("count-ready").innerText = readyOrdersContainer.children.length;
        }

        if (ringTheBell) bell.play().catch((e) => console.log("Son bloqué"));
        isFirstLoad = false;
    });

    console.log("🟢 Radar Cuisine ACTIVÉ (Mode Réactif Hautes Performances).");
}
// 3. Crée cette nouvelle fonction pour couper le robinet :
function stopKitchenRadar() {
  if (unsubscribeKitchenRadar) {
    unsubscribeKitchenRadar(); // Coupe la connexion Firestore
    unsubscribeKitchenRadar = null;
    console.log("🔴 Radar Cuisine DÉSACTIVÉ (Économie de requêtes).");
  }
}

// 4. L'AUTOMATISATION (Le vrai hack)
// On écoute si le cuistot change de page ou éteint l'écran de la tablette
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // L'écran est éteint ou onglet masqué -> On coupe Firebase !
    stopKitchenRadar();
  } else {
    // L'écran se rallume -> On relance Firebase (si on est sur le bon onglet)
    if (currentAdminTab === "cuisine" && currentAdminSnackId) {
      startKitchenRadar();
    }
  }
});

// 1. ACTION MÉTIER : LA CUISINE
async function updateOrderStatus(orderId, newStatus) {
  try {
    await window.fs.updateDoc(window.fs.doc(window.db, "commandes", orderId), {
      statut: newStatus,
    });
    // Plus tard, on mettra ici la logique de notification Push pour "C'est prêt"
  } catch (error) {
    console.error("Erreur Statut :", error);
  }
};

// ==========================================
// 💳 ACTION MÉTIER : LA CAISSE (Encaissement avec BATCH)
// ==========================================
async function updatePaymentStatus(orderId, currentStatus) {
  try {
    const newStatus = currentStatus === "paye" ? "en_attente" : "paye";

    // 1. On prépare notre BATCH (La boîte sécurisée)
    const batch = window.fs.writeBatch(window.db);
    
    // 2. On prépare la mise à jour de la commande
    const orderRef = window.fs.doc(window.db, "commandes", orderId);
    batch.update(orderRef, { "paiement.statut": newStatus });

    // 3. 📈 MISE À JOUR DES STATS BEST-SELLERS
    if (newStatus === "paye") {
      const orderDoc = await window.fs.getDoc(orderRef);

      if (orderDoc.exists()) {
        const items = orderDoc.data().items || [];

        // On boucle et on ajoute CHAQUE modification dans le Batch
        for (const item of items) {
          const realProductId = item.productId || item.id.split("-")[0];

          if (realProductId) {
            const productRef = window.fs.doc(window.db, "produits", realProductId);
            // On ajoute l'instruction au batch (sans await !)
            batch.update(productRef, {
              ventes: window.fs.increment(item.quantity),
            });
          }
        }
      }
    }

    // 4. L'EXÉCUTION MAGIQUE 🪄
    // On envoie le lot en une seule fois. C'est 100% sécurisé !
    await batch.commit();
    
    console.log(`💳 Paiement mis à jour : ${newStatus}`);
    
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

// ==========================================
// 3. ONGLETS ET NAVIGATION (DESKTOP & MOBILE)
// ==========================================
window.switchAdminTab = (tabName) => {
    currentAdminTab = tabName;
    const tabs = ['cuisine', 'menu', 'marketing', 'compta'];

    tabs.forEach(t => {
        const btnDesktop = document.getElementById(`tab-${t}-desktop`);
        const btnMobile = document.getElementById(`tab-${t}-mobile`);
        const view = document.getElementById(`view-${t}`);

        // 1. Reset Desktop (Sidebar Tiroir)
        if (btnDesktop) {
            btnDesktop.className = "w-full flex items-center px-6 py-4 text-gray-400 hover:text-white hover:bg-gray-800 rounded-r-2xl font-bold transition";
        }
        // 2. Reset Mobile
        if (btnMobile) {
            btnMobile.classList.remove('text-red-600', 'text-yellow-500', 'text-blue-600', 'text-green-600');
            btnMobile.classList.add('text-gray-400');
        }
        // 3. Cacher la vue
        if (view) {
            view.classList.add('hidden');
            if (t === 'cuisine') view.classList.remove('flex');
        }
    });

    // Activation de l'onglet demandé
    const activeBtnDesktop = document.getElementById(`tab-${tabName}-desktop`);
    const activeBtnMobile = document.getElementById(`tab-${tabName}-mobile`);
    const activeView = document.getElementById(`view-${tabName}`);

    if (activeBtnDesktop) {
        activeBtnDesktop.className = "w-full flex items-center px-6 py-4 bg-gray-800 text-white rounded-r-2xl font-bold shadow transition hover:bg-gray-700";
    }

    if (activeBtnMobile) {
        activeBtnMobile.classList.remove('text-gray-400');
        if (tabName === 'cuisine') activeBtnMobile.classList.add('text-red-600');
        if (tabName === 'menu') activeBtnMobile.classList.add('text-yellow-500');
        if (tabName === 'marketing') activeBtnMobile.classList.add('text-blue-600');
        if (tabName === 'compta') activeBtnMobile.classList.add('text-green-600');
    }

    if (activeView) {
        activeView.classList.remove('hidden');
        if (tabName === 'cuisine') activeView.classList.add('flex');
    }

    // Logique d'arrière-plan
    if (tabName === 'cuisine') {
        startKitchenRadar(); 
    } else {
        stopKitchenRadar(); 
    }
    if (tabName === 'menu') {
        loadAdminProducts();
    }
};

// ==========================================
// 🍔 CHARGEMENT & AFFICHAGE DU MENU (PIM avec Skeletons & Fallback)
// ==========================================
async function loadAdminProducts() {
  if (!currentAdminSnackId) return;
  const grid = document.getElementById("admin-products-grid");
  if (!grid) return;

  // 💀 1. INJECTION DES SKELETON LOADERS
  // On génère 6 fausses cartes qui clignotent le temps du chargement
  const skeletonHtml = Array(6)
    .fill(
      `
                <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col animate-pulse">
                    <div class="flex items-center gap-4 p-4 border-b border-gray-100">
                        <div class="w-16 h-16 rounded-xl bg-gray-200"></div>
                        <div class="flex-1 space-y-3">
                            <div class="h-4 bg-gray-200 rounded-md w-3/4"></div>
                            <div class="h-3 bg-gray-200 rounded-md w-1/2"></div>
                        </div>
                    </div>
                    <div class="p-4 bg-gray-50 flex justify-between items-center mt-auto">
                        <div class="h-8 w-28 bg-gray-200 rounded-full"></div>
                        <div class="h-8 w-24 bg-gray-200 rounded-xl"></div>
                    </div>
                </div>
            `,
    )
    .join("");
  grid.innerHTML = skeletonHtml;

  try {
    // Requête Firestore
    const q = query(
      collection(window.db, "produits"),
      where("snackId", "==", currentAdminSnackId),
    );
    const snapshot = await getDocs(q);
    adminProducts = [];

    // On efface les Skeletons pour mettre les vraies données
    grid.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const item = { id: docSnap.id, ...docSnap.data() };
      adminProducts.push(item);

      const isAvailable = item.isAvailable !== false;
      const toggleColor = isAvailable ? "bg-green-500" : "bg-gray-300";
      const toggleTranslate = isAvailable ? "translate-x-6" : "translate-x-1";
      const statusText = isAvailable
        ? "<span class='text-green-600'>En stock</span>"
        : "<span class='text-red-600 font-bold'>Épuisé</span>";
      const prixBaseText = `${(item.prix || 0).toFixed(2)} €`;
      const prixMenuText = item.allowMenu !== false ? `<span class="text-red-500 text-xs ml-1 bg-red-50 px-2 py-0.5 rounded-md">(Menu +${(item.menuPriceAdd || 2.5).toFixed(2)}€)</span>` 
    : `<span class="text-gray-400 text-xs ml-1 italic">Solo</span>`;

      // 🖼️ 2. GESTION DU FALLBACK IMAGE (Comme sur l'app publique)
      const imageUrl =
        item.image && item.image.trim() !== "" ? item.image : null;
      const fallbackHtml = `
                        <div class="w-16 h-16 rounded-xl bg-gray-100 shadow-inner flex items-center justify-center shrink-0 border border-gray-200">
                            <i class="fas fa-hamburger text-gray-300 text-2xl"></i>
                        </div>`;

      const imageHtml = imageUrl
        ? `<div class="relative w-16 h-16 shrink-0">
                               <img src="${imageUrl}" alt="${item.nom}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="absolute inset-0 w-full h-full rounded-xl object-cover shadow-sm border border-gray-200 z-10">
                               <div style="display: none;" class="absolute inset-0 rounded-xl bg-gray-100 shadow-inner items-center justify-center border border-gray-200 z-0">
                                   <i class="fas fa-hamburger text-gray-300 text-2xl"></i>
                               </div>
                           </div>`
        : fallbackHtml;

      // 🛠️ 3. INJECTION DE LA CARTE RÉELLE
      grid.innerHTML += `
                        <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col transition-all hover:shadow-md animate-fade-in-up">
                            <div class="flex items-center gap-4 p-4 border-b border-gray-100">
                                ${imageHtml}
                                <div class="flex-1">
                                    <h4 class="font-black text-gray-900 leading-tight">${escapeHTML(item.nom)}</h4>
                                    <p class="text-gray-500 text-sm font-bold mt-1">${prixBaseText} <span class="text-red-500 text-xs ml-1">${prixMenuText}</span></p>
                                </div>
                            </div>
<div class="p-4 bg-gray-50 flex justify-between items-center mt-auto">
    <div class="flex flex-col items-start gap-1">
        <p class="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Disponibilité</p>
        <div class="flex items-center gap-3">
            <button data-action="toggle-product" data-id="${item.id}" data-status=${isAvailable} class="relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${toggleColor}">
                <span class="inline-block h-5 w-5 transform rounded-full bg-white transition duration-300 shadow-md ${toggleTranslate}"></span>
            </button>
            <span class="text-sm font-bold">${statusText}</span>
        </div>
    </div>
    
    <div class="flex items-center gap-2">
        <button data-action="open-edit-modal" data-id=${item.id} aria-label="Modifier" class="bg-white border border-gray-200 text-gray-900 hover:bg-gray-900 hover:text-white w-10 h-10 rounded-xl text-sm font-bold transition shadow-sm flex items-center justify-center">
            <i class="fas fa-pen"></i>
        </button>
<button data-action="open-delete-modal" data-id=${item.id} aria-label="Supprimer" class="bg-white border border-red-200 text-red-600 hover:bg-red-600 hover:text-white w-10 h-10 rounded-xl text-sm font-bold transition shadow-sm flex items-center justify-center">
    <i class="fas fa-trash"></i>
</button>
    </div>
</div>
                        </div>`;
    });
    populatePushProducts();
  } catch (error) {
    grid.innerHTML =
      '<p class="text-red-500 bg-red-50 p-4 rounded-xl font-bold"><i class="fas fa-exclamation-triangle mr-2"></i> Erreur lors du chargement du menu.</p>';
  }
}

async function toggleProductStatus(productId, currentStatus){
  try {
    await updateDoc(doc(window.db, "produits", productId), {
      isAvailable: !currentStatus,
    });
    loadAdminProducts();
  } catch (error) {
    alert("Erreur de modification du statut.");
  }
};

// ==========================================
// 4. MODALE D'ÉDITION ET UPLOAD FIREBASE STORAGE
// ==========================================
async function openEditModal(productId){
  const product = adminProducts.find((p) => p.id === productId);
  if (!product) return;
  currentEditingProductId = productId;

  document.getElementById("edit-modal-title").innerText =
    `Modifier : ${product.nom}`;
  document.getElementById("edit-desc").value = product.description || "";
  document.getElementById("edit-prix").value = product.prix || 0;
  document.getElementById("edit-prix-menu").value = product.menuPriceAdd || 2.5;
  const currentTag = Array.isArray(product.tags)
    ? product.tags[0]
    : product.tags || "";
  document.getElementById("edit-tags").value = currentTag;
  // On remplit le menu déroulant avec les catégories dynamiques
  populateCategoryDropdown(product.categorieId);
  document.getElementById("edit-img-file").value = "";
  const checkbox = document.getElementById("edit-allow-menu");
  const prixMenuContainer = document.getElementById("edit-prix-menu-container");

  // Si allowMenu n'est pas défini, on considère par défaut que c'est un menu (sauf desserts/boissons)
  let isMenuAllowed = true;
  if (product.allowMenu !== undefined) {
    isMenuAllowed = product.allowMenu;
  } else if (
    product.categorieId === "drinks" ||
    product.categorieId === "deserts"
  ) {
    isMenuAllowed = false;
  }

  checkbox.checked = isMenuAllowed;

  // On déclenche manuellement l'événement 'change' pour que notre petit script du point 1 affiche/cache le champ !
  checkbox.dispatchEvent(new Event("change"));

  // 🥗 Remplir les Crudités
  const hasCrudites = !!product.hasCrudites;
  document.getElementById("edit-has-crudites").checked = hasCrudites;
  if (hasCrudites) {
    document.getElementById("edit-crudites-list").value = Array.isArray(product.crudites) ? product.crudites.join(", ") : "Salade, Tomate, Oignon";
  }

  // 🥣 Remplir les Sauces
  const hasSauces = !!product.choixSauces;
  document.getElementById("edit-has-sauces").checked = hasSauces;
  if (hasSauces && product.choixSauces) {
    document.getElementById("edit-sauces-list").value = Array.isArray(product.choixSauces.liste) ? product.choixSauces.liste.join(", ") : "";
    document.getElementById("edit-sauces-max").value = product.choixSauces.max || 2;
  }

  // On simule un clic pour afficher/cacher les bonnes cases visuellement
  document.getElementById("edit-has-crudites").dispatchEvent(new Event("change"));
  document.getElementById("edit-has-sauces").dispatchEvent(new Event("change"));

  // 📸 Gestion de l'image et du Fallback
  const imgEl = document.getElementById("edit-preview-img");
  const fallbackEl = document.getElementById("edit-preview-fallback");

  if (product.image && product.image.trim() !== "") {
    imgEl.src = product.image;
    imgEl.style.display = "block";
    fallbackEl.style.display = "none";
  } else {
    imgEl.src = "";
    imgEl.style.display = "none";
    fallbackEl.style.display = "flex";
  }

  // Affichage de la modale
  const modal = document.getElementById("edit-product-modal");
  modal.classList.remove("hidden");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector(".bg-white").classList.remove("scale-95");
  }, 10);
};

// ✨ BONUS UX : Prévisualisation en direct de la nouvelle photo !
document
  .getElementById("edit-img-file")
  .addEventListener("change", function (event) {
    if (event.target.files && event.target.files[0]) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const imgEl = document.getElementById("edit-preview-img");
        const fallbackEl = document.getElementById("edit-preview-fallback");
        imgEl.src = e.target.result; // Affiche la photo locale
        imgEl.style.display = "block";
        fallbackEl.style.display = "none";
      };
      reader.readAsDataURL(event.target.files[0]);
    }
  });


// Variable globale pour mémoriser le produit à supprimer
let productToDeleteId = null;

// 1. OUVRE LA MODALE (Appelé par le bouton poubelle sur la carte du produit)
async function openDeleteModal(id){
  productToDeleteId = id;
  const modal = document.getElementById("delete-confirm-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex"); // Nécessaire si on utilise flex-col
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector(".bg-white").classList.remove("scale-95");
  }, 10);
};


// 3. LA VRAIE SUPPRESSION (Appelé par le gros bouton rouge de la modale)
window.confirmDeleteProduct = async () => {
  if (!productToDeleteId) return;

  const btn = document.getElementById("confirm-delete-btn");
  
  // On fige l'état en chargement
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Suppression...';
  btn.disabled = true;

  try {
    await deleteDoc(doc(window.db, "produits", productToDeleteId));
    window.showToast("Produit définitivement supprimé.", "success");
closeModal("delete-confirm-modal");
    loadAdminProducts(); // On recharge la grille
  } catch (error) {
    console.error("Erreur de suppression:", error);
    window.showToast("Erreur lors de la suppression.", "error");
  } finally {
    // 🪄 MAGIE : Quoi qu'il arrive (succès ou erreur), on remet le bouton à zéro
    // On attend 300ms pour que l'animation de fermeture de la modale soit finie
    setTimeout(() => {
        btn.innerHTML = '<i class="fas fa-trash"></i> Oui, supprimer';
        btn.disabled = false;
    }, 300);
  }
};

// Fonction pour ouvrir la modale en mode "AJOUT"
// 1. OUVIR LA MODALE D'AJOUT
window.openAddProductModal = () => {
  currentEditingProductId = null;

  document.getElementById("edit-product-form").reset();
  // CORRECTION ICI 👇 : C'est "edit-modal-title"
  document.getElementById("edit-modal-title").innerText = "➕ Nouveau Produit";
  document.getElementById("save-product-btn").innerHTML =
    '<i class="fas fa-plus mr-2"></i> Créer le produit';
  document.getElementById("edit-allow-menu").checked = true;
  document.getElementById("edit-has-crudites").checked = false;
  document.getElementById("edit-has-sauces").checked = false;
  // Initialisation par défaut sur Burgers
  populateCategoryDropdown("burgers");
  // On déclenche les événements pour cacher les champs
  dispatchEvent(new Event("change"));
  
  const modal = document.getElementById("edit-product-modal");
  modal.classList.remove("hidden");
  dispatchEvent(new Event("change"));
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector(".bg-white").classList.remove("scale-95");
  }, 10);
};

// ==========================================
// 💾 SAUVEGARDE DU PRODUIT (UNIQUE ET SÉCURISÉ)
// ==========================================
document.getElementById("edit-product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-product-btn");
    const originalBtnHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sauvegarde...';
    btn.disabled = true;

    try {
      // 1. Récupération des données
      const nom = document.getElementById("edit-nom").value;
      const desc = document.getElementById("edit-desc").value;
      const prix = parseFloat(document.getElementById("edit-prix").value);
      const prixMenu = parseFloat(document.getElementById("edit-prix-menu").value || 0);
      const fileInput = document.getElementById("edit-img-file");
      const tagChoisi = document.getElementById("edit-tags").value;
      let categorieChoisie = document.getElementById("edit-category").value;
      let categorieTitre = null;
      // 🪄 Si le client a créé une nouvelle catégorie
      if (categorieChoisie === "NEW") {
          const newCatRaw = document.getElementById("edit-new-category").value.trim();
          if (!newCatRaw) {
              window.showToast("Veuillez saisir le nom de la catégorie", "error");
              btn.innerHTML = originalBtnHtml;
              btn.disabled = false;
              return;
          }
          categorieTitre = newCatRaw; // "🥗 Salades Fraîches"
          // On génère un ID technique propre (ex: "salades-fraiches")
          categorieChoisie = newCatRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-");
      }
      
      const allowMenuCheckbox = document.getElementById("edit-allow-menu");
      const allowMenu = allowMenuCheckbox ? allowMenuCheckbox.checked : true;

    // 💡 GESTION INTELLIGENTE DES CRUDITÉS
      const hasCrudites = document.getElementById("edit-has-crudites").checked;
      let finalCrudites = null;
      if (hasCrudites) {
          const cruditesInput = document.getElementById("edit-crudites-list").value;
          // Transforme "Salade, Tomate, Oignon" en ["Salade", "Tomate", "Oignon"]
          finalCrudites = cruditesInput.split(',').map(s => s.trim()).filter(s => s !== "");
          if (finalCrudites.length === 0) finalCrudites = ["Salade", "Tomate", "Oignon"];
      }

      // 💡 GESTION INTELLIGENTE DES SAUCES
      const hasSauces = document.getElementById("edit-has-sauces").checked;
      let finalSauces = null;
      if (hasSauces) {
          const saucesInput = document.getElementById("edit-sauces-list").value;
          const maxSauces = parseInt(document.getElementById("edit-sauces-max").value) || 2;
          const listeSauces = saucesInput.split(',').map(s => s.trim()).filter(s => s !== "");
          
          if (listeSauces.length > 0) {
              finalSauces = { liste: listeSauces, max: maxSauces };
          }
      }

      // 2. Formatage de l'objet (On utilise updateData PARTOUT)
      let updateData = {
        nom: nom,
        description: desc,
        prix: prix,
        menuPriceAdd: prixMenu,
        tags: tagChoisi ? [tagChoisi] : [],
        categorieId: categorieChoisie,
        ...(categorieTitre && { categorieTitre: categorieTitre }),
        allowMenu: allowMenu,
        hasCrudites: hasCrudites,     
        crudites: finalCrudites,      
        choixSauces: finalSauces,     
        updatedAt: serverTimestamp(),
      };

      // 3. Gestion de l'image (si nouvelle image sélectionnée)
      if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, "")}`;
        const storageReference = ref(window.storage, `produits/${currentAdminSnackId}/${fileName}`);
        await uploadBytes(storageReference, file);
        updateData.image = await getDownloadURL(storageReference);
      }

      // 4. Envoi à Firestore (Création ou Mise à jour)
      if (currentEditingProductId) {
        // 🔄 MISE À JOUR
        await updateDoc(doc(window.db, "produits", currentEditingProductId), updateData);
        window.showToast("Produit mis à jour avec succès !", "success");
      } else {
        // 🆕 CRÉATION
        updateData.snackId = currentAdminSnackId;
        updateData.createdAt = serverTimestamp();
        updateData.isAvailable = true;

        await addDoc(collection(window.db, "produits"), updateData);
        window.showToast("Nouveau produit ajouté !", "success");
      }

      // 5. Nettoyage de l'UI
closeModal("edit-product-modal");
      loadAdminProducts(); // Recharge la grille en direct

    } catch (error) {
      console.error("Erreur de sauvegarde :", error);
      window.showToast("Erreur lors de la sauvegarde.", "error");
    } finally {
      // On rend le bouton cliquable à nouveau
      btn.innerHTML = originalBtnHtml;
      btn.disabled = false;
    }
});

// ==========================================
// 💡 BONUS UX : AFFICHER/CACHER LE PRIX DU MENU
// ==========================================
const allowMenuCheckbox = document.getElementById("edit-allow-menu");
const prixMenuContainer = document.getElementById("edit-prix-menu-container");

if (allowMenuCheckbox && prixMenuContainer) {
  allowMenuCheckbox.addEventListener("change", (e) => {
    if (e.target.checked) {
      prixMenuContainer.classList.remove("hidden");
      prixMenuContainer.classList.add("block");
    } else {
      prixMenuContainer.classList.add("hidden");
      prixMenuContainer.classList.remove("block");
    }
  });
}

// ==========================================
// 💡 AFFICHER/CACHER LES OPTIONS AVANCÉES
// ==========================================
const cruditesCheckbox = document.getElementById("edit-has-crudites");
const cruditesContainer = document.getElementById("edit-crudites-container");
if (cruditesCheckbox && cruditesContainer) {
  cruditesCheckbox.addEventListener("change", (e) => {
    e.target.checked ? cruditesContainer.classList.remove("hidden") : cruditesContainer.classList.add("hidden");
  });
}

const saucesCheckbox = document.getElementById("edit-has-sauces");
const saucesContainer = document.getElementById("edit-sauces-container");
if (saucesCheckbox && saucesContainer) {
  saucesCheckbox.addEventListener("change", (e) => {
    e.target.checked ? saucesContainer.classList.remove("hidden") : saucesContainer.classList.add("hidden");
  });
}

// ==========================================
// 🍞 NOTIFICATIONS TOAST (ADMIN)
// ==========================================
window.showToast = function (message, type = "success") {
  const snackbar = document.getElementById("admin-snackbar");
  if (!snackbar) {
      alert(message); // Sécurité si le HTML n'est pas encore là
      return;
  }
  const msgEl = document.getElementById("admin-snackbar-message");
  const iconEl = document.getElementById("admin-snackbar-icon");

  msgEl.innerText = message;
  iconEl.className = type === "error"
      ? "fas fa-exclamation-circle text-red-500 text-xl"
      : "fas fa-check-circle text-green-400 text-xl";

  snackbar.classList.remove("translate-y-24", "opacity-0");
  setTimeout(() => snackbar.classList.add("translate-y-24", "opacity-0"), 3000);
};

// ==========================================
// 🚀 GESTION DES CAMPAGNES PUSH MARKETING
// ==========================================
const pushForm = document.getElementById('push-campaign-form');
if (pushForm) {
    pushForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btn = document.getElementById('btn-send-push');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Préparation en cours...`;
        btn.disabled = true;

        try {
            const titre = document.getElementById('push-title').value;
            const message = document.getElementById('push-message').value;
            const cible = document.getElementById('push-target').value;
            const dateSaisie = document.getElementById('push-date').value;
            const selectedProductId = document.getElementById('push-product-link').value;

            // Déterminer la date d'envoi prévue (immédiate ou planifiée)
            let dateEnvoi = null;
            if (dateSaisie) {
                dateEnvoi = new Date(dateSaisie);
            } else {
                dateEnvoi = new Date(); // Maintenant
            }
            // 🪄 LA MAGIE DU DEEP LINK ET DE LA RICH NOTIFICATION
            let actionUrl = null;
            let imageUrl = null;
            if (selectedProductId) {
                actionUrl = `?action=product&id=${selectedProductId}`; // Le Deep Link
                
                // Bonus de génie : On récupère l'image du produit pour illustrer la notification !
                const targetProduct = adminProducts.find(p => p.id === selectedProductId);
                if (targetProduct && targetProduct.image && targetProduct.image.trim() !== "") {
                    imageUrl = targetProduct.image;
                }
            }

            const { addDoc, collection, serverTimestamp } = window.fs;

            // 📥 On sauvegarde la demande de campagne dans la BDD
            await addDoc(collection(window.db, "campagnes_push"), {
                snackId: currentAdminSnackId,
                titre: titre,
                message: message,
                cible: cible,
                ...(actionUrl && { actionUrl: actionUrl }), // Optionnel
                ...(imageUrl && { imageUrl: imageUrl }),    // Optionnel
                dateCreation: serverTimestamp(),
                dateEnvoiPrevue: dateEnvoi,
                statut: "en_attente", // Le serveur lira ce statut pour savoir s'il doit envoyer
                stats: { envoye: 0, clics: 0 }
            });

            pushForm.reset();
            alert("✅ Campagne programmée avec succès !");

        } catch (error) {
            console.error("Erreur Push :", error);
            alert("Erreur lors de la programmation de la campagne.");
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    });
}

// ==========================================
// 🗂️ GESTION DYNAMIQUE DES CATÉGORIES
// ==========================================
function populateCategoryDropdown(selectedCategory = "burgers") {
    const select = document.getElementById("edit-category");
    const newCatInput = document.getElementById("edit-new-category");
    
    // 1. On liste d'abord les catégories de base (Fallback)
    const categoriesMap = new Map([
        ["tacos", "🌮 Tacos"],
        ["burgers", "🍔 Burgers"],
        ["wraps", "🌯 Wraps & Sandwichs"],
        ["pizzas", "🍕 Pizzas"],
        ["sides", "🍟 Sides (Frites...)"],
        ["drinks", "🥤 Boissons"],
        ["deserts", "🍰 Desserts"]
    ]);

    // 2. On scanne la BDD pour ajouter les catégories personnalisées du client
    adminProducts.forEach(p => {
        if (p.categorieId && !categoriesMap.has(p.categorieId)) {
            const title = p.categorieTitre || (p.categorieId.charAt(0).toUpperCase() + p.categorieId.slice(1));
            categoriesMap.set(p.categorieId, title);
        }
    });

    // 3. On construit le menu déroulant
    select.innerHTML = "";
    categoriesMap.forEach((titre, id) => {
        select.innerHTML += `<option value="${id}">${titre}</option>`;
    });
    
    // L'option magique !
    select.innerHTML += `<option value="NEW" class="font-black text-blue-600">➕ Créer une nouvelle catégorie...</option>`;

    // 4. On sélectionne la bonne valeur
    if (categoriesMap.has(selectedCategory)) {
        select.value = selectedCategory;
        newCatInput.classList.add("hidden");
    } else {
        // Sécurité si la catégorie n'existe plus
        select.value = "burgers";
        newCatInput.classList.add("hidden");
    }
}

// ==========================================
// 🎯 REMPLIR LE MENU DÉROULANT DU MARKETING
// ==========================================
function populatePushProducts() {
    const select = document.getElementById("push-product-link");
    if (!select) return;
    
    // On garde l'option par défaut
    select.innerHTML = '<option value="">📱 Aucune redirection (Ouvre l\'accueil)</option>';
    
    // On boucle sur les produits du resto
    adminProducts.forEach(p => {
        select.innerHTML += `<option value="${p.id}">🏷️ Promo sur : ${p.nom}</option>`;
    });
}

// L'écouteur pour faire apparaître le champ texte
document.getElementById("edit-category").addEventListener("change", (e) => {
    const newCategoryInput = document.getElementById("edit-new-category");
    if (e.target.value === "NEW") {
        newCategoryInput.classList.remove("hidden");
        newCategoryInput.value = "";
        newCategoryInput.focus();
    } else {
        newCategoryInput.classList.add("hidden");
    }
});


// ==========================================
// 📥 IMPORT DE PRODUITS EN MASSE (SMART CSV + SÉCURITÉ)
// ==========================================
window.importProductsCSV = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!currentAdminSnackId) {
        return window.showToast("Erreur : Aucun Snack ID détecté.", "error");
    }

    // UX : On prévient l'utilisateur
    window.showToast("⏳ Importation en cours...", "info");

    try {
        const text = await file.text();

        // 🛡️ BOUCLIER 1 : ANTI-RTF (Le piège TextEdit / Wordpad)
        if (text.includes('{\\rtf1') || text.includes('\\f0\\fs24')) {
            window.showToast("❌ Erreur : Fichier RTF détecté. Veuillez enregistrer en 'Texte Brut' ou exporter en vrai CSV depuis Excel/Numbers.", "error");
            event.target.value = ""; // Reset de l'input
            return;
        }

        // On coupe les lignes en gérant les retours chariots Windows (\r\n) et Mac/Linux (\n)
        const lines = text.split(/\r?\n/);
        let importedCount = 0;

        // 🛡️ OUTIL : Nettoyeur de chaînes (Enlève les guillemets d'Excel et les accolades parasites)
        const cleanString = (str) => {
            if (!str) return "";
            return str.replace(/[{}]/g, '')     // Supprime les accolades
                      .replace(/^"|"$/g, '')    // Supprime les guillemets au début et à la fin
                      .trim();                  // Supprime les espaces inutiles
        };

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const [nomRaw, descRaw, prixRaw, catRaw] = line.split(';');
            
            // Sécurité : Si les colonnes obligatoires manquent
            if (!nomRaw || !prixRaw || !catRaw) continue;
            if (nomRaw.trim().toLowerCase() === 'nom' || prixRaw.trim().toLowerCase() === 'prix') {
                continue; // On ignore cette ligne et on passe au vrai produit suivant
            }

            // 1. Nettoyage intensif des données
            const nom = cleanString(nomRaw);
            const description = cleanString(descRaw);
            
            // Nettoyage du prix (gère les "8,50", "8.50", "8,50€", '"8,50"')
            let prixPropre = cleanString(prixRaw).replace(/€/g, '').replace(',', '.').trim();
            const prix = parseFloat(prixPropre);
            
            // Nettoyage de la catégorie
            const categoriePure = cleanString(catRaw).toLowerCase();
            const categorieId = categoriePure.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-");

            // 2. L'INTELLIGENCE ARTIFICIELLE DU CODE (Déductions)
            let icon = "🍽️";
            let categorieTitre = categoriePure.charAt(0).toUpperCase() + categoriePure.slice(1); // Met la 1ère lettre en majuscule
            let allowMenu = true;

            if (categorieId.includes("burger")) { icon = "🍔"; }
            else if (categorieId.includes("pizza")) { icon = "🍕"; allowMenu = false; }
            else if (categorieId.includes("tacos")) { icon = "🌮"; }
            else if (categorieId.includes("wrap") || categorieId.includes("sandwich")) { icon = "🌯"; }
            else if (categorieId.includes("boisson") || categorieId.includes("drink")) { icon = "🥤"; allowMenu = false; }
            else if (categorieId.includes("dessert") || categorieId.includes("desert")) { icon = "🍰"; allowMenu = false; }
            else if (categorieId.includes("frite") || categorieId.includes("side")) { icon = "🍟"; allowMenu = false; }

            // 3. CONSTRUCTION DE TON OBJET PARFAIT
            const newProduct = {
                nom: nom,
                description: description,
                prix: isNaN(prix) ? 0 : prix,
                categorieId: categorieId,
                categorieTitre: categorieTitre,
                icon: icon,
                allowMenu: allowMenu,
                snackId: currentAdminSnackId,
                allergenes: [],
                devise: "€",
                image: "",
                isAvailable: true,
                isBestSeller: false,
                menuPriceAdd: 2.50,
                tags: [],
                ventes: 0,
                createdAt: window.fs.serverTimestamp(),
                updatedAt: window.fs.serverTimestamp()
            };

            // 4. Envoi à Firestore
            await window.fs.addDoc(window.fs.collection(window.db, "produits"), newProduct);
            importedCount++;
        }

        window.showToast(`✅ Succès : ${importedCount} produits importés !`, "success");
        loadAdminProducts();

    } catch (error) {
        console.error("Erreur d'import CSV :", error);
        window.showToast("❌ Erreur lors de la lecture du fichier CSV.", "error");
    } finally {
        event.target.value = ""; 
    }
};

// ==========================================
// 📈 EXPORT COMPTABLE DES VENTES (CSV)
// ==========================================
window.exportComptaCSV = async () => {
    const btn = document.getElementById("btn-export-compta");
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Traitement...`;
    btn.disabled = true;

    try {
        const { collection, query, where, orderBy, getDocs } = window.fs;
        
        const q = query(
            collection(window.db, "commandes"),
            where("snackId", "==", currentAdminSnackId),
            where("paiement.statut", "==", "paye"),
            orderBy("date", "desc")
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            window.showToast("Aucune vente trouvée pour l'export.", "info");
            return;
        }

        let csvContent = "Date;Heure;Client;Montant (€);Methode;ID Commande;ID Stripe\n";

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const id = docSnap.id;
            
            let dateStr = "N/A";
            let timeStr = "N/A";
            if (data.date) {
                const dateObj = data.date.toDate();
                dateStr = dateObj.toLocaleDateString('fr-FR');
                timeStr = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            }

            const total = data.total ? data.total.toFixed(2).replace('.', ',') : "0,00";
            const client = data.clientNom || "Inconnu";
            const methode = data.paiement?.methode || "Inconnue";
            const stripeId = data.paiement?.stripeSessionId || "N/A";

            csvContent += `${dateStr};${timeStr};"${client}";${total};${methode};${id};${stripeId}\n`;
        });

        const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' }); 
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        
        const dateDuJour = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');
        link.setAttribute("href", url);
        link.setAttribute("download", `Export_Ventes_${dateDuJour}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        window.showToast("✅ Export comptable téléchargé !", "success");

    } catch (error) {
        console.error("Erreur lors de l'export CSV :", error);
        window.showToast("Erreur lors de la génération de l'export.", "error");
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
};

// ==========================================
// 📄 GESTION DE LA MODALE D'AIDE CSV (INJECTION DYNAMIQUE)
// ==========================================
window.openCsvInfoModal = () => {
    // 1. On détruit l'ancienne modale si elle existe déjà (pour ne pas les empiler)
    const existingModal = document.getElementById("csv-info-modal-js");
    if (existingModal) existingModal.remove();

    // 2. On crée la modale de toute pièce en JS
    const modal = document.createElement("div");
    modal.id = "csv-info-modal-js";
    
    // 3. On utilise du CSS "en dur" pour garantir à 1000% l'affichage au 1er plan
    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100vw";
    modal.style.height = "100vh";
    modal.style.backgroundColor = "rgba(17, 24, 39, 0.8)";
    modal.style.backdropFilter = "blur(4px)";
    modal.style.zIndex = "999999"; // L'arme absolue
    modal.style.display = "flex";
    modal.style.justifyContent = "center";
    modal.style.alignItems = "center";
    modal.style.padding = "1rem";

    // 4. On dessine l'intérieur avec tes belles classes Tailwind
    modal.innerHTML = `
        <div class="bg-white w-full max-w-2xl rounded-3xl p-6 relative shadow-2xl animate-fade-in-up max-h-[90vh] overflow-y-auto">
            
            <button onclick="document.getElementById('csv-info-modal-js').remove()" class="absolute top-4 right-4 w-10 h-10 text-gray-400 hover:text-red-400 bg-gray-100 rounded-full transition flex justify-center items-center">
                <i class="fas fa-times text-xl"></i>
            </button>

            <h3 class="text-2xl font-black text-gray-900 mb-2 border-b border-gray-100 pb-4">
                <i class="fas fa-file-csv text-blue-500 mr-2"></i> Guide d'importation CSV
            </h3>
            
            <p class="text-gray-600 mb-6 mt-4">
                Pour importer votre carte en un clic, votre fichier doit respecter un format strict. Nous vous conseillons de télécharger notre modèle, de le remplir, puis de l'importer.
            </p>

            <div class="bg-blue-50 rounded-xl p-4 border border-blue-100 mb-6">
                <h4 class="font-bold text-blue-900 mb-2">Structure requise (4 colonnes) :</h4>
                <ul class="list-disc pl-5 text-sm text-blue-800 space-y-1">
                    <li><strong>Nom :</strong> Le nom exact du produit (ex: <i>Tacos XL</i>)</li>
                    <li><strong>Description :</strong> Les ingrédients (ex: <i>Frites, Viande hachée</i>)</li>
                    <li><strong>Prix :</strong> Le prix de base (ex: <i>8,50</i> ou <i>8.50</i>)</li>
                    <li><strong>Categorie :</strong> L'ID de la catégorie en minuscules (ex: <i>tacos, burgers</i>)</li>
                </ul>
            </div>

            <div class="flex flex-col sm:flex-row gap-3 mt-8">
                <button onclick="downloadCsvTemplate()" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow-md flex items-center justify-center gap-2">
                    <i class="fas fa-download"></i> Télécharger le Modèle
                </button>
                <button onclick="document.getElementById('csv-info-modal-js').remove()" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-3 rounded-xl transition">
                    J'ai compris
                </button>
            </div>
        </div>
    `;

    // 5. L'injection finale directement à la racine (Body) !
    document.body.appendChild(modal);
};

window.closeCsvInfoModal = () => {
    const modal = document.getElementById("csv-info-modal");
    modal.classList.add("opacity-0");
    modal.querySelector(".bg-white").classList.add("scale-95");
    setTimeout(() => {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }, 300);
};

window.downloadCsvTemplate = () => {
    // Le contenu exact que le client doit voir dans son Excel
    const content = "Nom;Description;Prix;Categorie\nBurger Classique;Pain brioché, steak 150g, cheddar, salade, tomate, sauce secrète;8,50;burgers\nCoca-Cola 33cl;Canette bien fraîche;2,00;drinks\nFrites Cheddar Bacon;Portion de frites avec sauce cheddar et bacon croustillant;4,50;sides";
    
    // Le \ufeff force Excel à lire le fichier en UTF-8 (pour les accents)
    const blob = new Blob(["\ufeff" + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    link.setAttribute("href", url);
    link.setAttribute("download", "Modele_Import_Carte.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    window.showToast("Modèle téléchargé !", "success");
};

// ==========================================
// 🏦 STRIPE CONNECT : DASHBOARD EXPRESS DU RESTAURATEUR
// ==========================================
window.openStripeExpressDashboard = async () => {
    const btn = document.getElementById("btn-stripe-dashboard");
    const originalText = btn.innerHTML;
    
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Connexion Stripe...`;
    btn.disabled = true;

    try {
        const { httpsCallable, functions } = window.fs;
        const getStripeLoginLink = httpsCallable(functions, "createStripeConnectLoginLink");
        
        const response = await getStripeLoginLink({ snackId: currentAdminSnackId });
        
        if (response.data && response.data.url) {
            window.open(response.data.url, '_blank');
        } else {
            throw new Error("URL introuvable dans la réponse.");
        }

    } catch (error) {
        console.error("Erreur ouverture Stripe Dashboard :", error);
        window.showToast("Erreur de connexion au portail bancaire.", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// ==========================================
// 5. DÉCONNEXION
// ==========================================
window.logoutAdmin = async () => {
  await signOut(window.auth);
  window.location.href = "index.html";
};
