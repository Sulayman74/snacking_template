// ============================================================================
// 🎨 LE DICTIONNAIRE DES THÈMES SAAS (Design System Curaté)
// ============================================================================
// Couleurs en HEX — injectées dans les CSS custom properties via applySaaSThemeToHTML.
// Les utilitaires Tailwind bg-primary / text-accent / border-accent / bg-primary-light
// / text-on-primary sont générés par le bloc @theme dans styles.css.
import { store } from "./core/Store.js";
import { doc, getDoc } from "./core/firebase.js";
import { resolveFont } from "./theme-fonts.js";
// Palettes = source UNIQUE partagée avec le build (vite.config.js) → le splash/manifest
// dérivent la même couleur que l'UI runtime, plus de désync. Cf. src/theme-palettes.js.
import { SAAS_THEMES } from "./theme-palettes.js";

// Coerce une valeur Firestore en nombre fini, sinon renvoie le fallback (ex: null).
const numberOr = (v, fallback) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

window.loadSnackConfig = async (db, snackId) => {
try {
  // 🚀 Cache en mémoire : évite une lecture Firestore si le snack est déjà chargé
  const currentConfig = store.state.config;
  if (currentConfig?.identity?.id === snackId) {
    return currentConfig;
  }

  const snackRef = doc(db, "snacks", snackId);
  const snackSnap = await getDoc(snackRef);

  if (snackSnap.exists()) {
    const data = snackSnap.data();

    // 🎯 RÉCUPÉRATION DU THÈME
    // On cherche la palette choisie. Si elle n'existe pas, on met "ruby" par défaut.
    const paletteKey = data.colorPalette || "sunflower";
    const selectedTheme = SAAS_THEMES[paletteKey] || SAAS_THEMES["sunflower"];

    // 🔤 RÉCUPÉRATION DE LA POLICE.
    // key = null si ABSENT en Firestore -> applyTheme ne surcharge PAS la valeur déjà posée
    // au build (snacks-seo.json). Si présent (même "system"), c'est un override explicite admin.
    const fontKey = data.fontKey || null;
    const selectedFont = resolveFont(fontKey); // resolveFont(null) -> police système

    // 🪄 ON REMPLACE LA CONFIG "EN DUR" PAR LES DONNÉES FIRESTORE
    const config = {
      identity: {
        id: snackId,
        name: data.nom || "Snack Sans Nom",
        description: data.description || "",
        logoUrl: data.logoUrl || "./assets/logo.webp",
        heroImg: data.heroImg || "./assets/logo.webp",
        currency: data.currency || "€",
      },
      promoPhrase: data.promoPhrase || "",
      contact: {
        phone: data.phoneNumber || "",
        email: data.email || "",
        address: {
          street: data.street || "",
          zip: data.zipcode || "",
          city: data.city || "",
          googleMapsUrl: data.googleMapsUrl || "",
        },
        socials: {
          instagram: data.instagram || "",
          facebook: data.facebook || "",
          tiktok: data.tiktok || "",
        },
      },
      theme: {
        templateId: data.templateId || "classic",
        colorPalette: paletteKey,
        fontFamily: data.fontFamily || "font-sans", // legacy conservé (Read-Old, CLAUDE.md §5.1)
        fontKey,
        // 🔤 Police résolue — injectée dans --font-body/--font-display par applyTheme
        fonts: {
          key: fontKey,
          body: selectedFont.body,
          display: selectedFont.display,
          href: selectedFont.href,
        },
        // 🔥 LES COULEURS SONT MAINTENANT DES HEX — injectées dans CSS vars par applySaaSThemeToHTML
        colors: {
          primaryHex:   selectedTheme.primaryHex,
          accentHex:    selectedTheme.accentHex,
          lightHex:     selectedTheme.lightHex,
          onPrimaryHex: selectedTheme.onPrimaryHex,
        },
      },
     // 🚨 APPLICATION DU BOUCLIER SUR TOUS LES FEATURE FLAGS
      features: {
        enableOnlineOrder: data.enableOnlineOrder,
        enableDelivery: data.enableDelivery,
        enableClickAndCollect: data.enableClickAndCollect,
        enableLoyaltyCard: data.enableLoyaltyCard,
        maintenanceMode: data.maintenanceMode,
        enablePushNotifs: data.enablePushNotifs,
        enableSmartReview: data.enableSmartReview,
        enableViralShare: data.enableViralShare,
        enableUpsell: data.enableUpsell,
      },
      // 🔗 Lien plateforme tierce (UberEats/Deliveroo) — FALLBACK quand le snack
      // n'a pas de flotte. La livraison native (ci-dessous) prime si activée.
      deliveryUrl: data.deliveryUrl || "",
      // 🚚 LIVRAISON NATIVE — réglages opérationnels (édités via AdminConfigUI).
      // Défauts sûrs : si le snack n'a rien configuré, la livraison reste cohérente.
      delivery: {
        radiusKm: numberOr(data.delivery?.radiusKm, 5),         // rayon max de livraison
        frais: numberOr(data.delivery?.frais, 2.5),             // frais fixes
        minOrder: numberOr(data.delivery?.minOrder, 0),         // panier minimum
        avgSpeedKmh: numberOr(data.delivery?.avgSpeedKmh, 22),  // vitesse moyenne (ETA Haversine)
        prepBaseMin: numberOr(data.delivery?.prepBaseMin, 12),  // temps prépa de base
        queueFactorMin: numberOr(data.delivery?.queueFactorMin, 3), // min ajoutées / commande en file
      },
      // 📍 Coordonnées resto (géocodées une fois). null si pas encore renseignées.
      geo: {
        lat: numberOr(data.restaurantLat, null),
        lng: numberOr(data.restaurantLng, null),
      },
      hours: data.hours || [],
      reviews: {
        googleMapsReviewLink: data.googleReviewUrl || "",
      },
      loyalty: {
        programName: data.loyaltyProgramName || "Club Fidélité",
        cardDesign: {
          backgroundGradient: data.cardGradient || "from-primary to-gray-900",
        },
      },
    };

    window.snackConfig = config;
    store.setConfig(config);
    console.log(`✅ SaaS : Configuration de "${data.nom}" chargée...`);
    return config;
  } else {
    console.error("❌ Erreur : Snack ID inexistant dans Firestore.");
    return null;
  }
} catch (error) {
  console.error("🔥 Erreur critique chargement SaaS :", error);
}
};