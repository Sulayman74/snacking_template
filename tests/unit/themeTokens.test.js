// 🎨 Tests unitaires — jetons du thème : structure traversante (--theme-*), valeurs
// miroir de src/theme-neutrals.js, contraste AA STRICT (≥ 4,5) de chaque texte sur
// chaque surface dans les deux thèmes, et catalogue des 16 palettes (texte sur
// primaire, texte sur accent, encre bornée en clair et en sombre). Phase 1 de la refonte.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { contrastRatio, pickOnColor, wheelSegmentColors, inkHex, SAAS_THEMES } from "../../src/theme-palettes.js";
import { NEUTRALS } from "../../src/theme-neutrals.js";

const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");
const NEUTRAL_KEYS = { surface: "surface", "surface-2": "surface2", "surface-3": "surface3", line: "line", text: "text", "text-muted": "textMuted", danger: "danger", footer: "footer" };

const light = {};
for (const m of css.matchAll(/--color-([a-z0-9-]+): var\(--theme-\1, (#[0-9a-fA-F]{6})\)/g)) light[m[1]] = m[2];
const rootStart = css.indexOf("\n:root {");
const rootBlock = css.slice(rootStart, css.indexOf("\n}", rootStart));
light["bg-base"] = rootBlock.match(/--bg-base: (#[0-9a-fA-F]{6})/)?.[1];
const darkStart = css.indexOf("\n.dark {");
const darkBlock = css.slice(darkStart, css.indexOf("\n}", darkStart));
const dark = {};
for (const m of darkBlock.matchAll(/--theme-([a-z0-9-]+): (#[0-9a-fA-F]{6})/g)) dark[m[1]] = m[2];
dark["bg-base"] = darkBlock.match(/--bg-base: (#[0-9a-fA-F]{6})/)?.[1];
const low = (h) => String(h).toLowerCase();

describe("jetons neutres : structure et valeurs", () => {
  it("chaque neutre est déclaré via --theme-* et vaut exactement theme-neutrals.js", () => {
    for (const [cssKey, jsKey] of Object.entries(NEUTRAL_KEYS)) {
      expect(low(light[cssKey]), `clair ${cssKey}`).toBe(low(NEUTRALS.light[jsKey]));
      expect(low(dark[cssKey]), `sombre ${cssKey}`).toBe(low(NEUTRALS.dark[jsKey]));
    }
    expect(low(light["bg-base"])).toBe(low(NEUTRALS.light.bgBase));
    expect(low(dark["bg-base"])).toBe(low(NEUTRALS.dark.bgBase));
  });
  it("les statuts ont une valeur sombre ; l'encre est bornée dans les deux thèmes", () => {
    for (const s of ["status-ok", "status-info", "status-wait", "status-warn"]) expect(dark[s]).toMatch(/^#/);
    expect(rootBlock).toMatch(/--theme-primary-ink: oklch\(from var\(--theme-primary, #dc2626\) min\(l, 0\.52\) c h\)/);
    expect(darkBlock).toMatch(/--theme-primary-ink: oklch\(from var\(--theme-primary, #dc2626\) max\(l, 0\.72\) c h\)/);
  });
});

describe("contraste AA strict des textes sur les surfaces", () => {
  for (const [name, t] of [["clair", NEUTRALS.light], ["sombre", NEUTRALS.dark]]) {
    for (const bg of ["bgBase", "surface", "surface2", "surface3"]) {
      for (const fg of ["text", "textMuted", "danger"]) {
        it(`${name} ${fg} sur ${bg} ≥ 4,5`, () => expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5));
      }
    }
    it(`${name} : texte blanc et muted sur le pied de page ≥ 4,5`, () => {
      expect(contrastRatio("#ffffff", t.footer)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#d6d3d1", t.footer)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#a8a29e", t.footer)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("surfaces « écran » : texte on-dark lisible", () => {
    for (const k of ["screen", "screen-2", "screen-3"]) {
      const v = css.match(new RegExp(`--color-${k}: (#[0-9a-fA-F]{6})`))[1];
      expect(contrastRatio("#ffffff", v), k).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("catalogue des 16 palettes tenant", () => {
  it("16 palettes, chacune complète", () => {
    expect(Object.keys(SAAS_THEMES)).toHaveLength(16);
    for (const [key, p] of Object.entries(SAAS_THEMES)) for (const f of ["primaryHex", "accentHex", "lightHex", "onPrimaryHex"]) expect(p[f], `${key}.${f}`).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
  for (const [key, p] of Object.entries(SAAS_THEMES)) {
    it(`${key} : texte sur primaire ≥ 4,5 et accent lisible avec pickOnColor`, () => {
      expect(contrastRatio(p.onPrimaryHex, p.primaryHex)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(pickOnColor(p.accentHex, { dark: "#1c1917" }), p.accentHex)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${key} : encre ≥ 4,5 sur les surfaces claires et sombres`, () => {
      const inkL = inkHex(p.primaryHex), inkD = inkHex(p.primaryHex, { dark: true });
      for (const bg of ["surface", "bgBase", "surface2"]) {
        expect(contrastRatio(inkL, NEUTRALS.light[bg]), `clair ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(inkD, NEUTRALS.dark[bg]), `sombre ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("sélecteur superadmin : une option par palette", () => {
    const html = readFileSync(new URL("../../superadmin.html", import.meta.url), "utf8");
    for (const key of Object.keys(SAAS_THEMES)) expect(html.includes(`<option value="${key}">`), key).toBe(true);
  });
});

describe("pickOnColor / wheelSegmentColors / inkHex", () => {
  it("choisit le texte le plus contrasté sur un fond accent", () => {
    expect(pickOnColor("#B88A44")).toBe("#1f2937");
    expect(pickOnColor("#dc2626")).toBe("#ffffff");
    expect(pickOnColor("zzz")).toBe("#ffffff");
  });
  it("8 segments oklch dérivés de la teinte du primaire, accent en tête si fourni", () => {
    const seg = wheelSegmentColors("#0A1B3F", "#B88A44");
    expect(seg).toHaveLength(8);
    for (const c of seg) expect(c).toMatch(/^oklch\(0\.78 0\.14 \d{1,3}\)$/);
    expect(new Set(seg).size).toBe(8);
  });
  it("inkHex borne la luminosité : sunflower s'assombrit en clair, belly s'éclaircit en sombre", () => {
    expect(contrastRatio(inkHex("#eab308"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(inkHex("#0A1B3F", { dark: true }), "#1c1917")).toBeGreaterThanOrEqual(4.5);
    expect(inkHex("#0A1B3F")).toBe("#0a1b3f"); // déjà sombre : inchangé en clair
    expect(inkHex("nope")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
