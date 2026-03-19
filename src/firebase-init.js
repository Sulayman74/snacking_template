// ============================================================================
// FIREBASE INITIALIZATION & AUTHENTICATION (LE HUB CENTRAL)
// ============================================================================

// 1. LES IMPORTS (TOUJOURS TOUT EN HAUT !)
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
  where
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import {
  getMessaging,
  getToken,
  onMessage
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
const storage = getStorage(app);

// 4. EXPORTATION SÉCURISÉE (LE HUB POUR VITE)
window.storage = storage;
window.auth = auth;
window.db = db;
window.messaging = messaging;

window.fs = { doc, getDoc, setDoc, updateDoc, increment, onSnapshot, query, collection, where, orderBy, limit, startAfter, getDocs, getStorage, addDoc, serverTimestamp };
window.storageTools = { getDownloadURL, ref, uploadBytes };
window.authTools = { onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword };

// ============================================================================
// 🎨 LE PEINTRE GLOBAL (Application dynamique du Thème SaaS)
// ============================================================================
window.applySaaSThemeToHTML = () => {
    const cfg = window.snackConfig;
    if (!cfg || !cfg.theme) return;
    
    const { primary, accent, textOnPrimary,border, blurBg  } = cfg.theme.colors;

    // 1. CHANGER LA COULEUR DES BOUTONS FIXES (Panier, Modales, Auth)
    const primaryButtons = [
        'auth-submit-btn', 'pwa-install-btn', 'btn-review-google', 'checkout-btn'
    ];
    
    primaryButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.className = btn.className.replace(/bg-[a-z]+-\d+/g, '').replace(/text-[a-z]+-\d+/g, '').replace('text-white', '').replace('text-black', '');
            btn.className += ` ${primary} ${textOnPrimary}`;
        }
    });

    // 2. CHANGER LE PANIER FLOTTANT
    const floatingCartBtn = document.querySelector('#floating-cart-container button');
    if (floatingCartBtn) {
        floatingCartBtn.className = floatingCartBtn.className.replace(/bg-[a-z]+-\d+/g, '').replace(/shadow-[a-z]+-\d+\/\d+/g, '');
        floatingCartBtn.className += ` ${primary} shadow-[0_8px_20px_rgba(0,0,0,0.3)]`;
    }
    
    // Le petit badge de quantité sur le panier
    const cartBadge = document.getElementById('cart-badge');
    if (cartBadge) {
        cartBadge.className = cartBadge.className.replace(/text-[a-z]+-\d+/g, textOnPrimary);
    }

