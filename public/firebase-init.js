// ============================================================================
// FIREBASE INITIALIZATION & AUTHENTICATION
// ============================================================================

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getMessaging,
  getToken,
  onMessage,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";

// 2. CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyBIgi4AKo5nzRTO27KuvX0D6nHKsJIDkW8",
  authDomain: "snacking-template.firebaseapp.com",
  projectId: "snacking-template",
  storageBucket: "snacking-template.firebasestorage.app",
  messagingSenderId: "472027657186",
  appId: "1:472027657186:web:7c1621680d9863aa8dffbb",
  measurementId: "G-XT2YH4NE9Q",
};

// 3. INITIALISATION
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const messaging = getMessaging(app);
const auth = getAuth(app);
const db = getFirestore(app);

window.auth = auth;
window.db = db;
window.messaging = messaging;
window.fs = { doc, getDoc, setDoc, updateDoc, increment, onSnapshot, query, collection, where, orderBy, limit, startAfter, getDocs };

function updateUI(user) {
  const cfg = window.snackConfig;
  if (!cfg) return;
  document.title = cfg.identity.name;
// On change la description SEO dynamiquement
const metaDescription = document.querySelector('meta[name="description"]');
if (metaDescription && cfg.identity.description) {
    metaDescription.setAttribute("content", cfg.identity.description);
}
  // ==========================================
  // 1. Navbar et Hero (Identité & Logo)
  // ==========================================
  const navName = document.getElementById("nav-name");
  if (navName) navName.innerText = cfg.identity.name;

  const navLogo = document.getElementById("nav-logo");
  if (navLogo && cfg.identity.logoUrl) {
    navLogo.src = cfg.identity.logoUrl;
    navLogo.classList.remove("hidden"); 
  }

  const heroTitle = document.getElementById("hero-title");
  if (heroTitle) heroTitle.innerText = cfg.identity.name;

  const heroDesc = document.getElementById("hero-desc");
  if (heroDesc) heroDesc.innerText = cfg.identity.description;

  const heroSection = document.getElementById("hero");
  if (heroSection) {
    heroSection.style.backgroundImage = `url('${cfg.identity.heroImg}')`;
  }

  // ==========================================
  // 2. Liens d'appel (Mobile CTA & Desktop CTA)
  // ==========================================
  const mobileCtaBtn = document.getElementById("mobile-cta-btn");
  const mobileCtaIcon = document.getElementById("mobile-cta-icon");
  const desktopCtaBtn = document.getElementById("cta-nav"); 

  if (cfg.features) {
    const isDelivery = cfg.features.enableDelivery === true;
    const primaryBg = cfg.theme?.colors?.primary?.split(" ")[0] || "bg-red-600";
    const phoneClean = cfg.contact?.phone ? cfg.contact.phone.replace(/\s/g, "") : "";

    if (mobileCtaBtn && mobileCtaIcon) {
      if (isDelivery) {
        mobileCtaBtn.href = cfg.deliveryUrl || "#";
        mobileCtaBtn.setAttribute("target", "_blank");
        mobileCtaBtn.classList.remove("bg-green-600");
        mobileCtaBtn.classList.add(primaryBg);
        mobileCtaIcon.className = "fas fa-motorcycle text-2xl";
      } else {
        mobileCtaBtn.href = `tel:${phoneClean}`;
        mobileCtaBtn.removeAttribute("target");
        mobileCtaBtn.classList.remove(primaryBg);
        mobileCtaBtn.classList.add("bg-green-600");
        mobileCtaIcon.className = "fas fa-phone text-2xl animate-pulse";
      }
    }

    if (desktopCtaBtn) {
      if (isDelivery) {
        desktopCtaBtn.href = cfg.deliveryUrl || "#";
        desktopCtaBtn.setAttribute("target", "_blank");
        desktopCtaBtn.innerHTML = '<i class="fas fa-motorcycle mr-2"></i> Commander en livraison';
        desktopCtaBtn.className = `ml-4 px-6 py-2 rounded-full font-bold shadow-lg transform hover:scale-105 transition text-white ${primaryBg}`;
      } else {
        desktopCtaBtn.href = `tel:${phoneClean}`;
        desktopCtaBtn.removeAttribute("target");
        desktopCtaBtn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> ${cfg.contact.phone || "Appeler"}`;
        desktopCtaBtn.className = `ml-4 px-6 py-2 rounded-full font-bold shadow-lg transform hover:scale-105 transition text-white bg-green-600`;
      }
    }
  }

  // ==========================================
  // 📍 MISE À JOUR DU FOOTER (Adresse & Tél)
  // ==========================================
  const footerPhone = document.getElementById("footer-phone");
  if (footerPhone && cfg.contact.phone) {
    const phoneClean = cfg.contact.phone.replace(/\s/g, "");
    footerPhone.innerHTML = `
        <a href="tel:${phoneClean}" aria-label="Appeler le restaurant" class="flex items-center gap-2 hover:text-red-500 transition group">
            <i class="fas fa-phone text-red-600 group-hover:text-red-500"></i>
            <span>${cfg.contact.phone}</span>
        </a>`;
  } else if (footerPhone) {
    footerPhone.innerText = "Téléphone non renseigné";
  }

  const footerAddr = document.getElementById("footer-address");
  if (footerAddr && cfg.contact.address) {
    const a = cfg.contact.address;
    if (a.street || a.city) {
      const fullAddr = `${a.street}, ${a.zip || ""} ${a.city || ""}`.trim();
      const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
      
      let mapLink = a.googleMapsUrl;
      if (!mapLink) {
          mapLink = isApple 
            ? `https://maps.apple.com/?q=${encodeURIComponent(fullAddr)}` 
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddr)}`;
      }

      const iconClass = isApple ? "fa-map" : "fa-location-dot";

      footerAddr.innerHTML = `
          <a href="${mapLink}" target="_blank" class="flex items-start gap-2 hover:text-red-500 transition group">
              <i class="fas ${iconClass} mt-1 text-red-600 group-hover:text-red-500"></i>
              <span>${a.street}<br>${a.zip || ""} ${a.city || ""}</span>
          </a>`;
    } else {
      footerAddr.innerText = "Adresse non renseignée dans la base.";
    }
  }

  // ==========================================
  // 3. Réseaux Sociaux & Horaires
  // ==========================================
  const socialsContainer = document.getElementById("socials-container");
  if (socialsContainer && cfg.contact.socials) {
    socialsContainer.innerHTML = "";
    const s = cfg.contact.socials;

    if (s.instagram) {
      socialsContainer.innerHTML += `<a href="https://instagram.com/${s.instagram.replace("@", "")}" aria-label="Visiter notre page Instagram (s'ouvre dans un nouvel onglet)" target="_blank" rel="noopener noreferrer" class="hover:text-pink-500 transition"><i class="fab fa-instagram"></i></a>`;
    }
    if (s.facebook) {
      socialsContainer.innerHTML += `<a href="https://facebook.com/${s.facebook}" aria-label="Visiter notre page Facebook (s'ouvre dans un nouvel onglet)" target="_blank" rel="noopener noreferrer" class="hover:text-blue-500 transition"><i class="fab fa-facebook"></i></a>`;
    }
    if (s.tiktok) {
      socialsContainer.innerHTML += `<a href="https://tiktok.com/@${s.tiktok.replace("@", "")}" aria-label="Visiter notre page TikTok (s'ouvre dans un nouvel onglet)" target="_blank" rel="noopener noreferrer" class="hover:text-black transition"><i class="fab fa-tiktok"></i></a>`;
    }
  }

  const hoursList = document.getElementById("hours-list");
  const heroStatus = document.getElementById("hero-status");

  if (hoursList && cfg.hours && cfg.hours.length > 0) {
    hoursList.innerHTML = "";

    const todayIndex = new Date().getDay();
    const todayMap = todayIndex === 0 ? 6 : todayIndex - 1; 

    cfg.hours.forEach((h, index) => {
      const isToday = index === todayMap;
      const li = document.createElement("li");

      const textColor = isToday ? "text-red-500 font-bold" : "text-gray-200";
      li.className = textColor;
      li.innerHTML = `<span class="inline-block w-24">${h.day}</span> ${h.closed ? "Fermé" : h.open + " - " + h.close}`;
      hoursList.appendChild(li);

      if (isToday && heroStatus) {
        heroStatus.innerText = h.closed ? "Fermé" : `Ouvert : ${h.open} - ${h.close}`;
        heroStatus.className = h.closed
          ? "inline-block px-3 py-1 mb-4 text-sm font-bold uppercase border border-red-500 rounded-full backdrop-blur-md bg-red-500/50 text-white"
          : "inline-block px-3 py-1 mb-4 text-sm font-bold uppercase border border-green-500 rounded-full bg-green-600/50 backdrop-blur-md text-white";
      }
    });
  }
}

// ============================================================================
// GESTION DE L'INTERFACE UTILISATEUR (MODALS)
// ============================================================================
let isSignUpMode = false;

window.toggleAuthModal = () => {
  document.getElementById("auth-modal").classList.toggle("hidden");
};

window.switchAuthMode = () => {
  isSignUpMode = !isSignUpMode;
  document.getElementById("auth-title").innerText = isSignUpMode ? "Créer un compte" : "Bienvenue !";
  document.getElementById("auth-submit-btn").innerText = isSignUpMode ? "S'inscrire" : "Se connecter";
  document.getElementById("auth-switch-btn").innerText = isSignUpMode ? "Se connecter" : "S'inscrire";
  document.getElementById("auth-switch-text").innerText = isSignUpMode ? "Déjà un compte ?" : "Pas encore de compte ?";
};

document.getElementById("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("auth-email").value;
  const password = document.getElementById("auth-password").value;

  try {
    if (isSignUpMode) {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      const currentSnackId = window.snackConfig?.identity?.id || "Ym1YiO4Ue5Fb5UXlxr06";
      
      try {
        await setDoc(doc(db, "users", user.uid), {
          email: user.email,
          role: "client",
          points: 0,
          snackId: currentSnackId,
          createdAt: new Date().toISOString(),
        });
        window.showToast(`Bienvenue ${user.email} ! 🎉`, "success");
      } catch (dbError) {
        console.error("❌ ERREUR FIRESTORE CRITIQUE :", dbError);
      }
    } else {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      window.showToast(`Ravi de vous revoir ${user.email} ! 👋`, "success");
    }

    window.toggleAuthModal();
    if (typeof window.switchView === "function") window.switchView("home");
    window.scrollTo({ top: 0, behavior: "smooth" }); 
  } catch (error) {
    window.showToast("Erreur : " + error.message, "error");
  }
});

// ============================================================================
// ÉCOUTEUR D'ÉTAT (LE VIGILE AMÉLIORÉ 🕵️‍♂️)
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  const loyaltyBtn = document.getElementById("loyalty-main-btn");
  const loyaltyDesc = document.getElementById("loyalty-desc");
  const navLogoutBtn = document.getElementById("nav-logout-btn");
  const mobileLogoutBtn = document.getElementById("mobile-logout-btn");

// On peut le récupérer depuis l'URL (ex: ?s=ID) ou depuis la config chargée
  const currentAppSnackId = window.snackConfig?.identity?.id || "Ym1YiO4Ue5Fb5UXlxr06";

  try {
    if (user) {
      console.log("🟢 Utilisateur connecté :", user.email);
      if (navLogoutBtn) navLogoutBtn.classList.remove("hidden");
      if (mobileLogoutBtn) mobileLogoutBtn.classList.remove("hidden");

      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      let snackToLoad = currentAppSnackId;
      let role = "client";
      let points = 0;

      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.snackId) snackToLoad = userData.snackId;
        role = userData.role || "client";
        points = userData.points || 0;
      }

      await window.loadSnackConfig(db, snackToLoad);
      updateUI(user);
      if (typeof window.initAppVisuals === "function") await window.initAppVisuals();


      if (role === "admin" || role ==="superadmin") {
        if (loyaltyDesc) loyaltyDesc.innerHTML = `<span class="text-red-400 font-bold"><i class="fas fa-crown"></i> Mode Admin</span>`;
        if (loyaltyBtn) {
          loyaltyBtn.innerHTML = '<i class="fas fa-camera"></i> Scanner un client';
          loyaltyBtn.onclick = window.openAdminScanner;
          loyaltyBtn.className = "bg-red-600 text-white px-8 py-3 rounded-full font-bold shadow-lg hover:bg-red-700 transition transform hover:-translate-y-1";
        }
      } else {
        if (loyaltyDesc) loyaltyDesc.innerHTML = `<span class="text-green-400 font-bold"><i class="fas fa-check-circle"></i> Membre :</span> Tu as <strong>${points} points</strong>`;
        if (loyaltyBtn) {
          loyaltyBtn.innerHTML = '<i class="fas fa-qrcode"></i> Ma Carte';
          loyaltyBtn.onclick = window.openClientCard;
          loyaltyBtn.className = "bg-white border-2 border-green-600 text-black px-8 py-3 rounded-full font-bold shadow-lg hover:bg-gray-100 transition transform hover:-translate-y-1";
        }
      }
    } else {
      console.log("🔴 Utilisateur déconnecté (Mode Public).");
      if (navLogoutBtn) navLogoutBtn.classList.add("hidden");
      if (mobileLogoutBtn) mobileLogoutBtn.classList.add("hidden");

      // 🚨 FIX : Les bordures vertes sont bien présentes ici aussi !
      if (loyaltyDesc) loyaltyDesc.innerText = "Gagnez des points à chaque commande !";
      if (loyaltyBtn) {
        loyaltyBtn.innerHTML = "Connexion";
        loyaltyBtn.onclick = window.toggleAuthModal;
        loyaltyBtn.className = "bg-white border-2 border-green-600 text-black px-8 py-3 rounded-full font-bold shadow-lg hover:bg-gray-100 transition transform hover:-translate-y-1";
      }

      await window.loadSnackConfig(db, currentAppSnackId);
      updateUI(null);
      if (typeof window.initAppVisuals === "function") await window.initAppVisuals();
    }
  } catch (error) {
    console.error("❌ Erreur d'initialisation :", error);
  }
});

// ============================================================================
// 🔔 GESTION DES NOTIFICATIONS PUSH (FCM)
// ============================================================================
window.demanderPermissionNotifs = async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      await navigator.serviceWorker.ready;
      
      const currentToken = await getToken(messaging, {
        vapidKey: "BGsq0EjCQPNq2_r5LC-41oxktxZtCfBCD0GvYjiKV7n2HgEOwKWnFGwgddQfPl9ZoFi6z8AvSM1rQUJkxa1-098",
        serviceWorkerRegistration: registration,
      });

      if (currentToken) {
        const user = auth.currentUser;
        if (user) await updateDoc(doc(db, "users", user.uid), { fcmToken: currentToken });
        
        const notifBtn = document.getElementById("promo-notif-btn");
        if (notifBtn) notifBtn.classList.add("hidden");
        window.showToast("🔔 Parfait ! Vous recevrez nos promos.", "success");
      }
    } else {
      window.showToast("Notifications refusées.", "error");
      const notifBtn = document.getElementById("promo-notif-btn");
      if (notifBtn) notifBtn.classList.add("hidden");
    }
  } catch (error) {
    console.error("❌ Erreur : ", error);
  }
};

onMessage(messaging, (payload) => {
  const titre = payload.notification?.title || "Nouvelle notification";
  const message = payload.notification?.body || "";
  window.showToast(`🔔 ${titre} : ${message}`, "success");
});

// ============================================================================
// 💳 CLUB FIDÉLITÉ : GESTION DU QR CODE ET DES POINTS
// ============================================================================

let unsubscribeClientCard = null; 

window.openClientCard = async () => {
  const user = auth.currentUser;
  if (!user) return;

  if (typeof window.snackConfig !== "undefined" && window.snackConfig.loyalty) {
    document.getElementById("card-program-name").innerText = window.snackConfig.loyalty.programName;
    document.getElementById("card-bg-gradient").className = `absolute inset-0 z-0 bg-gradient-to-br ${window.snackConfig.loyalty.cardDesign.backgroundGradient}`;
  }

  document.getElementById("card-user-email").innerText = user.email;
  document.getElementById("card-qr-img").src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${user.uid}`;

  const modal = document.getElementById("client-card-modal");
  modal.classList.remove("hidden");
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    document.getElementById("virtual-card").classList.remove("scale-95");
  }, 10);

  unsubscribeClientCard = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
    if (docSnap.exists()) {
      const points = docSnap.data().points || 0;
      animerCarteFidelite(points); 
    }
  });

  // 🛑 MODIFICATION ICI : On vérifie si le Pack Premium (Push) est actif
  const notifBtn = document.getElementById("promo-notif-btn");
  if (notifBtn && window.snackConfig && window.snackConfig.features.enablePushNotifs) {
    if ("Notification" in window && Notification.permission === "default") {
      notifBtn.classList.remove("hidden"); 
    } else {
      notifBtn.classList.add("hidden"); 
    }
  } else if (notifBtn) {
    notifBtn.classList.add("hidden"); // On cache pour les packs Starter/Pro
  }
};

