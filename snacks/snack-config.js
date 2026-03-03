const snackConfig = {
    // -------------------------------------------------------------------------
    // 1. IDENTITÉ & SEO (Marketing)
    // -------------------------------------------------------------------------
    identity: {
        name: "O'Tacos Fusion",
        slug: "otacos-fusion-lyon", // Pour l'URL future
        tagline: "Le goût de l'authenticité, la rapidité en plus.",
        description: "Meilleurs Tacos de Lyon. Sauces maison et viandes fraîches. Commandez en ligne ou emportez.",
        logoUrl: "./assets/logo.png",
        favicon: "./assets/favicon.ico",
        currency: "€",
        lang: "fr_FR"
    },

    // -------------------------------------------------------------------------
    // 2. UI & THEME (Tailwind & Design System)
    // -------------------------------------------------------------------------
    theme: {
        // Choix du layout global (ex: 'neon', 'minimal', 'rustic')
        templateId: "neon-vibes", 
        
        // Palette de couleurs (Classes Tailwind ou Hex)
        colors: {
            primary: "bg-red-600", // Boutons, actions
            secondary: "bg-yellow-400", // Accents, prix
            background: "bg-gray-900", // Fond global
            textMain: "text-white",
            textMuted: "text-gray-400",
            cardBackground: "bg-gray-800"
        },
        
        // Configuration des polices
        fonts: {
            heading: "font-oswald", // Google Font à charger
            body: "font-roboto"
        },

        // Rayon des bordures (rounded-md, rounded-full, etc.)
        borderRadius: "rounded-lg"
    },

    // -------------------------------------------------------------------------
    // 3. FONCTIONNALITÉS (Feature Flags)
    // Permet d'activer/désactiver des modules sans toucher au code
    // -------------------------------------------------------------------------
    features: {
        enableOnlineOrder: true,      // Panier d'achat actif ?
        enableDelivery: false,        // Livraison disponible ?
        enableClickAndCollect: true,  // Retrait sur place ?
        enableLoyaltyCard: true,      // Afficher la section fidélité ?
        maintenanceMode: false        // Si true, affiche une page "Bientôt de retour"
    },

    // -------------------------------------------------------------------------
    // 4. CARTE DE FIDÉLITÉ VIRTUELLE (Le Futur !)
    // Structure prête pour Firebase Auth
    // -------------------------------------------------------------------------
    loyalty: {
        programName: "Team Fusion Club",
        cardDesign: {
            // Un dégradé CSS pour la carte virtuelle
            backgroundGradient: "from-red-500 to-orange-600",
            textColor: "text-white"
        },
        rules: {
            pointName: "TacoPoints",
            earnRate: 1, // 1€ dépensé = 1 point gagné
            signupBonus: 10 // Points offerts à l'inscription
        },
        rewards: [
            // Ce que le client peut débloquer
            {
                id: "free_drink",
                title: "Boisson 33cl Offerte",
                cost: 50, // points
                icon: "🥤"
            },
            {
                id: "free_tacos_m",
                title: "Tacos M Offert",
                cost: 150, // points
                icon: "🌮"
            },
            {
                id: "vip_status",
                title: "Menu XL au prix du M",
                cost: 300, // points
                icon: "👑"
            }
        ]
    },

    // -------------------------------------------------------------------------
    // 5. CONTACT & INFOS PRATIQUES
    // -------------------------------------------------------------------------
    contact: {
        phone: "04 78 00 00 00",
        email: "hello@otacosfusion.fr",
        address: {
            street: "12 Rue de la République",
            city: "Lyon",
            zip: "69002",
            googleMapsUrl: "https://maps.google.com/..."
        },
        socials: {
            instagram: "@otacosfusion",
            tiktok: "@otacosfusion_off",
            facebook: "OTacosFusionLyon"
        }
    },

    // -------------------------------------------------------------------------
    // 6. HORAIRES (Structure précise)
    // -------------------------------------------------------------------------
    hours: [
        { day: "Lundi", open: "11:00", close: "23:00", closed: false },
        { day: "Mardi", open: "11:00", close: "23:00", closed: false },
        { day: "Mercredi", open: "11:00", close: "23:00", closed: false },
        { day: "Jeudi", open: "11:00", close: "00:00", closed: false },
        { day: "Vendredi", open: "11:00", close: "01:00", closed: false }, // Nocturne
        { day: "Samedi", open: "11:00", close: "01:00", closed: false },
        { day: "Dimanche", open: "12:00", close: "23:00", closed: false }
    ],

    // -------------------------------------------------------------------------
    // 7. LE MENU (Données structurées)
    // -------------------------------------------------------------------------
    menu: {
        categories: [
            {
                id: "tacos",
                title: "Nos Tacos",
                icon: "🌮", // Emoji ou SVG path
                items: [
                    {
                        id: "t_chicken",
                        name: "Le Chicken",
                        description: "Poulet mariné, sauce fromagère secrète.",
                        price: 6.50,
                        image: "assets/products/tacos-chicken.jpg",
                        tags: ["Populaire", "Halal"], // Badges marketing
                        allergens: ["Lait", "Gluten"]
                    },
                    {
                        id: "t_mixte",
                        name: "Le Mixte",
                        description: "Poulet & Viande hachée.",
                        price: 7.50,
                        image: "assets/products/tacos-mix.jpg",
                        tags: [],
                        allergens: ["Lait", "Gluten"]
                    }
                ]
            },
            {
                id: "sides",
                title: "Accompagnements",
                icon: "🍟",
                items: [
                    {
                        id: "frites_cheddar",
                        name: "Frites Cheddar Bacon",
                        price: 3.50,
                        image: "assets/products/fries.jpg"
                    }
                ]
            }
        ]
    }
};

// Export pour utilisation dans app.js
if (typeof module !== 'undefined') module.exports = snackConfig;