import { html } from 'lit';
import { SnackElement } from './SnackElement.js';

export class SnackBadge extends SnackElement {
  static properties = {
    type: { type: String }, // 'vegan', 'spicy', 'sold-out', ou texte brut
    text: { type: String }
  };

  constructor() {
    super();
    this.type = 'default';
    this.text = '';
  }

  render() {
    // Styles par défaut
    let badgeClasses = "inline-flex items-center justify-center px-3 py-1.5 rounded-2xl text-[10px] font-black uppercase tracking-tighter shadow-sm backdrop-blur";
    let badgeText = this.text || this.type;

    // Variante selon le type
    if (this.type === 'vegan') {
      badgeClasses += " bg-green-500/90 text-white";
      badgeText = this.text || "Vegan";
    } else if (this.type === 'spicy') {
      badgeClasses += " bg-orange-500/90 text-white";
      badgeText = this.text || "Épicé";
    } else if (this.type === 'sold-out') {
      badgeClasses += " bg-red-600/90 text-white absolute top-3 right-3";
      badgeText = this.text || "Épuisé";
    } else {
      badgeClasses += " bg-gray-900/90 text-white absolute top-3 right-3";
    }

    return html`
      <span class="${badgeClasses}">
        ${badgeText}
      </span>
    `;
  }
}

// Enregistrement du composant dans le CustomElementRegistry
customElements.define('snack-badge', SnackBadge);