function animerCarteFidelite(points) {
  const maxPoints = 10;
  const ratio = Math.min((points / maxPoints) * 100, 100); 

  const pointsText = document.getElementById("card-points");
  const progressBar = document.getElementById("card-progress-bar");
  const progressLabel = document.getElementById("progress-text");
  const pointsContainer = document.getElementById("points-display-container");
  const giftIcon = document.getElementById("gift-icon");

  pointsText.innerText = points;
  progressBar.style.width = `${ratio}%`;

  if (points >= maxPoints) {
    pointsContainer.classList.add("text-green-300"); 
    progressLabel.innerText = "🎉 MENU OFFERT ! PRÉSENTEZ CE CODE";
    progressLabel.classList.add("text-green-300", "animate-pulse");
    giftIcon.classList.add("animate-bounce", "text-green-300");
    pointsText.classList.add("scale-125", "transition-transform");
    window.showToast("Bravo ! Vous avez droit à votre Menu gratuit ! 🍔", "success");
    if (typeof window.triggerVibration === "function") window.triggerVibration("jackpot");
  } else {
    pointsContainer.classList.remove("text-green-300");
    progressLabel.classList.remove("text-green-300", "animate-pulse");
    giftIcon.classList.remove("animate-bounce", "text-green-300");
    pointsText.classList.remove("scale-125");
    const restants = maxPoints - points;
    progressLabel.innerText = `Encore ${restants} point${restants > 1 ? "s" : ""} avant ta récompense`;
  }
}

