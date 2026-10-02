// 🖼️ Tests unitaires — règles des icônes PWA (scripts/lib/icons.mjs) : zone sûre
// maskable, couleur de bord, et repli sur le logo webp quand aucun PNG n'est généré.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  edgeColor, edgeStats, isFlatEdge, hexToRgb, maskableLayout, manifestIcons, htmlIcons, DEFAULT_MASKABLE_SCALE,
} from "../../scripts/lib/icons.mjs";

const rgba = (w, h, fill) => {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) buf.set(fill(x, y), (y * w + x) * 4);
  return buf;
};

describe("maskableLayout", () => {
  it("le logo réduit tient dans la zone sûre Android (cercle de 80 %)", () => {
    const { inner, offset } = maskableLayout(512);
    expect(inner).toBe(Math.round(512 * DEFAULT_MASKABLE_SCALE));
    expect(offset * 2 + inner).toBeLessThanOrEqual(512);
    // Un sujet occupant 80 % du logo reste dans le cercle sûr (rayon 40 % du côté).
    const subjectHalf = (inner * 0.8) / 2;
    expect(Math.hypot(subjectHalf, subjectHalf)).toBeLessThanOrEqual(512 * 0.4);
  });

  it("échelle invalide → défaut ; échelle 1 → plein cadre", () => {
    expect(maskableLayout(192, 0).inner).toBe(Math.round(192 * DEFAULT_MASKABLE_SCALE));
    expect(maskableLayout(192, 1)).toEqual({ inner: 192, offset: 0 });
  });
});

describe("edgeColor", () => {
  it("moyenne du bord d'un logo opaque (le centre est ignoré)", () => {
    const px = rgba(10, 10, (x, y) => (x === 0 || y === 0 || x === 9 || y === 9 ? [200, 100, 50, 255] : [0, 0, 0, 255]));
    expect(edgeColor(px, 10, 10)).toEqual({ r: 200, g: 100, b: 50 });
  });

  it("bord transparent → null (fond = theme_color)", () => {
    const px = rgba(10, 10, (x, y) => (x === 0 || y === 0 || x === 9 || y === 9 ? [0, 0, 0, 0] : [10, 10, 10, 255]));
    expect(edgeColor(px, 10, 10)).toBeNull();
  });

  it("aplat → bord uniforme ; dégradé → bord non uniforme (fond flouté)", () => {
    const flat = rgba(10, 10, () => [50, 60, 70, 255]);
    expect(isFlatEdge(edgeStats(flat, 10, 10))).toBe(true);
    const gradient = rgba(10, 10, (x, y) => [x * 25, y * 25, 0, 255]);
    const stats = edgeStats(gradient, 10, 10);
    expect(stats.stddev).toBeGreaterThan(10);
    expect(isFlatEdge(stats)).toBe(false);
    expect(isFlatEdge(null)).toBe(false);
  });

  it("hexToRgb", () => {
    expect(hexToRgb("#0077b6")).toEqual({ r: 0, g: 119, b: 182 });
    expect(hexToRgb("bleu")).toBeNull();
  });
});

describe("manifestIcons / htmlIcons", () => {
  const fallbackUrl = "https://storage/logo.webp";

  it("sans PNG généré → logo webp historique", () => {
    const publicDir = mkdtempSync(join(tmpdir(), "icons-"));
    expect(manifestIcons({ publicDir, snackId: "s1", fallbackUrl })).toEqual([
      { src: fallbackUrl, sizes: "192x192", type: "image/webp" },
      { src: fallbackUrl, sizes: "512x512", type: "image/webp", purpose: "any maskable" },
    ]);
    expect(htmlIcons({ publicDir, snackId: "s1", fallbackUrl })).toMatchObject({ icon512: fallbackUrl, type: "image/webp" });
  });

  it("avec PNG générés → any et maskable séparés, chemins du snack", () => {
    const publicDir = mkdtempSync(join(tmpdir(), "icons-"));
    mkdirSync(join(publicDir, "icons", "s1"), { recursive: true });
    writeFileSync(join(publicDir, "icons", "s1", "icon-512.png"), "");
    const icons = manifestIcons({ publicDir, snackId: "s1", fallbackUrl });
    expect(icons.map((i) => [i.src, i.purpose])).toEqual([
      ["/icons/s1/icon-192.png", "any"],
      ["/icons/s1/icon-512.png", "any"],
      ["/icons/s1/maskable-192.png", "maskable"],
      ["/icons/s1/maskable-512.png", "maskable"],
    ]);
    expect(icons.every((i) => i.type === "image/png")).toBe(true);
    expect(htmlIcons({ publicDir, snackId: "s1", fallbackUrl })).toEqual({
      icon192: "/icons/s1/icon-192.png", icon512: "/icons/s1/icon-512.png", type: "image/png", appleTouchIcon: "/icons/s1/apple-touch-icon.png",
    });
  });
});
