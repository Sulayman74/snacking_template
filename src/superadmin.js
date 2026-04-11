// ============================================================================
// 🚀 SUPERADMIN DASHBOARD - MYSAAS HQ
// ============================================================================
// import './bridge.js';
import './snack-config.js';
import './firebase-init.js';

const { collection, doc, getDoc, getDocs, updateDoc, addDoc, serverTimestamp } = window.fs;
const { onAuthStateChanged, signOut } = window.authTools;
const auth = window.auth;
const db = window.db;

// Variables Globales
let allSnacks = [];
const PRIX_ABONNEMENT_MENSUEL = 49.00; // Ton tarif SaaS de base en euros

// ============================================================================
// 🛡️ 1. LE VIGILE DE SÉCURITÉ (AUTH GUARD)
// ============================================================================
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById("saas-loader");
    const content = document.getElementById("saas-content");

    if (user) {
        // L'utilisateur est connecté, on vérifie son badge VIP
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            
            if (userDoc.exists() && userDoc.data().role === "superadmin") {
                // ✅ ACCÈS AUTORISÉ
                document.getElementById("superadmin-email").innerText = user.email;
                loader.classList.add("hidden");
                content.classList.remove("hidden");
                
                // On lance le chargement des données !
                loadDashboardData();
            } else {
                // ❌ ACCÈS REFUSÉ (C'est un client ou un admin de resto)
                alert("ALERTE SÉCURITÉ : Vous n'avez pas l'habilitation SuperAdmin.");
                await signOut(auth);
                window.location.href = "index.html";
            }
        } catch (error) {
            console.error("Erreur de vérification des droits", error);
        }
    } else {
        // ❌ NON CONNECTÉ -> On le renvoie vers l'app publique pour qu'il se connecte
        alert("Veuillez vous connecter avec votre compte agence.");
        window.location.href = "index.html";
    }
});

// Bouton de déconnexion
document.getElementById("btn-logout").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "index.html";
});

// ============================================================================
// 📊 2. CHARGEMENT DES DONNÉES (FETCH) ET KPIs
// ============================================================================
async function loadDashboardData() {
    try {
        const snacksSnapshot = await getDocs(collection(db, "snacks"));
        allSnacks = [];
        let snacksEnMaintenance = 0;
        let snacksActifs = 0;

        snacksSnapshot.forEach((doc) => {
            const data = doc.data();
            // Sécurité : On s'assure de garder l'ID du document
            allSnacks.push({ id: doc.id, ...data });

            if (data.maintenanceMode === true) {
                snacksEnMaintenance++;
            } else {
                snacksActifs++;
            }
        });

        // 💰 MRR : somme des tarifs individuels (prixAbonnement) ou tarif de base
        const mrr = allSnacks
            .filter(s => !s.maintenanceMode)
            .reduce((sum, s) => sum + (s.prixAbonnement || PRIX_ABONNEMENT_MENSUEL), 0);

        // Mise à jour de l'UI
        document.getElementById("kpi-total-snacks").innerText = allSnacks.length;
        document.getElementById("kpi-maintenance").innerText = snacksEnMaintenance;
        document.getElementById("kpi-mrr").innerText = `${mrr.toFixed(2)} €`;
        document.getElementById("kpi-orders").innerText = "Bientôt"; // On fera une requête globale sur les commandes plus tard

        console.log(`✅ ${allSnacks.length} locataires chargés.`);
        
        renderSnacksTable(); // <- On créera cette fonction juste après !

    } catch (error) {
        console.error("Erreur lors du chargement des locataires :", error);
    }
}

