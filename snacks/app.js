
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(() => console.log("PWA Service Worker enregistré."))
        .catch(err => console.error("Erreur SW:", err));
}
document.addEventListener('DOMContentLoaded', () => {
    // Vérification de sécurité
    if (typeof snackConfig === 'undefined') {
        console.error("Erreur critique : Fichier de config introuvable.");
        return;
    }

    const cfg = snackConfig; // Raccourci

    // ============================================================
    // 1. CONFIGURATION DU THÈME & SEO
    // ============================================================
    document.title = `${cfg.identity.name} - ${cfg.identity.tagline}`;
    
    // Application des couleurs dynamiques (CSS Variables pour plus de souplesse)
    // Note: Tailwind pur nécessite une config build, ici on injecte des classes directes
    const body = document.body;
    
    // Si le thème est "neon", on force le fond sombre
    if (cfg.theme.templateId === 'neon-vibes') {
        body.classList.add('bg-gray-900', 'text-white');
        document.getElementById('navbar').classList.add('bg-gray-900/90', 'backdrop-blur');
    } else {
        body.classList.add('bg-gray-50', 'text-gray-900');
        document.getElementById('navbar').classList.add('bg-white/90', 'backdrop-blur', 'shadow-sm');
    }

    // ============================================================
    // 2. HEADER & NAV
    // ============================================================
    document.getElementById('nav-name').innerText = cfg.identity.name;
    document.getElementById('hero-title').innerText = cfg.identity.name;
    document.getElementById('hero-desc').innerText = cfg.identity.description;
    
    // Logo
    if(cfg.identity.logoUrl) {
        const logo = document.getElementById('nav-logo');
        logo.src = cfg.identity.logoUrl;
        logo.classList.remove('hidden');
    }

    // Boutons d'action (Couleur Primaire)
    const primaryBtns = [document.getElementById('cta-nav'), document.getElementById('cta-hero')];
    primaryBtns.forEach(btn => {
        // On nettoie les classes existantes et on ajoute celles de la config
        // Astuce : On utilise la chaîne de caractères de la config (ex: "bg-red-600")
        btn.className += ` ${cfg.theme.colors.primary} text-white`;
    });

    // Image de fond Hero
    // Pour la démo, on utilise une image placeholder si pas définie
    const heroBg = cfg.theme.heroImage || "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?ixlib=rb-1.2.1&auto=format&fit=crop&w=1950&q=80";
    document.getElementById('hero').style.backgroundImage = `url('${heroBg}')`;

    // Diviseur de section (Couleur Secondaire)
    document.getElementById('section-divider').className += ` ${cfg.theme.colors.secondary}`;

    // ============================================================
    // 3. GÉNÉRATION DU MENU
    // ============================================================
    const menuContainer = document.getElementById('menu-container');
    
    cfg.menu.categories.forEach(cat => {
        // Création de la section catégorie
        const catSection = document.createElement('div');
        catSection.innerHTML = `
            <div class="flex items-center gap-3 mb-8">
                <span class="text-3xl">${cat.icon || ''}</span>
                <h3 class="text-2xl font-bold uppercase tracking-wide border-b-2 ${cfg.theme.colors.secondary.replace('bg-', 'border-')} pb-2">
                    ${cat.title}
                </h3>
            </div>
            <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                ${cat.items.map(item => createProductCard(item, cfg)).join('')}
            </div>
        `;
        menuContainer.appendChild(catSection);
    });

    // ============================================================
    // 4. FIDÉLITÉ & FEATURES
    // ============================================================
    if (cfg.features.enableLoyaltyCard) {
        const loyaltySection = document.getElementById('loyalty');
        loyaltySection.classList.remove('hidden');
        document.getElementById('nav-loyalty-link').classList.remove('hidden');
        document.getElementById('nav-loyalty-link').classList.add('block');
        
        // Style de la carte
        const card = document.getElementById('loyalty-card');
        card.className += ` bg-gradient-to-r ${cfg.loyalty.cardDesign.backgroundGradient}`;
        
        document.getElementById('loyalty-title').innerText = cfg.loyalty.programName;
    }

    // ============================================================
    // 5. FOOTER & HORAIRES
    // ============================================================
    document.getElementById('footer-brand').innerText = cfg.identity.name;
    document.getElementById('footer-address').innerHTML = `${cfg.contact.address.street}<br>${cfg.contact.address.zip} ${cfg.contact.address.city}`;
    document.getElementById('footer-phone').innerText = cfg.contact.phone;

    // Horaires avec mise en surbrillance du jour actuel
    const todayIndex = new Date().getDay(); // 0 = Dimanche, 1 = Lundi...
    // Mapping JS (0=Dim) vers notre config (Lundi=0 dans le tableau si on commence lundi ?)
    // Simplification : on suppose que le tableau config.hours commence Lundi index 0
    const todayMap = todayIndex === 0 ? 6 : todayIndex - 1; 

    const hoursList = document.getElementById('hours-list');
    cfg.hours.forEach((h, index) => {
        const isToday = index === todayMap;
        const li = document.createElement('li');
        li.className = isToday ? `font-bold ${cfg.theme.colors.secondary.replace('bg-', 'text-')}` : '';
        li.innerHTML = `<span class="inline-block w-24">${h.day}</span> ${h.closed ? 'Fermé' : h.open + ' - ' + h.close}`;
        hoursList.appendChild(li);
        
        // Check statut ouvert/fermé pour le Hero
        if (isToday) {
            const statusBadge = document.getElementById('hero-status');
            // Logique simple (à améliorer avec comparaison d'heures réelles)
            if (h.closed) {
                statusBadge.innerText = "Fermé Aujourd'hui";
                statusBadge.classList.add('bg-red-500');
            } else {
                statusBadge.innerText = `Ouvert : ${h.open} - ${h.close}`;
                statusBadge.classList.add('bg-green-500');
            }
        }
    });

    // Socials
    const socialContainer = document.getElementById('socials-container');
    if(cfg.contact.socials.instagram) socialContainer.innerHTML += `<a href="#"><i class="fab fa-instagram hover:text-pink-500 transition"></i></a>`;
    if(cfg.contact.socials.facebook) socialContainer.innerHTML += `<a href="#"><i class="fab fa-facebook hover:text-blue-500 transition"></i></a>`;

    // Fin du chargement
    body.classList.remove('loading');
    body.classList.add('loaded');
});

