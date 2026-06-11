/**
 * 📊 PERFORMANCE UPSELL (Bridge)
 * Charge les compteurs shown/accepted/revenue par produit depuis
 * snacks/{snackId}/upsellStats et délègue l'affichage à AdminUpsellUI.
 *
 * Lecture seule : les stats sont écrites EXCLUSIVEMENT côté serveur
 * (trackUpsellShown + finalizeOrder). Le nom produit est joint depuis la
 * collection `produits` (source de vérité du libellé).
 */
import { adminStore } from "./core/AdminStore.js";
import { db, collection, query, where, getDocs } from "./core/firebase.js";

async function loadUpsellStats() {
    const snackId = window.currentAdminSnackId;
    if (!snackId) return;

    try {
        // 1) Libellés produits (jointure productId → nom). Une lecture bornée au snack.
        const nameMap = {};
        const prodSnap = await getDocs(query(
            collection(db, "produits"),
            where("snackId", "==", snackId),
        ));
        prodSnap.forEach((d) => { nameMap[d.id] = d.data()?.nom || ""; });

        // 2) Stats upsell (toute la sous-collection du snack, pas de filtre composite).
        const statsSnap = await getDocs(collection(db, "snacks", snackId, "upsellStats"));
        const rows = [];
        statsSnap.forEach((d) => {
            const s = d.data() || {};
            rows.push({
                productId: d.id,
                nom: nameMap[d.id] || "(produit supprimé)",
                shown: Number(s.shown) || 0,
                accepted: Number(s.accepted) || 0,
                revenue: Number(s.revenue) || 0,
            });
        });

        // Tri par CA attribuable décroissant (les produits qui rapportent en tête).
        rows.sort((a, b) => b.revenue - a.revenue);

        adminStore.setUpsellStats(rows);
    } catch (error) {
        console.error("Erreur chargement stats upsell:", error);
        adminStore.setUpsellStats([]);
    }
}

window.loadUpsellStats = loadUpsellStats;
