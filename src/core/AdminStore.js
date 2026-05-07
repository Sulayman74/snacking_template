/**
 * 🛠️ AdminStore — Gestionnaire d'état pour le Back-office
 * Flux unidirectionnel, mutations explicites, validation intégrée.
 */
export class AdminStore extends EventTarget {
    #state = {
        config: null,
        products: [],
        categories: [],
        pushHistory: [],
        salesData: [],
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
            
            const dataToSave = {
                description: this.#state.config.identity.description,
                promoPhrase: this.#state.config.config?.promoPhrase || this.#state.config.promoPhrase || "",
                hours: this.#state.config.hours
            };

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
                updatedAt: serverTimestamp()
            };

            if (productData.id) {
                const id = productData.id;
                delete data.id; // On n'update pas l'ID
                await updateDoc(doc(db, "produits", id), data);
            } else {
                const snackId = this.#state.config?.identity?.id || window.currentAdminSnackId;
                if (!snackId) throw new Error("Snack non identifié. Recharge l'onglet Configuration.");
                data.createdAt = serverTimestamp();
                data.isAvailable = true;
                data.snackId = snackId;
                await addDoc(collection(db, "produits"), data);
            }

            this.setSaving(false);
            return true;
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

    getSmartMarketingTips() {
        const tips = [];
        const now = new Date();
        const hour = now.getHours();
        const day = now.getDay(); // 0 = Dimanche, 1 = Lundi...

        // Périodes de creux typiques (15h - 18h)
        if (hour >= 14 && hour <= 17) {
            tips.push({
                type: "creux",
                title: "🕒 Période de creux détectée",
                message: "C'est le moment idéal pour proposer une offre 'Goûter' ou une remise 'Early Bird' pour le service du soir."
            });
        }

        // Événements saisonniers (Simplifié)
        const month = now.getMonth() + 1;
        if (month === 2) tips.push({ type: "event", title: "❤️ Saint-Valentin", message: "Proposez un menu duo spécial amoureux !" });
        if (month === 6) tips.push({ type: "event", title: "☀️ Été", message: "Mettez en avant vos boissons fraîches et salades." });
        if (month === 12) tips.push({ type: "event", title: "🎄 Fêtes", message: "Annoncez vos horaires spéciaux de fin d'année." });

        // Week-end
        if (day === 5 || day === 6) {
            tips.push({
                type: "weekend",
                title: "🎉 Week-end",
                message: "Les clients commandent plus en famille. Proposez un 'Pack Famille' ou une offre sur les accompagnements."
            });
        }

        return tips;
    }

    async schedulePush(db, fs, pushData) {
        const eligibility = this.getPushEligibility();
        if (!eligibility.canSend) throw new Error(eligibility.message);

        const snackId = this.#state.config?.identity?.id || window.currentAdminSnackId;
        if (!snackId) throw new Error("Snack non identifié. Recharge l'onglet Configuration.");

        this.setSaving(true);
        try {
            const { addDoc, collection, serverTimestamp } = fs;
            await addDoc(collection(db, "campagnes_push"), {
                ...pushData,
                snackId,
                dateCreation: serverTimestamp(),
                statut: "en_attente",
                stats: { envoye: 0, clics: 0 }
            });
            this.setSaving(false);
            return true;
        } catch (error) {
            this.setSaving(false);
            throw error;
        }
    }

    // --- ACCOUNTING & SALES ---

    setSalesData(data) {
        this.#state.salesData = data;
        this.emit("admin-sales-updated");
    }

    getSalesKPIs() {
        const sales = this.#state.salesData;
        const total = sales.reduce((acc, s) => acc + (parseFloat(s.total) || 0), 0);
        const count = sales.length;
        const avg = count > 0 ? total / count : 0;
        const tva = total * 0.10; // TVA 10% (restauration rapide sur place/emporté)

        return {
            total: total.toFixed(2),
            count,
            avg: avg.toFixed(2),
            tva: tva.toFixed(2),
            ht: (total - tva).toFixed(2)
        };
    }

    generateSalesCSV() {
        const sales = this.#state.salesData;
        if (sales.length === 0) return null;

        const headers = ["ID", "Date", "Client", "Total TTC", "HT (90%)", "TVA (10%)", "Statut"];
        const rows = sales.map(s => {
            const date = s.timestamp?.toDate ? s.timestamp.toDate().toLocaleDateString() : "";
            const total = parseFloat(s.total) || 0;
            const tva = total * 0.10;
            return [
                s.id,
                date,
                s.userName || "Anonyme",
                total.toFixed(2),
                (total - tva).toFixed(2),
                tva.toFixed(2),
                s.statut || "payé"
            ];
        });

        // Totaux
        const kpis = this.getSalesKPIs();
        rows.push([]);
        rows.push(["TOTAL", "", "", kpis.total, kpis.ht, kpis.tva, ""]);

        return [headers, ...rows].map(r => r.join(";")).join("\n");
    }
}

export const adminStore = new AdminStore();
