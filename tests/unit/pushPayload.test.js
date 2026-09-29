// 🔔 Tests unitaires — lecture des push dans le SW (src/sw/push-payload.js).
// Régression : le SW actif n'avait aucun handler push (notifications génériques,
// abonnements révoqués sur iOS) et aucun lien ne devait sortir du site du snack.
import { describe, it, expect } from "vitest";
import { parsePushPayload, toSameOriginUrl, iconForUrl, mustAlwaysShowNotification } from "../../src/sw/push-payload.js";

const O = "https://o-bois-pizza.web.app";

describe("toSameOriginUrl", () => {
  it("URL relative → absolue sur le site", () => {
    expect(toSameOriginUrl("?action=product&id=1", O)).toBe(`${O}/?action=product&id=1`);
    expect(toSameOriginUrl("/admin.html", O)).toBe(`${O}/admin.html`);
  });
  it("même origine → inchangée", () => {
    expect(toSameOriginUrl(`${O}/admin.html`, O)).toBe(`${O}/admin.html`);
  });
  it("autre origine → ramenée sur le site (chemin conservé)", () => {
    expect(toSameOriginUrl("https://snacking-template.web.app/admin.html", O)).toBe(`${O}/admin.html`);
    expect(toSameOriginUrl("https://evil.example/phish?x=1", O)).toBe(`${O}/phish?x=1`);
  });
  it.each([undefined, "", "   ", "javascript:alert(1)", "data:text/html,x"])("valeur %j → accueil", (raw) => {
    expect(toSameOriginUrl(raw, O)).toBe(`${O}/`);
  });
});

describe("parsePushPayload — FCM", () => {
  it("notification commande admin", () => {
    const m = parsePushPayload({
      notification: { title: "🛎️ Nouvelle commande", body: "Alice · 12.00€ · Livraison" },
      fcmOptions: { link: `${O}/admin.html` },
    }, O);
    expect(m).toMatchObject({ title: "🛎️ Nouvelle commande", body: "Alice · 12.00€ · Livraison", url: `${O}/admin.html`, icon: "/admin-icon-192.png", badgeCount: null });
  });

  it("campagne : actionUrl prioritaire + tracking", () => {
    const m = parsePushPayload({
      notification: { title: "Promo", body: "-20%", image: "https://img/x.webp" },
      data: { actionUrl: "?action=product&id=42", campaignId: "c1", snackId: "s1" },
      fcmOptions: { link: `${O}/?action=product&id=42` },
    }, O);
    expect(m).toMatchObject({ url: `${O}/?action=product&id=42`, campaignId: "c1", snackId: "s1", image: "https://img/x.webp", icon: undefined });
  });

  it("badge numérique transmis en data", () => {
    expect(parsePushPayload({ notification: { title: "t" }, data: { badge: "3" } }, O).badgeCount).toBe(3);
    expect(parsePushPayload({ notification: { title: "t" }, data: { badge: "abc" } }, O).badgeCount).toBeNull();
  });

  it("payload vide ou illisible → notification par défaut vers l'accueil", () => {
    expect(parsePushPayload(null, O)).toMatchObject({ title: "Nouvelle notification", body: "", url: `${O}/` });
  });
});

describe("parsePushPayload — Declarative Web Push", () => {
  it("lit navigate et app_badge", () => {
    const m = parsePushPayload({ web_push: 8030, notification: { title: "Prête !", body: "#AB12", navigate: `${O}/`, app_badge: 2 } }, O);
    expect(m).toMatchObject({ title: "Prête !", url: `${O}/`, badgeCount: 2 });
  });
});

describe("helpers", () => {
  it("icône par surface", () => {
    expect(iconForUrl(`${O}/livreur.html`)).toBe("/livreur-icon-192.png");
    expect(iconForUrl(`${O}/`)).toBeUndefined();
  });
  it("Safari exige toujours une notification, pas Chrome", () => {
    expect(mustAlwaysShowNotification("Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(mustAlwaysShowNotification("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36")).toBe(false);
  });
});
