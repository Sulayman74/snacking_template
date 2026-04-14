// ============================================================================
// ⚙️ ADMIN-CONFIG — Configuration (Identité, Horaires avec coupure)
// ============================================================================
//
// Structure Firestore par jour :
// {
//   day       : "Lundi",
//   closed    : false,
//   open      : "11:30",
//   close     : "22:30",
//   hasBreak  : true,      // ← coupure activée
//   breakStart: "15:00",   // ← fermeture coupure
//   breakEnd  : "17:00",   // ← réouverture après coupure
// }
// ============================================================================

window.loadConfigView = async () => {
  if (!window.currentAdminSnackId) return;
  const { doc, getDoc } = window.fs;

  try {
    const snackRef = doc(window.db, "snacks", window.currentAdminSnackId);
    const snackSnap = await getDoc(snackRef);

    if (!snackSnap.exists()) return;
    const data = snackSnap.data();

    // 1. Identité & Promo
    document.getElementById("config-description").value =
      data.description || "";
    document.getElementById("config-promo").value = data.promoPhrase || "";

    // 2. Horaires
    const days = [
      "Lundi",
      "Mardi",
      "Mercredi",
      "Jeudi",
      "Vendredi",
      "Samedi",
      "Dimanche",
    ];

    const currentHours =
      data.hours ||
      days.map((d) => ({
        day: d,
        open: "11:30",
        close: "22:30",
        closed: false,
        hasBreak: false,
        breakStart: "15:00",
        breakEnd: "17:00",
      }));

    const hoursGrid = document.getElementById("config-hours-grid");
    hoursGrid.innerHTML = currentHours.map((h) => renderDayRow(h)).join("");

  } catch (error) {
    console.error("Erreur chargement config:", error);
    window.showToast("Erreur lors du chargement des réglages.", "error");
  }
};

// ----------------------------------------------------------------------------
// Génère le HTML d'une ligne de jour avec support coupure
// ----------------------------------------------------------------------------
function renderDayRow(h) {
  const isClosed   = h.closed   ?? false;
  const hasBreak   = h.hasBreak ?? false;

  return `
  <div class="day-row flex flex-col gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100">

    <!-- Ligne principale : nom + plage 1 + Fermé -->
    <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3">
      <span class="w-20 font-bold text-gray-700 shrink-0">${h.day}</span>

      <!-- Plage principale -->
      <div class="flex items-center gap-2 ${isClosed ? "opacity-40 pointer-events-none" : ""}">
        <input type="time" class="hour-open p-2 rounded-lg border border-gray-200 text-sm"
          value="${h.open || "11:30"}" ${isClosed ? "disabled" : ""}>
        <span class="text-gray-400">–</span>
        <input type="time" class="hour-close p-2 rounded-lg border border-gray-200 text-sm"
          value="${h.close || "22:30"}" ${isClosed ? "disabled" : ""}>
      </div>

      <!-- Bouton coupure -->
      <button type="button"
        class="break-toggle text-xs px-3 py-1.5 rounded-lg font-bold border transition ${hasBreak && !isClosed
          ? "bg-orange-100 border-orange-300 text-orange-700"
          : "bg-gray-100 border-gray-200 text-gray-400 hover:text-gray-700"} ${isClosed ? "opacity-30 pointer-events-none" : ""}"
        onclick="toggleBreakRow(this)"
        title="Ajouter une coupure (ex : fermeture 15h → 17h)">
        <i class="fas fa-coffee mr-1"></i>Coupure
      </button>

      <!-- Fermé -->
      <label class="flex items-center gap-2 cursor-pointer ml-auto shrink-0">
        <input type="checkbox" class="hour-closed w-5 h-5 rounded text-red-600"
          ${isClosed ? "checked" : ""}
          onchange="toggleDayClosed(this)">
        <span class="text-sm font-bold text-gray-500">Fermé</span>
      </label>
    </div>

    <!-- Ligne coupure (masquée par défaut) -->
    <div class="break-row flex items-center gap-2 pl-0 sm:pl-24 ${hasBreak && !isClosed ? "" : "hidden"}">
      <i class="fas fa-coffee text-orange-400 text-sm shrink-0"></i>
      <span class="text-xs font-bold text-orange-600 shrink-0">Ferme à</span>
      <input type="time" class="hour-break-start p-2 rounded-lg border border-orange-200 text-sm bg-orange-50"
        value="${h.breakStart || "15:00"}" ${isClosed ? "disabled" : ""}>
      <span class="text-xs font-bold text-orange-600 shrink-0">réouvre à</span>
      <input type="time" class="hour-break-end p-2 rounded-lg border border-orange-200 text-sm bg-orange-50"
        value="${h.breakEnd || "17:00"}" ${isClosed ? "disabled" : ""}>
    </div>

  </div>`;
}

