/**
 * 🎨 UI — Pont de compatibilité (Phase 3 : SRP & Réactivité)
 * La logique est désormais dans ui/AppUI.js
 */
import { store } from "./core/Store.js";
import { appUI } from "./ui/AppUI.js";

// Exportation globale pour compatibilité avec le reste de l'app
window.applySaaSThemeToHTML = () => appUI.applyTheme(store.state.config);
window.updateUI = () => appUI.updateUI();
window.initAppVisuals = () => appUI.initAppVisuals(store.state.config);
window.switchView = (viewName) => appUI.switchView(viewName);

// Bridge pour les méthodes utilitaires si nécessaire
window.getOpeningStatus = (h) => appUI.getOpeningStatus(h);
