// ============================================================================
// 🎨 LE DICTIONNAIRE DES THÈMES SAAS (Design System Curaté)
// ============================================================================
const SAAS_THEMES = {
  "ruby": {
      primary: "bg-red-600",
      textOnPrimary: "text-white",
      accent: "text-red-600",
      lightBg: "bg-red-50"
  },
  "ocean": {
      primary: "bg-blue-600",
      textOnPrimary: "text-white",
      accent: "text-blue-600",
      lightBg: "bg-blue-50"
  },
  "forest": {
      primary: "bg-green-600",
      textOnPrimary: "text-white",
      accent: "text-green-600",
      lightBg: "bg-green-50"
  },
  "midnight": {
      primary: "bg-gray-900",
      textOnPrimary: "text-white",
      accent: "text-gray-900",
      lightBg: "bg-gray-100"
  },
  "sunflower": {
      primary: "bg-yellow-400",
      textOnPrimary: "text-gray-900", // Contraste WCAG respecté !
      accent: "text-yellow-500",
      lightBg: "bg-yellow-50"
  }
};

window.loadSnackConfig = async (db, snackId) => {
try {
  const { doc, getDoc } = window.fs;

  const snackRef = doc(db, "snacks", snackId);
  const snackSnap = await getDoc(snackRef);

  if (snackSnap.exists()) {
    const data = snackSnap.data();

    // 🎯 RÉCUPÉRATION DU THÈME
    // On cherche la palette choisie. Si elle n'existe pas, on met "ruby" par défaut.
    const paletteKey = data.colorPalette || "forest"; 
    const selectedTheme = SAAS_THEMES[paletteKey] || SAAS_THEMES["forest"];

    // 🪄 ON REMPLACE LA CONFIG "EN DUR" PAR LES DONNÉES FIRESTORE
    window.snackConfig = {
      identity: {
        id: snackId,
        name: data.nom || "Snack Sans Nom",
        description: data.description || "",
        logoUrl: data.logoUrl || "./assets/logo.webp",
        heroImg: data.heroImg || "./assets/logo.webp",
        currency: data.currency || "€",
      },
      contact: {
        phone: data.phoneNumber || "",
        email: data.email || "",
        address: {
          street: data.street || "",
          zip: data.zipcode || "",
          city: data.city || "",
        },
        socials: {
          instagram: data.instagram || "",
          facebook: data.facebook || "",
          tiktok: data.tiktok || "",
        },
      },
      theme: {
        templateId: data.templateId || "neon-vibes",
        colorPalette: paletteKey,
        // 🔥 LES COULEURS SONT MAINTENANT PILOTÉES PAR LE DICTIONNAIRE
        colors: {
          primary: selectedTheme.primary,
          textOnPrimary: selectedTheme.textOnPrimary,
          accent: selectedTheme.accent,
          lightBg: selectedTheme.lightBg
        },
      },
      features: {
        enableOnlineOrder: data.enableOnlineOrder !== undefined ? data.enableOnlineOrder : false,
        enableDelivery: data.enableDelivery !== undefined ? data.enableDelivery : false,
        enableClickAndCollect: data.enableClickAndCollect !== undefined ? data.enableClickAndCollect : false,
        enableLoyaltyCard: data.enableLoyaltyCard !== undefined ? data.enableLoyaltyCard : true,
        maintenanceMode: data.maintenanceMode !== undefined ? data.maintenanceMode : false,
        enablePushNotifs: data.enablePushNotifs !== undefined ? data.enablePushNotifs : false,
        enableSmartReview: data.enableSmartReview !== undefined ? data.enableSmartReview : false,
        enableViralShare: data.enableViralShare !== undefined ? data.enableViralShare : false,
      },
      hours: data.hours || [],
      reviews: {
        googleMapsReviewLink: "https://g.page/r/TON_LIEN_DA_AVIS/review",
      },
      loyalty: {
        programName: data.loyaltyProgramName || "Club Fidélité",
        cardDesign: {
          backgroundGradient: data.cardGradient || "from-red-500 to-orange-600",
        },
      },
    };

    console.log(`✅ SaaS : Configuration de "${data.nom}" chargée avec le thème [${paletteKey}].`);
    return window.snackConfig;
  } else {
    console.error("❌ Erreur : Snack ID inexistant dans Firestore.");
    return null;
  }
} catch (error) {
  console.error("🔥 Erreur critique chargement SaaS :", error);
}
};