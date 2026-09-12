import { LitElement, unsafeCSS } from 'lit';
import tailwindStyles from '../styles.css?inline';

/**
 * Base class for all Snack Web Components.
 * Automatically injects the global Tailwind CSS stylesheet via Constructable Stylesheets.
 */
export class SnackElement extends LitElement {
  static styles = [unsafeCSS(tailwindStyles)];

  connectedCallback() {
    super.connectedCallback();
    this._onLocaleChanged = () => this.requestUpdate();
    window.addEventListener('snack:locale:changed', this._onLocaleChanged);
    document.addEventListener('language-changed', this._onLocaleChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onLocaleChanged) {
      window.removeEventListener('snack:locale:changed', this._onLocaleChanged);
      document.removeEventListener('language-changed', this._onLocaleChanged);
    }
  }
}
