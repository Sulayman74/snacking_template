import { describe, it, expect } from "vitest";

// Pure unit tests for auth sanitization and password change validation

function sanitizeEmail(email) {
  return (email || "").trim();
}

function shouldSuppressResetError(code) {
  return code === "auth/user-not-found" || code === "auth/invalid-email";
}

async function validateChangePassword(user, currentPassword, newPassword) {
  if (!user || !user.email) {
    throw new Error("auth/requires-recent-login");
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error("auth/weak-password");
  }
  if (!currentPassword) {
    throw new Error("auth/wrong-password");
  }
  return true;
}

describe("Auth Sanitization & Security Enhancements", () => {
  describe("sanitizeEmail", () => {
    it("trims spaces around email input", () => {
      expect(sanitizeEmail("  user@example.com  ")).toBe("user@example.com");
      expect(sanitizeEmail("user@example.com\n")).toBe("user@example.com");
    });

    it("handles null / undefined / empty email safely", () => {
      expect(sanitizeEmail("")).toBe("");
      expect(sanitizeEmail(null)).toBe("");
      expect(sanitizeEmail(undefined)).toBe("");
    });
  });

  describe("OWASP Reset Password Anti-Enumeration", () => {
    it("suppresses user-not-found error to prevent account enumeration", () => {
      expect(shouldSuppressResetError("auth/user-not-found")).toBe(true);
    });

    it("suppresses invalid-email error to prevent account enumeration", () => {
      expect(shouldSuppressResetError("auth/invalid-email")).toBe(true);
    });

    it("does not suppress network or rate limit errors", () => {
      expect(shouldSuppressResetError("auth/too-many-requests")).toBe(false);
      expect(shouldSuppressResetError("auth/network-request-failed")).toBe(false);
    });
  });

  describe("validateChangePassword", () => {
    it("throws requires-recent-login if user is not authenticated", async () => {
      await expect(validateChangePassword(null, "old123", "new123456")).rejects.toThrow("auth/requires-recent-login");
      await expect(validateChangePassword({}, "old123", "new123456")).rejects.toThrow("auth/requires-recent-login");
    });

    it("throws weak-password if new password is too short", async () => {
      const mockUser = { email: "test@example.com" };
      await expect(validateChangePassword(mockUser, "old123", "123")).rejects.toThrow("auth/weak-password");
    });

    it("throws wrong-password if current password is missing", async () => {
      const mockUser = { email: "test@example.com" };
      await expect(validateChangePassword(mockUser, "", "new123456")).rejects.toThrow("auth/wrong-password");
    });

    it("passes validation with valid user and parameters", async () => {
      const mockUser = { email: "test@example.com" };
      const res = await validateChangePassword(mockUser, "oldPassword123", "newPassword123");
      expect(res).toBe(true);
    });
  });
});
