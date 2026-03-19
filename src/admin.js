import './bridge.js';
import './snack-config.js';
import './firebase-init.js';

const { addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } = window.fs;
const { getDownloadURL, ref, uploadBytes } = window.storageTools;
const { onAuthStateChanged, signInWithEmailAndPassword, signOut } = window.authTools;

// ==========================================
// VARIABLES GLOBALES
// ==========================================
let currentAdminSnackId = null;
let isFirstLoad = true;
let adminProducts = []; 
let currentEditingProductId = null; 
let unsubscribeKitchenRadar = null;
let currentAdminTab = 'cuisine'; // Pour savoir sur quel onglet on est
const bell = document.getElementById('kitchen-bell');

// ==========================================
// 1. SÉCURITÉ ET DÉMARRAGE
// ==========================================
// ==========================================
// 🔐 GESTION DE LA CONNEXION ADMIN
// ==========================================

// 1. Écouteur d'état de connexion (Le videur à l'entrée)
setTimeout(() => {
    onAuthStateChanged(window.auth, async (user) => {
        const loginSection = document.getElementById('admin-login-section');
        const startBtn = document.getElementById('start-shift-btn');
        const startupIcon = document.getElementById('startup-icon');
        const startupTitle = document.getElementById('startup-title');
        const startupDesc = document.getElementById('startup-desc');

        if (user) {
            // L'utilisateur est connecté, on vérifie ses droits
            const userDoc = await getDoc(doc(window.db, "users", user.uid));
            
            if (userDoc.exists() && (userDoc.data().role === "admin" || userDoc.data().role === "superadmin")) {
                // ✅ SUCCÈS : C'EST UN VRAI PATRON
                currentAdminSnackId = userDoc.data().snackId;
                if(document.getElementById('admin-email')) document.getElementById('admin-email').innerText = user.email;
                
                // On met à jour l'UI
                loginSection.classList.add('hidden'); // On cache le formulaire
                startupIcon.className = "fas fa-check-circle text-6xl mb-6 text-green-500 animate-bounce";
                startupTitle.innerText = "Accès Autorisé";
                startupDesc.innerText = "Cliquez ci-dessous pour activer le radar de cuisine.";
                startBtn.classList.remove('hidden'); // On affiche le bouton "Démarrer"
                
            } else {
                // ❌ ÉCHEC : C'EST UN CLIENT QUI A TROUVÉ LA PAGE
                window.auth.signOut(); // On le déconnecte de force de cette page
                refuseAccess("Accès refusé. Vous n'avez pas les droits d'administration.");
            }
        } else {
            // 👤 UTILISATEUR NON CONNECTÉ : On affiche le formulaire !
            startupIcon.className = "fas fa-lock text-6xl mb-6 text-gray-300";
            startupTitle.innerText = "Espace Sécurisé";
            startupDesc.innerText = "Veuillez vous identifier pour accéder au terminal.";
            startBtn.classList.add('hidden');
            loginSection.classList.remove('hidden'); // On affiche le formulaire
            loginSection.classList.add('flex');
        }
    });
}, 500);

