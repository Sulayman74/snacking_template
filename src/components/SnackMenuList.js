import { html } from 'lit';
import { SnackElement } from './SnackElement.js';
import { store } from '../store/Store.js';
import { StoreController } from '../store/StoreController.js';
import './SnackMenuItem.js';

export class SnackMenuList extends SnackElement {
  static properties = {
    searchQuery: { type: String },
    activeCatId: { type: String }
  };

  menuController = new StoreController(this, 'menu-changed');

  constructor() {
    super();
    this.searchQuery = '';
    this.activeCatId = null;
    this.isProgrammaticScroll = false;
    this._spyResumeTimer = null;
    this._handleScroll = this._handleScrollSpy.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    requestAnimationFrame(() => {
      this.scrollContainer = document.getElementById('full-menu');
      if (this.scrollContainer) {
        this.scrollContainer.addEventListener('scroll', this._handleScroll, { passive: true });
        setTimeout(() => this._handleScrollSpy(), 50);
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.scrollContainer) {
      this.scrollContainer.removeEventListener('scroll', this._handleScroll);
    }
  }

  updated() {
    if (window.lucide) {
      window.lucide.createIcons({ root: this.shadowRoot });
    }
  }

  getCategoryName(id) {
    const names = {
      burgers: "🍔 Burgers",
      tacos: "🌯 Tacos",
      drinks: "🥤 Boissons",
      sides: "🍟 Accompagnements",
      desserts: "🍰 Desserts"
    };
    return names[id] || id.charAt(0).toUpperCase() + id.slice(1);
  }

  _handleSearchInput(e) {
    this.searchQuery = e.target.value.toLowerCase();
  }

  _clearSearch() {
    this.searchQuery = '';
    const input = this.shadowRoot.getElementById('menu-search-input');
    if (input) input.value = '';
  }

  setActivePill(activeCatId) {
    this.activeCatId = activeCatId;
    const nav = this.shadowRoot.getElementById("menu-categories-nav");
    if (!nav) return;
    
    // We use setTimeout to let lit re-render with the new activeCatId state first,
    // so we can query the exact pill in the DOM.
    setTimeout(() => {
      const pill = nav.querySelector(`.cat-pill[data-cat-id="${activeCatId}"]`);
      if (pill) {
        const left = pill.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft + pill.offsetWidth / 2 - nav.clientWidth / 2;
        nav.scrollTo({ left, behavior: "smooth" });
      }
    }, 0);
  }

  _scrollToCategory(catId) {
    const target = this.shadowRoot.getElementById(`cat-${catId}`);
    if (target && this.scrollContainer) {
      this.isProgrammaticScroll = true;
      clearTimeout(this._spyResumeTimer);
      this.setActivePill(catId);
      
      const headerHeight = this.shadowRoot.querySelector('.sticky')?.offsetHeight || 120;
      const targetPos = (target.getBoundingClientRect().top - this.scrollContainer.getBoundingClientRect().top) + this.scrollContainer.scrollTop - headerHeight - 10;
      this.scrollContainer.scrollTo({ top: targetPos, behavior: 'smooth' });
      
      this._spyResumeTimer = setTimeout(() => { this.isProgrammaticScroll = false; }, 700);
    }
  }

  _handleScrollSpy() {
    if (this.isProgrammaticScroll) return;
    if (!this.scrollContainer) return;
    
    const sections = this.shadowRoot.querySelectorAll('.menu-section');
    if (sections.length === 0) return;

    const containerRect = this.scrollContainer.getBoundingClientRect();
    const detectionY = containerRect.top + 160;

    let newActiveCatId = sections[0].getAttribute('data-cat-id');
    const scrollPosition = this.scrollContainer.scrollTop + this.scrollContainer.clientHeight;
    const isAtBottom = scrollPosition >= this.scrollContainer.scrollHeight - 100;

    if (isAtBottom) {
      newActiveCatId = sections[sections.length - 1].getAttribute('data-cat-id');
    } else {
      for (let i = sections.length - 1; i >= 0; i--) {
        const rect = sections[i].getBoundingClientRect();
        if (rect.top <= detectionY) {
          newActiveCatId = sections[i].getAttribute('data-cat-id');
          break;
        }
      }
    }

    if (newActiveCatId !== this.activeCatId) {
      this.setActivePill(newActiveCatId);
    }
  }

  render() {
    const menu = store.state.menu || [];
    const categories = [...new Set(menu.map(p => p.categorieId))].filter(Boolean);

    return html`
      <div class="sticky top-0 z-50 bg-accent/40 backdrop-blur-xl border-b border-line shadow-sm">
        <div class="container mx-auto px-4 py-3 flex items-center gap-3">
          <div class="relative flex-1">
            <input type="text" 
                   id="menu-search-input" 
                   placeholder="Un p'tit creux ?" 
                   .value="${this.searchQuery}"
                   @input="${this._handleSearchInput}"
                   class="w-full pl-10 pr-10 py-3 bg-surface-2 border-none rounded-2xl focus:ring-2 focus:ring-primary focus:bg-surface outline-none transition-all text-text font-medium text-sm" />
            <i data-lucide="search" class="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted text-sm"></i>
            ${this.searchQuery ? html`
              <button @click="${this._clearSearch}" class="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text">
                <i data-lucide="x-circle" class="text-lg"></i>
              </button>
            ` : ''}
          </div>
          <button data-action="switch-home" class="w-11 h-11 shrink-0 bg-surface border border-accent rounded-2xl shadow-sm flex items-center justify-center text-text-muted hover:text-danger transition-colors">
            <i data-lucide="x" class="text-lg"></i>
          </button>
        </div>
        
        <div id="menu-categories-nav" class="container mx-auto px-4 pb-2 flex gap-2 overflow-x-auto no-scrollbar -webkit-overflow-scrolling-touch">
          ${categories.map(catId => {
            const isActive = this.activeCatId === catId;
            return html`
              <button class="cat-pill whitespace-nowrap px-4 py-2 rounded-xl font-bold text-sm transition-all active:scale-95 border-2 border-transparent ${isActive ? 'bg-gray-900 text-on-dark' : 'bg-surface-2 text-text-muted'}"
                      data-cat-id="${catId}"
                      @click="${() => this._scrollToCategory(catId)}">
                ${this.getCategoryName(catId)}
              </button>
            `;
          })}
        </div>
      </div>

      <div class="container mx-auto px-4 pt-6 pb-32 md:pb-12">
        ${categories.map(catId => {
          const catProduits = menu.filter(p => 
            p.categorieId === catId && 
            (p.nom.toLowerCase().includes(this.searchQuery) || (p.description || '').toLowerCase().includes(this.searchQuery))
          );

          if (catProduits.length === 0) return '';

          return html`
            <section class="menu-section mb-10 pt-4 scroll-mt-32" id="cat-${catId}" data-cat-id="${catId}">
              <div class="flex items-center gap-3 mb-6">
                <h2 class="text-2xl font-black text-text uppercase tracking-tight">${this.getCategoryName(catId)}</h2>
                <div class="flex-1 h-px bg-accent"></div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" role="list">
                ${catProduits.map(p => html`<snack-menu-item .product="${p}" class="block"></snack-menu-item>`)}
              </div>
            </section>
          `;
        })}
      </div>
    `;
  }
}

customElements.define('snack-menu-list', SnackMenuList);
