import { describe, expect, it, vi } from "vitest";
import { claimOrdysCheckoutCancellation } from "../supabase/functions/_shared/ordys-checkout-cancellation";

describe("ORDYS Checkout cancellation ownership claim", () => {
  it("accepts a successful compare-and-set only when the returned row has its owner token", async () => {
    const serviceRest = vi.fn(async (_path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return [{
        id: "attempt-1",
        status: "pending",
        cancellation_requested_at: body.cancellation_requested_at,
        cancellation_claim_id: body.cancellation_claim_id,
      }];
    });

    await expect(
      claimOrdysCheckoutCancellation("user-1", "attempt-1", serviceRest),
    ).resolves.toBe("claimed");
    expect(serviceRest).toHaveBeenCalledOnce();
    expect(serviceRest.mock.calls[0]?.[0]).toContain("user_id=eq.user-1");
    expect(serviceRest.mock.calls[0]?.[0]).toContain("cancellation_requested_at=is.null");
    expect(JSON.parse(String(serviceRest.mock.calls[0]?.[1]?.body)).cancellation_claim_id)
      .toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("recovers its own committed claim when the PATCH response is lost", async () => {
    let stored: Record<string, unknown> | null = null;
    const serviceRest = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        stored = {
          id: "attempt-1",
          status: "pending",
          cancellation_requested_at: body.cancellation_requested_at,
          cancellation_claim_id: body.cancellation_claim_id,
        };
        throw new Error("response connection lost after commit");
      }
      return stored ? [stored] : [];
    });

    await expect(
      claimOrdysCheckoutCancellation("user-1", "attempt-1", serviceRest),
    ).resolves.toBe("claimed");
    expect(serviceRest).toHaveBeenCalledTimes(2);
    expect(serviceRest.mock.calls[1]?.[0]).toContain("cancellation_claim_id");
  });

  it("does not take over a cancellation claim owned by another invocation", async () => {
    const serviceRest = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return [];
      return [{
        id: "attempt-1",
        status: "pending",
        cancellation_requested_at: "2026-11-04T10:00:00.000Z",
        cancellation_claim_id: "another-invocation-token",
      }];
    });

    await expect(
      claimOrdysCheckoutCancellation("user-1", "attempt-1", serviceRest),
    ).resolves.toBe("already_claimed");
    expect(serviceRest).toHaveBeenCalledTimes(2);
  });

  it("does not claim a Checkout already closed by its webhook", async () => {
    const serviceRest = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return [];
      return [{
        id: "attempt-1",
        status: "cancelled",
        cancellation_requested_at: null,
        cancellation_claim_id: null,
      }];
    });

    await expect(
      claimOrdysCheckoutCancellation("user-1", "attempt-1", serviceRest),
    ).resolves.toBe("terminal");
  });

  it("fails closed when the PATCH result and authoritative read-back are unavailable", async () => {
    const serviceRest = vi.fn()
      .mockRejectedValueOnce(new Error("PATCH response lost"))
      .mockRejectedValueOnce(new Error("read-back unavailable"));

    await expect(
      claimOrdysCheckoutCancellation("user-1", "attempt-1", serviceRest),
    ).rejects.toThrow("read-back unavailable");
    expect(serviceRest).toHaveBeenCalledTimes(2);
  });
});
