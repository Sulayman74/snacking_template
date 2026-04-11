// ============================================================================
// FIREBASE INITIALIZATION & AUTHENTICATION (LE HUB CENTRAL)
// ============================================================================

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { ReCaptchaV3Provider, initializeAppCheck } from "firebase/app-check";
// 1. LES IMPORTS (TOUJOURS TOUT EN HAUT !)
import {
  addDoc,
  collection,
  deleteDoc,
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
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

import { getAnalytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";

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
const auth = getAuth(app);
const messaging = getMessaging(app);
export const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app, "europe-west1");
// 🛡️ INITIALISATION DU BOUCLIER APP CHECK (reCAPTCHA v3)
// if (typeof window !== "undefined") {
//     const appCheck = initializeAppCheck(app, {
//         provider: new ReCaptchaV3Provider('6LdsQpwsAAAAAFrZ9uQw6ucGG6ECo0DE9HUJLmfo'),
//         isTokenAutoRefreshEnabled: true
//     });
// }
// ============================================================================
// 🚀 OPTIMISATION : CHARGEMENT DIFFÉRÉ DE FIREBASE ANALYTICS
// ============================================================================

// On déclare la variable vide au départ
export let analytics = null;

function initAnalytics() {
  if (analytics) return; // Si c'est déjà chargé, on ne fait rien

  // 🛑 LE BOUCLIER ANTI-ROBOTS
  // Si Vite détecte qu'on est en plein test Playwright, on annule tout !
  if (import.meta.env.VITE_E2E_TESTING === "true") {
    console.warn(
      "🤖 Test E2E Playwright détecté : Google Analytics est DÉSACTIVÉ.",
    );
    return;
  }

  // On lance Analytics seulement maintenant !
  analytics = getAnalytics(app);

  // On nettoie les écouteurs d'événements
  ["scroll", "mousemove", "touchstart", "click"].forEach((event) => {
    window.removeEventListener(event, initAnalytics);
  });
}

// 1. Déclenchement dès que le client interagit avec la page
["scroll", "mousemove", "touchstart", "click"].forEach((event) => {
  window.addEventListener(event, initAnalytics, { once: true, passive: true });
});

// 2. Sécurité : s'il ne bouge pas pendant 3,5 secondes, on charge quand même
setTimeout(initAnalytics, 3500);

// 4. EXPORTATION SÉCURISÉE (LE HUB POUR VITE)
window.storage = storage;
window.auth = auth;
window.db = db;
window.messaging = messaging;

window.fs = {
  addDoc,
  app,
  collection,
  deleteDoc,
  doc,
  functions,
  getDoc,
  getDocs,
  getFunctions,
  getStorage,
  httpsCallable,
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
  writeBatch,
};
window.storageTools = { getDownloadURL, ref, uploadBytes };
window.authTools = {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  getToken,
  onMessage,
};

// ============================================================================
// 🎨 LE PEINTRE GLOBAL (Application dynamique du Thème SaaS)
// ============================================================================
window.applySaaSThemeToHTML = () => {
  const cfg = window.snackConfig;
  if (!cfg || !cfg.theme) return;

  const { primary, accent, textOnPrimary, border, blurBg } = cfg.theme.colors;

  // Mise à jour des boutons et éléments thématiques (ton code existant est bon ici)
  const primaryButtons = [
    "auth-submit-btn",
    "pwa-install-btn",
    "btn-review-google",
    "checkout-btn",
  ];
  primaryButtons.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.className = btn.className
        .replace(/bg-[a-z]+-\d+/g, "")
        .replace("text-white", "")
        .replace("text-black", "");
      btn.className += ` ${primary} ${textOnPrimary}`;
    }
  });

  const loyaltyCard = document.getElementById("loyalty-card");
  if (loyaltyCard && border) loyaltyCard.classList.add(border);

  const loyaltyIcon = document.querySelector("#loyalty .fa-gift");
  if (loyaltyIcon && accent) loyaltyIcon.classList.add(accent);
};
function updateUI(user) {
  const cfg = window.snackConfig;
  if (!cfg) return;

  // 🎨 EXTRACTION DES COULEURS DU THÈME
  const primaryBg = cfg.theme.colors.primary;
  const textOnPrimary = cfg.theme.colors.textOnPrimary;
  const accentText = cfg.theme.colors.accent;

  // ==========================================
  // 🎭 MODALES : Remplacement des logos
  // ==========================================
  const pwaIcon = document.getElementById("pwa-banner-icon");
  const reviewIcon = document.getElementById("review-modal-icon");
  const navLogo = document.getElementById("nav-logo");

  if (cfg.identity && cfg.identity.logoUrl) {
    if (pwaIcon) pwaIcon.src = cfg.identity.logoUrl;
    if (reviewIcon) reviewIcon.src = cfg.identity.logoUrl;
    if (navLogo) {
      navLogo.src = cfg.identity.logoUrl;
      navLogo.classList.remove("hidden");
    }
  }

  // ==========================================
  // 1. Identité (Navbar & Hero)
  // ==========================================
  const navName = document.getElementById("nav-name");
  if (navName) navName.innerText = cfg.identity.name;

  const heroTitle = document.getElementById("hero-title");
  if (heroTitle) heroTitle.innerText = cfg.identity.name;

  const heroDesc = document.getElementById("hero-desc");
  if (heroDesc) heroDesc.innerText = cfg.identity.description;

  const heroSection = document.getElementById("hero");
  if (heroSection && cfg.identity.heroImg) {
    heroSection.style.backgroundImage = `url('${cfg.identity.heroImg}')`;
  }
  // ==========================================
  // 🚪 Bouton Déconnexion (visible si connecté)
  // ==========================================
  const navLogoutBtn = document.getElementById("nav-logout-btn");
  const mobileLogoutBtn = document.getElementById("mobile-logout-btn");

  if (user) {
    navLogoutBtn?.classList.remove("hidden");
    mobileLogoutBtn?.classList.remove("hidden");
  } else {
    navLogoutBtn?.classList.add("hidden");
    mobileLogoutBtn?.classList.add("hidden");
  }

  // ==========================================
  // 2. Liens d'appel (Mobile CTA, Desktop CTA & Burger Menu)
  // ==========================================
  const mobileCtaBtn = document.getElementById("mobile-cta-btn");
  const mobileCtaIcon = document.getElementById("mobile-cta-icon");
  const desktopCtaBtn = document.getElementById("cta-nav");
  const mobileBurgerCallBtn = document.getElementById("mobile-burger-call-btn");

  // On nettoie d'abord les classes dynamiques des boutons
  if (mobileCtaBtn)
    mobileCtaBtn.className = mobileCtaBtn.className
      .replace(/bg-\w+-\d+/g, "")
      .replace(/text-\w+-\d+/g, "")
      .replace("text-white", "")
      .replace("text-black", "");
  if (desktopCtaBtn)
    desktopCtaBtn.className = desktopCtaBtn.className
      .replace(/bg-\w+-\d+/g, "")
      .replace(/text-\w+-\d+/g, "")
      .replace("text-white", "")
      .replace("text-black", "");

  // 🏪 MODE VITRINE (Pas de commande)
  if (cfg.features && cfg.features.enableOnlineOrder === false) {
    if (mobileCtaBtn) mobileCtaBtn.classList.add("hidden");
    if (desktopCtaBtn) desktopCtaBtn.classList.add("hidden");
    if (mobileBurgerCallBtn) mobileBurgerCallBtn.classList.add("hidden");
  } else if (cfg.features) {
    // Le restaurant prend des commandes ! On affiche les boutons
    if (mobileCtaBtn) mobileCtaBtn.classList.remove("hidden");
    if (desktopCtaBtn) desktopCtaBtn.classList.remove("hidden");

    const isDelivery = cfg.features.enableDelivery === true;
    const isClickAndCollect = cfg.features.enableClickAndCollect === true;
    const phoneClean = cfg.contact?.phone
      ? cfg.contact.phone.replace(/\s/g, "")
      : "";

    // 🛒 PRIORITÉ 1 : CLICK & COLLECT (On renvoie vers le Menu)
    if (isClickAndCollect) {
      if (mobileCtaBtn && mobileCtaIcon) {
        mobileCtaBtn.setAttribute("data-action", "open-cart");
        mobileCtaBtn.removeAttribute("data-phone");
        mobileCtaBtn.removeAttribute("data-url");
        mobileCtaBtn.classList.add("bg-green-600", "text-white"); // Couleur par défaut Panier
        mobileCtaIcon.className = "fas fa-shopping-bag text-2xl";
      }
      if (desktopCtaBtn) {
        desktopCtaBtn.setAttribute("data-action", "open-cart");
        desktopCtaBtn.removeAttribute("data-phone");
        desktopCtaBtn.removeAttribute("data-url");
        desktopCtaBtn.innerHTML =
          '<i class="fas fa-shopping-bag mr-2"></i> Commander';
        desktopCtaBtn.className = `ml-4 px-6 py-2 rounded-full font-bold shadow-lg transform hover:scale-105 transition bg-gray-900 text-white`;

      }
      // On cache le bouton d'appel du Burger Menu car on a un vrai panier
      if (mobileBurgerCallBtn) mobileBurgerCallBtn.classList.add("hidden");
    }

    // 🏍️ PRIORITÉ 2 : LIVRAISON EXTERNE
    else if (isDelivery) {
      if (mobileCtaBtn && mobileCtaIcon) {
        mobileCtaBtn.setAttribute("data-action", "open-delivery");
        mobileCtaBtn.setAttribute("data-url", cfg.deliveryUrl || "");
        mobileCtaBtn.removeAttribute("data-phone");
        mobileCtaBtn.classList.add(primaryBg.split(" ")[0], textOnPrimary);
        mobileCtaIcon.className = "fas fa-motorcycle text-2xl";
      }
      if (desktopCtaBtn) {
        desktopCtaBtn.setAttribute("data-action", "open-delivery");
        desktopCtaBtn.setAttribute("data-url", cfg.deliveryUrl || "");
        desktopCtaBtn.removeAttribute("data-phone");
        desktopCtaBtn.innerHTML =
          '<i class="fas fa-motorcycle mr-2"></i> Commander en livraison';
        desktopCtaBtn.className = `ml-4 px-6 py-2 rounded-full font-bold shadow-lg transform hover:scale-105 transition ${primaryBg} ${textOnPrimary}`;

      }
      // On cache le bouton d'appel du Burger Menu car la livraison prime
      if (mobileBurgerCallBtn) mobileBurgerCallBtn.classList.add("hidden");
    }

    // 📞 PRIORITÉ 3 : TÉLÉPHONE (Par défaut)
    else {
      if (mobileCtaBtn && mobileCtaIcon) {
        mobileCtaBtn.setAttribute("data-action", "call-phone");
        mobileCtaBtn.setAttribute("data-phone", phoneClean || "");
        mobileCtaBtn.removeAttribute("data-url");
        mobileCtaBtn.classList.add("bg-green-600", "text-white");
        mobileCtaIcon.className = "fas fa-phone text-2xl animate-pulse";

      }
      if (desktopCtaBtn) {
        desktopCtaBtn.setAttribute("data-action", "call-phone");
        desktopCtaBtn.setAttribute("data-phone", phoneClean || "");
        desktopCtaBtn.removeAttribute("data-url");
        desktopCtaBtn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> ${cfg.contact?.phone || "Appeler"}`;
        desktopCtaBtn.className = `ml-4 px-6 py-2 rounded-full font-bold shadow-lg transform hover:scale-105 transition bg-green-600 text-white`;

      }
      // On affiche le bouton d'appel dans le Burger Menu !
      if (mobileBurgerCallBtn) {
        mobileBurgerCallBtn.href = phoneClean ? `tel:${phoneClean}` : "#";
        mobileBurgerCallBtn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> ${cfg.contact?.phone || "Appeler"}`;
        mobileBurgerCallBtn.classList.remove("hidden");
        mobileBurgerCallBtn.classList.add(
          "flex",
          "items-center",
          "justify-center",
        );
      }
    }
  }

  // ==========================================
  // 📍 MISE À JOUR DU FOOTER (Adresse & Tél avec Accent Color)
  // ==========================================
  const findUs = document.getElementById("find-us");
  const oClock = document.getElementById("o-clock");

  if (findUs) findUs.classList.add(accentText);
  if (oClock) oClock.classList.add(accentText);

  const footerPhone = document.getElementById("footer-phone");
  if (footerPhone && cfg.contact.phone) {
    const phoneClean = cfg.contact.phone.replace(/\s/g, "");
    footerPhone.innerHTML = `
        <a href="tel:${phoneClean}" aria-label="Appeler le restaurant" class="flex items-center gap-2">
            <i class="fas fa-phone ${accentText}"></i>
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
        // CORRECTION DU BUG LIEN GOOGLE MAPS ICI 👇
        mapLink = isApple
          ? `https://maps.apple.com/?q=${encodeURIComponent(fullAddr)}`
          : `https://maps.google.com/?q=${encodeURIComponent(fullAddr)}`;
      }

      const iconClass = isApple ? "fa-map" : "fa-location-dot";

      footerAddr.innerHTML = `
          <a href="${mapLink}" target="_blank" class="flex items-start gap-2">
              <i class="fas ${iconClass} mt-1 ${accentText}"></i>
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
  const s = cfg.contact.socials;

  if (socialsContainer && cfg.contact.socials) {
    socialsContainer.innerHTML = "";
    socialsContainer.className =
      "flex gap-5 text-3xl mt-4 pt-4 border-t border-gray-700/50";

    if (s.instagram) {
      socialsContainer.innerHTML += `
        <a href="https://instagram.com/${s.instagram.replace("@", "")}" target="_blank" aria-label="Notre page Instagram" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform duration-300">
            <i class="fab fa-instagram bg-linear-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-transparent bg-clip-text"></i>
        </a>`;
    }
    if (s.facebook) {
      socialsContainer.innerHTML += `
        <a href="https://facebook.com/${s.facebook}" target="_blank" aria-label="Notre page Facebook" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform duration-300">
            <i class="fab fa-facebook text-[#1877F2]"></i>
        </a>`;
    }
    if (s.tiktok) {
      socialsContainer.innerHTML += `
        <a href="https://tiktok.com/@${s.tiktok.replace("@", "")}" target="_blank" aria-label="Notre page Tiktok" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform duration-300 group">
            <i class="fab fa-tiktok text-white group-hover:drop-shadow-[2px_2px_0_#ff0050] transition-all"></i>
        </a>`;
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

      const textColor = isToday
        ? `${accentText} font-bold hover:-translate-y-1 transition-transform duration-300`
        : "text-gray-200";
      li.className = textColor;
      li.innerHTML = `<span class="inline-block w-24">${h.day}</span> ${h.closed ? "Fermé" : h.open + " - " + h.close}`;
      hoursList.appendChild(li);

      if (isToday && heroStatus) {
        heroStatus.innerText = h.closed
          ? "Fermé"
          : `Ouvert : ${h.open} - ${h.close}`;
        heroStatus.className = h.closed
          ? "inline-block px-3 py-1 mb-4 text-sm font-bold uppercase border border-red-500 rounded-full backdrop-blur-md bg-red-500/50 text-white"
          : "inline-block px-3 py-1 mb-4 text-sm font-bold uppercase border border-green-500 rounded-full bg-green-600/50 backdrop-blur-md text-white";
      }
    });
  }

  // ==========================================
  // 🚀 SEO LOCAL : INJECTION DU SCHEMA.ORG
  // ==========================================
  const existingScript = document.getElementById("seo-schema");
  if (existingScript) existingScript.remove();

  function buildOpeningHours(hoursArray) {
    const dayMap = {
      lundi: "Monday",
      mardi: "Tuesday",
      mercredi: "Wednesday",
      jeudi: "Thursday",
      vendredi: "Friday",
      samedi: "Saturday",
      dimanche: "Sunday",
    };
    return hoursArray
      .filter((h) => !h.closed)
      .map((h) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: dayMap[h.day.toLowerCase()],
        opens: h.open,
        closes: h.close,
      }));
  }

  const a = cfg.contact.address;
  const openingHoursSpecification = buildOpeningHours(cfg.hours);

  const schemaData = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": window.location.origin + "#restaurant",
    name: cfg.identity.name,
    image: cfg.identity.heroImg,
    url: window.location.origin,
    telephone: cfg.contact.phone,
    hasMenu: window.location.href + "#menu",
    address: {
      "@type": "PostalAddress",
      streetAddress: a.street,
      addressLocality: a.city,
      postalCode: a.zip,
      addressCountry: "FR",
    },
    // J'ai supprimé les coordonnées GPS "geo" statiques ici.
    sameAs: [
      s?.instagram
        ? `https://instagram.com/${s.instagram.replace("@", "")}`
        : "",
      s?.facebook ? `https://facebook.com/${s.facebook}` : "",
      s?.tiktok ? `https://tiktok.com/@${s.tiktok.replace("@", "")}` : "",
    ].filter(Boolean),
    servesCuisine: "Fast Food",
    priceRange: "€",
    openingHoursSpecification: openingHoursSpecification,
  };

  const script = document.createElement("script");
  script.id = "seo-schema";
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(schemaData);
  document.head.appendChild(script);
  

  if (typeof window.applySaaSThemeToHTML === "function") {
    window.applySaaSThemeToHTML();
  }
}

