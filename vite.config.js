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

  return {
    plugins: [
      tailwindcss(),
      {
        name: 'html-transform',
        enforce: 'pre',
        transformIndexHtml(html) {
          return html
            .replace(/\{\{SEO_TITLE\}\}/g, seoData.title)
            .replace(/\{\{SEO_DESC\}\}/g, seoData.desc)
            .replace(/\{\{THEME_COLOR\}\}/g, seoData.theme_color)
            .replace(/\{\{SNACK_ID\}\}/g, currentSnackId)
            .replace(/\{\{LOGO_URL\}\}/g, seoData.logoUrl)
            .replace(/\{\{SHADOW_CLASS\}\}/g, seoData.shadowClass)
        }
      },
      // 👇 2. LA CONFIGURATION DE LA PWA
      VitePWA({
        registerType: 'autoUpdate', // Met à jour l'app en arrière-plan automatiquement
        injectRegister: 'auto', // Injecte le script de SW tout seul dans l'HTML
        
        // A. LE MANIFEST GÉNÉRÉ DYNAMIQUEMENT POUR CHAQUE SNACK !
        manifest: {
          name: seoData.title,
          short_name: seoData.title.split('|')[0].trim(), // Prend juste la 1ère partie du titre
          description: seoData.desc,
          theme_color: seoData.theme_color,
          background_color: '#ffffff',
          orientation: 'portrait-primary', // 📱 BONUS : Bloque l'app en mode portrait !
          categories: ['food', 'shopping'], // 📱 BONUS : Aide Android à classer ton app dans le tiroir d'applications
          display: 'standalone',
          icons: [
            {
              src: '/assets/icon-192.webp',
              sizes: '192x192',
              type: 'image/webp'
            },
            {
              src: '/assets/icon-512.webp',
              sizes: '512x512',
              type: 'image/webp',
              purpose: 'any maskable'
            }
          ],
          shortcuts: [
            {
              name: "Voir la carte",
              short_name: "Commander",
              description: "Ouvrir le menu complet pour commander",
              url: "/?action=menu", // L'URL magique qu'on va intercepter
              icons: [{ src: "/assets/icon-192.webp", sizes: "192x192" }]
            },
            {
              name: "Ma Carte Fidélité",
              short_name: "Fidélité",
              description: "Afficher mon QR Code",
              url: "/?action=loyalty", // L'URL magique qu'on va intercepter
              icons: [{ src: "/assets/icon-192.webp", sizes: "192x192" }]
            }
          ]
        },

        // B. LA GESTION DU CACHE (WORKBOX)
        workbox: {
          importScripts: ['/firebase-messaging-sw.js'],
          // Vite mettra automatiquement en cache tous tes HTML, JS et CSS du dossier /dist
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
          
          // On ajoute la logique pour les serveurs externes (Google Fonts & Firebase Storage)
          runtimeCaching: [
            {
              // 🍔 Mettre en cache les images de Firebase Storage (Tes burgers !)
              urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
              handler: 'CacheFirst', // On regarde le cache avant d'aller sur le réseau
              options: {
                cacheName: 'snack-images-cache',
                expiration: {
                  maxEntries: 100, // Garde les 100 dernières images vues
                  maxAgeSeconds: 60 * 60 * 24 * 30 // Garde pendant 30 jours
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              // 🔤 Mettre en cache les polices Google Fonts et FontAwesome
              urlPattern: /^https:\/\/(fonts\.googleapis\.com|cdnjs\.cloudflare\.com)\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'external-fonts-cache',
              }
            }
          ]
        }
      })
    ],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          admin: resolve(__dirname, 'admin.html'),
          superadmin: resolve(__dirname, 'superadmin.html')
        }, 
        output: {
          manualChunks: {
            firebase: [
              'firebase/app', 
              'firebase/firestore', 
              'firebase/auth', 
              'firebase/storage',
              'firebase/analytics'
            ],
            qrcode: ['html5-qrcode']
          }
        }
      }
    }
  } 
}); 