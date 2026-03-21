import { defineConfig } from 'vite'
import fs from 'fs'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

// On charge notre dictionnaire SEO
const snacksSeo = JSON.parse(fs.readFileSync('./snacks-seo.json', 'utf-8'))

export default defineConfig(() => {
  // On récupère le snack en cours de build (fourni par Github Actions)
  // S'il n'y en a pas (build local), on met otacos_bonneville par défaut
  const currentSnackId = process.env.SNACK_ID || 'otacos_bonneville'
  const seoData = snacksSeo[currentSnackId]

  return {
    plugins: [
      tailwindcss(),
      {
        name: 'html-transform',
        transformIndexHtml(html) {
          return html
            .replace(/%VITE_SEO_TITLE%/g, seoData.title)
            .replace(/%VITE_SEO_DESC%/g, seoData.desc)
            .replace(/%VITE_THEME_COLOR%/g, seoData.color)
            .replace(/%VITE_SNACK_ID%/g, currentSnackId)
        }
      }
    ],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          admin: resolve(__dirname, 'admin.html'),
          superadmin: resolve(__dirname, 'superadmin.html')
        }
      }
    }
  }
})