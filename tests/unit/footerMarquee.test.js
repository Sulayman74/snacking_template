// 🎞️ Tests unitaires — bandeau défilant du pied de page (src/core/footerMarquee.js, pur).
import { describe, it, expect } from "vitest";
import { marqueeSegments, marqueeHTML } from "../../src/core/footerMarquee.js";

const t = (k) => ({ "footer.marqueeCollect": "Click & Collect", "footer.marqueeDelivery": "Livraison", "footer.marqueeLoyalty": "Club fidélité" })[k] ?? k;
const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

describe("marqueeSegments", () => {
  it("nom en accent, Click & Collect sauf coupé, livraison si activée, fidélité sauf coupée", () => {
    const segs = marqueeSegments({ identity: { name: "Belly" }, features: { enableDelivery: true } });
    expect(segs).toEqual([{ text: "Belly", accent: true }, { key: "footer.marqueeCollect" }, { key: "footer.marqueeDelivery" }, { key: "footer.marqueeLoyalty" }]);
  });
  it("flags coupés explicitement → seulement le nom ; sans nom → services seuls", () => {
    expect(marqueeSegments({ identity: { name: "Tacos" }, features: { enableClickAndCollect: false, enableLoyaltyCard: false } })).toEqual([{ text: "Tacos", accent: true }]);
    expect(marqueeSegments({ identity: { name: "  " }, features: { enableClickAndCollect: false, enableLoyaltyCard: false } })).toEqual([]);
    expect(marqueeSegments(undefined)).toEqual([{ key: "footer.marqueeCollect" }, { key: "footer.marqueeLoyalty" }]);
  });
});

describe("marqueeHTML", () => {
  it("un point médian après chaque segment (boucle sans couture), nom en accent, texte échappé", () => {
    const html = marqueeHTML(marqueeSegments({ identity: { name: "Chez <Bob> & Co" }, features: {} }), { t, escape, minSegments: 3 });
    expect(html).toBe('<span class="marquee-accent">Chez &lt;Bob&gt; &amp; Co</span><span class="marquee-dot">·</span><span>Click &amp; Collect</span><span class="marquee-dot">·</span><span>Club fidélité</span><span class="marquee-dot">·</span>');
    expect(html).not.toContain("<Bob>");
  });
  it("séquence répétée jusqu'à minSegments : deux segments → trois répétitions par défaut", () => {
    const html = marqueeHTML([{ text: "Belly", accent: true }, { key: "footer.marqueeLoyalty" }], { t, escape });
    expect(html.match(/marquee-accent/g)).toHaveLength(3);
    expect(html.match(/marquee-dot/g)).toHaveLength(6);
  });
  it("sans segment → chaîne vide", () => {
    expect(marqueeHTML([], { t, escape })).toBe("");
  });
});
