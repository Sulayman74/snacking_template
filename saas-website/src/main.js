/**
 * 🚀 Snack SaaS Pro — Logique Interactive
 * Simulateur ROI, Showcase Démo, Accordéon FAQ, Navigation
 */

// 1. Initialisation de la démo officielle autorisée : O'Tacos Fusion
const SHOWCASE_DATA = {
  menu: {
    title: "Menu Digital & Customisation Tacos",
    category: "Expérience Commande Client",
    desc: "Menu interactif avec customisation poussée : choix de la taille (M, L, XL, XXL), sélection des viandes halal marinées, sauces signatures, sauces fromagères et suppléments gourmands calculés en temps réel.",
    url: "https://snacking-template.web.app",
    tags: ["Customisation Multilevel", "Viandes Halal", "Suppléments Dynamiques", "Calcul Prix Direct"],
    color: "#F97316",
    badge: "Parcours Commande",
  },
  fidelite: {
    title: "Carte de Fidélité 3D Holographique",
    category: "Fidélisation & Rétention Client",
    desc: "Effet 'Waouh' garanti pour vos clients : une carte bancaire 3D interactive animée par gyroscope sur mobile. Vos habitués cumulent des points automatiquement et présentent leur QR code au comptoir pour leurs réductions.",
    url: "https://snacking-template.web.app",
    tags: ["Carte CB 3D Réaliste", "QR Code Scannable", "Cagnotte Fidélité", "Sans Carte Papier"],
    color: "#0077b6",
    badge: "Fidélité Gamifiée",
  },
  paiement: {
    title: "Paiement Express & Retrait Précis",
    category: "Tunnel d'Achat Sécurisé",
    desc: "Tunnel d'achat rapide pensé pour convertir : compatibilité Apple Pay, Google Pay et Stripe 3D-Secure. Le client choisit son créneau de retrait pour récupérer sa commande chaude sans faire la queue.",
    url: "https://snacking-template.web.app",
    tags: ["Apple Pay & Google Pay", "Stripe Sécurisé 3D-Secure", "Créneau Retrait", "Reçu par Email"],
    color: "#10B981",
    badge: "Conversion Maximale",
  },
  pwa: {
    title: "Application Mobile PWA Installable",
    category: "Technologie Mobile Propriétaire",
    desc: "Vos clients installent votre application directement sur leur écran d'accueil sans passer par l'App Store ni Google Play. Évitez les 30% de commission prélevés par Apple et Google et envoyez des notifications push gratuites.",
    url: "https://snacking-template.web.app",
    tags: ["Installation 1 Clic", "Écran d'Accueil", "Notifications Push", "0% Frais App Store"],
    color: "#8B5CF6",
    badge: "PWA Mobile",
  },
};

// 2. Gestion du Simulateur de Rentabilité (ROI - 3 Modèles Comparés)
function initRoiCalculator() {
  const slider = document.getElementById("ca-slider");
  const caDisplay = document.getElementById("ca-display");
  const uberFeesDisplay = document.getElementById("uber-fees-display");
  const starterFeesDisplay = document.getElementById("starter-fees-display");
  const starterSavingsDisplay = document.getElementById("starter-savings-display");
  const proFeesDisplay = document.getElementById("pro-fees-display");
  const proSavingsDisplay = document.getElementById("pro-savings-display");
  const netSavingsDisplay = document.getElementById("net-savings-display");
  const annualSavingsDisplay = document.getElementById("annual-savings-display");
  const adviceBox = document.getElementById("simulator-advice-box");
  const starterCard = document.getElementById("tier-starter-card");
  const proCard = document.getElementById("tier-pro-card");

  if (!slider) return;

  const updateCalculations = () => {
    const ca = Number(slider.value) || 10000;
    
    // 1. Uber Eats / Deliveroo (30%)
    const uberFees = Math.round(ca * 0.30);

    // 2. SnackSaaS Starter (8% sans abonnement fixe)
    const starterFees = Math.round(ca * 0.08);
    const starterSavings = Math.max(0, uberFees - starterFees);

    // 3. SnackSaaS Pro (89 € fixe · 0% commission)
    const proFees = 89;
    const proSavings = Math.max(0, uberFees - proFees);

    // Comparaison Starter vs Pro
    const isProOptimal = starterFees >= 89;
    const diffStarterPro = Math.abs(starterFees - 89);

    const fmt = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

    if (caDisplay) caDisplay.textContent = fmt(ca);
    if (uberFeesDisplay) uberFeesDisplay.textContent = fmt(uberFees);
    if (starterFeesDisplay) starterFeesDisplay.textContent = fmt(starterFees);
    if (starterSavingsDisplay) starterSavingsDisplay.innerHTML = `Économie : <strong>+${fmt(starterSavings)} / mois</strong> vs Uber`;

    if (proFeesDisplay) proFeesDisplay.textContent = "89 €";
    if (proSavingsDisplay) proSavingsDisplay.innerHTML = `Économie : <strong>+${fmt(proSavings)} / mois</strong> vs Uber`;

    // Synthèse globale
    const bestSavings = isProOptimal ? proSavings : starterSavings;
    if (netSavingsDisplay) netSavingsDisplay.textContent = `+${fmt(bestSavings)}`;
    if (annualSavingsDisplay) annualSavingsDisplay.textContent = fmt(bestSavings * 12);

    // Conseil dynamique et mise en avant de la formule optimale
    if (isProOptimal) {
      if (proCard) proCard.classList.add("highlight-card");
      if (starterCard) starterCard.classList.remove("highlight-card");
      if (adviceBox) {
        adviceBox.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.4rem;">🚀</span>
            <div>
              <strong style="color: #34D399; font-size: 0.95rem;">Volume optimal atteint pour le Forfait Pro (89 €) !</strong>
              <div style="color: #9CA3AF; font-size: 0.85rem; margin-top: 3px;">
                À 8%, vous paieriez ${fmt(starterFees)}/mois. En choisissant le <strong>Forfait Pro (89 € · 0%)</strong>, vous économisez <strong>+${fmt(diffStarterPro)} de plus chaque mois</strong> tout en gardant 100% de vos ventes !
              </div>
            </div>
          </div>
        `;
      }
    } else {
      if (starterCard) starterCard.classList.add("highlight-card");
      if (proCard) proCard.classList.remove("highlight-card");
      if (adviceBox) {
        adviceBox.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.4rem;">🎁</span>
            <div>
              <strong style="color: #FBBF24; font-size: 0.95rem;">Formule Starter (8%) recommandée pour démarrer :</strong>
              <div style="color: #9CA3AF; font-size: 0.85rem; margin-top: 3px;">
                Pour un CA de ${fmt(ca)}, vous ne payez que ${fmt(starterFees)} (et <strong>0 € le 1er mois</strong>). Risque zéro, aucune avance de trésorerie ! Dès que vos ventes dépassent 1 100 €, basculez en Pro en 1 clic.
              </div>
            </div>
          </div>
        `;
      }
    }
  };

  slider.addEventListener("input", updateCalculations);
  updateCalculations();
}

