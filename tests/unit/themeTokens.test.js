// 🎨 Tests unitaires — jetons du thème (src/styles.css) : structure traversante (--theme-*)
// et contraste WCAG des textes sur chaque surface, dans les deux thèmes. Phase 0 de la
// refonte : les valeurs sont celles d'avant ; les paires encore sous 4,5 sont listées
// explicitement et disparaissent en Phase 1 (palette), où ce test devient strict.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { contrastRatio, pickOnColor, wheelSegmentColors, SAAS_THEMES } from "../../src/theme-palettes.js";

const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");
const NEUTRALS = ["surface", "surface-2", "surface-3", "line", "text", "text-muted", "danger"];

const light = {};
for (const m of css.matchAll(/--color-([a-z0-9-]+): var\(--theme-\1, (#[0-9a-fA-F]{6})\)/g)) light[m[1]] = m[2];
const darkStart = css.indexOf("\n.dark {");
const darkBlock = css.slice(darkStart, css.indexOf("\n}", darkStart));
const dark = {};
for (const m of darkBlock.matchAll(/--theme-([a-z0-9-]+): (#[0-9a-fA-F]{6})/g)) dark[m[1]] = m[2];

// Paires tolérées jusqu'à la Phase 1 (valeurs héritées) : ≥ 3,5 exigé en attendant.
const KNOWN_UNTIL_PHASE_1 = new Set(["clair text-muted/surface-2", "clair text-muted/surface-3", "clair danger/surface-2", "clair danger/surface-3"]);
const KNOWN_PALETTES_UNTIL_PHASE_1 = new Set(["forest"]);

describe("jetons neutres : structure traversante", () => {
  it("chaque neutre est déclaré via --theme-* (clair en @theme, sombre dans .dark)", () => {
    for (const n of NEUTRALS) {
      expect(light[n], `clair ${n}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(dark[n], `sombre ${n}`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
  it("les statuts ont une valeur sombre", () => {
    for (const s of ["status-ok", "status-info", "status-wait", "status-warn"]) expect(dark[s]).toMatch(/^#/);
  });
});

describe("contraste AA des textes sur les surfaces", () => {
  for (const [name, t] of [["clair", light], ["sombre", dark]]) {
    for (const bg of ["surface", "surface-2", "surface-3"]) {
      for (const fg of ["text", "text-muted", "danger"]) {
        const key = `${name} ${fg}/${bg}`;
        it(`${key} ≥ ${KNOWN_UNTIL_PHASE_1.has(key) ? "3,5 (toléré jusqu'à la Phase 1)" : "4,5"}`, () => {
          const r = contrastRatio(t[fg], t[bg]);
          expect(r).toBeGreaterThanOrEqual(KNOWN_UNTIL_PHASE_1.has(key) ? 3.5 : 4.5);
        });
      }
    }
  }
  it("on-dark-muted et on-dark-faint lisibles sur screen", () => {
    const screen = css.match(/--color-screen: (#[0-9a-fA-F]{6})/)[1];
    for (const v of ["#d1d5db", "#9ca3af"]) expect(contrastRatio(v, screen)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("palettes tenant", () => {
  for (const [key, p] of Object.entries(SAAS_THEMES)) {
    it(`${key} : texte sur primaire ${KNOWN_PALETTES_UNTIL_PHASE_1.has(key) ? "(toléré jusqu'à la Phase 1)" : "≥ 4,5"}`, () => {
      const r = contrastRatio(p.onPrimaryHex, p.primaryHex);
      expect(r).toBeGreaterThanOrEqual(KNOWN_PALETTES_UNTIL_PHASE_1.has(key) ? 3 : 4.5);
    });
  }
});

describe("pickOnColor / wheelSegmentColors", () => {
  it("choisit le texte le plus contrasté sur un fond accent", () => {
    expect(pickOnColor("#B88A44")).toBe("#1f2937"); // or Belly : sombre
    expect(pickOnColor("#dc2626")).toBe("#ffffff"); // ruby : blanc
    expect(pickOnColor("zzz")).toBe("#ffffff"); // entrée invalide : blanc par défaut
  });
  it("8 segments oklch dérivés de la teinte du primaire, accent en tête si fourni", () => {
    const seg = wheelSegmentColors("#0A1B3F", "#B88A44");
    expect(seg).toHaveLength(8);
    for (const c of seg) expect(c).toMatch(/^oklch\(0\.78 0\.14 \d{1,3}\)$/);
    expect(new Set(seg).size).toBe(8);
    expect(wheelSegmentColors(undefined, undefined, 6)).toHaveLength(6);
  });
});
