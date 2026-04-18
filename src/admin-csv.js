// ============================================================================
// 📥 CSV — Import en masse, Export comptable, Modèle, Aide
// ============================================================================
// Dépendances : window.currentAdminSnackId, window.db, window.fs, window.showToast

// ============================================================================
// 📥 IMPORT DE PRODUITS EN MASSE (SMART CSV + SÉCURITÉ)
// ============================================================================
window.importProductsCSV = async (event) => {
  const file = event.target.files[0];
  if (!file || !window.currentAdminSnackId) return;

  window.showToast("⏳ Analyse du fichier...", "info");

  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
    if (lines.length < 2) return;

    // 1. Détection dynamique du séparateur et des headers
    const firstLine = lines[0];
    const separator = firstLine.includes(";") ? ";" : ",";
    const headers = firstLine.split(separator).map(h => h.trim().toLowerCase());

    const { addDoc, collection, serverTimestamp } = window.fs;
    let successCount = 0;

    // 2. Traitement des données
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(separator).map(p => p.replace(/^"|"$/g, "").trim());
      
      // Création d'un objet temporaire basé sur les headers présents
      const row = {};
      headers.forEach((header, index) => {
        row[header] = parts[index];
      });

      if (!row.nom || !row.categorie) continue;

      // 3. Logique métier : "Est-ce que ce produit peut être en menu ?"
      // On définit les catégories qui n'ont JAMAIS de menu (boissons, desserts, pizzas, sides)
      const noMenuCategories = ['pizzas', 'drinks', 'sides', 'boissons', 'desserts'];
      const categoryClean = row.categorie.toLowerCase().trim();
      
      // Par défaut : true sauf si dans la liste noire OU si spécifié "non" dans le CSV
      let allowMenu = !noMenuCategories.includes(categoryClean);
      
      // Si une colonne "menu" existe dans le CSV, elle est prioritaire
      if (row.menu) {
        allowMenu = (row.menu.toLowerCase() === 'oui' || row.menu === '1');
      }

      const prix = parseFloat(String(row.prix).replace(",", ".")) || 0;

      await addDoc(collection(window.db, "produits"), {
        snackId: window.currentAdminSnackId,
        nom: row.nom,
        description: row.description || "",
        prix: prix,
        categorieId: categoryClean,
        image: row.image || "", 
        isAvailable: true,
        allowMenu: allowMenu, // Dynamique !
        menuPriceAdd: parseFloat(row.surplus_menu) || 2.5,
        createdAt: serverTimestamp(),
      });
      successCount++;
    }

    window.showToast(`✅ ${successCount} produits synchronisés !`, "success");
    window.loadAdminProducts();
  } catch (error) {
    console.error(error);
    window.showToast("Erreur lors de l'import.", "error");
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

// Remplace le bloc modal.innerHTML par celui-ci :
modal.innerHTML = `
    <div class="bg-white w-full max-w-2xl rounded-3xl p-6 relative shadow-2xl animate-fade-in-up max-h-[90vh] overflow-y-auto font-sans">
        <button onclick="document.getElementById('csv-info-modal-js').remove()" class="absolute top-4 right-4 w-10 h-10 text-gray-400 hover:text-red-400 bg-gray-100 rounded-full transition flex justify-center items-center">
            <i class="fas fa-times text-xl"></i>
        </button>
        
        <h3 class="text-2xl font-black text-gray-900 mb-2 border-b border-gray-100 pb-4">
            <i class="fas fa-file-csv text-blue-500 mr-2"></i> Guide d'importation
        </h3>

        <p class="text-gray-600 mb-6 mt-4">Importez toute votre carte en une seconde. Utilisez un fichier <strong>.csv</strong> avec le point-virgule (;) comme séparateur.</p>

        <div class="overflow-x-auto mb-6 border border-gray-100 rounded-xl">
            <table class="w-full text-left text-xs">
                <thead class="bg-gray-50 text-gray-500 uppercase">
                    <tr>
                        <th class="px-3 py-2">Nom</th>
                        <th class="px-3 py-2">Prix</th>
                        <th class="px-3 py-2">Categorie</th>
                        <th class="px-3 py-2">Menu</th>
                    </tr>
                </thead>
                <tbody class="text-gray-700">
                    <tr class="border-t border-gray-50">
                        <td class="px-3 py-2 font-bold">Burger Bacon</td>
                        <td class="px-3 py-2">9.50</td>
                        <td class="px-3 py-2">burgers</td>
                        <td class="px-3 py-2 text-green-600 font-bold">Oui</td>
                    </tr>
                    <tr class="border-t border-gray-50">
                        <td class="px-3 py-2 font-bold">Pizza Regina</td>
                        <td class="px-3 py-2">12.00</td>
                        <td class="px-3 py-2">pizzas</td>
                        <td class="px-3 py-2 text-red-500 font-bold">Non</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-6">
            <div class="bg-blue-50 p-4 rounded-xl border border-blue-100">
                <h4 class="font-bold text-blue-900 mb-1">Obligatoire</h4>
                <p class="text-blue-800">Nom, Prix, Categorie (tacos, burgers, pizzas, drinks, sides, desserts).</p>
            </div>
            <div class="bg-green-50 p-4 rounded-xl border border-green-100">
                <h4 class="font-bold text-green-900 mb-1">Optionnel</h4>
                <p class="text-green-800">Description, Image (URL), Menu (Oui/Non), Surplus_Menu (ex: 3.00).</p>
            </div>
        </div>

        <div class="flex flex-col sm:flex-row gap-3 mt-8">
            <button onclick="window.downloadCsvTemplate()" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition shadow-md flex items-center justify-center gap-2">
                <i class="fas fa-download"></i> Télécharger le modèle
            </button>
            <button onclick="document.getElementById('csv-info-modal-js').remove()" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-4 rounded-xl transition">
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
  // On ajoute "Menu" et "Surplus_Menu" comme colonnes optionnelles
  const content = "Nom;Description;Prix;Categorie;Menu;Surplus_Menu;Image\n" +
    "Burger XL;Double steak, cheddar;9.50;burgers;Oui;3.00;\n" +
    "Pizza Regina;Tomate, mozza, jambon;12.00;pizzas;Non;0;\n" +
    "Coca 33cl;Fraîcheur intense;2.00;drinks;Non;0;";
  
  const blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "Modele_Import_Carte.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.showToast("Modèle téléchargé !", "success");
};
