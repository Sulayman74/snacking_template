// ============================================================================
// 📥 CSV — Import en masse, Export comptable, Modèle, Aide
// ============================================================================
// Dépendances : window.currentAdminSnackId, window.db, window.fs, window.showToast

// ============================================================================
// 📥 IMPORT DE PRODUITS EN MASSE (SMART CSV + SÉCURITÉ)
// ============================================================================
window.importProductsCSV = async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  if (!window.currentAdminSnackId) {
    return window.showToast("Erreur : Aucun Snack ID détecté.", "error");
  }

  window.showToast("⏳ Importation en cours...", "info");

  try {
    const text = await file.text();

    // 🛡️ Anti-RTF
    if (text.includes("{\\rtf1") || text.includes("\\f0\\fs24")) {
      window.showToast(
        "❌ Erreur : Fichier RTF détecté. Veuillez enregistrer en 'Texte Brut' ou exporter en vrai CSV.",
        "error",
      );
      event.target.value = "";
      return;
    }

    const lines = text.split(/\r?\n/);
    const { addDoc, collection, serverTimestamp } = window.fs;

    // On ignore la 1ère ligne (header)
    const dataLines = lines.slice(1).filter((line) => line.trim() !== "");

    if (dataLines.length === 0) {
      window.showToast("Le fichier CSV semble vide ou mal formaté.", "error");
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const line of dataLines) {
      // Séparateur : ";" ou ","
      const separator = line.includes(";") ? ";" : ",";
      const parts = line.split(separator).map((p) => p.replace(/^"|"$/g, "").trim());

      if (parts.length < 4) {
        errorCount++;
        continue;
      }

      const [nom, description, prixRaw, categorieId,imageUrl] = parts;

      if (!nom || !categorieId) {
        errorCount++;
        continue;
      }

      // Nettoyer le prix : remplacer la virgule par un point
      const prix = parseFloat(prixRaw.replace(",", ".")) || 0;

      try {
        await addDoc(collection(window.db, "produits"), {
          snackId: window.currentAdminSnackId,
          nom: nom.substring(0, 100),
          description: (description || "").substring(0, 300),
          prix,
          categorieId: categorieId.toLowerCase().trim(),
          isAvailable: true,
          allowMenu: true,
          imageUrl: imageUrl || "",
          tags: [],
          createdAt: serverTimestamp(),
        });
        successCount++;
      } catch (lineError) {
        errorCount++;
      }
    }

    event.target.value = "";

    if (successCount > 0) {
      window.showToast(
        `✅ ${successCount} produit(s) importé(s) avec succès !${errorCount > 0 ? ` (${errorCount} ignoré(s))` : ""}`,
        "success",
      );
      if (typeof window.loadAdminProducts === "function")
        window.loadAdminProducts();
    } else {
      window.showToast(
        "Aucun produit importé. Vérifiez le format de votre fichier.",
        "error",
      );
    }
  } catch (error) {
    console.error("Erreur importation CSV :", error);
    window.showToast("Erreur lors de la lecture du fichier.", "error");
    event.target.value = "";
  }
};

// ============================================================================
// 📄 MODALE D'AIDE CSV (INJECTION DYNAMIQUE)
// ============================================================================
window.openCsvInfoModal = () => {
  const existingModal = document.getElementById("csv-info-modal-js");
  if (existingModal) existingModal.remove();

  const modal = document.createElement("div");
  modal.id = "csv-info-modal-js";
  modal.style.cssText =
    "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(17,24,39,0.8);backdrop-filter:blur(4px);z-index:999999;display:flex;justify-content:center;align-items:center;padding:1rem;";

  modal.innerHTML = `
        <div class="bg-white w-full max-w-2xl rounded-3xl p-6 relative shadow-2xl animate-fade-in-up max-h-[90vh] overflow-y-auto">
            <button onclick="document.getElementById('csv-info-modal-js').remove()" class="absolute top-4 right-4 w-10 h-10 text-gray-400 hover:text-red-400 bg-gray-100 rounded-full transition flex justify-center items-center">
                <i class="fas fa-times text-xl"></i>
            </button>
            <h3 class="text-2xl font-black text-gray-900 mb-2 border-b border-gray-100 pb-4">
                <i class="fas fa-file-csv text-blue-500 mr-2"></i> Guide d'importation CSV
            </h3>
            <p class="text-gray-600 mb-6 mt-4">Pour importer votre carte en un clic, votre fichier doit respecter un format strict. Téléchargez notre modèle, remplissez-le, puis importez-le.</p>
            <div class="bg-blue-50 rounded-xl p-4 border border-blue-100 mb-6">
                <h4 class="font-bold text-blue-900 mb-2">Structure requise (4 colonnes) :</h4>
                <ul class="list-disc pl-5 text-sm text-blue-800 space-y-1">
                    <li><strong>Nom :</strong> Le nom exact du produit (ex: <i>Tacos XL</i>)</li>
                    <li><strong>Description :</strong> Les ingrédients (ex: <i>Frites, Viande hachée</i>)</li>
                    <li><strong>Prix :</strong> Le prix de base (ex: <i>8,50</i> ou <i>8.50</i>)</li>
                    <li><strong>Categorie :</strong> L'ID de la catégorie en minuscules (ex: <i>tacos, burgers</i>)</li>
                </ul>
            </div>
            <div class="flex flex-col sm:flex-row gap-3 mt-8">
                <button onclick="window.downloadCsvTemplate()" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow-md flex items-center justify-center gap-2">
                    <i class="fas fa-download"></i> Télécharger le Modèle
                </button>
                <button onclick="document.getElementById('csv-info-modal-js').remove()" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-3 rounded-xl transition">
                    J'ai compris
                </button>
            </div>
        </div>
    `;

  document.body.appendChild(modal);
};

window.closeCsvInfoModal = () => {
  const modal = document.getElementById("csv-info-modal");
  if (!modal) return;
  modal.classList.add("opacity-0");
  modal.querySelector(".bg-white").classList.add("scale-95");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 300);
};

window.downloadCsvTemplate = () => {
  const content =
    "Nom;Description;Prix;Categorie\nBurger Classique;Pain brioché, steak 150g, cheddar, salade, tomate, sauce secrète;8,50;burgers\nCoca-Cola 33cl;Canette bien fraîche;2,00;drinks\nFrites Cheddar Bacon;Portion de frites avec sauce cheddar et bacon croustillant;4,50;sides";
  const blob = new Blob(["\ufeff" + content], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "Modele_Import_Carte.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.showToast("Modèle téléchargé !", "success");
};
