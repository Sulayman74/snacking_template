// 📤 Tests unitaires — file hors-ligne des photos livreur (src/services/podQueue.js).
import { describe, it, expect } from "vitest";
import { createPodQueue, isPermanentPodError } from "../../src/services/podQueue.js";

const memory = () => {
  const m = new Map();
  return { set: async (k, v) => m.set(k, v), get: async (k) => m.get(k), del: async (k) => m.delete(k), keys: async () => [...m.keys()], m };
};
const job = (id, createdAt, kind = "pickup") => ({ id, orderId: "o1", kind, blob: new Blob(["x"]), createdAt });

describe("podQueue", () => {
  it("envoie dans l'ordre de prise de vue et vide la file", async () => {
    const a = memory(); const q = createPodQueue(a);
    await q.add(job("drop", 2, "dropoff")); await q.add(job("pick", 1, "pickup"));
    const order = [];
    const res = await q.flush(async (j) => { order.push(j.kind); });
    expect(order).toEqual(["pickup", "dropoff"]);
    expect(res.sent).toHaveLength(2);
    expect(a.m.size).toBe(0);
  });

  it("erreur réseau → s'arrête et garde la suite pour plus tard (ordre préservé)", async () => {
    const a = memory(); const q = createPodQueue(a);
    await q.add(job("pick", 1)); await q.add(job("drop", 2, "dropoff"));
    const res = await q.flush(async () => { throw Object.assign(new Error("offline"), { code: "storage/retry-limit-exceeded" }); });
    expect(res).toMatchObject({ sent: [], dropped: [], remaining: 2 });
    expect(a.m.size).toBe(2);
  });

  it("refus définitif (règles) → photo écartée, la file continue", async () => {
    const a = memory(); const q = createPodQueue(a);
    await q.add(job("stale", 1, "dropoff")); await q.add(job("ok", 2, "pickup"));
    const res = await q.flush(async (j) => {
      if (j.id === "stale") throw Object.assign(new Error("denied"), { code: "permission-denied" });
    });
    expect(res.dropped.map((d) => d.id)).toEqual(["stale"]);
    expect(res.sent.map((s) => s.id)).toEqual(["ok"]);
    expect(a.m.size).toBe(0);
  });

  it("deux flush simultanés → un seul envoi par photo", async () => {
    const a = memory(); const q = createPodQueue(a);
    await q.add(job("pick", 1));
    let calls = 0;
    const send = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); };
    await Promise.all([q.flush(send), q.flush(send)]);
    expect(calls).toBe(1);
  });

  it("classe les erreurs", () => {
    expect(isPermanentPodError({ code: "permission-denied" })).toBe(true);
    expect(isPermanentPodError({ code: "firestore/permission-denied" })).toBe(true);
    expect(isPermanentPodError({ code: "storage/retry-limit-exceeded" })).toBe(false);
    expect(isPermanentPodError(new Error("timeout"))).toBe(false);
  });
});
