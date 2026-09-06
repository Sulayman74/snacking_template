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
import {
  auth,
  db,
  storage,
  messaging,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  getToken,
  storageTools,
} from "../core/firebase.js";
import { escapeHTML } from "../utils.js";
import {
  haversineKm,
  watchPosition,
  getCurrentPosition,
  shouldWritePosition,
  formatDistance,
  isLatLng,
} from "../services/geoService.js";

const VAPID_KEY =
  "BGsq0EjCQPNq2_r5LC-41oxktxZtCfBCD0GvYjiKV7n2HgEOwKWnFGwgddQfPl9ZoFi6z8AvSM1rQUJkxa1-098";

// Rayon d'arrivée : on n'autorise la photo de livraison que si le livreur est à
// moins de X mètres de l'adresse client (anti-validation à distance). Généreux
// pour absorber l'imprécision GPS / d'un géocodage d'adresse.
const DELIVERY_PROXIMITY_M = 200;

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
    this.activeOrder = null; // commande en cours de livraison (état complet)
    this.lastPos = null; // dernière position GPS (chaque tick, non throttlée)
    this.pending = null; // photo en attente d'aperçu/confirmation { kind, blob, orderId, url }

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

    // Aide "Comment ça marche"
    document.getElementById("driver-help-btn")?.addEventListener("click", () => this.toggleHelp(true));
    document.getElementById("driver-help-close")?.addEventListener("click", () => this.toggleHelp(false));
    document.getElementById("driver-help-ok")?.addEventListener("click", () => this.toggleHelp(false));

    // Inputs photo (PoD) → aperçu avant envoi
    this.els.pickupInput?.addEventListener("change", (e) => this.onPhotoSelected(e, "pickup"));
    this.els.dropoffInput?.addEventListener("change", (e) => this.onPhotoSelected(e, "dropoff"));
    document.getElementById("pod-confirm-btn")?.addEventListener("click", () => this.confirmPhoto());
    document.getElementById("pod-retake-btn")?.addEventListener("click", () => this.retakePhoto());

    // Délégation des actions de l'app
    this.els.app?.addEventListener("click", (e) => this.onAppClick(e));

    // Reprise du Wake Lock au retour en avant-plan
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.watchOrderId) this.requestWakeLock();
    });

    onAuthStateChanged(auth, (user) => this.onAuth(user));
  }

  // --- Auth ---------------------------------------------------------------
  async onLogin(e) {
    e.preventDefault();
    const email = document.getElementById("driver-email").value.trim();
    const password = document.getElementById("driver-password").value;
    const btn = document.getElementById("driver-login-btn");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-circle" class="animate-spin"></i> Connexion…`;
    this.els.loginError.classList.add("hidden");
    try {
      await signInWithEmailAndPassword(auth, email, password);
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
      const snap = await getDoc(doc(db, "users", user.uid));
      const data = snap.exists() ? snap.data() : null;
      if (!data) {
        window.showToast?.("Accès refusé.", "error");
        return this.logout();
      }

      // 👑 Superadmin : pilote n'importe quelle app livreur via ?s=<id> (lien depuis
      // le dashboard superadmin). Les rules autorisent déjà isSuperAdmin/isSnackAdmin.
      if (data.role === "superadmin") {
        const target = new URLSearchParams(window.location.search).get("s");
        if (!target) {
          window.showToast?.("Superadmin : ouvrez une app livreur depuis votre dashboard.", "error");
          return this.logout();
        }
        this.snackId = target;
        this.driverName = "Superadmin 👑";
        const sb = document.createElement("div");
        sb.textContent = "👑 Mode superadmin — app livreur d'un resto";
        sb.className = "fixed top-0 inset-x-0 z-[400] bg-purple-700 text-white text-center text-[11px] font-bold py-1 shadow";
        document.body.appendChild(sb);
      } else {
        if (data.role !== "livreur" || !data.snackId) {
          window.showToast?.("Accès réservé aux livreurs.", "error");
          return this.logout();
        }
        if (data.actif === false) {
          window.showToast?.("Votre compte livreur est désactivé.", "error");
          return this.logout();
        }
        this.snackId = data.snackId;
        this.driverName = data.nom || "Livreur";
      }

      this.els.name.textContent = this.driverName;
      this.els.initials.textContent = this.driverName.trim().slice(0, 2).toUpperCase();
      this.showApp();
      this.startListening();
      this.renderPerms();
      // Ouvre l'aide au tout premier login (une seule fois).
      if (!localStorage.getItem("livreur_help_seen")) {
        this.toggleHelp(true);
        localStorage.setItem("livreur_help_seen", "1");
      }
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
    try { await signOut(auth); } catch (_) {}
    this.showLogin();
  }

  // --- Écoute des courses -------------------------------------------------
  startListening() {
    if (this.coursesUnsub) this.coursesUnsub();
    // Index commandes(snackId, mode, statut, date) — cf. firestore.indexes.json.
    // On filtre mode='delivery' CÔTÉ SERVEUR : un livreur ne traite que des
    // livraisons. Évite de télécharger (et facturer) les commandes click&collect
    // 'prete' qui étaient jusqu'ici récupérées puis jetées en JS.
    const q = query(
      collection(db, "commandes"),
      where("snackId", "==", this.snackId),
      where("mode", "==", "delivery"),
      where("statut", "in", ["prete", "en_livraison"]),
      orderBy("date", "asc"),
    );
    this.coursesUnsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const uid = auth.currentUser?.uid;
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
      el.innerHTML = `<div class="bg-surface border border-dashed border-line rounded-2xl p-8 text-center text-text-muted">
        <i data-lucide="coffee" class="text-3xl text-text-muted mb-3"></i>
        <p class="font-bold">Aucune course à récupérer.</p>
        <p class="text-sm">Les commandes prêtes apparaîtront ici.</p>
      </div>`;
      return;
    }
    el.innerHTML =
      `<h2 class="text-sm font-black text-text-muted uppercase tracking-wide px-1 mb-2">Courses à récupérer (${list.length})</h2>` +
      list.map((o) => this.courseCard(o)).join("");
  }

  courseCard(o) {
    const items = (o.items || []).reduce((n, i) => n + (i.quantity || 1), 0);
    const dist = o.livraison?.distanceKm != null ? formatDistance(o.livraison.distanceKm) : "—";
    return `
      <div class="bg-surface rounded-2xl shadow-sm border border-line p-4 mb-3">
        <div class="flex justify-between items-start gap-2 mb-2">
          <div class="min-w-0">
            <p class="font-black text-text truncate">${escapeHTML(o.clientNom || "Client")}</p>
            <p class="text-sm text-text-muted truncate"><i data-lucide="map-pin" class="text-blue-500 mr-1"></i>${escapeHTML(o.livraison?.adresse || "Adresse")}</p>
          </div>
          <span class="shrink-0 bg-surface-2 text-text border border-line text-xs font-mono font-bold px-2 py-1 rounded">${escapeHTML(o.secretCode || "")}</span>
        </div>
        <div class="flex items-center gap-3 text-xs text-text-muted mb-3">
          <span><i data-lucide="box" class="mr-1"></i>${items} article${items > 1 ? "s" : ""}</span>
          <span><i data-lucide="route" class="mr-1"></i>${dist}</span>
          <span><i data-lucide="euro" class="mr-1"></i>${Number(o.total || 0).toFixed(2)}</span>
        </div>
        <button type="button" data-livreur-action="take" data-id="${escapeHTML(o.id)}"
          class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-3 rounded-xl transition active:scale-95">
          <i data-lucide="package" class="mr-2"></i> Prendre la course
        </button>
      </div>`;
  }

  // --- Rendu : course active ---------------------------------------------
  renderActiveEmpty() {
    this.activeOrderId = null;
    this.activeOrder = null;
    this.els.active.innerHTML = "";
    this.stopWatch();
  }

  renderActive(o) {
    this.activeOrderId = o.id;
    this.activeOrder = o;
    const client = o.livraison;
    // PoD stocké sous livreur.* (contrainte des règles Firestore).
    const pickupDone = !!o.livreur?.pickupUrl;
    const mapsUrl = isLatLng(client)
      ? `https://www.google.com/maps/dir/?api=1&destination=${client.lat},${client.lng}`
      : "";

    this.els.active.innerHTML = `
      <div class="bg-surface rounded-2xl shadow-md border-2 border-blue-500 p-4 mb-4">
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-black text-blue-700 dark:text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-full uppercase tracking-wide"><i data-lucide="bike" class="mr-1"></i>En livraison</span>
          <span class="bg-surface-2 text-text border border-line text-xs font-mono font-bold px-2 py-1 rounded">${escapeHTML(o.secretCode || "")}</span>
        </div>
        <p class="font-black text-xl text-text">${escapeHTML(o.clientNom || "Client")}</p>
        <p class="text-text-muted mb-1"><i data-lucide="map-pin" class="text-blue-500 mr-1"></i>${escapeHTML(client?.adresse || "Adresse")}</p>
        <p class="text-sm text-text-muted mb-3">À <b id="active-distance" class="text-text">…</b> de vous</p>

        ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener" class="block w-full text-center bg-surface-2 hover:bg-surface-3 text-text font-bold py-3 rounded-xl mb-2 transition"><i data-lucide="navigation" class="mr-2"></i>Itinéraire</a>` : ""}

        <button type="button" data-livreur-action="pickup" ${pickupDone ? "disabled" : ""}
          class="w-full ${pickupDone ? "bg-green-500/10 text-green-700 dark:text-green-400 cursor-default" : "bg-primary text-white hover:opacity-90"} font-bold py-3 rounded-xl mb-2 transition active:scale-95">
          <i data-lucide="${pickupDone ? "check" : "camera"}" class="mr-2"></i>${pickupDone ? "Prise en charge confirmée" : "1. Photo de prise en charge"}
        </button>

        <button type="button" data-livreur-action="deliver" id="deliver-btn"
          class="w-full bg-green-600 hover:bg-green-700 text-white font-black py-4 rounded-xl transition active:scale-95">
          <i data-lucide="camera" class="mr-2"></i> 2. J'ai livré (photo)
        </button>
        <p id="deliver-hint" class="text-center text-xs mt-2 min-h-4"></p>
      </div>`;

    // Démarre/relance le suivi GPS pour cette course
    if (this.watchOrderId !== o.id) {
      this.stopWatch();
      this.startWatch(o);
    }
    this.updateActiveDistance(this.lastPos || this.lastWritten, client);
    this.refreshDeliverButton();
  }

  // Conditions pour autoriser la photo de livraison.
  canDeliver(o) {
    if (!o) return { ok: false, reason: "" };
    if (!o.livreur?.pickupUrl) return { ok: false, reason: "Confirmez d'abord la photo de prise en charge." };
    const client = o.livraison;
    if (!isLatLng(client)) return { ok: true, reason: "" }; // pas de géo client → on ne bloque pas
    const pos = this.lastPos || this.lastWritten;
    if (!isLatLng(pos)) {
      return { ok: false, reason: this.gpsError ? "Activez la localisation pour valider la livraison." : "Localisation en cours…" };
    }
    const distM = haversineKm(pos, client) * 1000;
    if (distM > DELIVERY_PROXIMITY_M) {
      return { ok: false, reason: `Rapprochez-vous du client (${formatDistance(distM / 1000)})` };
    }
    return { ok: true, reason: "" };
  }

  // Active/désactive le bouton "J'ai livré" selon la proximité + la prise en charge.
  refreshDeliverButton() {
    const btn = document.getElementById("deliver-btn");
    const hint = document.getElementById("deliver-hint");
    if (!btn) return;
    const gate = this.canDeliver(this.activeOrder);
    btn.disabled = !gate.ok;
    btn.classList.toggle("opacity-50", !gate.ok);
    btn.classList.toggle("cursor-not-allowed", !gate.ok);
    if (hint) {
      hint.textContent = gate.ok ? "" : gate.reason;
      hint.className = `text-center text-xs mt-2 min-h-4 ${gate.ok ? "text-text-muted" : "text-amber-600 dark:text-amber-400 font-bold"}`;
    }
  }

  // --- Prise en charge (claim transactionnel) ----------------------------
  async takeCourse(orderId) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "commandes", orderId);
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

  // Étape 1 : photo prise → compression → APERÇU (pas d'envoi immédiat).
  async onPhotoSelected(e, kind) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset pour permettre une reprise
    if (!file || !this.activeOrderId) return;
    try {
      const blob = await compressImage(file);
      if (this.pending?.url) URL.revokeObjectURL(this.pending.url);
      this.pending = { kind, blob, orderId: this.activeOrderId, url: URL.createObjectURL(blob) };
      this.showPreview();
    } catch (err) {
      console.error("Erreur compression photo :", err);
      window.showToast?.("Photo illisible, réessayez.", "error");
    }
  }

  showPreview() {
    const modal = document.getElementById("pod-preview-modal");
    const img = document.getElementById("pod-preview-img");
    const title = document.getElementById("pod-preview-title");
    if (img) img.src = this.pending.url;
    if (title) title.textContent = this.pending.kind === "pickup" ? "Photo de prise en charge" : "Photo de livraison";
    modal?.classList.remove("hidden");
    modal?.classList.add("flex");
  }

  hidePreview() {
    const modal = document.getElementById("pod-preview-modal");
    modal?.classList.add("hidden");
    modal?.classList.remove("flex");
    if (this.pending?.url) URL.revokeObjectURL(this.pending.url);
    this.pending = null;
  }

  retakePhoto() {
    const kind = this.pending?.kind;
    this.hidePreview();
    if (kind) this.triggerPhoto(kind);
  }

  // Étape 2 : confirmation → upload Storage + écriture Firestore.
  async confirmPhoto() {
    if (!this.pending) return;
    const { kind, blob, orderId } = this.pending;
    const btn = document.getElementById("pod-confirm-btn");
    const original = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-circle" class="animate-spin mr-2"></i>Envoi…'; }
    try {
      const url = await uploadPod(this.snackId, orderId, kind, blob);
      const ref = doc(db, "commandes", orderId);

      // PoD stocké sous livreur.* : seul espace autorisé au livreur par les règles
      // (affectedKeys = {livreur}). Champs pointés → ne pas écraser livreur.position.
      if (kind === "pickup") {
        await updateDoc(ref, { "livreur.pickupUrl": url, "livreur.pickupAt": serverTimestamp() });
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
      this.hidePreview();
    } catch (err) {
      console.error("Erreur PoD :", err);
      window.showToast?.("Échec de l'envoi de la photo.", "error");
      // On garde l'aperçu ouvert pour permettre un nouvel essai.
    } finally {
      if (btn) { btn.disabled = false; if (original) btn.innerHTML = original; }
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
        this.lastPos = pos; // chaque tick (non throttlé) → distance + gating bouton
        this.gpsError = false;
        this.updateActiveDistance(pos, client);
        this.refreshDeliverButton();
        const now = Date.now();
        if (shouldWritePosition(this.lastWritten, pos, now)) {
          this.lastWritten = { lat: pos.lat, lng: pos.lng, t: now };
          updateDoc(doc(db, "commandes", order.id), {
            "livreur.position": { lat: pos.lat, lng: pos.lng, updatedAt: serverTimestamp() },
          }).catch((e) => console.warn("write position:", e.message));
        }
      },
      (err) => {
        this.gpsError = true;
        this.refreshDeliverButton();
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
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
      const uid = auth.currentUser?.uid;
      if (token && uid) {
        await updateDoc(doc(db, "users", uid), { fcmToken: token });
        window.showToast?.("Notifications activées 🔔", "success");
      }
    } catch (err) {
      console.error("Erreur notif livreur :", err);
    } finally {
      this.renderPerms();
    }
  }

  // --- Onboarding permissions (notifs + géoloc) ---------------------------
  async geoPermState() {
    if (!navigator.permissions?.query) return "unknown";
    try {
      const s = await navigator.permissions.query({ name: "geolocation" });
      return s.state; // granted | denied | prompt
    } catch {
      return "unknown";
    }
  }

  async renderPerms() {
    const el = document.getElementById("driver-perms");
    if (!el) return;
    const notif = "Notification" in window ? Notification.permission : "unsupported";
    const geo = await this.geoPermState();
    // Tout est OK → on masque la carte (geo "unknown" = navigateur sans Permissions API,
    // on ne bloque pas l'affichage de la carte sur ce seul critère).
    if (notif === "granted" && geo === "granted") {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `
      <div class="bg-surface rounded-2xl border border-blue-500/30 p-4 mb-2 shadow-sm">
        <p class="font-black text-text mb-1"><i data-lucide="zap" class="text-blue-500 mr-1"></i>Activer mon espace</p>
        <p class="text-xs text-text-muted mb-2">Pour recevoir les courses et être suivi pendant les livraisons.</p>
        ${this.permRow("notifs", "Notifications", "bell", notif === "granted", notif === "denied")}
        ${this.permRow("geo", "Localisation", "map-pin", geo === "granted", geo === "denied")}
      </div>`;
  }

  permRow(kind, label, icon, ok, denied) {
    const right = ok
      ? `<span class="text-green-600 dark:text-green-400 font-bold text-sm shrink-0"><i data-lucide="circle-check" class="mr-1"></i>Activé</span>`
      : denied
        ? `<span class="text-[11px] text-amber-600 dark:text-amber-400 font-bold shrink-0 text-right">Bloqué — à réactiver<br>dans les réglages</span>`
        : `<button type="button" data-livreur-action="enable-${kind}" class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-3 py-1.5 rounded-lg active:scale-95 transition shrink-0">Activer</button>`;
    return `<div class="flex items-center justify-between gap-3 py-2 border-t border-line first:border-0">
      <span class="font-bold text-text text-sm"><i data-lucide="${icon}" class="text-text-muted mr-2"></i>${label}</span>
      ${right}
    </div>`;
  }

  async enableGeo() {
    try {
      const pos = await getCurrentPosition({ timeout: 10000 }); // déclenche le prompt natif
      this.lastPos = pos;
      this.gpsError = false;
      window.showToast?.("Localisation activée 📍", "success");
    } catch (e) {
      window.showToast?.(
        e.code === "denied" ? "Localisation refusée. Activez-la dans les réglages." : "Localisation indisponible.",
        "error",
      );
    } finally {
      this.renderPerms();
      this.refreshDeliverButton();
    }
  }

  toggleHelp(show) {
    const modal = document.getElementById("driver-help-modal");
    if (!modal) return;
    modal.classList.toggle("hidden", !show);
    modal.classList.toggle("flex", show);
  }

  // --- Divers -------------------------------------------------------------
  onAppClick(e) {
    const btn = e.target.closest("[data-livreur-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-livreur-action");
    if (action === "take") this.takeCourse(btn.getAttribute("data-id"));
    else if (action === "pickup") this.triggerPhoto("pickup");
    else if (action === "deliver") {
      const gate = this.canDeliver(this.activeOrder);
      if (!gate.ok) { if (gate.reason) window.showToast?.(gate.reason, "error"); return; }
      this.triggerPhoto("dropoff");
    } else if (action === "enable-notifs") this.enableNotifs();
    else if (action === "enable-geo") this.enableGeo();
  }

  cleanup() {
    if (this.coursesUnsub) { this.coursesUnsub(); this.coursesUnsub = null; }
    this.stopWatch();
    this.hidePreview();
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
  const { ref, uploadBytes, getDownloadURL } = storageTools;
  const path = `pod/${snackId}/${orderId}/${kind}_${Date.now()}.jpg`;
  const r = ref(storage, path);
  await uploadBytes(r, blob, { contentType: "image/jpeg" });
  return getDownloadURL(r);
}

function errorBox(msg) {
  return `<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">${escapeHTML(msg)}</div>`;
}

export const livreurUI = new LivreurUI();
