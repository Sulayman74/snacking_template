import { VitePWA } from 'vite-plugin-pwa' // 👈 1. L'import du plugin
import { defineConfig, loadEnv } from 'vite'
import fs from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import tailwindcss from '@tailwindcss/vite'
import { resolveFont, fontFaceCss, fontPreloadLinks } from './src/theme-fonts.js'
import { SAAS_THEMES } from './src/theme-palettes.js'
import { manifestIcons, htmlIcons } from './scripts/lib/icons.mjs'

const seoPath = resolve(__dirname, 'snacks-seo.json');
  let snacksSeo = {};
  if (fs.existsSync(seoPath)) {
    snacksSeo = JSON.parse(fs.readFileSync(seoPath, 'utf-8'));
  } else {
    snacksSeo = {
      "Ym1YiO4Ue5Fb5UXlxr06": {
        "title": "O'Tacos Fusion",
        "desc": "Les meilleurs Tacos et Burgers de la ville en Click & Collect.",
        "theme_color": "#1E2938",
        "logoUrl": "/assets/logo.webp",
        "shadowClass": "shadow-red-600/40"
      }
    };
  }

// 🛡️ GARDE-FOU SECRETS : toute variable VITE_* est écrite EN CLAIR dans le JS public.
// Une clé secrète Stripe (sk_/rk_) ou un secret de webhook (whsec_) ne doit JAMAIS
// y arriver → le build (et le serveur de dev) échoue. En build de production, la
// clé publishable est OBLIGATOIRE : plus de clé de secours silencieuse dans le code.
const SECRET_VALUE = /\b(sk|rk)_(test|live)_|\bwhsec_/;
function assertPublicEnv(env, { command, mode }) {
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('VITE_') && SECRET_VALUE.test(String(value))) {
      throw new Error(`🚨 ${name} contient une clé SECRÈTE (sk_/rk_/whsec_) : elle serait publiée dans le site. Build annulé — mettez-y une clé publishable pk_… .`)
    }
  }
  if (command === 'build' && mode === 'production') {
    const pk = env.VITE_STRIPE_PUBLISHABLE_KEY || ''
    if (!/^pk_(test|live)_/.test(pk)) {
      throw new Error('🚨 VITE_STRIPE_PUBLISHABLE_KEY absente ou invalide (attendu pk_test_… ou pk_live_…). En CI : secret GitHub du même nom. En local : fichier .env.production.local (gitignoré). Cf. docs/STRIPE-GO-LIVE.md.')
    }
    if (pk.startsWith('pk_test_')) {
      console.warn('⚠️  Build de PRODUCTION avec une clé Stripe de TEST : les paiements sont fictifs.')
    }
  }
}

/** Polices hébergées (public/fonts/fonts.json) : {} si le script fetch-fonts n'a pas tourné. */
function readHostedFonts() {
  try {
    return JSON.parse(fs.readFileSync(resolve(__dirname, 'public/fonts/fonts.json'), 'utf8'))
  } catch {
    return {}
  }
}
const hostedFonts = readHostedFonts()

