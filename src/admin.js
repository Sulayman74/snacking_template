import "./bridge.js";
import "./snack-config.js";
import "./firebase-init.js";

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

// ==========================================
// 1. SÉCURITÉ ET DÉMARRAGE
// ==========================================
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
    document.getElementById('tab-marketing').classList.remove('hidden');
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
// 2. RADAR FIREBASE (COMMANDES TEMPS RÉEL)
// ==========================================
function startKitchenRadar() {
  if (unsubscribeKitchenRadar) unsubscribeKitchenRadar();
  const q = query(
    collection(window.db, "commandes"),
    where("snackId", "==", currentAdminSnackId),
    where("statut", "in", ["en_attente_client", "nouvelle", "prete"]),
    orderBy("date", "desc"),
  );

  unsubscribeKitchenRadar = onSnapshot(q, (snapshot) => {
    const waitingOrdersContainer = document.getElementById("orders-waiting");
    const newOrdersContainer = document.getElementById("orders-new");
    const readyOrdersContainer = document.getElementById("orders-ready");

    if (waitingOrdersContainer) waitingOrdersContainer.innerHTML = "";
    newOrdersContainer.innerHTML = "";
    readyOrdersContainer.innerHTML = "";

    let countWaiting = 0,
      countNew = 0,
      countReady = 0;
    let ringTheBell = false;

    // On fait sonner la cloche si un ticket vient de passer en "nouvelle"
    snapshot.docChanges().forEach((change) => {
      if (
        (change.type === "added" || change.type === "modified") &&
        !isFirstLoad
      ) {
        if (change.doc.data().statut === "nouvelle") {
          ringTheBell = true;
        }
      }
    });

    if (ringTheBell) bell.play().catch((e) => console.log("Son bloqué"));

    snapshot.docs.forEach((docSnap) => {
      const commande = docSnap.data();
      const id = docSnap.id;
      const timeString = commande.date
        ? commande.date
            .toDate()
            .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        : "";

      let itemsHtml = commande.items
        .map(
          (item) =>
            `<li class="flex justify-between items-start border-b border-gray-100/50 py-2 last:border-0">
                    <div>
                        <span class="font-black text-lg" aria-hidden="true">${item.quantity}x</span> 
                        <span class="font-bold ml-1">${item.nom}</span>
                        <span class="sr-only">${item.quantity} ${item.nom}</span>
                    </div>
                </li>`,
        )
        .join("");

      const isWaiting = commande.statut === "en_attente_client";
      const isNew = commande.statut === "nouvelle";

      let ticketColor = "bg-white border-l-8 border-green-500";
      let textColor = "text-green-700";

      let btnHtml = `<button type="button" onclick="updateOrderStatus('${id}', 'terminee')" aria-label="Archiver le ticket. Commande donnée au client." class="w-full bg-green-600 hover:bg-green-700 text-white font-black py-4 rounded-xl text-xl shadow-lg transition active:scale-95"><i class="fas fa-hand-holding-box mr-2" aria-hidden="true"></i> DONNÉE AU CLIENT</button>`;

      if (isWaiting) {
        ticketColor = "bg-white border-l-8 border-gray-400 opacity-80";
        textColor = "text-gray-600";
        btnHtml = `<button type="button" onclick="updateOrderStatus('${id}', 'nouvelle')" aria-label="Forcer la mise en cuisson de la commande" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-black py-3 rounded-xl text-sm shadow-sm transition active:scale-95"><i class="fas fa-fire mr-2" aria-hidden="true"></i> Forcer Cuisson</button>`;
      } else if (isNew) {
        ticketColor = "bg-white border-l-8 border-red-500";
        textColor = "text-red-700";
        btnHtml = `<button type="button" onclick="updateOrderStatus('${id}', 'prete')" aria-label="Marquer la commande comme prête à être retirée" class="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 rounded-xl text-xl shadow-lg transition active:scale-95"><i class="fas fa-check mr-2" aria-hidden="true"></i> MARQUER PRÊTE</button>`;
      }

      // 💰 GESTION DU VISUEL DE PAIEMENT & A11Y
      const paymentStatus = commande.paiement?.statut || "en_attente";
      const isPaid = paymentStatus === "paye";

      const priceDisplay = isPaid
        ? `<p class="font-black text-2xl text-green-600 opacity-50 line-through" aria-label="Prix payé : ${commande.total.toFixed(2)} euros">${commande.total.toFixed(2)} €</p>`
        : `<p class="font-black text-2xl ${textColor}" aria-label="Prix à encaisser : ${commande.total.toFixed(2)} euros">${commande.total.toFixed(2)} €</p>`;

      const paymentBadgeHtml = isPaid
        ? `<button type="button" onclick="updatePaymentStatus('${id}', 'paye')" aria-label="Annuler l'encaissement. Actuellement payé." class="mt-2 bg-green-100 text-green-700 px-3 py-1.5 rounded-lg text-xs font-black border border-green-300 shadow-sm transition active:scale-95 flex items-center gap-1 hover:bg-green-200">
                    <i class="fas fa-check-circle" aria-hidden="true"></i> PAYÉ
                   </button>`
        : `<button type="button" onclick="updatePaymentStatus('${id}', 'en_attente')" aria-label="Encaisser la commande de ${commande.total.toFixed(2)} euros." class="mt-2 bg-orange-100 text-orange-800 px-3 py-1.5 rounded-lg text-xs font-black border border-orange-300 shadow-md transition active:scale-95 flex items-center gap-1 animate-pulse hover:bg-orange-200">
                    <i class="fas fa-cash-register" aria-hidden="true"></i> ENCAISSER
                   </button>`;

      const ticketHtml = `
                <div class="${ticketColor} rounded-2xl shadow-md p-5 animate-fade-in-up" role="article" aria-labelledby="ticket-title-${id}">
                    <div class="flex justify-between items-start mb-4 pb-3 border-b border-gray-100">
                        <div>
                            <h3 id="ticket-title-${id}" class="font-black text-2xl text-gray-900">${commande.clientNom}</h3>
                            <p class="text-sm text-gray-500 font-bold mt-1" aria-label="Heure de réception : ${timeString}"><i class="far fa-clock" aria-hidden="true"></i> ${timeString}</p>
                        </div>
                        <div class="flex flex-col items-end">
                            ${priceDisplay}
                            ${paymentBadgeHtml}
                        </div>
                    </div>
                    <ul class="mb-5 text-gray-800 space-y-1" aria-label="Détail des plats">${itemsHtml}</ul>
                    ${btnHtml}
                </div>`;

      if (isWaiting) {
        if (waitingOrdersContainer)
          waitingOrdersContainer.innerHTML += ticketHtml;
        countWaiting++;
      } else if (isNew) {
        newOrdersContainer.innerHTML += ticketHtml;
        countNew++;
      } else {
        readyOrdersContainer.innerHTML += ticketHtml;
        countReady++;
      }
    });

    if (document.getElementById("count-waiting"))
      document.getElementById("count-waiting").innerText = countWaiting;
    document.getElementById("count-new").innerText = countNew;
    document.getElementById("count-ready").innerText = countReady;
    isFirstLoad = false;
  });
  console.log("🟢 Radar Cuisine ACTIVÉ (Mode 3 Colonnes).");
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
window.updateOrderStatus = async (orderId, newStatus) => {
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
// 💳 ACTION MÉTIER : LA CAISSE (Encaissement)
// ==========================================
window.updatePaymentStatus = async (orderId, currentStatus) => {
  try {
    const newStatus = currentStatus === "paye" ? "en_attente" : "paye";

    // 1. On met à jour le statut du paiement du ticket
    await window.fs.updateDoc(window.fs.doc(window.db, "commandes", orderId), {
      "paiement.statut": newStatus,
    });
    console.log(`💳 Paiement mis à jour : ${newStatus}`);

    // 2. 📈 AUTOMATISATION DE L'ALGORITHME BEST-SELLER
    if (newStatus === "paye") {
      // On va chercher la commande complète pour voir ce que le client a mangé
      const orderDoc = await window.fs.getDoc(
        window.fs.doc(window.db, "commandes", orderId),
      );

      if (orderDoc.exists()) {
        const items = orderDoc.data().items || [];

        // On boucle sur chaque burger/tacos de la commande
        for (const item of items) {
          const realProductId = item.productId || item.id.split("-")[0];

          if (realProductId) {
            const productRef = window.fs.doc(
              window.db,
              "produits",
              realProductId,
            );

            // 🪄 MAGIE FIREBASE : On ajoute la quantité vendue au produit.
            // Si 'ventes' n'existe pas, Firebase le crée à 0 puis ajoute la quantité !
            await window.fs
              .updateDoc(productRef, {
                ventes: window.fs.increment(item.quantity),
              })
              .catch((e) =>
                console.log("Stat annulée : Produit peut-être supprimé", e),
              );
          }
        }
        window.showToast(
          "Caisse enregistrée et Best-Sellers mis à jour ! 📈",
          "success",
        );
      }
    } else {
      window.showToast("Paiement annulé.", "success");
    }
  } catch (error) {
    console.error("Erreur lors de l'encaissement :", error);
    window.showToast("Impossible de mettre à jour le paiement.", "error");
  }
};
// ==========================================
// 3. ONGLETS ET GESTION MENU (PIM)
// ==========================================
window.switchAdminTab = (tabName) => {
    currentAdminTab = tabName;
    const btnCuisine = document.getElementById('tab-cuisine');
    const btnMenu = document.getElementById('tab-menu');
    const btnMarketing = document.getElementById('tab-marketing'); // NOUVEAU
    
    const viewCuisine = document.getElementById('view-cuisine');
    const viewMenu = document.getElementById('view-menu');
    const viewMarketing = document.getElementById('view-marketing'); // NOUVEAU

    // On réinitialise tous les boutons en mode "Inactif"
    [btnCuisine, btnMenu, btnMarketing].forEach(btn => {
        if(btn) btn.className = "text-gray-400 hover:text-white hover:bg-gray-700 px-6 py-2 rounded-lg font-bold transition flex-1 md:flex-none";
    });
    
    // On cache toutes les vues
    viewCuisine.classList.replace('flex', 'hidden');
    viewMenu.classList.add('hidden');
    if(viewMarketing) viewMarketing.classList.add('hidden');

    // On active l'onglet demandé
    if (tabName === 'cuisine') {
        btnCuisine.className = "bg-gray-900 text-white px-6 py-2 rounded-lg font-bold shadow transition flex-1 md:flex-none";
        viewCuisine.classList.replace('hidden', 'flex');
        startKitchenRadar(); 
    } else if (tabName === 'menu') {
        btnMenu.className = "bg-gray-900 text-white px-6 py-2 rounded-lg font-bold shadow transition flex-1 md:flex-none";
        viewMenu.classList.remove('hidden');
        stopKitchenRadar(); 
        loadAdminProducts();
    } else if (tabName === 'marketing') {
        btnMarketing.className = "bg-gray-900 text-white px-6 py-2 rounded-lg font-bold shadow transition flex-1 md:flex-none";
        viewMarketing.classList.remove('hidden');
        stopKitchenRadar();
    }
};

// ==========================================
// 🍔 CHARGEMENT & AFFICHAGE DU MENU (PIM avec Skeletons & Fallback)
// ==========================================
async function loadAdminProducts() {
  if (!currentAdminSnackId) return;
  const grid = document.getElementById("admin-products-grid");

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
                                    <h4 class="font-black text-gray-900 leading-tight">${item.nom}</h4>
                                    <p class="text-gray-500 text-sm font-bold mt-1">${prixBaseText} <span class="text-red-500 text-xs ml-1">${prixMenuText}</span></p>
                                </div>
                            </div>
<div class="p-4 bg-gray-50 flex justify-between items-center mt-auto">
    <div class="flex flex-col items-start gap-1">
        <p class="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Disponibilité</p>
        <div class="flex items-center gap-3">
            <button onclick="toggleProductStatus('${item.id}', ${isAvailable})" class="relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${toggleColor}">
                <span class="inline-block h-5 w-5 transform rounded-full bg-white transition duration-300 shadow-md ${toggleTranslate}"></span>
            </button>
            <span class="text-sm font-bold">${statusText}</span>
        </div>
    </div>
    
    <div class="flex items-center gap-2">
        <button onclick="openEditModal('${item.id}')" aria-label="Modifier" class="bg-white border border-gray-200 text-gray-900 hover:bg-gray-900 hover:text-white w-10 h-10 rounded-xl text-sm font-bold transition shadow-sm flex items-center justify-center">
            <i class="fas fa-pen"></i>
        </button>
<button onclick="openDeleteModal('${item.id}')" aria-label="Supprimer" class="bg-white border border-red-200 text-red-600 hover:bg-red-600 hover:text-white w-10 h-10 rounded-xl text-sm font-bold transition shadow-sm flex items-center justify-center">
    <i class="fas fa-trash"></i>
</button>
    </div>
</div>
                        </div>`;
    });
  } catch (error) {
    grid.innerHTML =
      '<p class="text-red-500 bg-red-50 p-4 rounded-xl font-bold"><i class="fas fa-exclamation-triangle mr-2"></i> Erreur lors du chargement du menu.</p>';
  }
}

window.toggleProductStatus = async (productId, currentStatus) => {
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
window.openEditModal = (productId) => {
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
  document.getElementById("edit-category").value =
    product.categorieId || "burgers"; // Burgers par défaut si vide
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

window.closeEditModal = () => {
  const modal = document.getElementById("edit-product-modal");
  modal.classList.add("opacity-0");
  modal.querySelector(".bg-white").classList.add("scale-95");
  setTimeout(() => modal.classList.add("hidden"), 300);
  currentEditingProductId = null;
};


// Variable globale pour mémoriser le produit à supprimer
let productToDeleteId = null;

// 1. OUVRE LA MODALE (Appelé par le bouton poubelle sur la carte du produit)
window.openDeleteModal = (id) => {
  productToDeleteId = id;
  const modal = document.getElementById("delete-confirm-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex"); // Nécessaire si on utilise flex-col
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector(".bg-white").classList.remove("scale-95");
  }, 10);
};

// 2. FERME LA MODALE
window.closeDeleteModal = () => {
  const modal = document.getElementById("delete-confirm-modal");
  modal.classList.add("opacity-0");
  modal.querySelector(".bg-white").classList.add("scale-95");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    productToDeleteId = null; // On nettoie la mémoire
  }, 300);
};

// 3. LA VRAIE SUPPRESSION (Appelé par le gros bouton rouge de la modale)
window.confirmDeleteProduct = async () => {
  if (!productToDeleteId) return;

  const btn = document.getElementById("confirm-delete-btn");
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Suppression...';
  btn.disabled = true;

  try {
    await deleteDoc(doc(window.db, "produits", productToDeleteId));
    window.showToast("Produit définitivement supprimé.", "success");
    closeDeleteModal();
    loadAdminProducts(); // On recharge la grille
  } catch (error) {
    console.error("Erreur de suppression:", error);
    window.showToast("Erreur lors de la suppression.", "error");
    btn.innerHTML = originalHtml;
    btn.disabled = false;
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
      const categorieChoisie = document.getElementById("edit-category").value;
      
      const allowMenuCheckbox = document.getElementById("edit-allow-menu");
      const allowMenu = allowMenuCheckbox ? allowMenuCheckbox.checked : true;

      // 2. Formatage de l'objet (On utilise updateData PARTOUT)
      let updateData = {
        nom: nom,
        description: desc,
        prix: prix,
        menuPriceAdd: prixMenu,
        tags: tagChoisi ? [tagChoisi] : [],
        categorieId: categorieChoisie,
        allowMenu: allowMenu,
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
      window.closeEditModal();
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

            // Déterminer la date d'envoi prévue (immédiate ou planifiée)
            let dateEnvoi = null;
            if (dateSaisie) {
                dateEnvoi = new Date(dateSaisie);
            } else {
                dateEnvoi = new Date(); // Maintenant
            }

            const { addDoc, collection, serverTimestamp } = window.fs;

            // 📥 On sauvegarde la demande de campagne dans la BDD
            await addDoc(collection(window.db, "campagnes_push"), {
                snackId: currentAdminSnackId,
                titre: titre,
                message: message,
                cible: cible,
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
// 5. DÉCONNEXION
// ==========================================
window.logoutAdmin = async () => {
  await signOut(window.auth);
  window.location.href = "index.html";
};