// ==========================================
    // 3. LA SECTION FIDÉLITÉ (Bordures, Icônes et Halo lumineux)
    // ==========================================
    const loyaltyCard = document.getElementById('loyalty-card');
    const loyaltyBlur = document.getElementById('loyalty-blur'); 
    const loyaltyIcon = document.querySelector('#loyalty .fa-gift');
    const loyaltyBtn = document.getElementById('loyalty-main-btn');

    if (loyaltyCard && border) {
        // ✅ 1. On ajoute la bordure à la carte (Sans le "=" !)
        loyaltyCard.classList.add(border);
        
        if (loyaltyBlur && blurBg) {
            // ✅ 2. Comme ton HTML n'a pas de fond par défaut, on a juste à l'ajouter
            // (blurBg vaut par exemple "bg-blue-600/60")
            loyaltyBlur.classList.add(blurBg);
        }
    }

    if (loyaltyBtn && border) {
        // ✅ 3. On ajoute la couleur de la bordure ET son épaisseur (border-2)
        loyaltyBtn.classList.add("border-2", border);
    }
    
    if (loyaltyIcon && accent) {
        // ✅ 4. Le cadeau n'a plus de couleur de base, on ajoute la nouvelle direct
        loyaltyIcon.classList.add(accent);
    }

    // 4. LES PETITS DÉTAILS D'ACCENTUATION (Flèches, Spinners)
    // La flèche "Voir toute la carte"
    const arrowIcons = document.querySelectorAll('.fa-arrow-right.text-red-500');
    arrowIcons.forEach(icon => {
        icon.className = icon.className.replace('text-red-500', accent);
    });

    // Le spinner de rechargement (Pull to refresh)
    const ptrIcon = document.getElementById('ptr-icon'); 
    if (ptrIcon && ptrIcon.classList.contains('text-red-600')) {
        ptrIcon.className = ptrIcon.className.replace('text-red-600', accent);
    }
    
    // L'icône de scan de la modal scanner admin
    const scanIcon = document.querySelector('.fa-qrcode.text-red-500');
    if (scanIcon) scanIcon.className = scanIcon.className.replace('text-red-500', accent);
};
function updateUI(user) {
  const cfg = window.snackConfig;
  if (!cfg) return;
  
  document.title = cfg.identity.name;
  
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription && cfg.identity.description) {
      metaDescription.setAttribute("content", cfg.identity.description);
  }

  // 🎨 EXTRACTION DES COULEURS DU THÈME
  const primaryBg = cfg.theme.colors.primary;
  const textOnPrimary = cfg.theme.colors.textOnPrimary;
  const accentText = cfg.theme.colors.accent;

  // ==========================================
  // 0. SPLASH SCREEN (Logo et Ombre Dynamique)
  // ==========================================
  const splashLogo = document.getElementById("splash-logo");
  if (splashLogo && cfg.identity) {
      // 1. On remplace l'image et le texte alternatif
      if (cfg.identity.logoUrl){
        splashLogo.src = cfg.identity.logoUrl;
        splashLogo.classList.remove("hidden");
      } 
      if (cfg.identity.name) splashLogo.alt = cfg.identity.name;

      // 🎨 BONUS SÉNIOR : On adapte l'ombre colorée au thème du client !
      // Ton ombre rouge codée en dur n'ira pas du tout si le thème du client est Bleu Océan...
      if (cfg.theme && cfg.theme.colors && cfg.theme.colors.primary) {
          // On retire ton ombre rouge par défaut
          splashLogo.className = splashLogo.className.replace(/shadow-\[0_0_40px_rgba\(\d+,\d+,\d+,[\d.]+\)\]/g, '');
          
          // On crée une ombre dynamique basée sur la couleur primaire (ex: transforme "bg-blue-600" en "shadow-blue-600")
          const shadowColor = cfg.theme.colors.primary.replace('bg-', 'shadow-'); 
          splashLogo.classList.add('shadow-2xl', shadowColor);
      }
  }
  // ==========================================
  // 🎭 MODALES : Remplacement des logos génériques
  // ==========================================
  const pwaIcon = document.getElementById("pwa-banner-icon");
  const reviewIcon = document.getElementById("review-modal-icon");

  if (cfg.identity && cfg.identity.logoUrl) {
      // On remplace le logo dans la bannière d'installation
      if (pwaIcon) pwaIcon.src = cfg.identity.logoUrl;
      
      // On remplace le logo dans la modale d'avis
      if (reviewIcon) reviewIcon.src = cfg.identity.logoUrl;
  }

  // ==========================================
  // 1. Navbar et Hero (Identité & Logo)
  // ==========================================
  const navName = document.getElementById("nav-name");
  if (navName) navName.innerText = cfg.identity.name;

  if (cfg.identity.logoUrl) {
      // Change l'icône de l'onglet du navigateur
      let favicon = document.querySelector('link[rel="icon"]');
      if (favicon) favicon.href = cfg.identity.logoUrl;

      // Change l'icône pour les iPhone/iPad
      let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
      if (appleIcon) appleIcon.href = cfg.identity.logoUrl;
  }