// 3. Gestion du Showcase Démo
function initShowcaseTabs() {
  const tabButtons = document.querySelectorAll("[data-showcase-tab]");
  const titleEl = document.getElementById("showcase-title");
  const catEl = document.getElementById("showcase-cat");
  const descEl = document.getElementById("showcase-desc");
  const tagsEl = document.getElementById("showcase-tags");
  const linkEl = document.getElementById("showcase-link");
  const frameEl = document.getElementById("showcase-frame");

  if (!tabButtons.length) return;

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-showcase-tab");
      const data = SHOWCASE_DATA[key];
      if (!data) return;

      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (titleEl) titleEl.textContent = data.title;
      if (catEl) catEl.textContent = data.category;
      if (descEl) descEl.textContent = data.desc;
      if (linkEl) {
        linkEl.href = data.url;
        linkEl.textContent = "Tester O'Tacos Fusion en direct ↗";
      }

      if (tagsEl) {
        tagsEl.innerHTML = data.tags.map((t) => `<span class="tag">${t}</span>`).join("");
      }

      if (frameEl) {
        frameEl.style.borderColor = data.color;
      }
    });
  });
}

// 4. Accordéon FAQ
function initFaq() {
  const faqItems = document.querySelectorAll(".faq-item");
  faqItems.forEach((item) => {
    const questionBtn = item.querySelector(".faq-question");
    const answer = item.querySelector(".faq-answer");
    if (!questionBtn || !answer) return;

    questionBtn.addEventListener("click", () => {
      const isActive = item.classList.contains("active");

      faqItems.forEach((other) => {
        other.classList.remove("active");
        const otherAnswer = other.querySelector(".faq-answer");
        if (otherAnswer) otherAnswer.style.maxHeight = null;
      });

      if (!isActive) {
        item.classList.add("active");
        answer.style.maxHeight = answer.scrollHeight + 30 + "px";
      }
    });
  });
}

// 5. Navigation Mobile (Optimisée iPhone & Tactile)
function initMobileMenu() {
  const toggle = document.querySelector(".mobile-menu-toggle");
  const navWrap = document.querySelector(".navbar-wrap");
  const backdrop = document.getElementById("mobile-menu-backdrop");

  if (!toggle || !navWrap) return;

  const closeMenu = () => {
    navWrap.classList.remove("mobile-menu-open");
    document.body.classList.remove("mobile-nav-open");
    toggle.textContent = "☰";
    toggle.setAttribute("aria-expanded", "false");
  };

  const openMenu = () => {
    navWrap.classList.add("mobile-menu-open");
    document.body.classList.add("mobile-nav-open");
    toggle.textContent = "✕";
    toggle.setAttribute("aria-expanded", "true");
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = navWrap.classList.contains("mobile-menu-open");
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Fermeture au clic sur le fond flouté
  if (backdrop) {
    backdrop.addEventListener("click", closeMenu);
  }

  // Fermeture avec la touche Échap
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  // Fermeture au clic sur un lien du menu
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });
}

