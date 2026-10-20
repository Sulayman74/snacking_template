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

describe("AdminConfigUI.renderDayRow (horaires responsives)", () => {
  it("génère une structure responsive avec classes flex/order adaptées au mobile", () => {
    const ui = new AdminConfigUI();
    const html = ui.renderDayRow({
      day: "Lundi",
      open: "11:30",
      close: "22:30",
      hasBreak: true,
      breakStart: "14:30",
      breakEnd: "18:00",
      closed: false,
    });

    expect(html).toContain("day-name");
    expect(html).toContain("hours-range-container");
    expect(html).toContain("min-w-0");
    expect(html).toContain("break-row");
    expect(html).toContain("hour-open");
    expect(html).toContain("hour-close");
    expect(html).toContain("hour-break-start");
    expect(html).toContain("hour-break-end");
  });

  it("handleHoursSubmit extrait correctement les horaires avec la structure responsive", () => {
    document.body.innerHTML = `
      <form id="config-hours-form">
        <div id="config-hours-grid"></div>
        <select id="config-last-order"><option value="15" selected>15 min</option></select>
      </form>
    `;
    const ui = new AdminConfigUI();
    const grid = document.getElementById("config-hours-grid");
    grid.innerHTML = ui.renderDayRow({
      day: "Mardi",
      open: "11:00",
      close: "23:00",
      hasBreak: false,
      breakStart: "15:00",
      breakEnd: "17:00",
      closed: false,
    });

    vi.spyOn(adminStore, "saveConfig").mockResolvedValue(true);
    ui.handleHoursSubmit(new Event("submit"));

    const savedHours = adminStore.state.config.hours;
    expect(savedHours).toHaveLength(1);
    expect(savedHours[0].day).toBe("Mardi");
    expect(savedHours[0].open).toBe("11:00");
    expect(savedHours[0].close).toBe("23:00");
    expect(savedHours[0].closed).toBe(false);
    expect(adminStore.state.config.lastOrderMinutesBeforeClose).toBe(15);
  });
});

