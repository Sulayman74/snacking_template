// ============================================================================
// FIREBASE INITIALIZATION & AUTHENTICATION
// ============================================================================

import { collection, doc, getDoc, getDocs, getFirestore, increment, onSnapshot, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { createUserWithEmailAndPassword, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";
// 1. IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";

// 2. CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyBIgi4AKo5nzRTO27KuvX0D6nHKsJIDkW8",
  authDomain: "snacking-template.firebaseapp.com",
  projectId: "snacking-template",
  storageBucket: "snacking-template.firebasestorage.app",
  messagingSenderId: "472027657186",
  appId: "1:472027657186:web:7c1621680d9863aa8dffbb",
  measurementId: "G-XT2YH4NE9Q"
};

// 3. INITIALISATION
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const messaging = getMessaging(app);
const auth = getAuth(app);
const db = getFirestore(app);

// ============================================================================
// GESTION DE L'INTERFACE UTILISATEUR (MODALS)
// ============================================================================
let isSignUpMode = false;

// On attache à 'window' pour que le HTML puisse déclencher ces fonctions
window.toggleAuthModal = () => {
  document.getElementById('auth-modal').classList.toggle('hidden');
};

window.switchAuthMode = () => {
  isSignUpMode = !isSignUpMode;
  document.getElementById('auth-title').innerText = isSignUpMode ? "Créer un compte" : "Bienvenue !";
  document.getElementById('auth-submit-btn').innerText = isSignUpMode ? "S'inscrire" : "Se connecter";
  document.getElementById('auth-switch-btn').innerText = isSignUpMode ? "Se connecter" : "S'inscrire";
  document.getElementById('auth-switch-text').innerText = isSignUpMode ? "Déjà un compte ?" : "Pas encore de compte ?";
};

// ============================================================================
// LOGIQUE D'AUTHENTIFICATION & FIRESTORE
// ============================================================================

// Écouteur de soumission du formulaire de connexion/inscription
document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;

try {
if (isSignUpMode) {
      console.log("👉 1. Début de l'inscription Auth...");
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      try {
          await setDoc(doc(db, "users", user.uid), {
            email: user.email,
            role: "client",
            points: 0,
            createdAt: new Date().toISOString()
          });
//  TOAST de Succès avec Email
      window.showToast(`Bienvenue ${user.email} ! 🎉`, "success");
      } catch (dbError) {
          console.error("❌ ERREUR FIRESTORE CRITIQUE :", dbError);
      }
      
    } else {
      // 1. Connexion
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      // 2. TOAST de Succès
      window.showToast(`Ravi de vous revoir ${user.email} ! 👋`, "success");
    }
    
    // REDIRECTION (On ferme le modal et on remonte en haut de la page)
    window.toggleAuthModal();
    if (typeof window.switchView === 'function') {
        window.switchView('home'); // Si tu étais dans le menu, ça te ramène à l'accueil
    }
    window.scrollTo({ top: 0, behavior: "smooth" }); // Remonte la page doucement

  } catch (error) {
    // Si le mot de passe est trop court ou autre erreur :
    window.showToast("Erreur : " + error.message, 'error');
  }
});