window.closeClientCard = () => {
  const modal = document.getElementById("client-card-modal");
  modal.classList.add("opacity-0");
  document.getElementById("virtual-card").classList.add("scale-95");

  if (unsubscribeClientCard) unsubscribeClientCard();

  setTimeout(() => {
    modal.classList.add("hidden");
  }, 300);
};


let html5Qrcode = null; 

window.openAdminScanner = async () => {
  const modal = document.getElementById("admin-scanner-modal");
  modal.classList.remove("hidden");

  // 1. On utilise Html5Qrcode (le moteur pur) au lieu de Html5QrcodeScanner (l'UI moche)
  html5Qrcode = new Html5Qrcode("reader");

  try {
    // 2. On allume la caméra arrière automatiquement et silencieusement
    await html5Qrcode.start(
      { facingMode: "environment" }, // Force la caméra arrière du téléphone
      { fps: 10, qrbox: { width: 250, height: 250 } }, // Vitesse et taille du scan
      onScanSuccess, // Fonction appelée si succès
      onScanFailure  // Fonction appelée si erreur (ignorée en boucle)
    );
  } catch (err) {
    console.error("Erreur Caméra :", err);
    window.showToast("Autorisez la caméra pour pouvoir scanner.", "error");
  }
};

window.closeAdminScanner = async () => {
  document.getElementById("admin-scanner-modal").classList.add("hidden");
  
  if (html5Qrcode) {
    try {
      // 3. On éteint proprement la caméra si elle était allumée
      if (html5Qrcode.isScanning) {
        await html5Qrcode.stop();
      }
      html5Qrcode.clear();
    } catch (error) {
      console.error("Erreur à la fermeture de la caméra :", error);
    }
  }
};

