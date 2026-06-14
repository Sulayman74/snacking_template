// ============================================================================
// ✨ ICÔNES — Lucide (remplace Font Awesome) en Vanilla JS
// ----------------------------------------------------------------------------
// L'app re-render le DOM par innerHTML sur events du Store : appeler createIcons()
// après CHAQUE rendu dans 29 fichiers serait invasif et fragile. À la place : UN seul
// MutationObserver (débounce-rAF) rend les <i data-lucide> dès qu'ils apparaissent.
// KISS/DRY : un point d'intégration unique, robuste à tous les re-renders.
//
// Tree-shaking : on importe UNIQUEMENT les ~89 icônes réellement utilisées (jamais le
// barrel complet). Les 4 logos de marque (instagram/facebook/tiktok/stripe), absents de
// Lucide, sont des <svg> inline dans le markup (pas gérés ici).
//
// Dimensionnement : .lucide { width:1em; height:1em } (cf. styles.css) -> les classes
// text-* recopiées sur le <svg> par createIcons pilotent la taille, comme avec FA.
// ============================================================================

import {
  createIcons,
  LoaderCircle, X, Bike, Heart, Star, MapPin, Clock, CircleCheck, Utensils, Plus, Gift, Check,
  ShoppingBag, Eye, Car, Bell, Pizza, Phone, Contrast, ShoppingCart, Camera, ArrowRight, ArrowDown,
  User, Wrench, CircleX, Sun, Snowflake, Share2, Search, QrCode, Lock, Package, GlassWater, Flame,
  EyeOff, Settings, Info, Zap, Menu, Ban, Wifi, ShieldCheck, TriangleAlert, Trash2, Trash, ThumbsUp,
  ThermometerSun, CloudFog, LogOut, Save, Footprints, Ruler, Route, RotateCcw, Power, Pen, Coffee,
  Moon, Minus, Map, ZoomIn, WandSparkles, LocateFixed, Image, House, Sandwich, Globe, Volleyball,
  FileSpreadsheet, ExternalLink, CircleAlert, Euro, Download, Navigation, CreditCard, CloudRain, Cloud,
  ChartLine, Receipt, CalendarDays, Calendar, Box, BookOpen, CookingPot, BellOff, RefreshCw, Upload,
  TrendingUp,
  // Pages back-office (admin/superadmin/livreur/legal/404)
  Contact, ArrowLeft, Bug, Megaphone, ChevronDown, CircleArrowDown, CircleHelp, Copy, DoorOpen, Mail,
  FileText, FileUp, Filter, Headset, IdCard, LifeBuoy, Lightbulb, List, Send, Play, CirclePlus, LogIn,
  Rocket, Tag, ToggleRight, Landmark, UserPlus,
} from "lucide";

/** Sous-ensemble d'icônes embarqué (clé PascalCase ; createIcons mappe data-lucide kebab -> Pascal). */
const ICONS = {
  LoaderCircle, X, Bike, Heart, Star, MapPin, Clock, CircleCheck, Utensils, Plus, Gift, Check,
  ShoppingBag, Eye, Car, Bell, Pizza, Phone, Contrast, ShoppingCart, Camera, ArrowRight, ArrowDown,
  User, Wrench, CircleX, Sun, Snowflake, Share2, Search, QrCode, Lock, Package, GlassWater, Flame,
  EyeOff, Settings, Info, Zap, Menu, Ban, Wifi, ShieldCheck, TriangleAlert, Trash2, Trash, ThumbsUp,
  ThermometerSun, CloudFog, LogOut, Save, Footprints, Ruler, Route, RotateCcw, Power, Pen, Coffee,
  Moon, Minus, Map, ZoomIn, WandSparkles, LocateFixed, Image, House, Sandwich, Globe, Volleyball,
  FileSpreadsheet, ExternalLink, CircleAlert, Euro, Download, Navigation, CreditCard, CloudRain, Cloud,
  ChartLine, Receipt, CalendarDays, Calendar, Box, BookOpen, CookingPot, BellOff, RefreshCw, Upload,
  TrendingUp,
  Contact, ArrowLeft, Bug, Megaphone, ChevronDown, CircleArrowDown, CircleHelp, Copy, DoorOpen, Mail,
  FileText, FileUp, Filter, Headset, IdCard, LifeBuoy, Lightbulb, List, Send, Play, CirclePlus, LogIn,
  Rocket, Tag, ToggleRight, Landmark, UserPlus,
};

/**
 * Remplace l'icône d'un élément (anciennement piloté par `el.className = "fas fa-X"`) par une
 * icône Lucide : crée un placeholder <i data-lucide> que l'observer rendra en <svg>. Préserve
 * l'id et les attributs (sauf class/data-lucide) ; conserve les classes non-FA/non-lucide.
 * Retourne le nouvel élément (les refs détenues doivent être réassignées).
 * @param {Element|null} el - Élément icône courant (<i> ou <svg> déjà rendu).
 * @param {string} name - Nom Lucide kebab (ex. "circle-check").
 * @param {string} [extraClasses] - Classes additionnelles à ajouter (ex. "text-5xl text-danger").
 * @returns {Element|null} Le placeholder créé, ou null si el absent.
 */
export function swapIcon(el, name, extraClasses = "") {
  if (!el) return null;
  const next = document.createElement("i");
  for (const attr of el.attributes) {
    if (attr.name === "class" || attr.name === "data-lucide") continue;
    next.setAttribute(attr.name, attr.value);
  }
  next.setAttribute("data-lucide", name);
  const kept = (el.getAttribute("class") || "")
    .split(/\s+/)
    .filter((c) => c && !/^lucide/.test(c) && !/^fa[bsr]?$|^fa-/.test(c));
  const cls = [...kept, ...extraClasses.split(/\s+/).filter(Boolean)];
  if (cls.length) next.className = cls.join(" ");
  el.replaceWith(next);
  return next;
}
window.swapIcon = swapIcon;

let scheduled = false;

/** Rend tous les <i data-lucide> non encore convertis en SVG. Idempotent (les SVG produits
 *  n'ont plus l'attribut data-lucide -> ignorés aux passes suivantes). */
function renderIcons() {
  scheduled = false;
  try {
    createIcons({ icons: ICONS });
  } catch (err) {
    console.warn("[icons] createIcons a échoué :", err);
  }
}

/** Coalesce les rafales de mutations en un seul rendu par frame (perf). */
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(renderIcons);
}

// Un seul observateur pour tout le document : chaque innerHTML/append qui injecte des
// placeholders déclenche un rendu (rAF-débouncé). Les SVG réinsérés ne rebouclent pas
// (pas de data-lucide), au pire une passe no-op.
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.addedNodes.length) {
      schedule();
      return;
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

// Rendu initial (markup statique d'index.html).
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderIcons);
} else {
  renderIcons();
}