// ============================================================================
// ÉCOUTEUR D'ÉTAT (LE VIGILE AMÉLIORÉ 🕵️‍♂️)
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  // Les éléments de la carte Fidélité
  const loyaltyBtn = document.getElementById('loyalty-main-btn');
  const loyaltyDesc = document.getElementById('loyalty-desc');
  
  // Les boutons de navigation
  const navLogoutBtn = document.getElementById('nav-logout-btn');
  const mobileLogoutBtn = document.getElementById('mobile-logout-btn');

  if (user) {
    console.log("🟢 Connecté :", user.email);
    
    // On affiche les boutons de déconnexion généraux
    if (navLogoutBtn) navLogoutBtn.classList.remove('hidden');
    if (mobileLogoutBtn) mobileLogoutBtn.classList.remove('hidden');
    
    try {
        // 🔍 LE VIGILE VÉRIFIE LE BADGE DANS LA BASE DE DONNÉES
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            const role = userData.role || "client";
            const points = userData.points || 0;

            if (role === "admin") {
                // ==========================================
                // 👑 MODE ADMIN (Le Boss)
                // ==========================================
                if (loyaltyDesc) {
                    loyaltyDesc.innerHTML = `<span class="text-red-400 font-bold"><i class="fas fa-crown"></i> Compte Administrateur</span>`;
                }
                if (loyaltyBtn) {
                    loyaltyBtn.innerHTML = '<i class="fas fa-camera"></i> Scanner un client';
                    loyaltyBtn.onclick = window.openAdminScanner; // Ouvre la caméra !
                    // On change le bouton en rouge pour le différencier
                    loyaltyBtn.classList.add("bg-red-600", "text-white", "hover:bg-red-700");
                    loyaltyBtn.classList.remove("bg-white", "text-black", "hover:bg-gray-100");
                }
            } else {
                // ==========================================
                // 👤 MODE CLIENT
                // ==========================================
                if (loyaltyDesc) {
                    // C'est plus sympa d'afficher ses points directs ici !
                    loyaltyDesc.innerHTML = `<span class="text-green-400 font-bold"><i class="fas fa-check-circle"></i> Membre Club :</span> Tu as <strong>${points} point(s)</strong> !`;
                }
                if (loyaltyBtn) {
                    loyaltyBtn.innerHTML = '<i class="fas fa-qrcode"></i> Ma Carte de Fidélité';
                    loyaltyBtn.onclick = window.openClientCard; // Ouvre le QR Code !
                    // Design blanc classique
                    loyaltyBtn.classList.add("bg-white", "text-black", "hover:bg-gray-100");
                    loyaltyBtn.classList.remove("bg-red-600", "text-white", "hover:bg-red-700");
                }
            }
        }
    } catch (error) {
        console.error("❌ Erreur lors de la vérification du rôle :", error);
    }

  } else {
    console.log("🔴 Utilisateur déconnecté.");
    
    // UTILISATEUR DÉCONNECTÉ : On recache les boutons de déconnexion
    if (navLogoutBtn) navLogoutBtn.classList.add('hidden');
    if (mobileLogoutBtn) mobileLogoutBtn.classList.add('hidden');
    
    // On remet la section fidélité par défaut
    if (loyaltyDesc) loyaltyDesc.innerText = "Gagnez des points à chaque commande !";
    if (loyaltyBtn) {
      loyaltyBtn.innerHTML = 'Connexion';
      loyaltyBtn.onclick = window.toggleAuthModal;
      // Remise à zéro du design
      loyaltyBtn.classList.add("bg-white", "text-black", "hover:bg-gray-100");
      loyaltyBtn.classList.remove("bg-red-600", "text-white", "hover:bg-red-700");
    }
  }
});

// ============================================================================
// 🔔 GESTION DES NOTIFICATIONS PUSH (FCM)
// ============================================================================

window.demanderPermissionNotifs = async () => {
    console.log("⏳ Demande de permission au navigateur...");
    
    try {
        const permission = await Notification.requestPermission();
        
        if (permission === 'granted') {
            console.log("✅ Permission accordée ! Réveil du Service Worker...");
            
            // 🪄 LE FIX EST ICI : On installe le travailleur MANUELLEMENT et on attend
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
            
            // Petite pause pour s'assurer qu'il est bien "Actif"
            await navigator.serviceWorker.ready; 
            console.log("⚙️ Service Worker prêt et actif sur le scope :", registration.scope);

            // 1. On récupère le jeton en disant à Firebase d'utiliser NOTRE travailleur
            const currentToken = await getToken(messaging, { 
                vapidKey: 'BGsq0EjCQPNq2_r5LC-41oxktxZtCfBCD0GvYjiKV7n2HgEOwKWnFGwgddQfPl9ZoFi6z8AvSM1rQUJkxa1-098',
                serviceWorkerRegistration: registration // 👈 L'astuce magique !
            });

            if (currentToken) {
                console.log("🔑 Jeton FCM généré :", currentToken);
                
                // 2. On sauvegarde le jeton dans le profil du client
                const user = auth.currentUser;
                if (user) {
                    await updateDoc(doc(db, "users", user.uid), {
                        fcmToken: currentToken
                    });
                    console.log("💾 Jeton sauvegardé dans Firestore !");
                }

                // 3. UI : Disparition du bouton et Toast
                const notifBtn = document.getElementById('promo-notif-btn');
                if (notifBtn) notifBtn.classList.add('hidden');
                
                window.showToast("🔔 Parfait ! Vous recevrez nos promos.", "success");

            } else {
                console.log("⚠️ Aucun jeton disponible. Vérifiez les permissions.");
            }
        } else {
            console.log("❌ Permission refusée par l'utilisateur.");
            window.showToast("Notifications refusées.", "error");
            
            const notifBtn = document.getElementById('promo-notif-btn');
            if (notifBtn) notifBtn.classList.add('hidden');
        }
    } catch (error) {
        console.error("❌ Erreur lors de la récupération du jeton : ", error);
        window.showToast("Erreur d'activation des notifications.", "error");
    }
};

// ============================================================================
// 📨 ÉCOUTEUR DE MESSAGES (Quand l'app est OUVERTE)
// ============================================================================
onMessage(messaging, (payload) => {
    console.log("📨 Message reçu au premier plan :", payload);
    
    // Au lieu d'un vieux alert(), on utilise notre magnifique Snackbar !
    const titre = payload.notification?.title || "Nouvelle notification";
    const message = payload.notification?.body || "";
    
    // On l'affiche pendant 5 secondes pour être sûr qu'il le lise
    window.showToast(`🔔 ${titre} : ${message}`, "success");
});

