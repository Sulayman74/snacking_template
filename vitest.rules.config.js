import { defineConfig } from "vitest/config";

// Tests des Firestore Security Rules — exigent l'émulateur Firestore.
// Lancés séparément via `firebase emulators:exec` (voir script test:rules),
// donc EXCLUS du run unitaire par défaut (vitest.config.js).
export default defineConfig({
  test: {
    include: ["tests/rules/**/*.test.js"],
    environment: "node",
    // Les rules-unit-testing partagent un émulateur ; pas de parallélisme inter-fichiers.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