// ==========================================
  // 📱 GÉNÉRATEUR DE PWA DYNAMIQUE (MARQUE BLANCHE)
  // ==========================================
  if (cfg.identity.logoUrl) {
      
      // 🛠️ 1. Traducteur Tailwind -> Hexadécimal (Pour que le téléphone comprenne les couleurs)
      const twToHex = {
          "bg-red-600": "#dc2626", "bg-red-100": "#fee2e2",
          "bg-blue-600": "#2563eb", "bg-blue-100": "#dbeafe",
          "bg-green-600": "#16a34a", "bg-green-100": "#dcfce7",
          "bg-purple-500": "#a855f7", "bg-purple-100": "#f3e8ff",
          "bg-yellow-400": "#facc15", "bg-yellow-100": "#fef9c3"
      };

      // On trouve la vraie couleur, ou on met noir/blanc par défaut
      const themeHex = twToHex[cfg.theme?.colors?.primary] || "#000000";
      const bgHex = twToHex[cfg.theme?.colors?.lightBg] || "#ffffff";

      // 2. On fabrique le manifeste sur mesure
      const dynamicManifest = {
          "name": cfg.identity.name,
          "short_name": cfg.identity.name,
          "start_url": window.location.origin + "/", // ✅ URL Absolue pour éviter le bug du Blob !
          "display": "standalone",
          "background_color": bgHex, // ✅ Vrai code Hexadécimal
          "theme_color": themeHex,   // ✅ Vrai code Hexadécimal
          "icons": [
              {
                  "src": cfg.identity.logoUrl, 
                  "sizes": "512x512",
                  "type": "image/webp",
                  "purpose": "any maskable"
              }
          ]
      };

      // 3. On transforme ce texte en un "faux" fichier virtuel
      const blob = new Blob([JSON.stringify(dynamicManifest)], { type: 'application/json' });
      const manifestURL = URL.createObjectURL(blob);

      // 4. On remplace le lien du manifest dans le HTML par notre fichier virtuel
      let manifestLink = document.querySelector('link[rel="manifest"]');
      if (manifestLink) {
          manifestLink.setAttribute('href', manifestURL);
      }
  }

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
    const phoneClean = cfg.contact?.phone ? cfg.contact.phone.replace(/\s/g, "") : "";

    if (mobileCtaBtn && mobileCtaIcon) {
      // Nettoyage des anciennes classes de couleurs potentielles
      mobileCtaBtn.className = mobileCtaBtn.className.replace(/bg-\w+-\d+/g, '').replace(/text-\w+-\d+/g, '').replace('text-white', '').replace('text-black', '');
      
      if (isDelivery) {
        mobileCtaBtn.href = cfg.deliveryUrl || "#";
        mobileCtaBtn.setAttribute("target", "_blank");
        mobileCtaBtn.classList.add(primaryBg.split(" ")[0], textOnPrimary);
        mobileCtaIcon.className = "fas fa-motorcycle text-2xl";
      } else {
        mobileCtaBtn.href = `tel:${phoneClean}`;
        mobileCtaBtn.removeAttribute("target");
        // Le bouton d'appel reste vert classique, c'est une convention UI universelle
        mobileCtaBtn.classList.add("bg-green-600", "text-white");
        mobileCtaIcon.className = "fas fa-phone text-2xl animate-pulse";
      }
    }

    if (desktopCtaBtn) {
      desktopCtaBtn.className = desktopCtaBtn.className.replace(/bg-\w+-\d+/g, '').replace(/text-\w+-\d+/g, '').replace('text-white', '').replace('text-black', '');

      if (isDelivery) {
        desktopCtaBtn.href = cfg.deliveryUrl || "#";
        desktopCtaBtn.setAttribute("target", "_blank");
        desktopCtaBtn.innerHTML = '<i class="fas fa-motorcycle mr-2"></i> Commander en livraison';
        desktopCtaBtn.className = `ml-4 px-6 py-2 rounded-full font-bold shadow-lg transform hover:scale-105 transition ${primaryBg} ${textOnPrimary}`;
      } else {
        desktopCtaBtn.href = `tel:${phoneClean}`;
        desktopCtaBtn.removeAttribute("target");
        desktopCtaBtn.innerHTML = `<i class="fas fa-phone mr-2 animate-pulse"></i> ${cfg.contact.phone || "Appeler"}`;
        desktopCtaBtn.className = `ml-4 px-6 py-2 rounded-full font-bold shadow-lg transform hover:scale-105 transition bg-green-600 text-white`;
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
          mapLink = isApple 
            ? `https://maps.apple.com/?q=${encodeURIComponent(fullAddr)}` 
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddr)}`;
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
  // 3. Réseaux Sociaux & Horaires (Couleurs Officielles)
  // ==========================================
  const socialsContainer = document.getElementById("socials-container");
  const s = cfg.contact.socials;
  
  if (socialsContainer && cfg.contact.socials) {
    socialsContainer.innerHTML = "";
    
    // On s'assure que le conteneur a de l'espace et que les icônes sont grandes
    socialsContainer.className = "flex gap-5 text-3xl mt-4 pt-4 border-t border-gray-700/50";

    if (s.instagram) {
      // 📸 INSTAGRAM : Le fameux dégradé Jaune -> Rouge -> Violet
      socialsContainer.innerHTML += `
        <a href="https://instagram.com/${s.instagram.replace("@", "")}" target="_blank" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform duration-300">
            <i class="fab fa-instagram bg-linear-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-transparent bg-clip-text"></i>
        </a>`;
    }
    
    if (s.facebook) {
      // 📘 FACEBOOK : Le bleu officiel (#1877F2)
      socialsContainer.innerHTML += `
        <a href="https://facebook.com/${s.facebook}" target="_blank" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform duration-300">
            <i class="fab fa-facebook text-[#1877F2]"></i>
        </a>`;
    }
    
    if (s.tiktok) {
      // 🎵 TIKTOK : Blanc par défaut (car le footer est sombre), mais avec une ombre portée "Glitch" rose fluo au survol !
      socialsContainer.innerHTML += `
        <a href="https://tiktok.com/@${s.tiktok.replace("@", "")}" target="_blank" rel="noopener noreferrer" class="hover:-translate-y-1 transition-transform duration-300 group">
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

      const textColor = isToday ? `${accentText} font-bold hover:-translate-y-1 transition-transform duration-300` : "text-gray-200";
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

  // ==========================================
  // 🚀 SEO LOCAL : INJECTION DU SCHEMA.ORG
  // ==========================================
  const existingScript = document.getElementById('seo-schema');
  if (existingScript) existingScript.remove(); 

  function buildOpeningHours(hoursArray) {
      const dayMap = {
        "lundi": "Monday", "mardi": "Tuesday", "mercredi": "Wednesday",
        "jeudi": "Thursday", "vendredi": "Friday", "samedi": "Saturday", "dimanche": "Sunday"
      };
      return hoursArray.filter(h => !h.closed).map(h => ({
          "@type": "OpeningHoursSpecification",
          "dayOfWeek": dayMap[h.day.toLowerCase()],
          "opens": h.open,
          "closes": h.close
      }));
  }

  const a = cfg.contact.address;
  const openingHoursSpecification = buildOpeningHours(cfg.hours);

  const schemaData = {
      "@context": "https://schema.org",
      "@type": "Restaurant",
      "@id": window.location.origin + "#restaurant",
      "name": cfg.identity.name,
      "image": cfg.identity.heroImg,
      "url": window.location.origin,
      "telephone": cfg.contact.phone,
      "hasMenu": window.location.href + "#menu",
      "address": {
          "@type": "PostalAddress",
          "streetAddress": a.street,
          "addressLocality": a.city,
          "postalCode": a.zip,
          "addressCountry": "FR"
      },
      "geo": { "@type": "GeoCoordinates", "latitude": "46.0780", "longitude": "6.4074" },
      "sameAs": [
          s?.instagram ? `https://instagram.com/${s.instagram}` : "",
          s?.facebook ? `https://facebook.com/${s.facebook}` : ""
      ].filter(Boolean),
      "servesCuisine": "Fast Food",
      "priceRange": "€",
      "openingHoursSpecification": openingHoursSpecification
  };

  const script = document.createElement('script');
  script.id = 'seo-schema';
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(schemaData);
  document.head.appendChild(script);
  window.applySaaSThemeToHTML();
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