// ============================================================================
// 📡 RÉCUPÉRER LE MENU DIRECTEMENT DEPUIS FIRESTORE (FRONTEND)
// ============================================================================
window.chargerMenuDepuisDB = async () => {
    console.log("⏳ Récupération du menu depuis Firestore...");
    
    try {
        // On aspire les produits de la collection "produits"
        const querySnapshot = await getDocs(collection(db, "produits"));
        let tousLesProduits = [];
        
        querySnapshot.forEach((doc) => {
            tousLesProduits.push({ id: doc.id, ...doc.data() });
        });

        // La structure pour que ton HTML (app.js) puisse ranger les cartes
        const menuStructure = {
            tacos: { title: "Nos Tacos", icon: "🌮", items: [] },
            burgers: { title: "Burgers", icon: "🍔", items: [] },
            wraps: { title: "Wraps & Sandwichs", icon: "🌯", items: [] },
            sides: { title: "A côté", icon: "🍟", items: [] },
            drinks: { title: "Boissons & Douceurs", icon: "🥤", items: [] }
        };

        // On trie chaque produit dans sa catégorie
        tousLesProduits.forEach(produit => {
            if (menuStructure[produit.categorieId]) {
                menuStructure[produit.categorieId].items.push(produit);
            }
        });

        console.log("✅ Menu chargé avec succès depuis Firebase !", menuStructure);
        
        // On renvoie le paquet prêt à l'emploi pour app.js
        return { 
            brut: tousLesProduits, 
            categories: Object.values(menuStructure) 
        };

    } catch (error) {
        console.error("❌ Impossible de charger le menu :", error);
        return null;
    }
};

// ============================================================================
// 💳 CLUB FIDÉLITÉ : GESTION DU QR CODE ET DES POINTS
// ============================================================================
let html5QrcodeScanner = null; 
let unsubscribeClientCard = null; // 👈 Pour écouter les points en direct !

