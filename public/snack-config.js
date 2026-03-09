window.loadSnackConfig = async (db, snackId) => {
  try {
    const { doc, getDoc } = window.fs; // Utilisation des outils globaux

    const snackRef = doc(db, "snacks", snackId);
    const snackSnap = await getDoc(snackRef);

    if (snackSnap.exists()) {
      const data = snackSnap.data();

      // 🪄 ON REMPLACE LA CONFIG "EN DUR" PAR LES DONNÉES FIRESTORE
      window.snackConfig = {
        identity: {
          id: snackId,
          name: data.nom || "Snack Sans Nom",
          description: data.description || "",
          logoUrl: data.logoUrl || "./assets/logo.webp",
          heroImg: data.heroImg || "./assets/heroImg.webp",
          currency: data.currency || "€",
        },
        contact: {
          phone: data.phoneNumber || "",
          email: data.email || "",
          // On reconstruit l'objet adresse pour updateUI
          address: {
            street: data.street || "",
            zip: data.zipcode || "",
            city: data.city || "",
          },
          // Très important pour ta fonction updateUI
          socials: {
            instagram: data.instagram || "",
            facebook: data.facebook || "",
            tiktok: data.tiktok || "",
          },
        },
        theme: {
          templateId: data.templateId || "neon-vibes",
          colors: {
            primary: data.primaryColor || "bg-red-600",
            accent: data.accentColor || "text-red-500",
          },
        },
        // Gestion des fonctionnalités (SaaS)
        features: {
          // Si la DB a une valeur on la prend, SINON on met "true" par défaut
          enableOnlineOrder:
            data.enableOnlineOrder !== undefined
              ? data.enableOnlineOrder
              : true,
          enableDelivery:
            data.enableDelivery !== undefined ? data.enableDelivery : false,
          enableClickAndCollect:
            data.enableClickAndCollect !== undefined
              ? data.enableClickAndCollect
              : true,
          enableLoyaltyCard:
            data.enableLoyaltyCard !== undefined
              ? data.enableLoyaltyCard
              : true,
          maintenanceMode:
            data.maintenanceMode !== undefined ? data.maintenanceMode : false,
        },
        // On récupère tes horaires Firestore
        hours: data.hours || [],
        reviews: {
    googleMapsReviewLink: "https://g.page/r/TON_LIEN_DA_AVIS/review"},
        loyalty: {
          programName: data.loyaltyProgramName || "Club Fidélité",
          cardDesign: {
            backgroundGradient:
              data.cardGradient || "from-red-500 to-orange-600",
          },
        },
      };

      console.log(`✅ SaaS : Configuration de "${data.nom}" chargée.`);
      return window.snackConfig;
    } else {
      console.error("❌ Erreur : Snack ID inexistant dans Firestore.");
      return null;
    }
  } catch (error) {
    console.error("🔥 Erreur critique chargement SaaS :", error);
  }
};
