// ============================================================================
// 🎨 LE DICTIONNAIRE DES THÈMES SAAS (Design System Curaté)
// ============================================================================
const SAAS_THEMES = {
  "ruby": {
      primary: "bg-red-600",
      textOnPrimary: "text-white",
      accent: "text-red-600",
      lightBg: "bg-red-100",
      border: "border-red-600",    // NOUVEAU
      blurBg: "bg-red-600/60"
  },
  "ocean": {
      primary: "bg-blue-600",
      textOnPrimary: "text-white",
      accent: "text-blue-500",
      lightBg: "bg-blue-100",
      border: "border-blue-600",    // NOUVEAU
      blurBg: "bg-blue-600/60"
  },
  "forest": {
      primary: "bg-green-600",
      textOnPrimary: "text-white",
      accent: "text-green-600",
      lightBg: "bg-green-100",
      border: "border-green-600",    // NOUVEAU
      blurBg: "bg-green-600/60"
  },
  "midnight": {
      primary: "bg-purple-500",
      textOnPrimary: "text-white",
      accent: "text-purple-400",
      lightBg: "bg-purple-100",
      border: "border-purple-600",    // NOUVEAU
      blurBg: "bg-purple-600/60"
  },
  "sunflower": {
      primary: "bg-yellow-400",
      textOnPrimary: "text-gray-900", // Contraste WCAG respecté !
      accent: "text-yellow-500",
      lightBg: "bg-yellow-100",
      border: "border-yellow-600",    // NOUVEAU
      blurBg: "bg-yellow-600/60"
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
    const paletteKey = data.colorPalette || "sunflower"; 
    const selectedTheme = SAAS_THEMES[paletteKey] || SAAS_THEMES["sunflower"];

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
        templateId: data.templateId || "classic",
        colorPalette: paletteKey,
        fontFamily: data.fontFamily || "font-sans",
        // 🔥 LES COULEURS SONT MAINTENANT PILOTÉES PAR LE DICTIONNAIRE
        colors: {
          primary: selectedTheme.primary,
          textOnPrimary: selectedTheme.textOnPrimary,
          accent: selectedTheme.accent,
          lightBg: selectedTheme.lightBg,
          border: selectedTheme.border, 
          blurBg: selectedTheme.blurBg  
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
      },
      deliveryUrl: data.deliveryUrl || "",
      hours: data.hours || [],
      reviews: {
        googleMapsReviewLink: data.googleMapsUrl || "https://g.page/r/TON_LIEN_DA_AVIS/review",
      },
      loyalty: {
        programName: data.loyaltyProgramName || "Club Fidélité",
        cardDesign: {
          backgroundGradient: data.cardGradient || "from-red-500 to-orange-600",
        },
      },
    };

    console.log(`✅ SaaS : Configuration de "${data.nom}" chargée...`);
    return window.snackConfig;
  } else {
    console.error("❌ Erreur : Snack ID inexistant dans Firestore.");
    return null;
  }
} catch (error) {
  console.error("🔥 Erreur critique chargement SaaS :", error);
}
};