// 2. Écouteur du formulaire de connexion
const adminLoginForm = document.getElementById('admin-login-form');
if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('admin-email-input').value;
        const password = document.getElementById('admin-password-input').value;
        const btn = document.getElementById('admin-login-btn');
        const errorMsg = document.getElementById('admin-login-error');
        
        // UX: On fait tourner le bouton
        const originalText = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Vérification...`;
        btn.disabled = true;
        errorMsg.classList.add('hidden');

        try {
            // On lance la connexion Firebase
            await signInWithEmailAndPassword(window.auth, email, password);
            
        } catch (error) {
            console.error("Erreur de connexion:", error);
            errorMsg.innerText = "Identifiants incorrects. Veuillez réessayer.";
            errorMsg.classList.remove('hidden');
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });
}

function refuseAccess(message) {
    document.getElementById('startup-icon').className = "fas fa-ban text-6xl mb-6 text-red-500";
    document.getElementById('startup-title').innerText = "Accès Refusé";
    document.getElementById('startup-desc').innerText = message;
    document.getElementById('back-home-btn').classList.remove('hidden');
}

// Débloquer l'audio via interaction utilisateur
document.getElementById('start-shift-btn').addEventListener('click', () => {
    bell.volume = 0;
    bell.play().then(() => {
        bell.pause();
        bell.currentTime = 0;
        bell.volume = 1; 
        document.getElementById('startup-overlay').classList.add('hidden');
        startKitchenRadar();
    }).catch(e => console.error("Erreur Audio:", e));
});

// ==========================================
// 2. RADAR FIREBASE (COMMANDES TEMPS RÉEL)
// ==========================================
function startKitchenRadar() {
    if (unsubscribeKitchenRadar) unsubscribeKitchenRadar();
    const q = query(
        collection(window.db, "commandes"), 
        where("snackId", "==", currentAdminSnackId), 
        where("statut", "in", ["nouvelle", "prete"]), 
        orderBy("date", "desc")
    );

    // On stocke le "tuyau" dans notre variable
    unsubscribeKitchenRadar = onSnapshot(q, (snapshot) => {
        const newOrdersContainer = document.getElementById('orders-new');
        const readyOrdersContainer = document.getElementById('orders-ready');
        
        newOrdersContainer.innerHTML = '';
        readyOrdersContainer.innerHTML = '';
        
        let countNew = 0;
        let countReady = 0;
        let hasNewOrderTriggered = false;

        snapshot.docChanges().forEach((change) => {
            if (change.type === "added" && !isFirstLoad && change.doc.data().statut === "nouvelle") {
                hasNewOrderTriggered = true;
            }
        });

        if (hasNewOrderTriggered) {
            bell.play().catch(e => console.log("Son bloqué"));
        }

        snapshot.docs.forEach((docSnap) => {
            const commande = docSnap.data();
            const id = docSnap.id;
            const dateObj = commande.date ? commande.date.toDate() : new Date();
            const timeString = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

            let itemsHtml = '';
            commande.items.forEach(item => {
                itemsHtml += `<li class="flex justify-between items-start border-b border-gray-100/50 py-2 last:border-0"><div><span class="font-black text-lg">${item.quantity}x</span> <span class="font-bold ml-1">${item.nom}</span></div></li>`;
            });

            const isNew = commande.statut === "nouvelle";
            const ticketColor = isNew ? "bg-white border-l-8 border-red-500" : "bg-white border-l-8 border-green-500";
            const textColor = isNew ? "text-red-700" : "text-green-700";
            const btnHtml = isNew 
                ? `<button onclick="updateOrderStatus('${id}', 'prete')" class="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 rounded-xl text-xl shadow-lg transition active:scale-95"><i class="fas fa-check mr-2"></i> MARQUER PRÊTE</button>`
                : `<button onclick="updateOrderStatus('${id}', 'terminee')" class="w-full bg-green-600 hover:bg-green-700 text-white font-black py-4 rounded-xl text-xl shadow-lg transition active:scale-95"><i class="fas fa-hand-holding-box mr-2"></i> DONNÉE AU CLIENT</button>`;

            const ticketHtml = `
                <div class="${ticketColor} rounded-2xl shadow-md p-5 animate-fade-in-up">
                    <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
                        <div><h3 class="font-black text-2xl text-gray-900">${commande.clientNom}</h3><p class="text-sm text-gray-500 font-bold"><i class="far fa-clock"></i> ${timeString}</p></div>
                        <div class="text-right"><p class="text-xs font-bold text-gray-400 uppercase">À encaisser</p><p class="font-black text-2xl ${textColor}">${commande.total.toFixed(2)} €</p></div>
                    </div>
                    <ul class="mb-5 text-gray-800 space-y-1">${itemsHtml}</ul>
                    ${btnHtml}
                </div>`;

            if (isNew) { newOrdersContainer.innerHTML += ticketHtml; countNew++; } 
            else { readyOrdersContainer.innerHTML += ticketHtml; countReady++; }
        });

        document.getElementById('count-new').innerText = countNew;
        document.getElementById('count-ready').innerText = countReady;
        isFirstLoad = false;
    });
    console.log("🟢 Radar Cuisine ACTIVÉ.");
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
        if (currentAdminTab === 'cuisine' && currentAdminSnackId) {
            startKitchenRadar();
        }
    }
});

window.updateOrderStatus = async (commandeId, newStatus) => {
    try { 
        await updateDoc(doc(window.db, "commandes", commandeId), { statut: newStatus }); 
    } catch (error) { 
        alert("Erreur réseau, veuillez réessayer."); 
    }
};

// ==========================================
// 3. ONGLETS ET GESTION MENU (PIM)
// ==========================================
window.switchAdminTab = (tabName) => {
    currentAdminTab = tabName;
    const btnCuisine = document.getElementById('tab-cuisine');
    const btnMenu = document.getElementById('tab-menu');
    const viewCuisine = document.getElementById('view-cuisine');
    const viewMenu = document.getElementById('view-menu');

    if (tabName === 'cuisine') {
        btnCuisine.className = "bg-gray-900 text-white px-6 py-2 rounded-lg font-bold shadow transition flex-1 md:flex-none";
        btnMenu.className = "text-gray-400 hover:text-white hover:bg-gray-700 px-6 py-2 rounded-lg font-bold transition flex-1 md:flex-none";
        viewCuisine.classList.remove('hidden'); 
        viewCuisine.classList.add('flex');
        viewMenu.classList.add('hidden');
        startKitchenRadar(); // On relance
    } else {
        btnMenu.className = "bg-gray-900 text-white px-6 py-2 rounded-lg font-bold shadow transition flex-1 md:flex-none";
        btnCuisine.className = "text-gray-400 hover:text-white hover:bg-gray-700 px-6 py-2 rounded-lg font-bold transition flex-1 md:flex-none";
        viewCuisine.classList.add('hidden'); 
        viewCuisine.classList.remove('flex');
        viewMenu.classList.remove('hidden');
        stopKitchenRadar(); // On coupe pendant qu'il gère ses stocks !
        loadAdminProducts();
        loadAdminProducts();
    }
};

// ==========================================
        // 🍔 CHARGEMENT & AFFICHAGE DU MENU (PIM avec Skeletons & Fallback)
        // ==========================================
        async function loadAdminProducts() {
            if (!currentAdminSnackId) return;
            const grid = document.getElementById('admin-products-grid');
            
            // 💀 1. INJECTION DES SKELETON LOADERS
            // On génère 6 fausses cartes qui clignotent le temps du chargement
            const skeletonHtml = Array(6).fill(`
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
            `).join('');
            grid.innerHTML = skeletonHtml;

            try {
                // Requête Firestore
                const q = query(collection(window.db, "produits"), where("snackId", "==", currentAdminSnackId));
                const snapshot = await getDocs(q);
                adminProducts = [];
                
                // On efface les Skeletons pour mettre les vraies données
                grid.innerHTML = '';

                snapshot.forEach(docSnap => {
                    const item = { id: docSnap.id, ...docSnap.data() };
                    adminProducts.push(item);
                    
                    const isAvailable = item.isAvailable !== false;
                    const toggleColor = isAvailable ? "bg-green-500" : "bg-gray-300";
                    const toggleTranslate = isAvailable ? "translate-x-6" : "translate-x-1";
                    const statusText = isAvailable ? "<span class='text-green-600'>En stock</span>" : "<span class='text-red-600 font-bold'>Épuisé</span>";
                    
                    // 🖼️ 2. GESTION DU FALLBACK IMAGE (Comme sur l'app publique)
                    const imageUrl = item.image && item.image.trim() !== "" ? item.image : null;
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
                                    <p class="text-gray-500 text-sm font-bold mt-1">${(item.prix || 0).toFixed(2)} € <span class="text-red-500 text-xs ml-1">(Menu +${(item.menuPriceAdd || 2.50).toFixed(2)}€)</span></p>
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
                                <button onclick="openEditModal('${item.id}')" class="bg-white border border-gray-200 text-gray-900 hover:bg-gray-900 hover:text-white px-4 py-2 rounded-xl text-sm font-bold transition shadow-sm flex items-center gap-2">
                                    <i class="fas fa-pen"></i> Modifier
                                </button>
                            </div>
                        </div>`;
                });
            } catch (error) { 
                grid.innerHTML = '<p class="text-red-500 bg-red-50 p-4 rounded-xl font-bold"><i class="fas fa-exclamation-triangle mr-2"></i> Erreur lors du chargement du menu.</p>'; 
            }
        }

