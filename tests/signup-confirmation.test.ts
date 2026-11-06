import { describe, expect, it, vi } from "vitest";
import {
  resolveSignupSessionOutcome,
  signupEmailIsAlreadyConfirmed,
} from "../src/lib/signup-confirmation";

describe("signup confirmation state", () => {
  it("recognizes a database-confirmed signup even when Auth returned no session", () => {
    expect(signupEmailIsAlreadyConfirmed("2026-10-30T23:00:00.000Z")).toBe(true);
  });

  it("does not treat missing or empty confirmation timestamps as confirmed", () => {
    expect(signupEmailIsAlreadyConfirmed(null)).toBe(false);
    expect(signupEmailIsAlreadyConfirmed(undefined)).toBe(false);
    expect(signupEmailIsAlreadyConfirmed("")).toBe(false);
    expect(signupEmailIsAlreadyConfirmed("   ")).toBe(false);
  });

  it("attempts password sign-in even when signup returns no confirmation timestamp", async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null });
    await expect(resolveSignupSessionOutcome(null, signIn)).resolves.toBe("signed-in");
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("keeps the confirmation-pending state only for an explicit Auth confirmation error", async () => {
    const signIn = vi.fn().mockResolvedValue({
      error: { message: "Email not confirmed" },
    });
    await expect(resolveSignupSessionOutcome(null, signIn)).resolves.toBe(
      "confirmation-pending",
    );
  });

  it("asks a confirmed user to sign in when automatic session creation fails", async () => {
    const signIn = vi.fn().mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    await expect(
      resolveSignupSessionOutcome("2026-10-30T23:00:00.000Z", signIn),
    ).resolves.toBe("login-required");
  });

  it("uses a neutral retry state for transient or unexpected sign-in failures", async () => {
    const signIn = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    await expect(resolveSignupSessionOutcome(null, signIn)).resolves.toBe("retry-login");
  });
});
