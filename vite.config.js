import { VitePWA } from 'vite-plugin-pwa' // 👈 1. L'import du plugin
import { defineConfig } from 'vite'
import fs from 'fs'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

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
          // Injecté en premier dans <head> : suppression absolue du flash blanc
          const splashStyle = `<style>
            :root,html,body{background:${seoData.theme_color} !important; color-scheme: light dark;}
            :root{--color-primary:${seoData.theme_color};--logo-url:url("${iconUrl}")}
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
            .replace(/\{\{ICON_URL\}\}/g, iconUrl)
            .replace(/\{\{APP_SHORT_NAME\}\}/g, seoData.title.split('|')[0].trim())
            .replace(/\{\{CANONICAL_URL\}\}/g, seoData.canonicalUrl || '')
        }
      },
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
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
          legal: resolve(__dirname, 'legal.html')
        }
      }
    }
  }
});
