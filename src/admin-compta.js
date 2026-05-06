/**
 * 🧾 COMPTABILITÉ (Bridge)
 * Gère le chargement filtré des ventes et délègue l'UI à AdminComptaUI.
 */
import { adminStore } from "./core/AdminStore.js";

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
        const { query, collection, where, getDocs, orderBy } = window.fs;
        const q = query(
            collection(window.db, "orders"),
            where("snackId", "==", window.currentAdminSnackId),
            where("timestamp", ">=", startDate),
            where("timestamp", "<=", endDate),
            orderBy("timestamp", "desc")
        );

        const snapshot = await getDocs(q);
        const sales = [];
        snapshot.forEach(doc => sales.push({ id: doc.id, ...doc.data() }));

        adminStore.setSalesData(sales);

    } catch (error) {
        console.error("Erreur chargement compta:", error);
    }
}

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
