import { store } from "../core/Store.js";
import fr from "./fr.js";

// Langue par défaut et cache des dictionnaires
const defaultLang = "fr";
const dictionaries = {
  fr: fr
};

let currentLang = defaultLang;

/**
 * Charge dynamiquement un dictionnaire s'il n'est pas déjà en cache.
 * Permet un lazy loading parfait pour Lighthouse.
 */
async function loadDictionary(lang) {
  if (dictionaries[lang]) {
    return dictionaries[lang];
  }

  try {
    let dict;
    if (lang === "en") {
      const module = await import("./en.js");
      dict = module.default;
    } else {
      // Fallback sur le français
      dict = fr;
    }
    dictionaries[lang] = dict;
    return dict;
  } catch (error) {
    console.error(`❌ Impossible de charger la langue "${lang}" :`, error);
    return fr;
  }
}

/**
 * Traduit une clé donnée avec interpolation optionnelle de paramètres.
 * Supporte la notation par points (ex: "navbar.menu").
 */
export function t(key, params = {}) {
  const dict = dictionaries[currentLang] || fr;
  
  // Résolution récursive du chemin par points
  let value = key.split(".").reduce((acc, curr) => {
    return acc && acc[curr] ? acc[curr] : null;
  }, dict);

  // Si non trouvé dans la langue active, tenter un repli sur le français
  if (value === null && currentLang !== "fr") {
    value = key.split(".").reduce((acc, curr) => {
      return acc && acc[curr] ? acc[curr] : null;
    }, fr);
  }

  // Si toujours non trouvé, retourner la clé elle-même
  if (value === null || typeof value !== "string") {
    return key;
  }

  // Interpolation de variables (ex: {count})
  let result = value;
  for (const [paramKey, paramVal] of Object.entries(params)) {
    result = result.replace(new RegExp(`{${paramKey}}`, "g"), paramVal);
  }

  return result;
}

/**
 * Parcourt le DOM pour traduire tous les éléments avec des attributs data-i18n.
 */
export function translateDOM() {
  // Traduction des textes internes
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const translation = t(key);
    if (translation !== key) {
      el.textContent = translation;
    }
  });

  // Traduction des placeholders d'inputs
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    const translation = t(key);
    if (translation !== key) {
      el.placeholder = translation;
    }
  });

  // Traduction des attributs title
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    const translation = t(key);
    if (translation !== key) {
      el.setAttribute("title", translation);
    }
  });

  // Traduction des attributs aria-label
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria-label");
    const translation = t(key);
    if (translation !== key) {
      el.setAttribute("aria-label", translation);
    }
  });
}

/**
 * Modifie la langue active de l'application.
 */
export async function changeLanguage(lang) {
  const targetLang = ["fr", "en"].includes(lang) ? lang : "fr";
  
  // Chargement du dictionnaire requis
  await loadDictionary(targetLang);
  currentLang = targetLang;
  
  // Persistance
  localStorage.setItem("snack_locale", targetLang);
  document.documentElement.setAttribute("lang", targetLang);
  
  // Sync avec le Store s'il a été mis à jour
  if (store.setLocale) {
    store.setLocale(targetLang);
  }
  
  // Mise à jour des boutons de langue (toggle)
  const langBtn = document.getElementById("lang-btn");
  if (langBtn) {
    langBtn.textContent = targetLang === "fr" ? "EN" : "FR";
  }
  const mobileLangText = document.getElementById("mobile-lang-text");
  if (mobileLangText) {
    mobileLangText.textContent = targetLang === "fr" ? "EN" : "FR";
  }
  
  // Traduction du DOM
  translateDOM();
  
  // Notification globale
  window.dispatchEvent(new CustomEvent("snack:locale:changed", { detail: { lang: targetLang } }));
}

/**
 * Initialise le module de traduction.
 */
export async function initI18n() {
  // Détection de la langue
  const urlParams = new URLSearchParams(window.location.search);
  const langQuery = urlParams.get("lang");
  const storedLang = localStorage.getItem("snack_locale");
  const browserLang = navigator.language ? navigator.language.substring(0, 2) : "fr";
  
  const detectedLang = langQuery || storedLang || browserLang || defaultLang;
  const targetLang = ["fr", "en"].includes(detectedLang) ? detectedLang : "fr";
  
  await changeLanguage(targetLang);
  
  // Ré-exécution des traductions lors des mises à jour majeures de l'UI (ex: menu mis à jour)
  document.addEventListener("menu-updated", translateDOM);
  document.addEventListener("cart-updated", translateDOM);
}

// Exposer globalement pour un accès direct depuis d'autres scripts ou le HTML
if (typeof window !== "undefined") {
  window.t = t;
  window.changeLanguage = changeLanguage;
}
