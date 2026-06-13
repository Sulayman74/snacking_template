import { VitePWA } from 'vite-plugin-pwa' // 👈 1. L'import du plugin
import { defineConfig } from 'vite'
import fs from 'fs'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import { resolveFont } from './src/theme-fonts.js'

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

export default defineConfig(() => {
  const currentSnackId = process.env.SNACK_ID || 'Ym1YiO4Ue5Fb5UXlxr06'
  const seoData = snacksSeo[currentSnackId] || snacksSeo["Ym1YiO4Ue5Fb5UXlxr06"];
  const iconUrl = seoData.iconUrl || seoData.logoUrl;
  // Fond de page = base claire de la palette (overscroll / pré-paint). Fallback theme_color
  // si un tenant n'a pas encore de lightHex dans snacks-seo.json.
  const lightHex = seoData.lightHex || seoData.theme_color;

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
          const fontLink = font.href
            ? `<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preload" as="style" href="${font.href}">
    <link rel="stylesheet" href="${font.href}">`
            : '';
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
          const splashStyle = `<style>
            :root,html,body{background:${lightHex} !important; color-scheme: light dark;}
            :root{--color-primary:${seoData.theme_color};--color-primary-light:${lightHex};${fontVars}--logo-url:url("${iconUrl}")}
          </style>`;
          
          return html
            .replace('<head>', `<head>\n    ${splashStyle}`)
            .replace(/\{\{SEO_TITLE\}\}/g, seoData.title)
            .replace(/\{\{SEO_DESC\}\}/g, seoData.desc)
            .replace(/\{\{THEME_COLOR\}\}/g, seoData.theme_color)
            .replace(/\{\{SNACK_ID\}\}/g, currentSnackId)
            .replace(/\{\{LOGO_URL\}\}/g, seoData.logoUrl)
            .replace(/\{\{SHADOW_CLASS\}\}/g, seoData.shadowClass)
            .replace(/\{\{HERO_URL\}\}/g, seoData.heroUrl || '')
            .replace('{{HERO_PRELOAD}}', heroPreload)
            .replace('{{FONT_LINK}}', fontLink)
            .replace(/\{\{ICON_URL\}\}/g, iconUrl)
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
        // 🗄️ Stratégies de cache (CLAUDE.md §8.3). L'app-shell buildé est précaché
        // par défaut. Le catalogue Firestore (menus/prix) est déjà géré offline par
        // persistentLocalCache du SDK → pas besoin de le runtime-cacher ici.
        workbox: {
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // Polices & icônes CDN : immuables → cache-first (long TTL).
              urlPattern: ({ url }) =>
                ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'ka-f.fontawesome.com'].includes(url.hostname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'cdn-assets',
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Images produits (Firebase Storage) : stale-while-revalidate (catalogue).
              urlPattern: ({ url }) =>
                url.hostname.includes('firebasestorage') || url.hostname.includes('storage.googleapis.com'),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'product-images',
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 7 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // ❌ Cloud Functions (paiement/commande) : JAMAIS de cache (network-only).
              urlPattern: ({ url }) => url.hostname.includes('cloudfunctions.net'),
              handler: 'NetworkOnly',
            },
          ],
        },
        manifest: {
          name: seoData.title,
          short_name: seoData.title.split('|')[0].trim(),
          description: seoData.desc,
          theme_color: seoData.theme_color,
          background_color: seoData.theme_color, // 👈 FIX : Élimine le flash blanc au démarrage PWA
          orientation: 'portrait-primary',
          display: 'standalone',
          icons: [
            {
              src: iconUrl,
              sizes: '192x192',
              type: 'image/webp'
            },
            {
              src: iconUrl,
              sizes: '512x512',
              type: 'image/webp',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
    define: {
      __SNACK_ID__: JSON.stringify(currentSnackId),
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
