/**
 * 🛠️ AdminStore — Gestionnaire d'état pour le Back-office
 * Flux unidirectionnel, mutations explicites, validation intégrée.
 */
import { computeComptaSummary, computeOrderRow } from "../services/comptaService.js";

export class AdminStore extends EventTarget {
    #state = {
        config: null,
        products: [],
        categories: [],
        pushHistory: [],
        salesData: [],            // commandes brutes pour le tableau d'historique (BORNÉ)
        salesAggregate: { count: 0, total: 0 }, // KPIs via agrégation serveur (toute la plage)
        upsellStats: [],          // 📊 perf upsell par produit (shown/accepted/revenue + nom)
        kitchenLoad: { queue: 0, avgPrepMin: 0, rushMode: false }, // 🔥 charge cuisine (serveur)
        isSaving: false,
        errors: []
    };

    constructor() {
        super();
    }

    get state() {
        // Retourne une copie profonde pour éviter les mutations directes accidentelles
        return JSON.parse(JSON.stringify(this.#state));
    }

    emit(eventName) {
        this.dispatchEvent(new CustomEvent(eventName, { detail: this.#state }));
    }

    // --- MUTATIONS ---

    setConfig(config) {
        this.#state.config = config;
        this.emit("admin-config-updated");
    }

    setProducts(products) {
        this.#state.products = products;
        this.emit("admin-products-updated");
    }

    updateConfigField(path, value) {
        if (!this.#state.config) {
            console.warn(`updateConfigField('${path}') ignoré : config non chargée.`);
            return;
        }
        const keys = path.split(".");
        let current = this.#state.config;
        for (let i = 0; i < keys.length - 1; i++) {
            if (current[keys[i]] == null) current[keys[i]] = {};
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
        this.emit("admin-config-updated");
    }

    setSaving(status) {
        this.#state.isSaving = status;
        this.emit("admin-saving-status");
    }

    // --- VALIDATION ---

    /**
     * Valide l'intégrité des données avant envoi à Firebase
     */
    validate() {
        const errors = [];
        const cfg = this.#state.config;

        if (!cfg) return { valid: false, errors: ["Configuration absente"] };

        // 1. Identité
        if (!cfg.identity?.name?.trim()) errors.push("Le nom du snack est obligatoire.");
        
        // 2. Horaires
        if (cfg.hours) {
            cfg.hours.forEach(h => {
                if (!h.closed) {
                    if (!h.open || !h.close) {
                        errors.push(`${h.day} : Les heures d'ouverture et fermeture sont requises.`);
                    } else if (h.open >= h.close) {
                        errors.push(`${h.day} : L'heure d'ouverture (${h.open}) doit être avant la fermeture (${h.close}).`);
                    }

                    if (h.hasBreak) {
                        if (!h.breakStart || !h.breakEnd) {
                            errors.push(`${h.day} : Les heures de coupure sont requises.`);
                        } else if (h.breakStart <= h.open || h.breakEnd >= h.close || h.breakStart >= h.breakEnd) {
                            errors.push(`${h.day} : La coupure (${h.breakStart}–${h.breakEnd}) doit être comprise dans la plage d'ouverture.`);
                        }
                    }
                }
            });
        }

        this.#state.errors = errors;
        return {
            valid: errors.length === 0,
            errors
        };
    }

    // --- ACTIONS PERSISTANCE ---

    async toggleProductStatus(db, fs, productId) {
        const product = this.#state.products.find(p => p.id === productId);
        if (!product) return;

        const newStatus = !product.isAvailable;
        
        try {
            const { doc, updateDoc } = fs;
            await updateDoc(doc(db, "produits", productId), {
                isAvailable: newStatus
            });
            // Note: Le rechargement sera déclenché par le listener Firestore (si on en met un) 
            // ou par un appel manuel à loadAdminProducts.
            return true;
        } catch (error) {
            console.error("Erreur toggleProductStatus:", error);
            throw error;
        }
    }

    async saveConfig(db, fs) {
        const validation = this.validate();
        if (!validation.valid) {
            throw new Error(validation.errors.join("\n"));
        }

        this.setSaving(true);
        try {
            const { doc, updateDoc } = fs;
            const snackRef = doc(db, "snacks", this.#state.config.identity.id);
            
            const cfg = this.#state.config;
            const c = cfg.contact || {};
            const a = c.address || {};
            const s = c.socials || {};
            const r = cfg.reviews || {};

            const dataToSave = {
                description: cfg.identity.description,
                promoPhrase: cfg.config?.promoPhrase || cfg.promoPhrase || "",
                hours: cfg.hours,
                phoneNumber: c.phone || "",
                email: c.email || "",
                street: a.street || "",
                zipcode: a.zip || "",
                city: a.city || "",
                googleMapsUrl: a.googleMapsUrl || "",
                googleReviewUrl: r.googleReviewUrl || "",
                instagram: s.instagram || "",
                facebook: s.facebook || "",
                tiktok: s.tiktok || "",
            };

            // 🚚 Livraison : flag + réglages (objet imbriqué) + position resto.
            // Présents en permanence dans le state (chargés par loadConfigView),
            // donc réécrits à l'identique lors des autres formulaires (idempotent).
            if (cfg.features || cfg.delivery || cfg.geo) {
                const d = cfg.delivery || {};
                const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
                dataToSave.enableDelivery = !!cfg.features?.enableDelivery;
                dataToSave.delivery = {
                    radiusKm: num(d.radiusKm, 5),
                    frais: num(d.frais, 2.5),
                    minOrder: num(d.minOrder, 0),
                    avgSpeedKmh: num(d.avgSpeedKmh, 22),
                    prepBaseMin: num(d.prepBaseMin, 12),
                    queueFactorMin: num(d.queueFactorMin, 3),
                };
                dataToSave.restaurantLat = Number.isFinite(Number(cfg.geo?.lat)) ? Number(cfg.geo.lat) : null;
                dataToSave.restaurantLng = Number.isFinite(Number(cfg.geo?.lng)) ? Number(cfg.geo.lng) : null;
            }

            await updateDoc(snackRef, dataToSave);
            this.setSaving(false);
            return true;
        } catch (error) {
            this.setSaving(false);
            throw error;
        }
    }

    // --- PRODUCT ACTIONS ---

    validateProduct(p) {
        const errors = [];
        if (!p.nom?.trim()) errors.push("Le nom du produit est obligatoire.");
        if (p.prix === undefined || p.prix < 0) errors.push("Le prix doit être positif.");
        if (!p.categorieId) errors.push("Veuillez choisir une catégorie.");
        
        if (p.tailles?.length > 0) {
            p.tailles.forEach(t => {
                if (!t.nom?.trim() || t.prix < 0) errors.push("Chaque taille doit avoir un nom et un prix valide.");
            });
        }

        return { valid: errors.length === 0, errors };
    }

    async saveProduct(db, fs, productData) {
        const validation = this.validateProduct(productData);
        if (!validation.valid) throw new Error(validation.errors.join("\n"));

        this.setSaving(true);
        try {
            const { doc, updateDoc, addDoc, collection, serverTimestamp } = fs;
            const data = {
                ...productData,
                // TVA : on force un preset valide (défaut 10) — defense-in-depth si la
                // donnée vient d'ailleurs que du formulaire (LOT A).
                tvaRate: [5.5, 10, 20].includes(Number(productData.tvaRate)) ? Number(productData.tvaRate) : 10,
                updatedAt: serverTimestamp()
            };

            let productId;
            if (productData.id) {
                productId = productData.id;
                delete data.id; // On n'update pas l'ID
                await updateDoc(doc(db, "produits", productId), data);
            } else {
                const snackId = this.#state.config?.identity?.id || window.currentAdminSnackId;
                if (!snackId) throw new Error("Snack non identifié. Recharge l'onglet Configuration.");
                data.createdAt = serverTimestamp();
                data.isAvailable = true;
                data.snackId = snackId;
                const newRef = await addDoc(collection(db, "produits"), data);
                productId = newRef.id;
            }

            this.setSaving(false);
            return productId; // ← id du produit (utile pour patcher l'image en arrière-plan)
        } catch (error) {
            this.setSaving(false);
            throw error;
        }
    }

    // --- MARKETING & PUSH ---

    setPushHistory(history) {
        this.#state.pushHistory = history;
        this.emit("admin-push-updated");
    }

    getPushEligibility() {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const monthlyPushes = this.#state.pushHistory.filter(p => {
            const date = p.dateCreation?.toDate ? p.dateCreation.toDate() : new Date(p.dateCreation);
            return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
        });

        const count = monthlyPushes.length;
        const limit = 2;
        
        return {
            canSend: count < limit,
            count,
            limit,
            remaining: limit - count,
            message: count >= limit ? "Quota mensuel atteint (2/2). Attendez le mois prochain pour ne pas fatiguer vos clients." : ""
        };
    }

    // --- CHARGE CUISINE (signal de capacité, autorité serveur) ---

    /**
     * Enregistre le dernier signal de charge cuisine renvoyé par getKitchenLoad.
     * rushMode est décidé SERVEUR (jamais recalculé ici) ; le store ne fait que
     * le diffuser pour que l'UI (console cuisine, bouton offre flash) réagisse.
     * @param {{queue:number, avgPrepMin:number, rushMode:boolean}} load
     */
    setKitchenLoad(load) {
        this.#state.kitchenLoad = {
            queue: Number(load?.queue) || 0,
            avgPrepMin: Number(load?.avgPrepMin) || 0,
            rushMode: load?.rushMode === true,
        };
        this.emit("admin-kitchen-load-updated");
    }

    /**
     * Éligibilité d'une OFFRE FLASH : combine le quota mensuel push existant ET la
     * garde de capacité (refus en rushMode). L'envoi réel est de toute façon
     * re-vérifié côté serveur (pushFlashOffer) — c'est ici de l'UX préventive.
     * @returns {{canSendFlash:boolean, rushMode:boolean, message:string}}
     */
    getFlashOfferEligibility() {
        const push = this.getPushEligibility();
        const rushMode = this.#state.kitchenLoad?.rushMode === true;
        let message = "";
        if (rushMode) message = "Cuisine en charge — offre flash indisponible. Réessayez quand le rush retombe.";
        else if (!push.canSend) message = push.message;
        return { canSendFlash: push.canSend && !rushMode, rushMode, message };
    }

    /**
     * Pousse une offre flash via la Cloud Function gardée `pushFlashOffer`
     * (role-gate + rate-limit + rushMode serveur). On NE réutilise PAS schedulePush
     * (écriture directe campagnes_push) : le flash doit passer par la CF.
     * @param {object} fs — bridge firebase.js (httpsCallable + functions)
     * @param {{title:string, body:string, ttlMin:number}} data
     */
    async pushFlashOffer(fs, data) {
        if (!fs?.httpsCallable || !fs?.functions) throw new Error("Fonctions Firebase indisponibles.");
        const snackId = this.#state.config?.identity?.id || window.currentAdminSnackId;
        if (!snackId) throw new Error("Snack non identifié. Recharge l'onglet Configuration.");

        this.setSaving(true);
        try {
            const callable = fs.httpsCallable(fs.functions, "pushFlashOffer");
            const res = await callable({ snackId, title: data.title, body: data.body, ttlMin: data.ttlMin });
            this.setSaving(false);
            return res?.data || { ok: true };
        } catch (error) {
            this.setSaving(false);
            // Traduit l'erreur de capacité serveur en message lisible.
            if (error?.message?.includes("kitchen-busy") || error?.details === "kitchen-busy") {
                throw new Error("Cuisine en charge — offre flash refusée par le serveur.");
            }
            throw error;
        }
    }

    getSmartMarketingTips() {
        const tips = [];
        const now = new Date();
        const hour = now.getHours();
        const day = now.getDay(); // 0 = Dimanche, 1 = Lundi, …, 6 = Samedi

        // Périodes de creux typiques (14h - 17h)
        if (hour >= 14 && hour <= 17) {
            tips.push({
                type: "creux",
                title: "🕒 Période de creux détectée",
                message: "C'est le moment idéal pour proposer une offre 'Goûter' ou une remise 'Early Bird' pour le service du soir."
            });
        }

        // Événements saisonniers — couverture mois par mois
        const month = now.getMonth() + 1;
        if (month === 2) tips.push({ type: "event", title: "❤️ Saint-Valentin", message: "Proposez un menu duo spécial amoureux !" });
        if (month === 3) tips.push({ type: "event", title: "🌷 Printemps arrive", message: "La terrasse redevient un atout : annoncez sa réouverture et mettez en avant les boissons rafraîchissantes." });
        if (month === 6) tips.push({ type: "event", title: "☀️ Été", message: "Mettez en avant vos boissons fraîches et salades." });
        if (month === 7 || month === 8) tips.push({ type: "event", title: "🏖️ Vacances d'été", message: "Captez le trafic touristique : mettez en avant Click & Collect rapide et menus d'été." });
        if (month === 10) tips.push({ type: "event", title: "🎃 Halloween", message: "Proposez un menu monstrueux pour les enfants et une promo familles à l'approche du 31 octobre." });
        if (month === 12) tips.push({ type: "event", title: "🎄 Fêtes", message: "Annoncez vos horaires spéciaux de fin d'année." });

        // Week-end (vendredi soir, samedi, dimanche)
        if (day === 5 || day === 6) {
            tips.push({
                type: "weekend",
                title: "🎉 Week-end",
                message: "Les clients commandent plus en famille. Proposez un 'Pack Famille' ou une offre sur les accompagnements."
            });
        } else if (day === 0) {
            tips.push({
                type: "weekend",
                title: "🌙 Dimanche soir",
                message: "Beaucoup de foyers évitent de cuisiner. Mettez en avant le Click & Collect pour le repas du dimanche soir et préparez la relance pour la semaine."
            });
        }

        return tips;
    }

    /**
     * ⚽ Football tip — appelle la Cloud Function `getUpcomingFootballEvents`,
     * filtre les matchs dans les prochaines 48h, et renvoie le tip pour le
     * match le plus imminent (un seul, pour ne pas saturer l'Advisor).
     * 48h laisse le temps de programmer une campagne push J-1.
     *
     * Retourne `null` silencieusement si :
     *   - fonctions Firebase non dispo (fs.functions absent)
     *   - aucun match dans la fenêtre 24h
     *   - appel function échoue
     *
     * @param {object} fs — bridge Firestore (barrel firebase.js) avec httpsCallable + functions
     */
    async getFootballTip(fs) {
        if (!fs?.httpsCallable || !fs?.functions) return null;

        try {
            const callable = fs.httpsCallable(fs.functions, "getUpcomingFootballEvents");
            const result = await callable({});
            const matches = result?.data?.matches || [];
            if (matches.length === 0) return null;

            // Fenêtre 48h glissante (push J-1 confortable)
            const now = Date.now();
            const horizon = now + 48 * 60 * 60 * 1000;
            const upcoming = matches
                .map((m) => ({ ...m, _ts: new Date(m.utcDate).getTime() }))
                .filter((m) => m._ts >= now && m._ts <= horizon)
                .sort((a, b) => a._ts - b._ts);

            if (upcoming.length === 0) return null;

            const m = upcoming[0];
            const when = new Date(m._ts).toLocaleString("fr-FR", {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
            });
            const matchLabel = `${m.homeTeam?.name || "?"} – ${m.awayTeam?.name || "?"}`;
            const compShort = m.competition?.code === "CL" ? "Champions League"
                : m.competition?.code === "WC" ? "Coupe du Monde"
                : m.competition?.code === "EC" ? "Euro"
                : m.competition?.name || m.competition?.code || "Match";

            return {
                type: "football",
                title: `⚽ ${matchLabel} — ${when}`,
                message: `${compShort}. Lancez une campagne "Menu match" en Click & Collect : commande à récupérer avant le coup d'envoi.`,
            };
        } catch (err) {
            console.warn("[getFootballTip] échec :", err.message);
            return null;
        }
    }

    /**
     * 📉 Sales trend tip — compare les revenus des 7 derniers jours à la
     * moyenne hebdomadaire des 30 derniers. Si baisse significative (≥ 15%),
     * pousse un tip "relancez vos inactifs".
     *
     * Async + query Firestore dédiée : ne dépend pas du salesData du store
     * (qui n'est peuplé qu'à l'ouverture de la vue Compta sur une plage choisie).
     *
     * Retourne `null` si pas assez de data, si Firestore down, ou si la
     * tendance est neutre/positive → l'UI peut ignorer silencieusement.
     *
     * @param {import("firebase/firestore").Firestore} db
     * @param {object} fs — bridge Firestore (barrel firebase.js) avec query, collection, where, getDocs, Timestamp
     * @param {string} snackId — snack ciblé (window.currentAdminSnackId)
     */
    async getSalesTrendTip(db, fs, snackId) {
        if (!db || !fs || !snackId) return null;

        try {
            const { query, collection, where, getDocs, Timestamp } = fs;
            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            // Collection "commandes" (FR) + champ "date" — cohérent avec
            // finalizeOrder côté Cloud Function et les Firestore rules.
            const q = query(
                collection(db, "commandes"),
                where("snackId", "==", snackId),
                where("date", ">=", Timestamp.fromDate(thirtyDaysAgo)),
                where("date", "<=", Timestamp.fromDate(now))
            );
            const snap = await getDocs(q);
            if (snap.empty) return null;

            let revenue7 = 0;
            let revenue30 = 0;
            snap.forEach((doc) => {
                const o = doc.data();
                const amount = parseFloat(o.total) || 0;
                const ts = o.date?.toDate?.() || new Date(o.date);
                revenue30 += amount;
                if (ts >= sevenDaysAgo) revenue7 += amount;
            });

            // Pas assez d'historique pour conclure : on attend au moins 14 jours d'activité.
            const daysWithData = (now.getTime() - thirtyDaysAgo.getTime()) / (24 * 60 * 60 * 1000);
            if (daysWithData < 14 || revenue30 <= 0) return null;

            const avgWeekly = (revenue30 / daysWithData) * 7;
            const variation = (revenue7 - avgWeekly) / avgWeekly; // -0.20 = -20%

            if (variation > -0.15) return null; // pas de tendance baissière significative

            const pct = Math.abs(Math.round(variation * 100));
            return {
                type: "sales-trend",
                title: `📉 Baisse de ${pct}% sur 7 jours`,
                message: "Vos revenus reculent par rapport à la moyenne du mois. Idéal pour cibler vos clients inactifs avec une offre Click & Collect."
            };
        } catch (err) {
            console.warn("[getSalesTrendTip] échec :", err.message);
            return null;
        }
    }

    async schedulePush(db, fs, pushData) {
        // Pré-check UX (le quota est de toute façon RÉ-ENFORCÉ côté serveur).
        const eligibility = this.getPushEligibility();
        if (!eligibility.canSend) throw new Error(eligibility.message);

        if (!fs?.httpsCallable || !fs?.functions) throw new Error("Fonctions Firebase indisponibles.");
        const snackId = this.#state.config?.identity?.id || window.currentAdminSnackId;
        if (!snackId) throw new Error("Snack non identifié. Recharge l'onglet Configuration.");

        this.setSaving(true);
        try {
            // Passe par la Cloud Function gardée (quota + rate-limit serveur), comme
            // pushFlashOffer. Plus d'écriture client directe dans campagnes_push.
            const callable = fs.httpsCallable(fs.functions, "schedulePushCampaign");
            const res = await callable({
                snackId,
                titre: pushData.titre,
                message: pushData.message,
                cible: pushData.cible,
                actionUrl: pushData.actionUrl || null,
                imageUrl: pushData.imageUrl || null,
                dateEnvoiPrevue:
                    pushData.dateEnvoiPrevue instanceof Date
                        ? pushData.dateEnvoiPrevue.toISOString()
                        : pushData.dateEnvoiPrevue,
            });
            this.setSaving(false);
            return res?.data || { ok: true };
        } catch (error) {
            this.setSaving(false);
            if (error?.code === "functions/resource-exhausted" || error?.message?.includes("resource-exhausted")) {
                throw new Error("Quota mensuel atteint (2/2). Attendez le mois prochain.");
            }
            throw error;
        }
    }

    // --- ACCOUNTING & SALES ---

    setSalesData(data) {
        this.#state.salesData = data;
        this.emit("admin-sales-updated");
    }

    /**
     * Enregistre les KPIs calculés côté serveur (count + sum(total)) via une
     * requête d'agrégation Firestore — au lieu de sommer des milliers de docs
     * lourds côté client. Ne déclenche pas de rendu (setSalesData le fait ensuite).
     * @param {{count: number, total: number}} agg
     */
    /**
     * Enregistre les stats de performance upsell (une ligne par produit ayant
     * été affiché et/ou ajouté via la bottom-sheet d'upsell).
     * @param {Array<{productId:string, nom:string, shown:number, accepted:number, revenue:number}>} rows
     */
    setUpsellStats(rows) {
        this.#state.upsellStats = Array.isArray(rows) ? rows : [];
        this.emit("admin-upsell-updated");
    }

    /**
     * Stocke l'agrégat serveur étendu (LOT D) : CA brut (€) + champs financiers
     * et ventilation TVA, tous en CENTIMES. Les commandes legacy (pré-LOT A) sans
     * ces champs sont ignorées par `sum()` côté serveur → aucune valeur fausse.
     * @param {object} agg
     */
    setSalesAggregate(agg) {
        const t = agg?.tva || {};
        this.#state.salesAggregate = {
            count: Number(agg?.count) || 0,
            total: Number(agg?.total) || 0, // EUROS (somme de commande.total)
            commission: Number(agg?.commission) || 0, // centimes
            stripeFee: Number(agg?.stripeFee) || 0,
            refundTotal: Number(agg?.refundTotal) || 0,
            refundCommission: Number(agg?.refundCommission) || 0,
            tva: {
                ht5_5: Number(t.ht5_5) || 0, tva5_5: Number(t.tva5_5) || 0,
                ht10: Number(t.ht10) || 0, tva10: Number(t.tva10) || 0,
                ht20: Number(t.ht20) || 0, tva20: Number(t.tva20) || 0,
                htLiv: Number(t.htLiv) || 0, tvaLiv: Number(t.tvaLiv) || 0,
            },
        };
    }

    /**
     * KPIs compta (LOT D) basés sur l'agrégat serveur (toute la plage). Délègue le
     * calcul net + ventilation TVA au service pur `computeComptaSummary` (zéro
     * `total*0.10` en dur : la TVA est désormais LUE depuis `tvaBreakdown`).
     * Conserve les champs `total`/`tva`/`ht` pour la rétro-compat (CSV, UI).
     */
    getSalesKPIs() {
        const s = computeComptaSummary(this.#state.salesAggregate || {});
        return {
            // Rétro-compat (consommé par renderKPIs + generateSalesCSV).
            total: s.caBrutTtc.toFixed(2),
            count: s.count,
            avg: s.avg.toFixed(2),
            tva: s.tvaCollectee.toFixed(2), // TVA RÉELLE collectée (ventilée), plus 10 % forfaitaire
            ht: (s.caBrutTtc - s.tvaCollectee).toFixed(2),
            // LOT D — compta nette + ventilation par taux.
            caNet: s.caNet.toFixed(2),
            commission: s.commission.toFixed(2),
            commissionNette: s.commissionNette.toFixed(2),
            stripeFee: s.stripeFee.toFixed(2),
            refundTotal: s.refundTotal.toFixed(2),
            tvaCollectee: s.tvaCollectee.toFixed(2),
            tvaParTaux: s.tvaParTaux, // [{rate, ht, tva}] en euros
        };
    }

    /**
     * Génère le CSV comptable VENTILÉ (LOT E) : une ligne par commande (TTC + HT/TVA
     * par taux 5,5/10/20 + frais livraison + commission + frais Stripe + remboursé +
     * net), puis un bloc TOTAUX et un RÉCAP TVA par taux pour la réintégration par
     * l'expert-comptable. Montants en euros (2 déc., virgule FR) ; séparateur `;`.
     *
     * Réconciliation (commandes ventilées) : Σ(HT+TVA par taux)+frais livraison === TTC,
     * et Σ TTC export === CA TTC des KPIs. FEC explicitement HORS périmètre (cf.
     * brief §0.6) : cet export se réintègre dans l'outil du comptable, il n'est PAS
     * destiné à un dépôt direct DGFiP.
     *
     * @param {Array<Object>} [salesArg] - commandes pleine plage (sinon liste bornée).
     * @returns {string|null} CSV (sans BOM ; le BOM UTF-8 est ajouté au blob d'export).
     */
    generateSalesCSV(salesArg) {
        const sales = Array.isArray(salesArg) ? salesArg : this.#state.salesData;
        if (!sales || sales.length === 0) return null;

        const SEP = ";";
        // Euros « FR » : 2 décimales, virgule décimale (Excel FR). Jamais de `;` interne.
        const eur = (n) => (Number(n) || 0).toFixed(2).replace(".", ",");

        const headers = [
            "Date", "N° commande", "Mode", "TTC",
            "HT 5,5%", "TVA 5,5%", "HT 10%", "TVA 10%", "HT 20%", "TVA 20%",
            "Frais livraison", "Commission", "Frais Stripe", "Remboursé", "Net", "Ventilé",
        ];

        const acc = {
            ttc: 0, ht5_5: 0, tva5_5: 0, ht10: 0, tva10: 0, ht20: 0, tva20: 0,
            frais: 0, commission: 0, stripeFee: 0, refunded: 0, net: 0, legacy: 0,
        };

        const rows = sales.map((s) => {
            const r = computeOrderRow(s);
            acc.ttc += r.ttc; acc.ht5_5 += r.ht5_5; acc.tva5_5 += r.tva5_5;
            acc.ht10 += r.ht10; acc.tva10 += r.tva10; acc.ht20 += r.ht20; acc.tva20 += r.tva20;
            acc.frais += r.fraisLivraison; acc.commission += r.commission;
            acc.stripeFee += r.stripeFee; acc.refunded += r.refunded; acc.net += r.net;
            if (!r.ventilated) acc.legacy += 1;
            const date = s.date?.toDate ? s.date.toDate().toLocaleDateString("fr-FR") : "";
            return [
                date, s.id, r.mode, eur(r.ttc),
                eur(r.ht5_5), eur(r.tva5_5), eur(r.ht10), eur(r.tva10), eur(r.ht20), eur(r.tva20),
                eur(r.fraisLivraison), eur(r.commission), eur(r.stripeFee), eur(r.refunded), eur(r.net),
                r.ventilated ? "oui" : "LEGACY",
            ];
        });

        const totalsRow = [
            "TOTAUX", "", "", eur(acc.ttc),
            eur(acc.ht5_5), eur(acc.tva5_5), eur(acc.ht10), eur(acc.tva10), eur(acc.ht20), eur(acc.tva20),
            eur(acc.frais), eur(acc.commission), eur(acc.stripeFee), eur(acc.refunded), eur(acc.net), "",
        ];

        // Récap TVA par taux (articles) + ligne livraison + note de périmètre.
        const recap = [
            [],
            ["RÉCAP TVA PAR TAUX (articles)"],
            ["Taux", "HT", "TVA", "TTC"],
            ["5,5%", eur(acc.ht5_5), eur(acc.tva5_5), eur(acc.ht5_5 + acc.tva5_5)],
            ["10%", eur(acc.ht10), eur(acc.tva10), eur(acc.ht10 + acc.tva10)],
            ["20%", eur(acc.ht20), eur(acc.tva20), eur(acc.ht20 + acc.tva20)],
            ["Frais de livraison (TTC, 10%)", "", "", eur(acc.frais)],
            [],
            ["TVA collectée totale", eur(acc.tva5_5 + acc.tva10 + acc.tva20)],
            ["Commission plateforme", eur(acc.commission)],
            ["Frais Stripe", eur(acc.stripeFee)],
            ["Remboursements", eur(acc.refunded)],
            ["CA net encaissé", eur(acc.net)],
            [],
            [`Commandes hors ventilation (antérieures au socle compta) : ${acc.legacy}`],
            ["Données de gestion, non certifiées NF525. TVA collectée hors TVA déductible."],
            ["Export destiné à votre expert-comptable (réintégration) — NON un FEC/dépôt DGFiP."],
        ];

        return [headers, ...rows, [], totalsRow, ...recap]
            .map((r) => r.join(SEP))
            .join("\n");
    }
}

export const adminStore = new AdminStore();
