// ============================================================================
// 🚚 LivreurUI — Application livreur (PWA) : courses, géoloc, PoD photos
// ============================================================================
// SOLID : géométrie/ETA/throttle dans geoService ; ici = auth + UI + I/O Firebase.
// Sécurité : le livreur n'écrit QUE livreur/livreurId/statut (cf. firestore.rules).
// Tout le sensible (notifs distance, calcul serveur) est côté Cloud Functions.

import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { escapeHTML } from "../utils.js";
import {
  haversineKm,
  watchPosition,
  shouldWritePosition,
  formatDistance,
  isLatLng,
} from "../services/geoService.js";

const VAPID_KEY =
  "BGsq0EjCQPNq2_r5LC-41oxktxZtCfBCD0GvYjiKV7n2HgEOwKWnFGwgddQfPl9ZoFi6z8AvSM1rQUJkxa1-098";

class LivreurUI {
  constructor() {
    this.snackId = null;
    this.driverName = "Livreur";
    this.coursesUnsub = null;
    this.watchStop = null;
    this.watchOrderId = null;
    this.lastWritten = null;
    this.wakeLock = null;
    this.activeOrderId = null; // pour router les photos PoD vers la bonne commande

    this.els = {
      login: document.getElementById("driver-login"),
      app: document.getElementById("driver-app"),
      loginForm: document.getElementById("driver-login-form"),
      loginError: document.getElementById("driver-login-error"),
      name: document.getElementById("driver-name"),
      initials: document.getElementById("driver-initials"),
      courses: document.getElementById("driver-courses"),
      active: document.getElementById("driver-active"),
      pickupInput: document.getElementById("pod-pickup-input"),
      dropoffInput: document.getElementById("pod-dropoff-input"),
    };

    this.init();
  }