window.toggleProductStatus = async (productId, currentStatus) => {
    try { 
        await updateDoc(doc(window.db, "produits", productId), { isAvailable: !currentStatus }); 
        loadAdminProducts(); 
    } catch (error) { 
        alert("Erreur de modification du statut."); 
    }
};

// ==========================================
// 4. MODALE D'ÉDITION ET UPLOAD FIREBASE STORAGE
// ==========================================
window.openEditModal = (productId) => {
    const product = adminProducts.find(p => p.id === productId);
    if (!product) return;
    currentEditingProductId = productId;
    
    document.getElementById('edit-modal-title').innerText = `Modifier : ${product.nom}`;
    document.getElementById('edit-desc').value = product.description || '';
    document.getElementById('edit-prix').value = product.prix || 0;
    document.getElementById('edit-prix-menu').value = product.menuPriceAdd || 2.50;
    document.getElementById('edit-img-file').value = ''; // On vide le champ fichier

    // 📸 Gestion de l'image et du Fallback
    const imgEl = document.getElementById('edit-preview-img');
    const fallbackEl = document.getElementById('edit-preview-fallback');
    
    if (product.image && product.image.trim() !== '') {
        imgEl.src = product.image;
        imgEl.style.display = 'block';
        fallbackEl.style.display = 'none';
    } else {
        imgEl.src = '';
        imgEl.style.display = 'none';
        fallbackEl.style.display = 'flex';
    }

    // Affichage de la modale
    const modal = document.getElementById('edit-product-modal');
    modal.classList.remove('hidden');
    setTimeout(() => { 
        modal.classList.remove('opacity-0'); 
        modal.querySelector('.bg-white').classList.remove('scale-95'); 
    }, 10);
};