// ============================================================================
// 🕵️‍♂️ ÉCOUTEUR D'ÉTAT (LE VIGILE)
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  const urlParams = new URLSearchParams(window.location.search);
  let snackIdToLoad =
    urlParams.get("s") || window.CURRENT_SNACK_ID || "Ym1YiO4Ue5Fb5UXlxr06";

  try {
    // 1. On charge la config SaaS en premier !
    await window.loadSnackConfig(db, snackIdToLoad);

    // 2. On injecte les textes, logos et thèmes (La Pause)
    // C'est ICI que tu répares le chargement des données
    if (typeof updateUI === "function") updateUI(user);

    // 3. Gestion du bouton de fidélité
    const loyaltyBtn = document.getElementById("loyalty-main-btn");
    const loyaltyDesc = document.getElementById("loyalty-desc");

    if (user) {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const data = userDoc.exists()
        ? userDoc.data()
        : { points: 0, role: "client" };

      if (data.role === "admin") {
        loyaltyBtn?.setAttribute("data-action", "open-admin-scanner");
        if (loyaltyBtn)
          loyaltyBtn.innerHTML = '<i class="fas fa-camera"></i> Scanner';
      } else {
        loyaltyBtn?.setAttribute("data-action", "open-client-card");
        if (loyaltyBtn)
          loyaltyBtn.innerHTML = '<i class="fas fa-qrcode"></i> Ma Carte';
        if (loyaltyDesc)
          loyaltyDesc.innerHTML = `Membre : <strong>${data.points || 0} points</strong>`;
      }
    } else {
      loyaltyBtn?.setAttribute("data-action", "toggle-auth-modal");
      if (loyaltyBtn) loyaltyBtn.innerHTML = "Connexion";
    }

    // 4. On lance les visuels (Menu, Pull-to-refresh...)
    if (typeof window.initAppVisuals === "function")
      await window.initAppVisuals();
  } catch (error) {
    console.error("❌ Erreur Initialisation :", error);
  }
});