// Helper : Créer une carte produit
function createProductCard(item, cfg) {
    const cardBg = cfg.theme.templateId === 'neon-vibes' ? 'bg-gray-800' : 'bg-white shadow-lg';
    
    return `
    <div class="${cardBg} ${cfg.theme.borderRadius} overflow-hidden group hover:shadow-2xl transition duration-300 transform hover:-translate-y-1">
        <div class="h-48 overflow-hidden relative">
            <img src="${item.image}" alt="${item.name}" class="w-full h-full object-cover transition duration-500 group-hover:scale-110">
            ${item.tags && item.tags.length > 0 ? 
                `<span class="absolute top-2 right-2 ${cfg.theme.colors.secondary} text-xs font-bold px-2 py-1 rounded-full uppercase text-black">
                    ${item.tags[0]}
                </span>` : ''
            }
        </div>
        <div class="p-6">
            <div class="flex justify-between items-start mb-2">
                <h4 class="text-xl font-bold">${item.name}</h4>
                <span class="text-xl font-bold ${cfg.theme.colors.secondary.replace('bg-', 'text-')}">${item.price.toFixed(2)}${cfg.identity.currency}</span>
            </div>
            <p class="text-sm opacity-70 mb-4 line-clamp-2">${item.description}</p>
            <button class="w-full py-2 border border-gray-500 rounded hover:${cfg.theme.colors.primary} hover:border-transparent hover:text-white transition">
                Ajouter
            </button>
        </div>
    </div>
    `;

    
}