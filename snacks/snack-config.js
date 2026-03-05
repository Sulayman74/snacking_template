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
    //  Livraison? (Marketing)
    // ------ exemple...
    deliveryUrl: "https://www.ubereats.com/fr/store/...",

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
        borderRadius: "rounded-lg",
        heroImage: "./assets/heroImg.webp"
    },

    // -------------------------------------------------------------------------
    // 3. FONCTIONNALITÉS (Feature Flags)
    // Permet d'activer/désactiver des modules sans toucher au code
    // -------------------------------------------------------------------------
    features: {
        enableOnlineOrder: true,      // Panier d'achat actif ?
        enableDelivery: false,        // Livraison disponible ?
        enableClickAndCollect: true,  // Retrait sur place ?
        enableLoyaltyCard: false,      // Afficher la section fidélité ?
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
            googleMapsUrl: null
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
        { day: "Mercredi", open: "11:00", close: "23:00", closed: true },
        { day: "Jeudi", open: "11:00", close: "00:00", closed: false },
        { day: "Vendredi", open: "11:00", close: "01:00", closed: false }, // Nocturne
        { day: "Samedi", open: "11:00", close: "01:00", closed: false },
        { day: "Dimanche", open: "12:00", close: "23:00", closed: false }
    ],

   // -------------------------------------------------------------------------
    // 7. LE MENU (Données structurées - 16 Items de test)
    // -------------------------------------------------------------------------
    menu: {
        categories: [
            // CATÉGORIE 1 : TACOS
            {
                id: "tacos",
                title: "Nos Tacos",
                icon: "🌮",
                items: [
                    {
                        id: "t_chicken",
                        name: "Le Chicken",
                        description: "Poulet mariné, sauce fromagère secrète.",
                        price: 8.50,
                        image: "./assets/tacos.webp",
                        tags: ["Populaire", "Halal"], // <--- BEST SELLER 1
                        allergens: ["Lait", "Gluten"]
                    },
                    {
                        id: "t_viande",
                        name: "Le Carnivore",
                        description: "Double viande hachée, cordon bleu.",
                        price: 9.50,
                        image: "./assets/tacos.webp",
                        tags: ["Nouveau"],
                        allergens: ["Lait", "Gluten"]
                    },
                    {
                        id: "t_vege",
                        name: "Le Végé",
                        description: "Falafels, chèvre, légumes grillés.",
                        price: 7.50,
                        image: "./assets/tacos.webp",
                        tags: ["Végétarien"],
                        allergens: ["Lait", "Gluten"]
                    },
                    {
                        id: "t_lyon",
                        name: "Le Lyonnais",
                        description: "Steak, tenders, sauce algérienne.",
                        price: 8.90,
                        image: "./assets/tacos.webp",
                        tags: [],
                        allergens: ["Lait"]
                    }
                ]
            },
            
            // CATÉGORIE 2 : BURGERS
            {
                id: "burgers",
                title: "Burgers",
                icon: "🍔",
                items: [
                    {
                        id: "b_boss",
                        name: "Le Big Boss",
                        description: "Triple steak, cheddar fondant, bacon.",
                        price: 10.50,
                        image: "./assets/sandwich.webp", // Image temporaire
                        tags: ["Populaire"], // <--- BEST SELLER 2
                        allergens: ["Sésame", "Lait"]
                    },
                    {
                        id: "b_cheese",
                        name: "Classic Cheese",
                        description: "L'indémodable steak cheddar.",
                        price: 5.50,
                        image: "./assets/sandwich.webp",
                        tags: [],
                        allergens: ["Sésame", "Lait"]
                    },
                    {
                        id: "b_chicken",
                        name: "Chicken Tower",
                        description: "Filet de poulet pané croustillant.",
                        price: 7.00,
                        image: "./assets/sandwich.webp",
                        tags: [],
                        allergens: ["Sésame", "Gluten"]
                    }
                ]
            },

            // CATÉGORIE 3 : WRAPS & SANDWICHS
            {
                id: "wraps",
                title: "Wraps & Sandwichs",
                icon: "🌯",
                items: [
                    {
                        id: "w_chevre",
                        name: "Wrap Chèvre Miel",
                        description: "Douceur du miel et caractère du chèvre.",
                        price: 6.00,
                        image: "./assets/sandwich.webp",
                        tags: [],
                        allergens: ["Lait"]
                    },
                    {
                        id: "s_parisien",
                        name: "Le Parisien",
                        description: "Jambon crudités mayonnaise.",
                        price: 5.50,
                        image: "./assets/sandwich.webp",
                        tags: [],
                        allergens: ["Gluten"]
                    },
                    {
                        id: "s_thon",
                        name: "Le Thon Mayo",
                        description: "Mélange thon mayonnaise maison.",
                        price: 5.50,
                        image: "./assets/sandwich.webp",
                        tags: [],
                        allergens: ["Poisson"]
                    }
                ]
            },

            // CATÉGORIE 4 : SIDES
            {
                id: "sides",
                title: "A côté",
                icon: "🍟",
                items: [
                    {
                        id: "frites_cheddar",
                        name: "Frites Cheddar Bacon",
                        price: 4.50,
                        image: "assets/frites.webp",
                        tags: ["Populaire"], // <--- BEST SELLER 3
                        allergens: ["Lait"]
                    },
                    {
                        id: "frites_simple",
                        name: "Frites",
                        price: 3.00,
                        image: "assets/frites.webp",
                        tags: [],
                        allergens: []
                    },
                    {
                        id: "nuggets",
                        name: "Nuggets x6",
                        price: 4.00,
                        image: "assets/frites.webp",
                        tags: [],
                        allergens: ["Gluten"]
                    }
                ]
            },

            // CATÉGORIE 5 : BOISSONS & DESSERTS
            {
                id: "drinks",
                title: "Boissons & Douceurs",
                icon: "🥤",
                items: [
                    {
                        id: "coca",
                        name: "Coca-Cola 33cl",
                        description: "L'original.",
                        price: 1.50,
                        image: "assets/heroImg.webp", // Image placeholder
                        tags: [],
                        allergens: []
                    },
                    {
                        id: "tiramisu",
                        name: "Tiramisu Maison",
                        description: "Café ou Speculoos.",
                        price: 3.50,
                        image: "assets/heroImg.webp",
                        tags: ["Fait Maison"],
                        allergens: ["Lait", "Oeuf"]
                    },
                    {
                        id: "cookie",
                        name: "Cookie Pépite",
                        description: "Cuit sur place chaque matin.",
                        price: 2.00,
                        image: "assets/heroImg.webp",
                        tags: [],
                        allergens: ["Gluten", "Oeuf"]
                    }
                ]
            }
        ]
    },
    //  : AVIS ---
    reviews: {
        enable: true,
        // Remplacez par le vrai lien Google Maps du client
        googleMapsReviewLink: "https://search.google.com/local/writereview?placeid=EXAMPLE" 
    },

    //  : FORMULAIRE ---
    form: {
        enable: true,
        title: "Contactez-nous",
        description: "Une question sur les allergènes ou une réservation ?",
        formspreeUrl: "https://formspree.io/f/mykdrzlq"
    },
};

// Export pour utilisation dans app.js
if (typeof module !== 'undefined') module.exports = snackConfig;