/** Commit du build : CI (GITHUB_SHA) ou git local ; "dev" sinon. */
function appVersion() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig(({ command, mode }) => {
  assertPublicEnv(loadEnv(mode, process.cwd(), 'VITE_'), { command, mode })
  const currentSnackId = process.env.SNACK_ID || 'Ym1YiO4Ue5Fb5UXlxr06'
  const seoData = snacksSeo[currentSnackId] || snacksSeo["Ym1YiO4Ue5Fb5UXlxr06"];
  const iconUrl = seoData.iconUrl || seoData.logoUrl;
  // 🖼️ Icônes PWA : jeu PNG généré par `npm run icons:generate` (public/icons/<id>/,
  // any + maskable + apple-touch-icon) ; repli sur le logo webp distant s'il manque.
  const iconsCfg = { publicDir: resolve(__dirname, 'public'), snackId: currentSnackId, fallbackUrl: iconUrl }
  const headIcons = htmlIcons(iconsCfg)
  // 🎨 Couleur dérivée de colorPalette (SOURCE UNIQUE, partagée avec le runtime via
  // src/theme-palettes.js) → splash/meta/manifest cohérents avec l'UI, plus de désync.
  // Fallbacks rétro-compatibles : hex explicites de snacks-seo.json, puis défaut neutre.
  const palette = seoData.colorPalette || '';
  const themeHex = SAAS_THEMES[palette] || {};
  const themeColor = themeHex.primaryHex || seoData.theme_color || '#1E2938';
  // Fond de page = base claire de la palette (overscroll / pré-paint).
  const lightHex = themeHex.lightHex || seoData.lightHex || themeColor;
  // Accent du thème : nappe secondaire du fond mesh (.app-bg).
  const accentHex = themeHex.accentHex || seoData.accentHex || themeColor;

  return {
    plugins: [
      tailwindcss(),
      {
        name: 'html-transform',
        enforce: 'pre',
        transformIndexHtml(html) {
          const heroPreload = seoData.heroUrl
            ? `<link rel="preload" as="image" fetchpriority="high" href="${seoData.heroUrl}">`
            : '';
          // 🔤 Police du tenant (build-time, zéro FOUT). Si police système -> chaîne vide
          // (pas de preconnect mort). display=swap est déjà dans l'href (cf. SAAS_FONTS).
          const font = resolveFont(seoData.fontKey);
          // 🔤 Police HÉBERGÉE (public/fonts, cf. scripts/fetch-fonts.mjs) : préchargée
          // + @font-face inline → plus de chaîne HTML → CSS Google → woff2 qui bloquait le
          // rendu (~0,9 s simulées sur mobile), plus de domaine tiers. Repli Google si la
          // famille n'a pas été téléchargée. `data-font-key` sur <html> dit au runtime
          // (AppUI.applyTheme) que cette famille est déjà là → pas de rechargement.
          const hostedFont = hostedFonts[seoData.fontKey] || null;
          const fontLink = hostedFont
            ? `${fontPreloadLinks(hostedFont)}
    <style>${fontFaceCss(hostedFont)}</style>`
            : font.href
            ? `<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preload" as="style" href="${font.href}">
    <link rel="stylesheet" href="${font.href}">`
            : '';
          const fontKeyAttr = hostedFont ? ` data-font-key="${seoData.fontKey}"` : '';
          // Police posée dès le 1er octet (avant le boot JS) -> le font-family est correct au
          // 1er paint, pas de bascule système->web font (FOUT). Le <link> (fontLink) charge le
          // fichier ; ces vars l'APPLIQUENT. Le runtime (applyTheme) ne surcharge que si Firestore
          // a explicitement un fontKey (override admin).
          const fontVars = `--font-body:${font.body};--font-display:${font.display || font.body};`;
          // Injecté en premier dans <head> dès le 1er octet : tue le flash blanc ET le flash
          // de mauvaise couleur. Le FOND DE PAGE est la base claire (lightHex) — visible en
          // overscroll / avant peinture du contenu. Le SPLASH (#boot-splash) garde --color-primary
          // (couleur de marque pleine) via sa propre règle. --color-primary-light est posé ici
          // pour que body et composants thémés aient la bonne base avant le boot du JS.
          // --color-accent posé ici aussi -> le fond mesh (.app-bg) est complet dès le 1er paint
          // (sinon les nappes accent restent transparentes jusqu'au boot JS).
          const splashStyle = `<style>
            :root,html,body{background:${lightHex} !important; color-scheme: light dark;}
            :root{--color-primary:${themeColor};--color-accent:${accentHex};--color-primary-light:${lightHex};--theme-primary:${themeColor};--theme-accent:${accentHex};--theme-primary-light:${lightHex};${fontVars}--logo-url:url("${iconUrl}")}
          </style>`;
          // 🌗 Anti-flash dark : pose la classe .dark sur <html> AVANT le 1er paint (et avant le
          // <link styles.css> render-blocking), selon la préférence persistée (localStorage
          // "theme-mode") ou l'OS en mode "système". styles.css (html.dark) prend ensuite le relais
          // par spécificité. Sans ça : flash clair avant le boot du JS. Cf. src/theme-mode.js.
          const antiFlashScript = `<script>try{var k="theme-mode",m=localStorage.getItem(k),`
            + `d=m==="dark"||((!m||m==="system")&&matchMedia("(prefers-color-scheme:dark)").matches),`
            + `e=document.documentElement;e.classList.toggle("dark",d);if(m==="light")e.classList.add("light");`
            + `e.style.colorScheme=d?"dark":"light";}catch(_){}</script>`;

          return html
            .replace('<html', `<html data-theme="${palette}"${fontKeyAttr}`) // override mesh par thème actif au 1er paint
            .replace('<head>', `<head>\n    ${splashStyle}\n    ${antiFlashScript}`)
            .replace(/\{\{SEO_TITLE\}\}/g, seoData.title)
            .replace(/\{\{SEO_DESC\}\}/g, seoData.desc)
            .replace(/\{\{THEME_COLOR\}\}/g, themeColor)
            .replace(/\{\{SNACK_ID\}\}/g, currentSnackId)
            .replace(/\{\{LOGO_URL\}\}/g, seoData.logoUrl)
            .replace(/\{\{SHADOW_CLASS\}\}/g, seoData.shadowClass)
            .replace(/\{\{HERO_URL\}\}/g, seoData.heroUrl || '')
            .replace('{{HERO_PRELOAD}}', heroPreload)
            .replace('{{FONT_LINK}}', fontLink)
            .replace(/\{\{ICON_URL\}\}/g, iconUrl)
            .replace(/\{\{ICON_192\}\}/g, headIcons.icon192)
            .replace(/\{\{ICON_512\}\}/g, headIcons.icon512)
            .replace(/\{\{ICON_TYPE\}\}/g, headIcons.type)
            .replace(/\{\{APPLE_TOUCH_ICON\}\}/g, headIcons.appleTouchIcon)
            .replace(/\{\{APP_SHORT_NAME\}\}/g, seoData.title.split('|')[0].trim())
            .replace(/\{\{CANONICAL_URL\}\}/g, seoData.canonicalUrl || '')
        }
      },
      VitePWA({
        // 'prompt' : on NE recharge plus l'app automatiquement (risque d'interrompre
        // un paiement client ou la validation d'une photo de preuve par le livreur).
        // L'utilisateur décide quand rafraîchir via le bandeau #pwa-update-banner.
        registerType: 'prompt',
        // false : l'enregistrement du SW est fait manuellement en JS (registerSW)
        // pour brancher les hooks onNeedRefresh / updateSW.
        injectRegister: false,
        // 🛠️ SW écrit à la main (src/sw.js) : précache + caches runtime (CLAUDE.md
        // §8.3) + affichage des push FCM et clic. L'ancien SW généré (generateSW)
        // n'avait AUCUN handler push → notifications génériques / révoquées sur iOS.
        // Les icônes du manifest ne sont PAS précachées (sinon chaque visiteur télécharge
        // les 4 PNG dès la 1re visite) : le navigateur ne les charge qu'à l'installation.
        includeManifestIcons: false,
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html}'],
          // Précache = coquille CLIENT uniquement. Admin / livreur / superadmin (pages +
          // chunks d'entrée) et la sonnerie cuisine sont servis par les caches runtime
          // de src/sw.js à leur première ouverture : un client n'a pas à télécharger
          // ~140 Ko de back-office, et la sonnerie reste disponible tablette hors-ligne.
          globIgnores: [
            'admin.html', 'livreur.html', 'superadmin.html',
            'assets/admin-*.js', 'assets/livreur-*.js', 'assets/superadmin-*.js',
          ],
        },
        manifest: {
          // id explicite = start_url (identité d'install inchangée, pas de doublon).
          id: '/',
          start_url: '/',
          scope: '/',
          lang: 'fr',
          name: seoData.title,
          short_name: seoData.title.split('|')[0].trim(),
          description: seoData.desc,
          theme_color: themeColor,
          background_color: themeColor, // 👈 Dérivé de colorPalette : splash sans flash ni désync
          orientation: 'portrait-primary',
          display: 'standalone',
          icons: manifestIcons(iconsCfg),
        }
      }),
      {
        // admin / livreur / superadmin déclarent LEUR manifest (scope, icônes, start_url
        // dédiés). VitePWA injecte en plus /manifest.webmanifest dans chaque page : on
        // retire ce doublon hors index.html (le 1er lien gagnait, mais c'était fragile).
        name: 'single-manifest-per-page',
        enforce: 'post', // après l'injection de VitePWA (elle-même en post)
        transformIndexHtml: {
          order: 'post',
          handler(html, ctx) {
            if (ctx.filename.endsWith('index.html')) return html;
            if (!/<link rel="manifest" href="\/(admin|livreur|superadmin)\.webmanifest"/.test(html)) return html;
            return html.replace(/\s*<link rel="manifest" href="\/manifest\.webmanifest">/g, '');
          },
        },
      },
    ],
    define: {
      __SNACK_ID__: JSON.stringify(currentSnackId),
      // Version du build (commit) affichée au démarrage : savoir ce qui tourne chez
      // un utilisateur en cas d'incident (cf. kill-switch, docs/PWA-DEPLOIEMENT.md).
      __APP_VERSION__: JSON.stringify(appVersion()),
    },
    build: {
      outDir: process.env.SNACK_ID ? `dist/${currentSnackId}` : 'dist',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          admin: resolve(__dirname, 'admin.html'),
          superadmin: resolve(__dirname, 'superadmin.html'),
          legal: resolve(__dirname, 'legal.html'),
          livreur: resolve(__dirname, 'livreur.html')
        }
      }
    }
  }
});