// ============================================================================
// 🏢 3. AFFICHAGE DES RESTAURANTS (TABLEAU)
// ============================================================================
function renderSnacksTable() {
    const tbody = document.getElementById("snacks-table-body");
    tbody.innerHTML = "";

    if (allSnacks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-500">Aucun client pour le moment.</td></tr>`;
        return;
    }

    allSnacks.forEach(snack => {
        const statusBadge = snack.maintenanceMode
            ? `<span class="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold shadow-sm"><i class="fas fa-tools mr-1"></i> Maintenance</span>`
            : `<span class="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold shadow-sm"><i class="fas fa-globe mr-1"></i> En Ligne</span>`;

        let featuresHtml = '';
        if (snack.enableClickAndCollect) featuresHtml += `<i class="fas fa-shopping-bag text-indigo-500 mx-1" title="Click & Collect"></i>`;
        if (snack.enableDelivery)        featuresHtml += `<i class="fas fa-motorcycle text-orange-500 mx-1" title="Livraison"></i>`;
        if (snack.enableLoyaltyCard)     featuresHtml += `<i class="fas fa-gift text-pink-500 mx-1" title="Fidélité"></i>`;
        if (snack.enablePushNotifs)      featuresHtml += `<i class="fas fa-bell text-blue-500 mx-1" title="Push Notifs"></i>`;
        if (snack.enableSmartReview)     featuresHtml += `<i class="fas fa-star text-yellow-500 mx-1" title="Smart Review"></i>`;
        if (snack.enableViralShare)      featuresHtml += `<i class="fas fa-share-nodes text-teal-500 mx-1" title="Partage Viral"></i>`;

        const mrrClient = (snack.prixAbonnement || PRIX_ABONNEMENT_MENSUEL).toFixed(0);
        const powerBtnClass = snack.maintenanceMode
            ? "text-yellow-700 bg-yellow-100 hover:bg-yellow-200"
            : "text-gray-500 bg-gray-100 hover:bg-gray-200";

        tbody.innerHTML += `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
                <td class="p-4">
                    <div class="font-bold text-gray-900 text-lg">${snack.nom || "Sans Nom"}</div>
                    <div class="text-xs text-gray-400 mt-1 flex items-center gap-3">
                        <span class="font-mono">${snack.id}</span>
                        <span class="bg-green-50 text-green-700 font-black px-2 py-0.5 rounded-md">${mrrClient} €/mois</span>
                    </div>
                </td>
                <td class="p-4 text-center">${statusBadge}</td>
                <td class="p-4 text-center text-lg">${featuresHtml || '<span class="text-gray-300 text-xs">—</span>'}</td>
                <td class="p-4 text-right space-x-1 whitespace-nowrap">
                    <a href="index.html?s=${snack.id}" target="_blank" class="inline-flex items-center gap-1 text-indigo-600 hover:text-white font-bold text-sm bg-indigo-50 hover:bg-indigo-600 px-3 py-2 rounded-lg transition">
                        <i class="fas fa-external-link-alt text-xs"></i> Voir
                    </a>
                    <button onclick="window.openConfigModal('${snack.id}')" class="text-gray-700 hover:text-white font-bold text-sm bg-gray-100 hover:bg-indigo-600 px-3 py-2 rounded-lg transition" title="Configurer les modules">
                        <i class="fas fa-cog"></i>
                    </button>
                    <button onclick="toggleMaintenance('${snack.id}', ${snack.maintenanceMode})" class="font-bold text-sm px-3 py-2 rounded-lg transition ${powerBtnClass}" title="${snack.maintenanceMode ? 'Mettre en ligne' : 'Mettre en maintenance'}">
                        <i class="fas fa-power-off"></i>
                    </button>
                </td>
            </tr>
        `;
    });
}


// Fonction globale pour le bouton ON/OFF rapide
window.toggleMaintenance = async (snackId, currentStatus) => {
    const action = currentStatus ? "mettre EN LIGNE" : "mettre EN MAINTENANCE";
    if (confirm(`Voulez-vous ${action} ce restaurant ?`)) {
        await updateDoc(doc(db, "snacks", snackId), { maintenanceMode: !currentStatus });
        loadDashboardData();
    }
};

// ============================================================================
// ⚙️ 4. CONFIGURATION PAR CLIENT — Feature Flags
// ============================================================================
const CONFIG_FLAGS = [
    "maintenanceMode",
    "enableClickAndCollect",
    "enableDelivery",
    "enableLoyaltyCard",
    "enablePushNotifs",
    "enableSmartReview",
    "enableViralShare",
];

let currentConfigSnackId = null;

