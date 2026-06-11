// ============================================================================
// 🚚 ADMIN LIVREURS — Création & gestion de la flotte interne
// ============================================================================
// Dépendances : window.currentAdminSnackId, window.showToast. La création
//               passe par la CF createDriver (admin SDK → crée le compte Auth
//               + users/{uid} role 'livreur').

import { escapeHTML } from "./utils.js";
import {
  db,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  updateDoc,
  httpsCallable,
  functions,
} from "./core/firebase.js";

let driversBound = false;

async function loadDriversView() {
  const snackId = window.currentAdminSnackId;
  const listEl = document.getElementById("drivers-list");
  if (!snackId || !listEl) return;

  bindDriverForm();

  listEl.innerHTML = `<p class="text-center text-gray-400 py-8"><i class="fas fa-spinner fa-spin"></i> Chargement…</p>`;

  try {
    // Composite (snackId, role) — cf. firestore.indexes.json.
    const q = query(
      collection(db, "users"),
      where("snackId", "==", snackId),
      where("role", "==", "livreur"),
    );
    const snap = await getDocs(q);
    const drivers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDrivers(drivers);
  } catch (e) {
    console.error("Erreur chargement livreurs :", e);
    listEl.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">Impossible de charger les livreurs.${e?.message?.includes("index") ? " (Index Firestore à déployer.)" : ""}</div>`;
  }

  loadDeliveriesLog(snackId);
}

// ============================================================================
// 📸 LOG DES LIVRAISONS — preuves photo (pickup/dropoff) + suivi
// ============================================================================
async function loadDeliveriesLog(snackId) {
  const el = document.getElementById("deliveries-log");
  if (!el) return;
  bindLightbox();
  el.innerHTML = `<p class="text-center text-gray-400 py-6"><i class="fas fa-spinner fa-spin"></i></p>`;

  try {
    // Réutilise l'index commandes(snackId, statut, date). On filtre mode en JS.
    const q = query(
      collection(db, "commandes"),
      where("snackId", "==", snackId),
      where("statut", "in", ["en_livraison", "livree"]),
      orderBy("date", "desc"),
      limit(20),
    );
    const snap = await getDocs(q);
    const livraisons = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => o.mode === "delivery");
    renderDeliveries(livraisons);
  } catch (e) {
    console.error("Erreur chargement livraisons :", e);
    el.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">Impossible de charger les livraisons.</div>`;
  }
}

function fmtTime(ts) {
  const t = ts?.toDate ? ts.toDate() : null;
  return t ? t.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}

function thumb(url, label, time) {
  const safe = window.safeURL ? window.safeURL(url) : url;
  if (!url) {
    return `<div class="flex flex-col items-center gap-1 opacity-40">
      <div class="w-16 h-16 rounded-lg bg-gray-100 border border-dashed border-gray-300 flex items-center justify-center text-gray-400"><i class="fas fa-image"></i></div>
      <span class="text-[10px] text-gray-400">${label}</span>
    </div>`;
  }
  return `<button type="button" data-photo="${escapeHTML(safe)}" class="flex flex-col items-center gap-1 group">
    <img src="${escapeHTML(safe)}" alt="${label}" loading="lazy" class="w-16 h-16 object-cover rounded-lg border border-gray-200 group-hover:ring-2 group-hover:ring-blue-400 transition cursor-zoom-in">
    <span class="text-[10px] text-gray-500">${label}${time ? " · " + time : ""}</span>
  </button>`;
}

function renderDeliveries(list) {
  const el = document.getElementById("deliveries-log");
  if (!el) return;

  if (list.length === 0) {
    el.innerHTML = `<div class="bg-white border border-dashed border-gray-300 rounded-2xl p-6 text-center text-gray-500 text-sm">Aucune livraison en cours ou récente.</div>`;
    return;
  }

  el.innerHTML = list
    .map((o) => {
      const livree = o.statut === "livree";
      const badge = livree
        ? `<span class="text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700">Livré</span>`
        : `<span class="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 animate-pulse">En livraison</span>`;
      const lv = o.livreur || {};
      return `
      <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
        <div class="flex justify-between items-start gap-2 mb-3">
          <div class="min-w-0">
            <p class="font-black text-gray-900 truncate">${escapeHTML(o.clientNom || "Client")}</p>
            <p class="text-sm text-gray-500 truncate"><i class="fas fa-location-dot text-blue-500 mr-1"></i>${escapeHTML(o.livraison?.adresse || "—")}</p>
            <p class="text-xs text-gray-400 mt-0.5"><i class="fas fa-motorcycle mr-1"></i>${escapeHTML(lv.nom || "—")}${o.livraison?.distanceKm != null ? " · " + escapeHTML(String(o.livraison.distanceKm)) + " km" : ""}</p>
          </div>
          ${badge}
        </div>
        <div class="flex gap-4">
          ${thumb(lv.pickupUrl, "Prise en charge", fmtTime(lv.pickupAt))}
          ${thumb(lv.dropoffUrl, "Dépôt", fmtTime(lv.dropoffAt))}
        </div>
      </div>`;
    })
    .join("");

  el.querySelectorAll("[data-photo]").forEach((btn) => {
    btn.addEventListener("click", () => openLightbox(btn.getAttribute("data-photo")));
  });
}

