// ============================================================================
// 🚀 SUPERADMIN DASHBOARD - MYSAAS HQ
// ============================================================================

const { collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, serverTimestamp } = window.fs;
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

        // 💰 Calcul du MRR (Revenu Mensuel Récurrent)
        // On simule que chaque snack actif rapporte le prix de l'abonnement
        const mrr = snacksActifs * PRIX_ABONNEMENT_MENSUEL;

        // Mise à jour de l'UI
        document.getElementById("kpi-total-snacks").innerText = allSnacks.length;
        document.getElementById("kpi-maintenance").innerText = snacksEnMaintenance;
        document.getElementById("kpi-mrr").innerText = `${mrr.toFixed(2)} €`;
        document.getElementById("kpi-orders").innerText = "Bientôt"; // On fera une requête globale sur les commandes plus tard

        console.log(`✅ ${allSnacks.length} locataires chargés.`);
        
        // renderSnacksTable(); // <- On créera cette fonction juste après !

    } catch (error) {
        console.error("Erreur lors du chargement des locataires :", error);
    }
}