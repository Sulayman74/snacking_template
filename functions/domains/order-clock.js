// ============================================================================
// ⏱️ HORLOGE DES COMMANDES — tâche planifiée (chaque minute)
// ============================================================================
// Une seule tâche Cloud Scheduler (0,10 $/mois) pour tout ce qui dépend du temps
// dans la vie d'une commande ; détail des tâches dans lib/orderClock.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runOrderClock } = require("../lib/orderClock");

exports.orderClock = onSchedule(
  { schedule: "every 1 minutes", region: "europe-west1", timeoutSeconds: 50 },
  async () => {
    const stats = await runOrderClock();
    const acted = Object.entries(stats).some(([k, v]) => k !== "errors" && v > 0);
    if (acted || stats.errors) console.log("⏱️ orderClock", stats);
  }
);
