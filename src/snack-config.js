// ============================================================================
// 🎨 LE DICTIONNAIRE DES THÈMES SAAS (Design System Curaté)
// ============================================================================
// Couleurs en HEX — injectées dans les CSS custom properties via applySaaSThemeToHTML.
// Les utilitaires Tailwind bg-primary / text-accent / border-accent / bg-primary-light
// / text-on-primary sont générés par le bloc @theme dans styles.css.
const SAAS_THEMES = {
  "ruby":      { primaryHex: "#dc2626", accentHex: "#dc2626", lightHex: "#fee2e2", onPrimaryHex: "#ffffff" },
  "ocean": { 
    primaryHex: "#0077b6",   // Bleu lagon profond
    accentHex: "#00b4d8",    // Bleu cristal de surface
    lightHex: "#caf0f8",     // Écume / Eau peu profonde
    onPrimaryHex: "#ffffff"  // Texte blanc pur pour le contraste
},
  "forest":    { primaryHex: "#16a34a", accentHex: "#16a34a", lightHex: "#dcfce7", onPrimaryHex: "#ffffff" },
  "midnight":  { primaryHex: "#4c1d95", accentHex: "#c084fc", lightHex: "#f3e9ff", onPrimaryHex: "#ffffff" },
  "sunflower": { primaryHex: "#eab308", accentHex: "#ca8a04", lightHex: "#fef9c3", onPrimaryHex: "#111827" },
};

window.loadSnackConfig = async (db, snackId) => {
try {
  // 🚀 Cache en mémoire : évite une lecture Firestore si le snack est déjà chargé
  if (window.snackConfig?.identity?.id === snackId) {
    return window.snackConfig;
  }

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
      },
      deliveryUrl: data.deliveryUrl || "",
      hours: data.hours || [],
      reviews: {
        googleMapsReviewLink: data.googleMapsUrl || "https://g.page/r/TON_LIEN_DA_AVIS/review",
      },
      loyalty: {
        programName: data.loyaltyProgramName || "Club Fidélité",
        cardDesign: {
          backgroundGradient: data.cardGradient || "from-primary to-gray-900",
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