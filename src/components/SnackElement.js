import { LitElement, unsafeCSS } from 'lit';
import tailwindStyles from '../styles.css?inline';

/**
 * Base class for all Snack Web Components.
 * Automatically injects the global Tailwind CSS stylesheet via Constructable Stylesheets.
 */
export class SnackElement extends LitElement {
  static styles = [unsafeCSS(tailwindStyles)];
}
