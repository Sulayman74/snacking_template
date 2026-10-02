// 🔤 Tests unitaires — polices hébergées (src/theme-fonts.js + public/fonts/fonts.json).
// Régression : les polices chargées depuis Google Fonts bloquaient le rendu (chaîne
// HTML → CSS → woff2) ; le runtime rechargeait en plus la feuille Google à chaque visite.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SAAS_FONTS, fontFaceCss, fontPreloadLinks } from "../../src/theme-fonts.js";

const manifest = JSON.parse(readFileSync("public/fonts/fonts.json", "utf8"));

describe("fontFaceCss / fontPreloadLinks", () => {
  it("police statique (Poppins) → une règle par graisse, swap, unicode-range", () => {
    const css = fontFaceCss(manifest.poppins);
    expect(css).toContain("font-family:'Poppins'");
    expect(css).toContain("font-weight:400;");
    expect(css).toContain("font-weight:600;");
    expect(css).toContain("font-display:swap");
    expect(css).toContain("unicode-range:U+0000-00FF");
    expect(css).toContain("url(/fonts/poppins-400.woff2) format('woff2')");
  });

  it("police variable (Inter) → un seul fichier déclaré sur la plage 400 600", () => {
    const css = fontFaceCss(manifest.inter);
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).toContain("font-weight:400 600;");
    expect(fontPreloadLinks(manifest.inter)).toBe(
      '<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/inter-variable.woff2">'
    );
  });

  it("entrée absente → rien (le build retombe sur Google Fonts)", () => {
    expect(fontFaceCss(null)).toBe("");
    expect(fontPreloadLinks(undefined)).toBe("");
  });
});

describe("public/fonts : cohérent avec SAAS_FONTS", () => {
  it("chaque famille web du thème est hébergée et ses fichiers existent", () => {
    for (const [key, font] of Object.entries(SAAS_FONTS)) {
      if (!font.href) continue; // police système
      expect(manifest[key], `famille ${key} absente de fonts.json (node scripts/fetch-fonts.mjs)`).toBeDefined();
      for (const src of Object.values(manifest[key].files)) {
        expect(existsSync(join("public", src)), `${src} manquant`).toBe(true);
      }
      // Le nom de famille déclaré doit être celui utilisé dans font-family du thème.
      expect(font.body).toContain(`'${manifest[key].family}'`);
    }
  });
});