// ✨ BONUS UX : Prévisualisation en direct de la nouvelle photo !
document.getElementById('edit-img-file').addEventListener('change', function(event) {
    if (event.target.files && event.target.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const imgEl = document.getElementById('edit-preview-img');
            const fallbackEl = document.getElementById('edit-preview-fallback');
            imgEl.src = e.target.result; // Affiche la photo locale
            imgEl.style.display = 'block';
            fallbackEl.style.display = 'none';
        };
        reader.readAsDataURL(event.target.files[0]);
    }
});

window.closeEditModal = () => {
    const modal = document.getElementById('edit-product-modal');
    modal.classList.add('opacity-0'); 
    modal.querySelector('.bg-white').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
    currentEditingProductId = null;
};

document.getElementById('edit-product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEditingProductId) return;

    const btn = document.getElementById('save-product-btn');
    const originalBtnHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sauvegarde...';
    btn.disabled = true; 
    btn.classList.add('opacity-70', 'cursor-not-allowed');

    try {
        const desc = document.getElementById('edit-desc').value;
        const prix = parseFloat(document.getElementById('edit-prix').value);
        const prixMenu = parseFloat(document.getElementById('edit-prix-menu').value);
        const fileInput = document.getElementById('edit-img-file');
        
        let updateData = { 
            description: desc, 
            prix: prix, 
            menuPriceAdd: prixMenu 
        };

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
            const storageReference = ref(window.storage, `produits/${currentAdminSnackId}/${fileName}`);
            await uploadBytes(storageReference, file);
            updateData.image = await getDownloadURL(storageReference);
        }

        await updateDoc(doc(window.db, "produits", currentEditingProductId), updateData);
        closeEditModal(); 
        loadAdminProducts(); 
    } catch (error) { 
        console.error(error);
        alert("Erreur de sauvegarde. Avez-vous configuré les règles Storage dans Firebase ?"); 
    } finally { 
        btn.innerHTML = originalBtnHtml; 
        btn.disabled = false; 
        btn.classList.remove('opacity-70', 'cursor-not-allowed'); 
    }
});

// ==========================================
// 5. DÉCONNEXION
// ==========================================
window.logoutAdmin = async () => {
    await signOut(window.auth);
    window.location.href = "index.html";
};