function _setToggle(btn, isOn) {
    const isMaintenance = btn.id === "cfg-maintenanceMode";
    const onColor = isMaintenance ? "bg-yellow-500" : "bg-indigo-600";
    btn.setAttribute("data-state", isOn ? "on" : "off");
    if (isOn) {
        btn.classList.remove("bg-gray-200");
        btn.classList.add(onColor);
        btn.querySelector("span").classList.remove("translate-x-1");
        btn.querySelector("span").classList.add("translate-x-6");
    } else {
        btn.classList.remove("bg-indigo-600", "bg-yellow-500");
        btn.classList.add("bg-gray-200");
        btn.querySelector("span").classList.remove("translate-x-6");
        btn.querySelector("span").classList.add("translate-x-1");
    }
}

window.toggleConfigFlag = (btn) => {
    _setToggle(btn, btn.getAttribute("data-state") !== "on");
};

window.openConfigModal = (snackId) => {
    const snack = allSnacks.find(s => s.id === snackId);
    if (!snack) return;
    currentConfigSnackId = snackId;

    document.getElementById("config-modal-title").textContent = `Configurer : ${snack.nom || snackId}`;
    document.getElementById("config-modal-snack-id").textContent = `ID : ${snackId}`;

    CONFIG_FLAGS.forEach(flag => {
        const btn = document.getElementById(`cfg-${flag}`);
        if (btn) _setToggle(btn, !!snack[flag]);
    });

    document.getElementById("cfg-maxPoints").value = snack.maxPoints || 10;
    document.getElementById("cfg-prixAbonnement").value = snack.prixAbonnement || PRIX_ABONNEMENT_MENSUEL;
    document.getElementById("cfg-colorPalette").value = snack.colorPalette || "ruby";
    document.getElementById("cfg-domaine").value = snack.domaine || "";

    const modal = document.getElementById("modal-config-snack");
    modal.classList.remove("hidden");
    modal.classList.add("flex");
};

document.getElementById("btn-close-config-modal").addEventListener("click", () => {
    document.getElementById("modal-config-snack").classList.replace("flex", "hidden");
});