let lightboxBound = false;
function bindLightbox() {
  if (lightboxBound) return;
  const lb = document.getElementById("img-lightbox");
  if (!lb) return;
  lightboxBound = true;
  lb.addEventListener("click", () => {
    lb.classList.add("hidden");
    lb.classList.remove("flex");
  });
}

function openLightbox(url) {
  const lb = document.getElementById("img-lightbox");
  const img = document.getElementById("img-lightbox-img");
  if (!lb || !img) return;
  img.src = url;
  lb.classList.remove("hidden");
  lb.classList.add("flex");
}

function renderDrivers(drivers) {
  const listEl = document.getElementById("drivers-list");
  if (!listEl) return;

  if (drivers.length === 0) {
    listEl.innerHTML = `<div class="bg-white border border-dashed border-gray-300 rounded-2xl p-8 text-center text-gray-500">
      <i class="fas fa-motorcycle text-3xl text-gray-300 mb-3"></i>
      <p class="font-bold">Aucun livreur pour l'instant.</p>
      <p class="text-sm">Ajoutez votre premier livreur ci-dessus.</p>
    </div>`;
    return;
  }

  listEl.innerHTML = drivers
    .map((d) => {
      const actif = d.actif !== false;
      const initials = (d.nom || "?").trim().slice(0, 2).toUpperCase();
      return `
      <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex items-center gap-4">
        <div class="w-11 h-11 rounded-full bg-blue-100 text-blue-700 font-black flex items-center justify-center shrink-0">${escapeHTML(initials)}</div>
        <div class="min-w-0 flex-1">
          <p class="font-black text-gray-900 truncate">${escapeHTML(d.nom || "Livreur")}</p>
          <p class="text-xs text-gray-500 truncate">${escapeHTML(d.email || "")}${d.telephone ? " · " + escapeHTML(d.telephone) : ""}</p>
        </div>
        <span class="text-xs font-bold px-2.5 py-1 rounded-full ${actif ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}">${actif ? "Actif" : "Inactif"}</span>
        <button type="button" data-driver-toggle="${escapeHTML(d.id)}" data-actif="${actif}"
          class="shrink-0 text-sm font-bold px-3 py-2 rounded-lg transition active:scale-95 ${actif ? "bg-gray-100 text-gray-700 hover:bg-gray-200" : "bg-green-600 text-white hover:bg-green-700"}">
          ${actif ? "Désactiver" : "Activer"}
        </button>
      </div>`;
    })
    .join("");

  // Listeners de toggle (délégation scopée à la liste).
  listEl.querySelectorAll("[data-driver-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggleDriver(btn.getAttribute("data-driver-toggle"), btn.getAttribute("data-actif") === "true"));
  });
}

async function toggleDriver(uid, currentlyActive) {
  try {
    await updateDoc(doc(db, "users", uid), { actif: !currentlyActive });
    window.showToast?.(currentlyActive ? "Livreur désactivé." : "Livreur activé.", "success");
    loadDriversView();
  } catch (e) {
    console.error("Erreur toggle livreur :", e);
    window.showToast?.("Action impossible.", "error");
  }
}

function bindDriverForm() {
  if (driversBound) return;
  const form = document.getElementById("add-driver-form");
  if (!form) return;
  driversBound = true;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const snackId = window.currentAdminSnackId;
    if (!snackId) return window.showToast?.("Snack non identifié.", "error");

    const btn = document.getElementById("add-driver-btn");
    const fd = new FormData(form);
    const payload = {
      snackId,
      nom: (fd.get("nom") || "").toString().trim(),
      telephone: (fd.get("telephone") || "").toString().trim(),
      email: (fd.get("email") || "").toString().trim(),
      password: (fd.get("password") || "").toString(),
    };

    if (!payload.nom || !payload.email || payload.password.length < 6) {
      return window.showToast?.("Nom, email et mot de passe (≥6) requis.", "error");
    }

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Création…`;
    try {
      const createDriver = httpsCallable(functions, "createDriver");
      await createDriver(payload);
      window.showToast?.("Livreur créé ✅", "success");
      form.reset();
      loadDriversView();
    } catch (err) {
      console.error("Erreur création livreur :", err);
      const msg = err?.message?.includes("already-exists") || err?.code === "functions/already-exists"
        ? "Cet email est déjà utilisé."
        : "Création impossible. Vérifiez les informations.";
      window.showToast?.(msg, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });
}

window.loadDriversView = loadDriversView;
