/**
 * 🧾 COMPTABILITÉ (Bridge)
 * Gère le chargement filtré des ventes et délègue l'UI à AdminComptaUI.
 */
import { adminStore } from "./core/AdminStore.js";
import {
    db,
    query,
    collection,
    where,
    getDocs,
    getAggregateFromServer,
    count,
    sum,
    orderBy,
    limit,
} from "./core/firebase.js";

async function loadComptaDashboard() {
    const startInput = document.getElementById("compta-date-start");
    const endInput = document.getElementById("compta-date-end");

    // Valeurs par défaut si vide (ce mois)
    if (!startInput.value || !endInput.value) {
        window.setComptaDateRange("month");
        return; // setComptaDateRange rappellera loadComptaDashboard
    }

    const startDate = new Date(startInput.value);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endInput.value);
    endDate.setHours(23, 59, 59, 999);

    if (!window.currentAdminSnackId) return;

    try {
        const baseConstraints = [
            where("snackId", "==", window.currentAdminSnackId),
            where("date", ">=", startDate),
            where("date", "<=", endDate),
        ];

        // 1) KPIs (CA + nb commandes) via AGRÉGATION serveur : facturée ~1 lecture
        //    par 1000 entrées d'index, au lieu de lire toutes les commandes lourdes.
        const aggSnap = await getAggregateFromServer(
            query(collection(db, "commandes"), ...baseConstraints),
            { count: count(), total: sum("total") }
        );
        adminStore.setSalesAggregate({
            count: aggSnap.data().count,
            total: aggSnap.data().total,
        });

        // 2) Historique : liste BORNÉE (affichage seulement, pas pour le total).
        const HISTORY_LIMIT = 200;
        const histSnap = await getDocs(query(
            collection(db, "commandes"),
            ...baseConstraints,
            orderBy("date", "desc"),
            limit(HISTORY_LIMIT)
        ));
        const sales = [];
        histSnap.forEach(doc => sales.push({ id: doc.id, ...doc.data() }));
        adminStore.setSalesData(sales); // troncature détectée via length === HISTORY_LIMIT côté UI

    } catch (error) {
        console.error("Erreur chargement compta:", error);
    }
}

/**
 * Récupère TOUTES les commandes de la plage affichée (sans limite) pour un export
 * CSV comptable complet. Lecture lourde mais DÉLIBÉRÉE (au clic export uniquement).
 * @returns {Promise<Array<Object>>}
 */
async function fetchAllComptaSales() {
    const startInput = document.getElementById("compta-date-start");
    const endInput = document.getElementById("compta-date-end");
    if (!startInput?.value || !endInput?.value || !window.currentAdminSnackId) return [];

    const startDate = new Date(startInput.value); startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endInput.value); endDate.setHours(23, 59, 59, 999);

    const snap = await getDocs(query(
        collection(db, "commandes"),
        where("snackId", "==", window.currentAdminSnackId),
        where("date", ">=", startDate),
        where("date", "<=", endDate),
        orderBy("date", "desc")
    ));
    const sales = [];
    snap.forEach(doc => sales.push({ id: doc.id, ...doc.data() }));
    return sales;
}

window.fetchAllComptaSales = fetchAllComptaSales;

window.setComptaDateRange = (range) => {
    const startInput = document.getElementById("compta-date-start");
    const endInput = document.getElementById("compta-date-end");
    const now = new Date();
    let start = new Date();
    let end = new Date();

    switch (range) {
        case "today":
            start.setHours(0, 0, 0, 0);
            break;
        case "week":
            start.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
            start.setHours(0, 0, 0, 0);
            break;
        case "month":
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        case "last-month":
            start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            end = new Date(now.getFullYear(), now.getMonth(), 0);
            break;
    }

    if (startInput) startInput.value = start.toISOString().split("T")[0];
    if (endInput) endInput.value = end.toISOString().split("T")[0];

    loadComptaDashboard();
};

// Initialisation des inputs pour rafraîchir au changement
document.getElementById("compta-date-start")?.addEventListener("change", loadComptaDashboard);
document.getElementById("compta-date-end")?.addEventListener("change", loadComptaDashboard);

window.loadComptaDashboard = loadComptaDashboard;