document.getElementById("btn-save-config").addEventListener("click", async () => {
    if (!currentConfigSnackId) return;

    const btn = document.getElementById("btn-save-config");
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Sauvegarde...`;
    btn.disabled = true;

    const updates = {};
    CONFIG_FLAGS.forEach(flag => {
        const el = document.getElementById(`cfg-${flag}`);
        if (el) updates[flag] = el.getAttribute("data-state") === "on";
    });
    updates.maxPoints       = parseInt(document.getElementById("cfg-maxPoints").value) || 10;
    updates.prixAbonnement  = parseFloat(document.getElementById("cfg-prixAbonnement").value) || PRIX_ABONNEMENT_MENSUEL;
    updates.colorPalette    = document.getElementById("cfg-colorPalette").value;
    updates.domaine         = document.getElementById("cfg-domaine").value.trim().toLowerCase();

    try {
        await updateDoc(doc(db, "snacks", currentConfigSnackId), updates);

        // Mise à jour du cache local
        const snack = allSnacks.find(s => s.id === currentConfigSnackId);
        if (snack) Object.assign(snack, updates);

        // Recalcul MRR avec les nouveaux tarifs
        const mrr = allSnacks
            .filter(s => !s.maintenanceMode)
            .reduce((sum, s) => sum + (s.prixAbonnement || PRIX_ABONNEMENT_MENSUEL), 0);
        document.getElementById("kpi-mrr").textContent = `${mrr.toFixed(2)} €`;

        renderSnacksTable();
        document.getElementById("modal-config-snack").classList.replace("flex", "hidden");
        showSAToast("✅ Configuration mise à jour !");
    } catch (error) {
        console.error("Erreur sauvegarde config :", error);
        showSAToast("❌ Erreur lors de la sauvegarde.", "error");
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
});

// ============================================================================
// 🍞 TOAST SUPERADMIN
// ============================================================================
function showSAToast(message, type = "success") {
    const toast = document.getElementById("sa-toast");
    document.getElementById("sa-toast-msg").textContent = message;
    document.getElementById("sa-toast-icon").className = type === "error"
        ? "fas fa-exclamation-circle text-red-400"
        : "fas fa-check-circle text-green-400";
    toast.classList.remove("translate-y-20", "opacity-0");
    setTimeout(() => toast.classList.add("translate-y-20", "opacity-0"), 3000);
}

// ============================================================================
// 🪄 5. CRÉATION D'UN NOUVEAU CLIENT (MODALE)
// ============================================================================
const modalNewSnack = document.getElementById("modal-new-snack");
const btnOpenModal = document.getElementById("btn-open-new-snack");
const btnCloseModal = document.getElementById("btn-close-modal");
const formNewSnack = document.getElementById("form-new-snack");

if (btnOpenModal && modalNewSnack) {
    btnOpenModal.addEventListener("click", () => {
        modalNewSnack.classList.remove("hidden");
        modalNewSnack.classList.add("flex");
    });

    btnCloseModal.addEventListener("click", () => {
        modalNewSnack.classList.add("hidden");
        modalNewSnack.classList.remove("flex");
    });

    formNewSnack.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const btnSubmit = document.getElementById("btn-submit-snack");
        const originalText = btnSubmit.innerHTML;
        btnSubmit.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Création du locataire...`;
        btnSubmit.disabled = true;

        const nom = document.getElementById("input-snack-name").value;
        const type = document.getElementById("input-snack-type").value;
        const theme = document.getElementById("input-snack-theme").value;
        const domaine = document.getElementById("input-snack-domain").value.toLowerCase().trim();

        try {
// 🏭 L'USINE À RESTAURANTS : Clonage complet du modèle de base
            const newSnackRef = await addDoc(collection(db, "snacks"), {
                nom: nom,
                domaine:domaine,
                typeCuisine: type,
                colorPalette: theme, // Le moteur de thème !
                description: `Découvrez le menu digital de ${nom}. Commandez en ligne vos spécialités en Click & Collect ou Livraison. Gagnez des récompenses !`,
                currency: "€",
                
                // Coordonnées (Vides par défaut, le client les remplira plus tard)
                city: "",
                street: "",
                zipcode: "",
                lat: 0,
                long: 0,
                phoneNumber: "",
                
                // Réseaux Sociaux
                facebook: "",
                instagram: "",
                tiktok: "",
                
                // Images par défaut (On évite de mettre les URL du O'Tacos pour les autres clients !)
                logoUrl: "./assets/logo.webp", 
                heroImg: "./assets/heroImg.webp", 
                
                // Paramètres du SaaS (Feature Flags)
                maintenanceMode: true, // 🛑 TOUJOURS en maintenance à la création !
                enableClickAndCollect: false,
                enableDelivery: false,
                enableOnlineOrder: false,
                enableLoyaltyCard: true, 
                enablePushNotifs: false,
                enableSmartReview: false,
                enableViralShare: false,
                maxPoints: 10,
                
                // 🕒 HORAIRES PAR DÉFAUT (Le gros morceau !)
                hours: [
                    { day: "lundi", open: "11:00", close: "22:00", closed: false },
                    { day: "mardi", open: "11:00", close: "22:00", closed: false },
                    { day: "mercredi", open: "11:00", close: "22:00", closed: false },
                    { day: "jeudi", open: "11:00", close: "22:00", closed: false },
                    { day: "vendredi", open: "11:00", close: "23:00", closed: false },
                    { day: "samedi", open: "11:00", close: "23:00", closed: false },
                    { day: "dimanche", open: "14:00", close: "22:00", closed: false }
                ],
                
                // Date de création pour ta compta
                createdAt: serverTimestamp()
            });

            // Succès
            formNewSnack.reset();
            modalNewSnack.classList.add("hidden");
            modalNewSnack.classList.remove("flex");
            
            alert(`🎉 Le restaurant "${nom}" a été généré avec succès !\nSon identifiant unique est : ${newSnackRef.id}`);
            
            // On met à jour le tableau des KPIs et la liste
            loadDashboardData();

        } catch (error) {
            console.error("Erreur lors de la création :", error);
            alert("Erreur lors de la création du client. Vérifiez la console.");
        } finally {
            btnSubmit.innerHTML = originalText;
            btnSubmit.disabled = false;
        }
    });
}