// 🟢 FONCTION CLIENT : Afficher sa carte VIP
window.openClientCard = async () => {
    const user = auth.currentUser;
    if (!user) return;

    // 1. Appliquer le thème de la config (si existant)
    if (typeof snackConfig !== 'undefined' && snackConfig.loyalty) {
        document.getElementById('card-program-name').innerText = snackConfig.loyalty.programName;
        document.getElementById('card-bg-gradient').className = `absolute inset-0 z-0 bg-gradient-to-br ${snackConfig.loyalty.cardDesign.backgroundGradient}`;
    }

    // 2. Générer le QR Code
    document.getElementById('card-user-email').innerText = user.email;
    document.getElementById('card-qr-img').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${user.uid}`;

    const modal = document.getElementById('client-card-modal');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        document.getElementById('virtual-card').classList.remove('scale-95');
    }, 10);

    // 🪄 4. LA MAGIE DU TEMPS RÉEL (onSnapshot)
    // Au lieu de lire la base 1 seule fois, on met la carte sur écoute !
    unsubscribeClientCard = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
        if (docSnap.exists()) {
            const points = docSnap.data().points || 0;
            animerCarteFidelite(points); // On lance la machinerie UX !
        }
    });
    // 🪄 5. LOGIQUE DES NOTIFICATIONS (Le consentement contextuel)
    const notifBtn = document.getElementById('promo-notif-btn');
    if ("Notification" in window) {
        // "default" veut dire que le client n'a pas encore cliqué sur Autoriser ou Bloquer
        if (Notification.permission === "default") {
            notifBtn.classList.remove('hidden'); // On lui propose !
        } else {
            notifBtn.classList.add('hidden'); // Déjà répondu (oui ou non), on cache.
        }
    }
};

// 🎨 LE MOTEUR D'ANIMATION (UX 10/10)
function animerCarteFidelite(points) {
    const maxPoints = 10;
    const ratio = Math.min((points / maxPoints) * 100, 100); // Bloque à 100% visuellement
    
    // Éléments HTML
    const pointsText = document.getElementById('card-points');
    const progressBar = document.getElementById('card-progress-bar');
    const progressLabel = document.getElementById('progress-text');
    const pointsContainer = document.getElementById('points-display-container');
    const giftIcon = document.getElementById('gift-icon');

    // Mise à jour basique
    pointsText.innerText = points;
    progressBar.style.width = `${ratio}%`;

    if (points >= maxPoints) {
        // 🌟 SCÉNARIO GAGNANT (10/10 ou plus)
        
        // Textes et couleurs
        pointsContainer.classList.add('text-green-300'); // Devient vert menthe
        progressLabel.innerText = "🎉 MENU OFFERT ! PRÉSENTEZ CE CODE";
        progressLabel.classList.add('text-green-300', 'animate-pulse');
        giftIcon.classList.add('animate-bounce', 'text-green-300');
        
        // Animation CSS sur le chiffre
        pointsText.classList.add('scale-125', 'transition-transform');
        
        // Notification Toast
        window.showToast("Bravo ! Vous avez droit à votre Menu gratuit ! 🍔", "success");

    } else {
        // 🔄 SCÉNARIO NORMAL (En cours)
        
        // On nettoie les classes de victoire si le boss lui a retiré ses 10 points
        pointsContainer.classList.remove('text-green-300');
        progressLabel.classList.remove('text-green-300', 'animate-pulse');
        giftIcon.classList.remove('animate-bounce', 'text-green-300');
        pointsText.classList.remove('scale-125');

        // On calcule combien il en manque
        const restants = maxPoints - points;
        progressLabel.innerText = `Encore ${restants} point${restants > 1 ? 's' : ''}...`;
    }
}

// 🔴 FERMER LA CARTE
window.closeClientCard = () => {
    const modal = document.getElementById('client-card-modal');
    modal.classList.add('opacity-0');
    document.getElementById('virtual-card').classList.add('scale-95');
    
    // On coupe le micro de Firebase pour économiser les requêtes !
    if (unsubscribeClientCard) {
        unsubscribeClientCard();
    }

    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
};

// 🔴 FONCTION ADMIN : Ouvrir la caméra
window.openAdminScanner = () => {
    const modal = document.getElementById('admin-scanner-modal');
    modal.classList.remove('hidden');

    // On initialise la caméra
    html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
    
    // Si la caméra lit un code, elle appelle cette fonction
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
};

window.closeAdminScanner = () => {
    document.getElementById('admin-scanner-modal').classList.add('hidden');
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear(); // Éteint la caméra
    }
};

// ============================================================================
// 🎯 L'ADMIN A SCANNÉ UN CLIENT : LA LOGIQUE INTELLIGENTE
// ============================================================================
async function onScanSuccess(decodedText, decodedResult) {
    // decodedText contient l'UID du client
    console.log(`📸 Scan réussi ! UID du client : ${decodedText}`);
    
    // 1. On éteint la caméra immédiatement pour éviter les multi-scans
    closeAdminScanner();
    window.showToast("QR Code lu ! Vérification en cours...", "success");

    try {
        const clientRef = doc(db, "users", decodedText);
        const clientDoc = await getDoc(clientRef);
        
        // Sécurité : Est-ce un vrai client ?
        if (!clientDoc.exists()) {
            window.showToast("❌ Erreur : Ce QR Code n'est pas dans notre base.", "error");
            return;
        }

        const currentPoints = clientDoc.data().points || 0;
        const maxPoints = 10; // Le palier de ton snack

        // 🧠 LE CARREFOUR DES DÉCISIONS
        if (currentPoints >= maxPoints) {
            
            // 🎁 CAS B : LE CLIENT RÉCLAME SON CADEAU
            await updateDoc(clientRef, {
                points: 0 // On remet sa carte à zéro
            });
            
            // Notification explosive pour l'Admin en caisse
            window.showToast("🎉 BINGO ! Donnez un Menu Gratuit ! (Carte remise à 0)", "success");
            
            // (Le client verra sa jauge se vider en direct sur son téléphone grâce au onSnapshot !)
            
        } else {
            
            // ➕ CAS A : AJOUT D'UN POINT CLASSIQUE
            await updateDoc(clientRef, {
                points: increment(1)
            });
            
            const newTotal = currentPoints + 1;
            
            if (newTotal === maxPoints) {
                // Il vient pile de gagner !
                window.showToast(`✅ Point ajouté ! Le client gagne son menu ! 🎁`, "success");
            } else {
                // Routine classique
                window.showToast(`✅ Point ajouté ! Total actuel : ${newTotal}/${maxPoints}`, "success");
            }
        }

    } catch (error) {
        console.error("❌ Erreur critique lors du scan :", error);
        window.showToast("Erreur de communication avec le serveur.", "error");
    }
}

function onScanFailure(error) {
    // Ignore les erreurs de scan, la caméra cherche en boucle
}

// ============================================================================
// FONCTION DE DÉCONNEXION (LOGOUT)
// ============================================================================
window.logoutUser = async () => {
    try {
        await signOut(auth);
        window.showToast("Vous êtes déconnecté. À bientôt !", "success");
        // On ramène le client à l'accueil
        if (typeof window.switchView === 'function') {
            window.switchView('home');
        }
    } catch (error) {
        console.error("Erreur de déconnexion", error);
    }
};
