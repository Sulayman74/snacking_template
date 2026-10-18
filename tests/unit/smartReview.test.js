// @vitest-environment jsdom
// ⭐ Smart review — régression : les étoiles sont des <button data-value> et le clic peut
// partir du <svg> lucide interne (pointer-events:none en prod, mais jsdom l'ignore : on
// vise donc explicitement l'icône pour vérifier que currentTarget porte la note).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupReviews, paintStars } from "../../src/smart-review.js";

function mountDom() {
  document.body.innerHTML = `
    <section id="reviews">
      <div id="interactive-stars">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-value="${n}" class="text-text-muted"><svg class="lucide"><path /></svg></button>`).join("")}
      </div>
      <p id="rating-feedback"></p>
    </section>
    <section id="contact"><form id="contact-form"><input id="source-avis" value="contact_direct" /></form></section>`;
}

beforeEach(() => {
  mountDom();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  window.open = vi.fn();
  setupReviews();
});

describe("smart review — clic sur les étoiles", () => {
  it("un clic parti du <svg> de la 4e étoile note 4 et remplit 4 étoiles", () => {
    document.querySelector('button[data-value="4"] path').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const filled = [...document.querySelectorAll("#interactive-stars button")].map((b) => b.classList.contains("text-rating"));
    expect(filled).toEqual([true, true, true, true, false]);
    expect(document.getElementById("rating-feedback").textContent).toMatch(/Top/);
    expect(localStorage.getItem("hasRatedApp")).toBe("true");
  });

  it("une note < 4 oriente vers le formulaire et pré-remplit la source", () => {
    document.querySelector('button[data-value="2"]').click();
    expect(document.getElementById("rating-feedback").textContent).toMatch(/Dites-nous tout/);
    expect(document.getElementById("source-avis").value).toBe("Note : 2/5");
    expect(document.querySelectorAll("#interactive-stars .text-rating").length).toBe(2);
  });

  it("paintStars(0) remet toutes les étoiles en neutre (reset du formulaire)", () => {
    const stars = document.querySelectorAll("#interactive-stars button");
    paintStars(stars, 5);
    document.getElementById("contact-form").dispatchEvent(new Event("reset"));
    expect(document.querySelectorAll("#interactive-stars .text-rating").length).toBe(0);
    expect(stars[0].getAttribute("aria-pressed")).toBe("false");
    expect(document.getElementById("source-avis").value).toBe("contact_direct");
  });
});
