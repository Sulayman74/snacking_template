// ============================================================================
// ⭐ SMART REVIEW — Routage selon la note + invitation après N visites
// ============================================================================
// Source unique pour toute la logique d'avis :
//  - Note ≥ 4 → ouverture Google Maps Reviews (avis public)
//  - Note < 4 → scroll vers form de contact + pré-remplit la source
//  - Après 3 ouvertures de l'app, scroll auto + pulse de la section reviews
//
// L'envoi du form contact reste géré par AppUI.setupContactForm (pas de duplication).

import { store } from "./core/Store.js";

const POSITIVE_THRESHOLD = 4;
const PLACEHOLDER_LINK = "https://g.page/r/TON_LIEN_DA_AVIS/review";
const VISITS_KEY = "appVisits";
const RATED_KEY = "hasRatedApp";
const PROMPT_AT_VISIT = 3;
const PROMPT_DELAY_MS = 5000;
const PULSE_DURATION_MS = 2500;

function paintStars(stars, val) {
  stars.forEach((s, i) => {
    const filled = i < val;
    s.classList.toggle("far", !filled);
    s.classList.toggle("text-gray-300", !filled);
    s.classList.toggle("fas", filled);
    s.classList.toggle("text-yellow-400", filled);
    s.classList.toggle("scale-110", filled);
  });
}

function getGoogleLink() {
  const cfg = store.state.config;
  const link =
    cfg?.reviews?.googleMapsReviewLink ||
    cfg?.contact?.address?.googleMapsUrl ||
    null;
  return link && link !== PLACEHOLDER_LINK ? link : null;
}

function handlePositive(feedbackText) {
  feedbackText.innerHTML =
    '<span class="text-green-600 font-bold">Top ! On va sur Google... 🚀</span>';
  setTimeout(() => {
    const link = getGoogleLink();
    if (link) window.open(link, "_blank", "noopener,noreferrer");
    else
      feedbackText.innerHTML =
        '<span class="text-green-600 font-bold">Merci pour votre amour ! ❤️</span>';
  }, 1000);
}

function handleCritical(val, feedbackText, sourceAvisInput, contactSection) {
  feedbackText.innerHTML =
    '<span class="text-orange-500 font-bold">Dites-nous tout ci-dessous 👇</span>';
  if (sourceAvisInput) sourceAvisInput.value = `Note : ${val}/5`;
  setTimeout(() => {
    contactSection?.scrollIntoView({ behavior: "smooth" });
  }, 500);
}

// Compteur de visites : au PROMPT_AT_VISIT-ième chargement, on attire
// l'attention sur la section reviews (scroll + pulse), sans modal séparé.
function maybePromptAfterVisits(reviewsSection) {
  if (localStorage.getItem(RATED_KEY) === "true") return;
  if (!store.state.config?.features?.enableSmartReview) return;
  if (!reviewsSection) return;

  const visits = parseInt(localStorage.getItem(VISITS_KEY) || "0", 10) + 1;
  localStorage.setItem(VISITS_KEY, String(visits));

  if (visits !== PROMPT_AT_VISIT) return;

  setTimeout(() => {
    reviewsSection.scrollIntoView({ behavior: "smooth", block: "center" });
    reviewsSection.classList.add("animate-pulse");
    setTimeout(
      () => reviewsSection.classList.remove("animate-pulse"),
      PULSE_DURATION_MS
    );
    window.triggerVibration?.("light");
  }, PROMPT_DELAY_MS);
}

function setupReviews() {
  const stars = document.querySelectorAll("#interactive-stars i");
  const feedbackText = document.getElementById("rating-feedback");
  const sourceAvisInput = document.getElementById("source-avis");
  const contactSection = document.getElementById("contact");
  const contactForm = document.getElementById("contact-form");
  const reviewsSection = document.getElementById("reviews");

  if (!stars.length || !feedbackText) return;

  // Cleanup étoiles quand le form se reset (déclenché par AppUI après envoi réussi)
  contactForm?.addEventListener("reset", () => {
    paintStars(stars, 0);
    feedbackText.innerText = "";
    if (sourceAvisInput) sourceAvisInput.value = "contact_direct";
  });

  stars.forEach((star) => {
    star.addEventListener("click", (e) => {
      const val = parseInt(e.target.getAttribute("data-value"), 10);
      window.triggerVibration?.("light");
      paintStars(stars, val);
      // L'utilisateur a interagi → plus jamais de prompt auto
      localStorage.setItem(RATED_KEY, "true");

      if (val >= POSITIVE_THRESHOLD) handlePositive(feedbackText);
      else handleCritical(val, feedbackText, sourceAvisInput, contactSection);
    });
  });

  // Le compteur de visites a besoin de la config (feature flag) — on attend si nécessaire
  if (store.state.config) maybePromptAfterVisits(reviewsSection);
  else
    store.addEventListener(
      "config-updated",
      () => maybePromptAfterVisits(reviewsSection),
      { once: true }
    );
}

document.addEventListener("DOMContentLoaded", setupReviews);
