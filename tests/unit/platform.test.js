// 📱 Tests unitaires — détection iOS / app installée (src/core/platform.js).
// Régression : l'iPad (iPadOS = « Macintosh ») n'était pas détecté, et sur iPhone
// dans Safari le bouton notifications disparaissait sans explication.
import { describe, it, expect } from "vitest";
import { isIOSDevice, isStandaloneDisplay, needsInstallForPush } from "../../src/core/platform.js";

const IPHONE = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 };
const IPAD = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.4 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 };
const MAC = { userAgent: IPAD.userAgent, platform: "MacIntel", maxTouchPoints: 0 };
const ANDROID = { userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 };

const win = (navigator, standalone) => ({ navigator: { ...navigator, standalone }, matchMedia: () => ({ matches: false }) });

describe("platform", () => {
  it("détecte iPhone et iPad, pas un Mac ni Android", () => {
    expect(isIOSDevice(IPHONE)).toBe(true);
    expect(isIOSDevice(IPAD)).toBe(true);
    expect(isIOSDevice(MAC)).toBe(false);
    expect(isIOSDevice(ANDROID)).toBe(false);
  });

  it("mode installé via display-mode ou navigator.standalone", () => {
    expect(isStandaloneDisplay({ navigator: {}, matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isStandaloneDisplay(win(IPHONE, true))).toBe(true);
    expect(isStandaloneDisplay(win(IPHONE, false))).toBe(false);
  });

  it("installation requise seulement sur iOS hors app installée", () => {
    expect(needsInstallForPush(win(IPHONE, false))).toBe(true);
    expect(needsInstallForPush(win(IPAD, false))).toBe(true);
    expect(needsInstallForPush(win(IPHONE, true))).toBe(false);
    expect(needsInstallForPush(win(ANDROID, false))).toBe(false);
  });
});
