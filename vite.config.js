import { defineConfig } from 'vite'
import { resolve } from 'path' // 👈 Ajout important pour gérer les chemins
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      input: {
        // 👇 On déclare nos 3 pages officiellement ici !
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        superadmin: resolve(__dirname, 'superadmin.html')
      }
    }
  }
})