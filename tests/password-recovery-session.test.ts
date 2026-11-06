import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRecoveryScreenMode } from "../src/lib/password-recovery-session";

describe("password recovery session initialization", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the password form when a recovery session exists", async () => {
    await expect(
      resolveRecoveryScreenMode(async () => ({
        data: { session: { user: { id: "user-1" } } },
        error: null,
      })),
    ).resolves.toEqual({ mode: "reset", status: "resolved" });
  });

  it("opens the request form when no session exists", async () => {
    await expect(
      resolveRecoveryScreenMode(async () => ({
        data: { session: null },
        error: null,
      })),
    ).resolves.toEqual({ mode: "request", status: "resolved" });
  });

  it("falls back to the request form when the session lookup returns an error", async () => {
    await expect(
      resolveRecoveryScreenMode(async () => ({
        data: { session: null },
        error: new Error("storage unavailable"),
      })),
    ).resolves.toEqual({ mode: "request", status: "fallback" });
  });

  it("falls back to the request form when the session lookup rejects", async () => {
    await expect(
      resolveRecoveryScreenMode(async () => {
        throw new Error("network unavailable");
      }),
    ).resolves.toEqual({ mode: "request", status: "fallback" });
  });

  it("stops waiting when the session lookup does not settle", async () => {
    vi.useFakeTimers();

    const resolution = resolveRecoveryScreenMode(
      () => new Promise<never>(() => undefined),
      500,
    );

    await vi.advanceTimersByTimeAsync(500);

    await expect(resolution).resolves.toEqual({
      mode: "request",
      status: "fallback",
    });
  });
});