onMessage(messaging, (payload) => {
  const titre = payload.notification?.title || "Nouvelle notification";
  const message = payload.notification?.body || "";
  window.showToast(`🔔 ${titre} : ${message}`, "success");
});

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

  // On laisse la modale s'afficher correctement (taille 0x0)
  await new Promise((resolve) => setTimeout(resolve, 150));

  try {
    // 💡 L'ARME SECRÈTE : On charge le script depuis le CDN à la volée !
    if (!window.Html5Qrcode) {
      window.showToast("Chargement de la caméra...", "info");

      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://unpkg.com/html5-qrcode";
        script.type = "text/javascript";
        script.onload = resolve; // Quand le fichier est téléchargé, on continue !
        script.onerror = () =>
          reject("Impossible de charger le script QR Code");
        document.body.appendChild(script);
      });
    }

    // ✅ À ce stade, le script est téléchargé, la classe existe dans "window"
    html5Qrcode = new window.Html5Qrcode("reader");

    await html5Qrcode.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
      },
      onScanSuccess,
      onScanFailure,
    );
  } catch (err) {
    alert("ERREUR CAMÉRA : " + (err.message || err));
    console.error("Scanner erreur :", err);
    window.showToast("Erreur d'accès à la caméra", "error");
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
  if (typeof window.triggerVibration === "function")
    window.triggerVibration("success");
  window.showToast("QR Code lu ! Vérification en cours...", "success");

  try {
    const clientRef = doc(db, "users", decodedText);
    const clientDoc = await getDoc(clientRef);

    if (!clientDoc.exists()) {
      window.showToast(
        "❌ Erreur : Ce QR Code n'est pas dans notre base.",
        "error",
      );
      return;
    }

    const clientData = clientDoc.data();
    if (clientData.snackId !== adminSnackId) {
      window.showToast(
        "⚠️ Ce client appartient à un autre établissement !",
        "error",
      );
      return;
    }

    const currentPoints = clientDoc.data().points || 0;
    const maxPoints = 10;

    if (currentPoints >= maxPoints) {
      await updateDoc(clientRef, { points: 0 });
      window.showToast(
        "🎉 BINGO ! Donnez un Menu Gratuit ! (Carte remise à 0)",
        "success",
      );
    } else {
      await updateDoc(clientRef, { points: increment(1) });
      const newTotal = currentPoints + 1;
      if (newTotal === maxPoints) {
        window.showToast(
          `✅ Point ajouté ! Le client gagne son menu ! 🎁`,
          "success",
        );
      } else {
        window.showToast(
          `✅ Point ajouté ! Total actuel : ${newTotal}/${maxPoints}`,
          "success",
        );
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
  const errorMessage = typeof error === "string" ? error : error?.message || "";

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