async function onScanSuccess(decodedText, decodedResult) {
  const adminSnackId = window.snackConfig?.identity?.id;
  console.log(`📸 Scan réussi ! UID du client : ${decodedText}`);

  closeAdminScanner();
  if (typeof window.triggerVibration === "function") window.triggerVibration("success");
  window.showToast("QR Code lu ! Vérification en cours...", "success");

  try {

    const clientRef = doc(db, "users", decodedText);
    const clientDoc = await getDoc(clientRef);

    if (!clientDoc.exists()) {
      window.showToast("❌ Erreur : Ce QR Code n'est pas dans notre base.", "error");
      return;
    }

    const clientData = clientDoc.data();
    if (clientData.snackId !== adminSnackId) {
      window.showToast("⚠️ Ce client appartient à un autre établissement !", "error");
      return;
    }

    const currentPoints = clientDoc.data().points || 0;
    const maxPoints = 10; 

    if (currentPoints >= maxPoints) {
      await updateDoc(clientRef, { points: 0 });
      window.showToast("🎉 BINGO ! Donnez un Menu Gratuit ! (Carte remise à 0)", "success");
    } else {
      await updateDoc(clientRef, { points: increment(1) });
      const newTotal = currentPoints + 1;
      if (newTotal === maxPoints) {
        window.showToast(`✅ Point ajouté ! Le client gagne son menu ! 🎁`, "success");
      } else {
        window.showToast(`✅ Point ajouté ! Total actuel : ${newTotal}/${maxPoints}`, "success");
      }
    }
  } catch (error) {
    console.error("❌ Erreur critique lors du scan :", error);
    window.showToast("Erreur de communication avec le serveur.", "error");
  }
}

