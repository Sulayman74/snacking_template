// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock minimal de utils.js : on fournit seulement ce qu'AdminConfigUI importe.
vi.mock("../../src/utils.js", () => ({
  escapeHTML: (s) => String(s ?? ""),
  showToast: vi.fn(),
}));

// AdminConfigUI importe core/firebase.js qui initialise Firebase Messaging au
// chargement (→ rejection "unsupported-browser" sous jsdom). On le stub : le test
// n'écrit pas dans Firestore (saveConfig est mocké), donc db/fs réels sont inutiles.
vi.mock("../../src/core/firebase.js", () => ({ db: {}, fs: {} }));

import { adminStore } from "../../src/core/AdminStore.js";
import { AdminConfigUI } from "../../src/ui/AdminConfigUI.js";

const CONTACT_IDS = [
  "config-phone", "config-email", "config-street", "config-zipcode", "config-city",
  "config-google-maps-url", "config-google-review-url",
  "config-instagram", "config-facebook", "config-tiktok",
];

function setupDOM() {
  document.body.innerHTML =
    `<form id="config-contact-form">` +
    CONTACT_IDS.map((id) => `<input id="${id}">`).join("") +
    `</form>`;
}

describe("AdminConfigUI.handleContactSubmit (régression coordonnées)", () => {
  beforeEach(() => {
    setupDOM();
    adminStore.setConfig({
      identity: { id: "snack1", name: "Test" },
      contact: { phone: "0000", email: "", address: {}, socials: {} },
      reviews: {},
      hours: [],
    });
    // On n'écrit pas dans Firestore : on isole la logique de capture du formulaire.
    vi.spyOn(adminStore, "saveConfig").mockResolvedValue(true);
  });

  it("capture TOUS les champs saisis (pas seulement phone) malgré le render() relancé à chaque updateConfigField", async () => {
    const ui = new AdminConfigUI();

    document.getElementById("config-phone").value = "0102030405";
    document.getElementById("config-email").value = "jo@bravo.fr";
    document.getElementById("config-street").value = "18 av. de la Libération";
    document.getElementById("config-zipcode").value = "74300";
    document.getElementById("config-city").value = "Cluses";
    document.getElementById("config-google-maps-url").value = "https://maps/x";
    document.getElementById("config-instagram").value = "https://insta/x";

    await ui.handleContactSubmit(new Event("submit"));

    const c = adminStore.state.config.contact;
    expect(c.phone).toBe("0102030405");
    expect(c.email).toBe("jo@bravo.fr");          // ← cassait avant le fix
    expect(c.address.street).toBe("18 av. de la Libération");
    expect(c.address.zip).toBe("74300");
    expect(c.address.city).toBe("Cluses");
    expect(c.address.googleMapsUrl).toBe("https://maps/x");
    expect(c.socials.instagram).toBe("https://insta/x");
    expect(adminStore.saveConfig).toHaveBeenCalledOnce();
  });
});
