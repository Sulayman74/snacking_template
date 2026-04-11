// ============================================================================
// 📊 COMPTABILITÉ — Dashboard KPIs, Filtres date, Historique, Export TVA
// ============================================================================
// Dépendances : window.currentAdminSnackId, window.db, window.fs, window.showToast

const TVA_RATE = 0.10; // Taux restauration rapide

// ============================================================================
// 📅 PLAGES DE DATES PRÉDÉFINIES
// ============================================================================
function getDateRange(preset) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case "today": {
      const end = new Date(today);
      end.setHours(23, 59, 59, 999);
      return { start: today, end };
    }
    case "week": {
      const day = today.getDay() || 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - (day - 1));
      const end = new Date(today);
      end.setHours(23, 59, 59, 999);
      return { start: monday, end };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }
    case "last-month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end };
    }
    case "quarter": {
      const qStart = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), qStart, 1);
      const end = new Date(now.getFullYear(), qStart + 3, 0, 23, 59, 59, 999);
      return { start, end };
    }
    default:
      return null;
  }
}

// ============================================================================
// 📊 CHARGEMENT DU DASHBOARD KPI (mois en cours)
// ============================================================================
window.loadComptaDashboard = async () => {
  if (!window.currentAdminSnackId) return;

  const { collection, query, where, orderBy, getDocs, Timestamp } = window.fs;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Skeleton
  const elSales = document.getElementById("compta-total-sales");
  const elOrders = document.getElementById("compta-total-orders");
  if (elSales) elSales.textContent = "...";
  if (elOrders) elOrders.textContent = "...";

  try {
    const q = query(
      collection(window.db, "commandes"),
      where("snackId", "==", window.currentAdminSnackId),
      where("paiement.statut", "==", "paye"),
      where("date", ">=", Timestamp.fromDate(startOfMonth)),
      orderBy("date", "desc"),
    );

    const snapshot = await getDocs(q);

    let totalMonth = 0;
    let totalDay = 0;
    let countMonth = 0;
    let countDay = 0;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const amount = data.total || 0;
      const date = data.date?.toDate();

      totalMonth += amount;
      countMonth++;

      if (date && date >= startOfDay) {
        totalDay += amount;
        countDay++;
      }
    });

    const avgBasket = countMonth > 0 ? totalMonth / countMonth : 0;
    const tvaMonth = totalMonth - totalMonth / (1 + TVA_RATE);
    const htMonth = totalMonth / (1 + TVA_RATE);

    if (elSales) elSales.textContent = totalMonth.toFixed(2) + " €";
    if (elOrders) elOrders.textContent = countMonth;

    _renderKpiExtras({ totalDay, countDay, avgBasket, tvaMonth, htMonth });
    _renderOrderHistory(snapshot);

    // Pré-remplir le filtre sur le mois en cours
    window.setComptaDateRange("month");
  } catch (error) {
    console.error("Erreur chargement compta :", error);
    window.showToast("Erreur lors du chargement de la comptabilité.", "error");
  }
};

// ============================================================================
// 💡 KPI SUPPLÉMENTAIRES (injectés dans compta-kpi-extras)
// ============================================================================
function _renderKpiExtras({ totalDay, countDay, avgBasket, tvaMonth, htMonth }) {
  const container = document.getElementById("compta-kpi-extras");
  if (!container) return;

  container.innerHTML = `
    <div class="bg-gray-50 p-4 rounded-xl border border-gray-100">
      <p class="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">CA du Jour</p>
      <p class="text-3xl font-black text-gray-900">${totalDay.toFixed(2)} €</p>
      <p class="text-xs text-gray-400 mt-1">${countDay} commande${countDay > 1 ? "s" : ""}</p>
    </div>
    <div class="bg-gray-50 p-4 rounded-xl border border-gray-100">
      <p class="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Panier Moyen</p>
      <p class="text-3xl font-black text-gray-900">${avgBasket.toFixed(2)} €</p>
      <p class="text-xs text-gray-400 mt-1">ce mois-ci</p>
    </div>
    <div class="bg-amber-50 p-4 rounded-xl border border-amber-100">
      <p class="text-xs text-amber-600 font-bold uppercase tracking-wider mb-1">TVA Collectée (${(TVA_RATE * 100).toFixed(0)}%)</p>
      <p class="text-3xl font-black text-amber-700">${tvaMonth.toFixed(2)} €</p>
      <p class="text-xs text-amber-500 mt-1">HT : ${htMonth.toFixed(2)} €</p>
    </div>
  `;
}