const authForm = document.getElementById("auth-form");

// Le bouclier : On n'écoute le bouton "submit" QUE si le formulaire existe sur la page
if (authForm) {
  authForm.addEventListener("submit", async (e) => {
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
}

// ============================================================================
// ÉCOUTEUR D'ÉTAT (LE VIGILE AMÉLIORÉ 🕵️‍♂️)
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  const loyaltyBtn = document.getElementById("loyalty-main-btn");
  const loyaltyDesc = document.getElementById("loyalty-desc");
  const navLogoutBtn = document.getElementById("nav-logout-btn");
  const mobileLogoutBtn = document.getElementById("mobile-logout-btn");

// On peut le récupérer depuis l'URL (ex: ?s=ID) ou depuis la config chargée
// ====================================================================
  // 🧭 LE ROUTEUR MAGIQUE SAAS (HYBRIDE : PREVIEW + PRODUCTION)
  // ====================================================================
  const urlParams = new URLSearchParams(window.location.search);
  const forcedSnackId = urlParams.get('s'); // Cherche ?s=... dans l'URL
  const hostname = window.location.hostname;

  let snackIdToLoad = "Ym1YiO4Ue5Fb5UXlxr06";

  try {
      if (forcedSnackId) {
          console.log("🔍 Mode Aperçu activé pour le Snack :", forcedSnackId);
          snackIdToLoad = forcedSnackId; // ✅ On utilise l'ID de l'URL !
      } else if (hostname !== "localhost" && hostname !== "127.0.0.1" && !hostname.includes("snacking-template.web.app")) {
          console.log("🌍 Mode Domaine activé : Recherche de", hostname);
          const { collection, query, where, getDocs } = window.fs;
          const q = query(collection(window.db, "snacks"), where("domain", "==", hostname));
          const snapshot = await getDocs(q);
          
          if (!snapshot.empty) {
              snackIdToLoad = snapshot.docs[0].id;
          } else {
              console.error("❌ Domaine inconnu ! Chargement de la démo par défaut.");
          }
      }
  } catch (e) {
      console.error("Erreur du Routeur SaaS :", e);
  }
  // ====================================================================

  try {
    if (user) {
      console.log("🟢 Utilisateur connecté :", user.email);
      if (navLogoutBtn) navLogoutBtn.classList.remove("hidden");
      if (mobileLogoutBtn) mobileLogoutBtn.classList.remove("hidden");

      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      let role = "client";
      let points = 0;

      if (userDoc.exists()) {
        const userData = userDoc.data();
        
        // Sécurité : Si c'est un Admin de resto, on le force sur SON resto
        if (userData.snackId && userData.role === 'admin') {
            snackIdToLoad = userData.snackId;
        }
        
        role = userData.role || "client";
        points = userData.points || 0;
      }

      // 🎯 ON INJECTE LE BON ID ICI !
      await window.loadSnackConfig(db, snackIdToLoad);
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

      if (loyaltyDesc) loyaltyDesc.innerText = "Gagnez des points à chaque commande !";
      if (loyaltyBtn) {
        loyaltyBtn.innerHTML = "Connexion";
        loyaltyBtn.onclick = window.toggleAuthModal;
        loyaltyBtn.className = "bg-white border-2 border-green-600 text-black px-8 py-3 rounded-full font-bold shadow-lg hover:bg-gray-100 transition transform hover:-translate-y-1";
      }

      // 🎯 ET ON INJECTE LE BON ID ICI AUSSI !
      await window.loadSnackConfig(db, snackIdToLoad);
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