function onScanFailure(error) {
  // Html5Qrcode appelle cette fonction en boucle (plusieurs fois par seconde)
  // tant qu'il n'y a pas de QR code lisible dans le viseur.
  
  // 1. On sécurise la lecture de l'erreur (ça peut être un objet ou une string)
  const errorMessage = typeof error === 'string' ? error : (error?.message || '');

  // 2. On filtre les erreurs "normales" de scan vide pour éviter de spammer la console
  const isNormalNotFound = 
    errorMessage.includes("NotFound") || 
    errorMessage.includes("No MultiFormat Readers") ||
    errorMessage.includes("not found");

  if (isNormalNotFound) {
    // C'est normal, la caméra cherche le QR Code... on ne fait rien silencieusement.
    return;
  }

  // 3. S'il y a une VRAIE erreur inattendue (ex: perte d'accès caméra soudaine)
  // On utilise console.warn au lieu de showToast pour ne pas gêner l'utilisateur
  // console.warn("⚠️ Avertissement Scanner (Non bloquant) :", errorMessage);
}

window.logoutUser = async () => {
  try {
    await signOut(auth);
    window.showToast("Vous êtes déconnecté. À bientôt !", "success");
    if (typeof window.switchView === "function") window.switchView("home");
  } catch (error) {
    console.error("Erreur de déconnexion", error);
  }
};