// ============================================================================
// 📋 HISTORIQUE DES COMMANDES (tableau injecté)
// ============================================================================
function _renderOrderHistory(snapshot) {
  const container = document.getElementById("compta-history-table");
  if (!container) return;

  if (snapshot.empty) {
    container.innerHTML = `<p class="text-center text-gray-400 py-8">Aucune vente ce mois-ci.</p>`;
    return;
  }

  let rows = "";
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const date = data.date?.toDate();
    const dateStr = date ? date.toLocaleDateString("fr-FR") : "—";
    const timeStr = date
      ? date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
      : "—";
    const client = data.clientNom || "Anonyme";
    const ttc = data.total || 0;
    const ht = ttc / (1 + TVA_RATE);
    const tva = ttc - ht;
    const methode = data.paiement?.methode || "—";
    const itemCount = (data.items || []).reduce(
      (sum, i) => sum + (i.quantity || 1),
      0,
    );
    const isStripe = methode === "stripe";

    rows += `
      <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
        <td class="py-3 px-4 text-sm font-bold text-gray-700 whitespace-nowrap">${dateStr}</td>
        <td class="py-3 px-4 text-sm text-gray-500">${timeStr}</td>
        <td class="py-3 px-4 text-sm text-gray-700 max-w-[130px] truncate">${client}</td>
        <td class="py-3 px-4 text-sm text-gray-500 text-center">${itemCount}</td>
        <td class="py-3 px-4 text-sm font-black text-gray-900 whitespace-nowrap">${ttc.toFixed(2)} €</td>
        <td class="py-3 px-4 text-sm text-gray-400 whitespace-nowrap">${ht.toFixed(2)} €</td>
        <td class="py-3 px-4 text-sm font-bold text-amber-600 whitespace-nowrap">${tva.toFixed(2)} €</td>
        <td class="py-3 px-4">
          <span class="px-2 py-1 rounded-lg text-xs font-black uppercase ${isStripe ? "bg-indigo-100 text-indigo-700" : "bg-green-100 text-green-700"}">${methode}</span>
        </td>
      </tr>`;
  });

  container.innerHTML = `
    <div class="overflow-x-auto -mx-2">
      <table class="w-full text-left min-w-[600px]">
        <thead>
          <tr class="text-xs text-gray-400 font-bold uppercase tracking-wider border-b border-gray-200">
            <th class="pb-3 px-4">Date</th>
            <th class="pb-3 px-4">Heure</th>
            <th class="pb-3 px-4">Client</th>
            <th class="pb-3 px-4 text-center">Art.</th>
            <th class="pb-3 px-4">TTC</th>
            <th class="pb-3 px-4">HT</th>
            <th class="pb-3 px-4">TVA</th>
            <th class="pb-3 px-4">Méthode</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// 📤 EXPORT CSV AVEC FILTRE DATE + COLONNES TVA
// ============================================================================
window.exportComptaCSV = async () => {
  const btn = document.getElementById("btn-export-compta");
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Traitement...`;
  btn.disabled = true;

  try {
    const { collection, query, where, orderBy, getDocs, Timestamp } = window.fs;

    const startInput = document.getElementById("compta-date-start");
    const endInput = document.getElementById("compta-date-end");

    let startDate, endDate;
    if (startInput?.value && endInput?.value) {
      startDate = new Date(startInput.value + "T00:00:00");
      endDate = new Date(endInput.value + "T23:59:59");
    } else {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }

    const q = query(
      collection(window.db, "commandes"),
      where("snackId", "==", window.currentAdminSnackId),
      where("paiement.statut", "==", "paye"),
      where("date", ">=", Timestamp.fromDate(startDate)),
      where("date", "<=", Timestamp.fromDate(endDate)),
      orderBy("date", "desc"),
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      window.showToast("Aucune vente trouvée pour cette période.", "info");
      return;
    }

    let csvContent =
      "Date;Heure;Client;Articles;Montant TTC (€);HT (€);TVA (€);Methode;ID Commande;ID Stripe\n";
    let totalTTC = 0;
    let totalHT = 0;
    let totalTVA = 0;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const id = docSnap.id;

      const date = data.date?.toDate();
      const dateStr = date ? date.toLocaleDateString("fr-FR") : "N/A";
      const timeStr = date
        ? date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        : "N/A";

      const ttc = data.total || 0;
      const ht = ttc / (1 + TVA_RATE);
      const tva = ttc - ht;
      totalTTC += ttc;
      totalHT += ht;
      totalTVA += tva;

      const client = data.clientNom || "Inconnu";
      const methode = data.paiement?.methode || "Inconnue";
      const stripeId = data.paiement?.stripeSessionId || "N/A";
      const itemCount = (data.items || []).reduce(
        (sum, i) => sum + (i.quantity || 1),
        0,
      );

      csvContent += `${dateStr};${timeStr};"${client}";${itemCount};${ttc.toFixed(2).replace(".", ",")};${ht.toFixed(2).replace(".", ",")};${tva.toFixed(2).replace(".", ",")};${methode};${id};${stripeId}\n`;
    });

    csvContent += `\nTOTAL;;;;${totalTTC.toFixed(2).replace(".", ",")};${totalHT.toFixed(2).replace(".", ",")};${totalTVA.toFixed(2).replace(".", ",")};;;\n`;

    const blob = new Blob(["\ufeff" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateLabel = startDate.toLocaleDateString("fr-FR").replace(/\//g, "-");
    link.setAttribute("href", url);
    link.setAttribute("download", `Export_Ventes_${dateLabel}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    window.showToast("✅ Export comptable téléchargé !", "success");
  } catch (error) {
    console.error("Erreur export CSV :", error);
    window.showToast("Erreur lors de la génération de l'export.", "error");
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
};

// ============================================================================
// 📅 BOUTONS RAPIDES — Pré-remplit les inputs date
// ============================================================================
window.setComptaDateRange = (preset) => {
  const range = getDateRange(preset);
  if (!range) return;

  const startInput = document.getElementById("compta-date-start");
  const endInput = document.getElementById("compta-date-end");

  if (startInput) startInput.value = range.start.toISOString().split("T")[0];
  if (endInput) endInput.value = range.end.toISOString().split("T")[0];
};