// 6. Gestion du Formulaire Lead vers WhatsApp Direct (06 17 46 22 08)
function initLeadForm() {
  const form = document.getElementById("lead-form");
  if (!form) return;

  const MY_WHATSAPP_NUMBER = "33617462208"; // 06 17 46 22 08

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const resto = document.getElementById("lead-resto")?.value.trim() || "";
    const phone = document.getElementById("lead-phone")?.value.trim() || "";
    const city = document.getElementById("lead-city")?.value.trim() || "";
    const formula = document.getElementById("lead-formula")?.value || "Starter (8%)";
    const menu = document.getElementById("lead-menu")?.value.trim() || "Non renseigné";
    const submitBtn = document.getElementById("lead-submit-btn");
    const statusBox = document.getElementById("lead-status");

    // Message pré-rempli structuré et courtois sur WhatsApp
    const message = `Bonjour ! Je souhaite lancer mon application restaurant Click & Collect avec SnackSaaS Pro.

📋 Mes coordonnées :
• Restaurant : ${resto}
• Ville : ${city}
• Mon téléphone : ${phone}
• Formule souhaitée : ${formula}
• Lien menu / Uber Eats : ${menu}

Pouvons-nous échanger sur la mise en place de ma démo gratuite sous 24h ? Merci !`;

    const whatsappUrl = `https://wa.me/${MY_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>⏳ Ouverture de WhatsApp en cours...</span>`;
    }

    if (statusBox) {
      statusBox.style.display = "block";
      statusBox.style.background = "rgba(16, 185, 129, 0.15)";
      statusBox.style.border = "1px solid rgba(16, 185, 129, 0.4)";
      statusBox.style.color = "#34D399";
      statusBox.innerHTML = `
        <strong>✅ Redirection vers WhatsApp en cours...</strong><br>
        <span style="font-size: 0.85rem; color: #D1D5DB; display: block; margin-top: 4px;">
          Si WhatsApp ne s'ouvre pas automatiquement, <a href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" style="color: #60A5FA; text-decoration: underline; font-weight: bold;">cliquez ici pour ouvrir directement la conversation</a>.
        </span>
      `;
    }

    // Ouvrir WhatsApp
    setTimeout(() => {
      window.open(whatsappUrl, "_blank");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>💬 Envoyer ma demande sur WhatsApp (06 17 46 22 08) →</span>`;
      }
    }, 500);
  });
}

// 7. Gestionnaire de Thème Dark / Light avec persistance
function initThemeToggle() {
  const toggleBtn = document.getElementById("theme-toggle-btn");
  if (!toggleBtn) return;

  const applyTheme = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch (e) {}
    const label = theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre";
    toggleBtn.setAttribute("aria-label", label);
    toggleBtn.setAttribute("title", label);
  };

  toggleBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
  });
}

// 8. Barre de progression de lecture au scroll
function initScrollProgressBar() {
  const bar = document.getElementById("scroll-progress");
  if (!bar) return;

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const h = document.documentElement;
        const b = document.body;
        const st = h.scrollTop || b.scrollTop;
        const sh = h.scrollHeight || b.scrollHeight;
        const ch = h.clientHeight;
        const percent = ((st) / (sh - ch)) * 100;
        bar.style.width = Math.min(100, Math.max(0, percent)) + "%";
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

// 9. Effet Spotlight Souris & Inclinaison 3D Interactive (Anti-cliché IA)
function initMouseSpotlightAndTilt() {
  // 1. Mouse Spotlight sur les cartes
  const spotlightCards = document.querySelectorAll(
    ".bento-card, .pricing-card, .simulator-card, .showcase-display, .comparison-card, .stat-card, #lead-form, .calculator-box, .calc-tier-card"
  );

  spotlightCards.forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty("--mouse-x", `${x}px`);
      card.style.setProperty("--mouse-y", `${y}px`);
    });
  });

  // 2. 3D Tilt interactif doux sur le Mockup Mobile du Hero et la carte Pro
  const tiltElements = document.querySelectorAll(".phone-mockup, .pricing-card.featured");
  tiltElements.forEach((el) => {
    el.style.transformStyle = "preserve-3d";
    el.style.transition = "transform 0.15s ease-out, box-shadow 0.25s ease";

    el.addEventListener("mousemove", (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      // Rotation maximale douce
      el.style.transform = `perspective(1000px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)`;
    });

    el.addEventListener("mouseleave", () => {
      el.style.transform = "";
    });
  });
}

// 10. Animations d'apparition fluides via IntersectionObserver
function initScrollReveal() {
  const revealElements = document.querySelectorAll(
    ".reveal-on-scroll, .reveal-stagger, .reveal-left, .reveal-right"
  );

  if (!revealElements.length) return;

  if (!("IntersectionObserver" in window)) {
    revealElements.forEach((el) => el.classList.add("revealed"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          obs.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.1,
      rootMargin: "0px 0px -40px 0px",
    }
  );

  revealElements.forEach((el) => observer.observe(el));
}

// Boot
document.addEventListener("DOMContentLoaded", () => {
  initRoiCalculator();
  initShowcaseTabs();
  initFaq();
  initMobileMenu();
  initLeadForm();
  initThemeToggle();
  initScrollProgressBar();
  initMouseSpotlightAndTilt();
  initScrollReveal();
});