  init() {
    this.els.loginForm?.addEventListener("submit", (e) => this.onLogin(e));
    document.getElementById("driver-logout-btn")?.addEventListener("click", () => this.logout());
    document.getElementById("driver-notif-btn")?.addEventListener("click", () => this.enableNotifs());

    // Inputs photo (PoD)
    this.els.pickupInput?.addEventListener("change", (e) => this.onPhoto(e, "pickup"));
    this.els.dropoffInput?.addEventListener("change", (e) => this.onPhoto(e, "dropoff"));

    // Délégation des actions de l'app
    this.els.app?.addEventListener("click", (e) => this.onAppClick(e));

    // Reprise du Wake Lock au retour en avant-plan
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.watchOrderId) this.requestWakeLock();
    });

    const { onAuthStateChanged } = window.authTools;
    onAuthStateChanged(window.auth, (user) => this.onAuth(user));
  }

  // --- Auth ---------------------------------------------------------------
  async onLogin(e) {
    e.preventDefault();
    const email = document.getElementById("driver-email").value.trim();
    const password = document.getElementById("driver-password").value;
    const btn = document.getElementById("driver-login-btn");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Connexion…`;
    this.els.loginError.classList.add("hidden");
    try {
      await window.authTools.signInWithEmailAndPassword(window.auth, email, password);
    } catch (err) {
      this.els.loginError.textContent = "Identifiants incorrects.";
      this.els.loginError.classList.remove("hidden");
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  async onAuth(user) {
    if (!user) return this.showLogin();
    try {
      const snap = await getDoc(doc(window.db, "users", user.uid));
      const data = snap.exists() ? snap.data() : null;
      if (!data || data.role !== "livreur" || !data.snackId) {
        window.showToast?.("Accès réservé aux livreurs.", "error");
        return this.logout();
      }
      if (data.actif === false) {
        window.showToast?.("Votre compte livreur est désactivé.", "error");
        return this.logout();
      }
      this.snackId = data.snackId;
      this.driverName = data.nom || "Livreur";
      this.els.name.textContent = this.driverName;
      this.els.initials.textContent = this.driverName.trim().slice(0, 2).toUpperCase();
      this.showApp();
      this.startListening();
    } catch (err) {
      console.error("Erreur auth livreur :", err);
      window.showToast?.("Erreur de connexion.", "error");
    }
  }

  showLogin() {
    this.cleanup();
    this.els.app.classList.add("hidden");
    this.els.app.classList.remove("flex");
    this.els.login.classList.remove("hidden");
    this.els.login.classList.add("flex");
  }

  showApp() {
    this.els.login.classList.add("hidden");
    this.els.login.classList.remove("flex");
    this.els.app.classList.remove("hidden");
    this.els.app.classList.add("flex");
  }

  async logout() {
    this.cleanup();
    try { await window.authTools.signOut(window.auth); } catch (_) {}
    this.showLogin();
  }

  // --- Écoute des courses -------------------------------------------------
  startListening() {
    if (this.coursesUnsub) this.coursesUnsub();
    // Réutilise l'index commandes(snackId, statut, date). On filtre mode/livreur en JS.
    const q = query(
      collection(window.db, "commandes"),
      where("snackId", "==", this.snackId),
      where("statut", "in", ["prete", "en_livraison"]),
      orderBy("date", "asc"),
    );
    this.coursesUnsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const uid = window.auth.currentUser?.uid;
        const mine = docs.filter((o) => o.statut === "en_livraison" && o.livreurId === uid);
        const available = docs.filter(
          (o) => o.statut === "prete" && o.mode === "delivery" && !o.livreurId,
        );
        if (mine.length > 0) this.renderActive(mine[0]);
        else this.renderActiveEmpty();
        this.renderCourses(available);
      },
      (err) => {
        console.error("Erreur écoute courses :", err);
        this.els.courses.innerHTML = errorBox(
          "Impossible de charger les courses." + (String(err?.message).includes("index") ? " (Index Firestore à déployer.)" : ""),
        );
      },
    );
  }

  // --- Rendu : liste des courses -----------------------------------------
  renderCourses(list) {
    const el = this.els.courses;
    if (this.activeOrderId) { el.innerHTML = ""; return; } // on masque la liste pendant une livraison
    if (list.length === 0) {
      el.innerHTML = `<div class="bg-white border border-dashed border-gray-300 rounded-2xl p-8 text-center text-gray-500">
        <i class="fas fa-mug-hot text-3xl text-gray-300 mb-3"></i>
        <p class="font-bold">Aucune course à récupérer.</p>
        <p class="text-sm">Les commandes prêtes apparaîtront ici.</p>
      </div>`;
      return;
    }
    el.innerHTML =
      `<h2 class="text-sm font-black text-gray-500 uppercase tracking-wide px-1 mb-2">Courses à récupérer (${list.length})</h2>` +
      list.map((o) => this.courseCard(o)).join("");
  }

  courseCard(o) {
    const items = (o.items || []).reduce((n, i) => n + (i.quantity || 1), 0);
    const dist = o.livraison?.distanceKm != null ? formatDistance(o.livraison.distanceKm) : "—";
    return `
      <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 mb-3">
        <div class="flex justify-between items-start gap-2 mb-2">
          <div class="min-w-0">
            <p class="font-black text-gray-900 truncate">${escapeHTML(o.clientNom || "Client")}</p>
            <p class="text-sm text-gray-600 truncate"><i class="fas fa-location-dot text-blue-500 mr-1"></i>${escapeHTML(o.livraison?.adresse || "Adresse")}</p>
          </div>
          <span class="shrink-0 bg-gray-900 text-white text-xs font-mono font-bold px-2 py-1 rounded">${escapeHTML(o.secretCode || "")}</span>
        </div>
        <div class="flex items-center gap-3 text-xs text-gray-500 mb-3">
          <span><i class="fas fa-box mr-1"></i>${items} article${items > 1 ? "s" : ""}</span>
          <span><i class="fas fa-route mr-1"></i>${dist}</span>
          <span><i class="fas fa-euro-sign mr-1"></i>${Number(o.total || 0).toFixed(2)}</span>
        </div>
        <button type="button" data-livreur-action="take" data-id="${escapeHTML(o.id)}"
          class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-3 rounded-xl transition active:scale-95">
          <i class="fas fa-hand-holding-box mr-2"></i> Prendre la course
        </button>
      </div>`;
  }

  // --- Rendu : course active ---------------------------------------------
  renderActiveEmpty() {
    this.activeOrderId = null;
    this.els.active.innerHTML = "";
    this.stopWatch();
  }

  renderActive(o) {
    this.activeOrderId = o.id;
    const client = o.livraison;
    const pickupDone = !!o.livraison?.preuves?.pickupUrl;
    const mapsUrl = isLatLng(client)
      ? `https://www.google.com/maps/dir/?api=1&destination=${client.lat},${client.lng}`
      : "";

    this.els.active.innerHTML = `
      <div class="bg-white rounded-2xl shadow-md border-2 border-blue-500 p-4 mb-4">
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-black text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full uppercase tracking-wide"><i class="fas fa-motorcycle mr-1"></i>En livraison</span>
          <span class="bg-gray-900 text-white text-xs font-mono font-bold px-2 py-1 rounded">${escapeHTML(o.secretCode || "")}</span>
        </div>
        <p class="font-black text-xl text-gray-900">${escapeHTML(o.clientNom || "Client")}</p>
        <p class="text-gray-600 mb-1"><i class="fas fa-location-dot text-blue-500 mr-1"></i>${escapeHTML(client?.adresse || "Adresse")}</p>
        <p class="text-sm text-gray-500 mb-3">À <b id="active-distance" class="text-gray-900">…</b> de vous</p>

        ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener" class="block w-full text-center bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-3 rounded-xl mb-2 transition"><i class="fas fa-diamond-turn-right mr-2"></i>Itinéraire</a>` : ""}

        <button type="button" data-livreur-action="pickup"
          class="w-full ${pickupDone ? "bg-green-100 text-green-700" : "bg-gray-900 text-white hover:bg-black"} font-bold py-3 rounded-xl mb-2 transition active:scale-95">
          <i class="fas ${pickupDone ? "fa-check" : "fa-camera"} mr-2"></i>${pickupDone ? "Prise en charge confirmée" : "Photo de prise en charge"}
        </button>

        <button type="button" data-livreur-action="deliver"
          class="w-full bg-green-600 hover:bg-green-700 text-white font-black py-4 rounded-xl transition active:scale-95">
          <i class="fas fa-camera mr-2"></i> J'ai livré (photo)
        </button>
      </div>`;

    // Démarre/relance le suivi GPS pour cette course
    if (this.watchOrderId !== o.id) {
      this.stopWatch();
      this.startWatch(o);
    }
    this.updateActiveDistance(this.lastWritten, client);
  }

  // --- Prise en charge (claim transactionnel) ----------------------------
  async takeCourse(orderId) {
    const uid = window.auth.currentUser?.uid;
    if (!uid) return;
    try {
      await runTransaction(window.db, async (tx) => {
        const ref = doc(window.db, "commandes", orderId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("introuvable");
        const d = snap.data();
        if (d.statut !== "prete" || d.livreurId) throw new Error("déjà prise");
        tx.update(ref, {
          livreurId: uid,
          statut: "en_livraison",
          livreur: { nom: this.driverName, position: null, lastNotifiedBucket: null },
        });
      });
      window.triggerVibration?.("success");
      window.showToast?.("Course acceptée ! En route 🛵", "success");
    } catch (err) {
      const msg = String(err?.message).includes("déjà") ? "Course déjà prise par un autre livreur." : "Impossible de prendre la course.";
      window.showToast?.(msg, "error");
    }
  }

  // --- Photos PoD ---------------------------------------------------------
  triggerPhoto(kind) {
    if (!this.activeOrderId) return;
    (kind === "pickup" ? this.els.pickupInput : this.els.dropoffInput)?.click();
  }

  async onPhoto(e, kind) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset pour permettre reprise
    if (!file || !this.activeOrderId) return;
    const orderId = this.activeOrderId;
    window.showToast?.("Envoi de la photo…", "success");
    try {
      const blob = await compressImage(file);
      const url = await uploadPod(this.snackId, orderId, kind, blob);
      const ref = doc(window.db, "commandes", orderId);

      // PoD stocké sous livreur.* : c'est le SEUL espace que les règles Firestore
      // autorisent le livreur à écrire (affectedKeys = {livreur}). Champs pointés
      // pour ne pas écraser livreur.position mise à jour par le suivi GPS.
      if (kind === "pickup") {
        await updateDoc(ref, {
          "livreur.pickupUrl": url,
          "livreur.pickupAt": serverTimestamp(),
        });
        window.showToast?.("Prise en charge confirmée ✅", "success");
      } else {
        // Dépôt → commande livrée. On purge la position (RGPD).
        await updateDoc(ref, {
          statut: "livree",
          "livreur.dropoffUrl": url,
          "livreur.dropoffAt": serverTimestamp(),
          "livreur.position": null,
        });
        window.triggerVibration?.("success");
        window.showToast?.("Livraison validée ! Merci 🎉", "success");
        this.stopWatch();
      }
    } catch (err) {
      console.error("Erreur PoD :", err);
      window.showToast?.("Échec de l'envoi de la photo.", "error");
    }
  }

  // --- Suivi GPS (throttlé) ----------------------------------------------
  startWatch(order) {
    this.watchOrderId = order.id;
    this.lastWritten = null;
    this.requestWakeLock();
    const client = order.livraison;

    this.watchStop = watchPosition(
      (pos) => {
        this.updateActiveDistance(pos, client);
        const now = Date.now();
        if (shouldWritePosition(this.lastWritten, pos, now)) {
          this.lastWritten = { lat: pos.lat, lng: pos.lng, t: now };
          updateDoc(doc(window.db, "commandes", order.id), {
            "livreur.position": { lat: pos.lat, lng: pos.lng, updatedAt: serverTimestamp() },
          }).catch((e) => console.warn("write position:", e.message));
        }
      },
      (err) => {
        if (err.code === "denied") window.showToast?.("Activez la localisation pour le suivi.", "error");
      },
    );
  }

  stopWatch() {
    if (this.watchStop) { this.watchStop(); this.watchStop = null; }
    this.watchOrderId = null;
    this.releaseWakeLock();
  }

  updateActiveDistance(pos, client) {
    const el = document.getElementById("active-distance");
    if (!el) return;
    if (!isLatLng(pos) || !isLatLng(client)) { el.textContent = "…"; return; }
    el.textContent = formatDistance(haversineKm(pos, client));
  }

  // --- Wake Lock ----------------------------------------------------------
  async requestWakeLock() {
    if (!("wakeLock" in navigator) || this.wakeLock) return;
    try { this.wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}
  }
  releaseWakeLock() {
    try { this.wakeLock?.release(); } catch (_) {}
    this.wakeLock = null;
  }

  // --- Notifications (FCM token pour le livreur) -------------------------
  async enableNotifs() {
    try {
      if (!("Notification" in window)) return window.showToast?.("Notifications non supportées.", "error");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return window.showToast?.("Notifications refusées.", "error");
      const reg = await navigator.serviceWorker.ready;
      const token = await window.authTools.getToken(window.messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
      const uid = window.auth.currentUser?.uid;
      if (token && uid) {
        await updateDoc(doc(window.db, "users", uid), { fcmToken: token });
        window.showToast?.("Notifications activées 🔔", "success");
      }
    } catch (err) {
      console.error("Erreur notif livreur :", err);
    }
  }

  // --- Divers -------------------------------------------------------------
  onAppClick(e) {
    const btn = e.target.closest("[data-livreur-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-livreur-action");
    if (action === "take") this.takeCourse(btn.getAttribute("data-id"));
    else if (action === "pickup") this.triggerPhoto("pickup");
    else if (action === "deliver") this.triggerPhoto("dropoff");
  }

  cleanup() {
    if (this.coursesUnsub) { this.coursesUnsub(); this.coursesUnsub = null; }
    this.stopWatch();
    this.activeOrderId = null;
  }
}

// ============================================================================
// Helpers : compression image (Canvas) + upload Storage
// ============================================================================
function compressImage(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width >= height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("compress failed"))), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

async function uploadPod(snackId, orderId, kind, blob) {
  const { ref, uploadBytes, getDownloadURL } = window.storageTools;
  const path = `pod/${snackId}/${orderId}/${kind}_${Date.now()}.jpg`;
  const r = ref(window.storage, path);
  await uploadBytes(r, blob, { contentType: "image/jpeg" });
  return getDownloadURL(r);
}

function errorBox(msg) {
  return `<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">${escapeHTML(msg)}</div>`;
}

export const livreurUI = new LivreurUI();
