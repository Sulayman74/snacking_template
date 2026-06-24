import { describe, it, expect, vi, beforeEach } from "vitest";
import Module from "module";
import { createRequire } from "module";

const testRequire = createRequire(import.meta.url);

// Mocks/Stubs pour Firestore
const mockDoc = {
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
};

const mockCollection = vi.fn().mockReturnValue({
  doc: vi.fn().mockReturnValue(mockDoc),
});

const mockDb = {
  collection: mockCollection,
  runTransaction: vi.fn(async (callback) => {
    const tx = {
      get: vi.fn(async (ref) => ref.get()),
      set: vi.fn((ref, val) => ref.set(val)),
      update: vi.fn((ref, val) => ref.update(val)),
    };
    return await callback(tx);
  }),
};

// Interception ciblée de require("./admin") uniquement depuis rateLimit.js
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "./admin" && this.filename && this.filename.endsWith("functions/lib/rateLimit.js")) {
    return {
      db: mockDb,
      Timestamp: {
        fromMillis: (m) => ({ toMillis: () => m }),
      },
    };
  }
  return originalRequire.apply(this, arguments);
};

// Mock de HttpsError
vi.mock("firebase-functions/v2/https", () => {
  return {
    HttpsError: class HttpsError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    },
  };
});

// Charger rateLimit.js de façon séquentielle APRÈS l'installation du mock
const { enforceRateLimit, callerKey } = testRequire("../../functions/lib/rateLimit.js");

describe("rateLimit — enforceRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crée un nouveau rate limit (set) si aucun enregistrement n'existe", async () => {
    mockDoc.get.mockResolvedValue({
      exists: false,
    });

    await enforceRateLimit({ key: "test_key", max: 5, windowMs: 60000 });

    expect(mockCollection).toHaveBeenCalledWith("rateLimits");
    expect(mockDoc.set).toHaveBeenCalledWith({
      count: 1,
      windowStart: expect.objectContaining({ toMillis: expect.any(Function) }),
    });
    expect(mockDoc.update).not.toHaveBeenCalled();
  });

  it("incrémente le compteur (update) si on est toujours dans la fenêtre", async () => {
    const now = Date.now();
    mockDoc.get.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 2,
        windowStart: { toMillis: () => now - 10000 }, // 10 secondes écoulées sur 60s
      }),
    });

    await enforceRateLimit({ key: "test_key", max: 5, windowMs: 60000 });

    expect(mockDoc.update).toHaveBeenCalledWith({ count: 3 });
    expect(mockDoc.set).not.toHaveBeenCalled();
  });

  it("réinitialise la fenêtre (set) si la fenêtre de temps est expirée", async () => {
    const now = Date.now();
    mockDoc.get.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 4,
        windowStart: { toMillis: () => now - 70000 }, // 70 secondes écoulées sur 60s
      }),
    });

    await enforceRateLimit({ key: "test_key", max: 5, windowMs: 60000 });

    expect(mockDoc.set).toHaveBeenCalledWith({
      count: 1,
      windowStart: expect.objectContaining({ toMillis: expect.any(Function) }),
    });
    expect(mockDoc.update).not.toHaveBeenCalled();
  });

  it("throw HttpsError 'resource-exhausted' si la limite est dépassée", async () => {
    const now = Date.now();
    mockDoc.get.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 5,
        windowStart: { toMillis: () => now - 10000 },
      }),
    });

    await expect(
      enforceRateLimit({ key: "test_key", max: 5, windowMs: 60000 })
    ).rejects.toThrowError(/Trop de tentatives/);
  });
});

describe("rateLimit — callerKey", () => {
  it("construit une clé basée sur le uid si l'utilisateur est authentifié", () => {
    const req = {
      auth: { uid: "user_abc123" },
    };
    const key = callerKey(req, "my_action");
    expect(key).toBe("my_action_uid_user_abc123");
  });

  it("construit une clé basée sur le x-forwarded-for si l'utilisateur n'est pas connecté", () => {
    const req = {
      rawRequest: {
        headers: { "x-forwarded-for": "192.168.1.1, 10.0.0.1" },
      },
    };
    const key = callerKey(req, "my_action");
    expect(key).toBe("my_action_ip_192.168.1.1");
  });

  it("construit une clé basée sur req.rawRequest.ip en fallback", () => {
    const req = {
      rawRequest: {
        ip: "2001:db8::8a2e:370:7334",
      },
    };
    const key = callerKey(req, "my_action");
    expect(key).toBe("my_action_ip_2001:db8::8a2e:370:7334");
  });

  it("construit une clé avec 'unknown' si aucune IP ni UID n'est fourni", () => {
    const req = {};
    const key = callerKey(req, "my_action");
    expect(key).toBe("my_action_ip_unknown");
  });

  it("normalise l'IP pour être safe dans les IDs Firestore", () => {
    const req = {
      rawRequest: {
        ip: "192.168.1.1/invalid-chars?",
      },
    };
    const key = callerKey(req, "my_action");
    expect(key).toBe("my_action_ip_192.168.1.1_invalid-chars_");
  });
});
