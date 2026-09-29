// ============================================================================
// 📤 podQueue — file hors-ligne des photos de preuve de livraison (livreur)
// ============================================================================
// Sans réseau, l'envoi Storage d'une photo est impossible : la photo est gardée sur
// l'appareil (IndexedDB) et envoyée plus tard, DANS L'ORDRE (prise en charge avant
// livraison). Une photo refusée définitivement (course annulée / réattribuée → règles
// Firestore) est écartée pour ne pas bloquer la file. Stockage injectable (tests).
import { createStore, get, set, del, keys } from "idb-keyval";

// Refus définitifs : inutile de réessayer (les règles ou l'objet ont changé).
const PERMANENT_CODES = new Set([
  "permission-denied",
  "not-found",
  "failed-precondition",
  "storage/unauthorized",
  "storage/object-not-found",
]);

/** Une erreur d'envoi est-elle définitive (≠ problème réseau à réessayer) ? */
export function isPermanentPodError(err) {
  const code = String(err?.code || "").replace(/^firestore\//, "");
  return PERMANENT_CODES.has(code);
}

/** Stockage IndexedDB (base dédiée, séparée du cache Firestore). */
function idbAdapter() {
  let store = null;
  const s = () => (store ??= createStore("snack-livreur", "pod-queue"));
  return {
    set: (k, v) => set(k, v, s()),
    get: (k) => get(k, s()),
    del: (k) => del(k, s()),
    keys: () => keys(s()),
  };
}

/**
 * @param {{ set: Function, get: Function, del: Function, keys: Function }} [adapter]
 */
export function createPodQueue(adapter = idbAdapter()) {
  let flushing = null;

  async function list() {
    const ids = await adapter.keys();
    const jobs = await Promise.all(ids.map((id) => adapter.get(id)));
    return jobs.filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
  }

  return {
    /** @param {{ id: string, orderId: string, kind: "pickup"|"dropoff", blob: Blob, createdAt: number }} job */
    add: (job) => adapter.set(job.id, job),
    list,
    remove: (id) => adapter.del(id),

    /**
     * Envoie les photos en attente, dans l'ordre. S'arrête à la 1re erreur réseau
     * (on réessaiera), écarte une photo refusée définitivement.
     * @param {(job: object) => Promise<void>} send
     * @returns {Promise<{ sent: object[], dropped: object[], remaining: number }>}
     */
    flush(send) {
      // Un seul envoi à la fois (online + visibilitychange peuvent se chevaucher).
      flushing ??= (async () => {
        const out = { sent: [], dropped: [], remaining: 0 };
        try {
          const jobs = await list();
          for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];
            try {
              await send(job);
              await adapter.del(job.id);
              out.sent.push(job);
            } catch (err) {
              if (!isPermanentPodError(err)) {
                out.remaining = jobs.length - i;
                break;
              }
              await adapter.del(job.id);
              out.dropped.push({ ...job, error: err?.code || String(err) });
            }
          }
          return out;
        } finally {
          flushing = null;
        }
      })();
      return flushing;
    },
  };
}
