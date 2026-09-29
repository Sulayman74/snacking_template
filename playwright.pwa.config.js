// @ts-check
// 🛠️ Tests PWA (service worker) sur le BUILD de production servi en local
// (`vite preview`) — le SW n'est pas enregistré par `npm run dev`.
// Aucune requête externe : tout ce qui n'est pas localhost est bloqué dans les
// tests (pas d'appel à Firebase/Stripe de prod). Chromium uniquement (CDP).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pwa',
  testMatch: '**/*.pwa.js',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173', ...devices['Desktop Chrome'], channel: 'chromium' },
  webServer: {
    command: 'SNACK_ID=Ym1YiO4Ue5Fb5UXlxr06 npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/robots.txt',
    reuseExistingServer: false,
    timeout: 60 * 1000,
  },
});