// ----------------------------------------------------------------------------
// Toggle affichage de la ligne coupure
// ----------------------------------------------------------------------------
window.toggleBreakRow = (btn) => {
  const row      = btn.closest(".day-row");
  const breakRow = row.querySelector(".break-row");
  const isHidden = breakRow.classList.contains("hidden");

  breakRow.classList.toggle("hidden", !isHidden);
  btn.classList.toggle("bg-orange-100",   isHidden);
  btn.classList.toggle("border-orange-300", isHidden);
  btn.classList.toggle("text-orange-700", isHidden);
  btn.classList.toggle("bg-gray-100",     !isHidden);
  btn.classList.toggle("border-gray-200", !isHidden);
  btn.classList.toggle("text-gray-400",   !isHidden);
};

// ----------------------------------------------------------------------------
// Toggle Fermé : désactive tous les inputs du row
// ----------------------------------------------------------------------------
window.toggleDayClosed = (checkbox) => {
  const row    = checkbox.closest(".day-row");
  const inputs = row.querySelectorAll("input[type=time]");
  const breakToggle = row.querySelector(".break-toggle");
  const breakRow    = row.querySelector(".break-row");

  inputs.forEach((i) => (i.disabled = checkbox.checked));

  if (checkbox.checked) {
    breakRow.classList.add("hidden");
    breakToggle.classList.add("opacity-30", "pointer-events-none");
  } else {
    breakToggle.classList.remove("opacity-30", "pointer-events-none");
  }

  // Grise visuellement la plage principale
  row.querySelector(".flex.items-center.gap-2")?.classList.toggle(
    "opacity-40",
    checkbox.checked
  );
};

// ============================================================================
// SAVE — Identité
// ============================================================================
document
  .getElementById("config-identity-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const desc  = document.getElementById("config-description").value;
    const promo = document.getElementById("config-promo").value;

    const { doc, updateDoc } = window.fs;
    try {
      await updateDoc(doc(window.db, "snacks", window.currentAdminSnackId), {
        description : desc,
        promoPhrase : promo,
      });
      window.showToast("Identité mise à jour !");
    } catch (error) {
      console.error("Erreur save identity:", error);
      window.showToast("Erreur lors de l'enregistrement.", "error");
    }
  });

// ============================================================================
// SAVE — Horaires (avec coupure)
// ============================================================================
document
  .getElementById("config-hours-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const rows  = document.getElementById("config-hours-grid").querySelectorAll(".day-row");
    const hours = [];

    for (const row of rows) {
      const day        = row.querySelector("span.font-bold").innerText.trim();
      const open       = row.querySelector(".hour-open").value;
      const close      = row.querySelector(".hour-close").value;
      const closed     = row.querySelector(".hour-closed").checked;
      const breakRow   = row.querySelector(".break-row");
      const hasBreak   = !breakRow.classList.contains("hidden");
      const breakStart = row.querySelector(".hour-break-start").value;
      const breakEnd   = row.querySelector(".hour-break-end").value;

      hours.push({ day, open, close, closed, hasBreak, breakStart, breakEnd });
    }

    const { doc, updateDoc } = window.fs;
    try {
      await updateDoc(doc(window.db, "snacks", window.currentAdminSnackId), {
        hours,
      });
      window.showToast("Horaires mis à jour !");
    } catch (error) {
      console.error("Erreur save hours:", error);
      window.showToast("Erreur lors de l'enregistrement.", "error");
    }
  });