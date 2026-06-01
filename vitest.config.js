import { defineConfig } from "vitest/config";

// Tests unitaires (Vitest) — séparés des E2E Playwright (tests/*.spec.js).
// On ne ramasse QUE tests/unit/**/*.test.js. Environnement node par défaut ;
// les fichiers nécessitant le DOM déclarent `// @vitest-environment jsdom` en tête.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
  },
});
