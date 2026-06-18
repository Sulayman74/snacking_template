// ============================================================================
// 🍔 SNACKING TEMPLATE — Cloud Functions (barrel)
// ----------------------------------------------------------------------------
// Point d'entrée découvert par Firebase (champ `main`). Les 25 CloudFunctions
// sont regroupées par domaine dans ./domains/*.js et la logique partagée dans
// ./lib/*.js. Ce fichier ne fait que ré-exporter — AUCUNE logique ici.
// Règle d'or : ne jamais renommer une clé d'export (renommer = delete+create =
// changement d'URL/coupure). Même nom → Firebase « updating only ».
// ============================================================================

// Side-effect AVANT tout : admin.initializeApp() + setGlobalOptions() une seule
// fois (les domaines le re-requirent, mais on garantit l'ordre d'init ici).
require("./lib/admin");

module.exports = {
  ...require("./domains/payment"),
  ...require("./domains/stripe-connect"),
  ...require("./domains/subscription"),
  ...require("./domains/webhooks"),
  ...require("./domains/loyalty"),
  ...require("./domains/orders"),
  ...require("./domains/notifications"),
  ...require("./domains/marketing"),
  ...require("./domains/admin-mgmt"),
  ...require("./domains/media"),
  ...require("./domains/football"),
};
