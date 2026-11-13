import { describe, expect, it, vi } from "vitest";
import { claimOrdysSubscriptionCancellation } from "../edge-functions/_shared/ordys-subscription-cancellation";

function setup(options: {
  patchResult?: unknown;
  losePatchResponseAfterCommit?: boolean;
  row?: Record<string, unknown>;
} = {}) {
  const row: Record<string, unknown> = {
    id: "subscription-1",
    status: "active",
    provider_status: "ACTIVE",
    cancellation_requested_at: null,
    cancellation_confirmed_at: null,
    cancellation_claim_id: null,
    ...options.row,
  };
  const serviceRest = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      if (options.patchResult !== undefined) return options.patchResult;
      Object.assign(row, JSON.parse(String(init.body ?? "{}")));
      if (options.losePatchResponseAfterCommit) {
        throw new Error("PATCH response lost after commit");
      }
      return [{ ...row }];
    }
    if (path.startsWith("ordys_billing_subscriptions?select=id,status,provider_status")) {
      return [{ ...row }];
    }
    throw new Error(`Unexpected serviceRest call: ${path}`);
  });
  return { row, serviceRest };
}

describe("ORDYS recurring subscription cancellation claim", () => {
  it("proves ownership from the PATCH representation", async () => {
    const { row, serviceRest } = setup();

    const result = await claimOrdysSubscriptionCancellation("user-1", "subscription-1", serviceRest);

    expect(result.status).toBe("claimed");
    expect(row.cancellation_claim_id).toEqual(expect.any(String));
    expect(row.cancellation_requested_at).toEqual(expect.any(String));
    expect(serviceRest).toHaveBeenCalledTimes(1);
    expect(serviceRest.mock.calls[0]?.[0]).toContain("cancellation_claim_id=is.null");
  });

  it("allows one claim for a legacy locally cancelled row without provider confirmation", async () => {
    const { row, serviceRest } = setup({
      row: { status: "cancelled", provider_status: "ACTIVE" },
    });

    const result = await claimOrdysSubscriptionCancellation("user-1", "subscription-1", serviceRest);

    expect(result.status).toBe("claimed");
    expect(row.cancellation_claim_id).toEqual(expect.any(String));
    expect(row.cancellation_requested_at).toEqual(expect.any(String));
    expect(serviceRest.mock.calls[0]?.[0]).toContain(
      "status=in.(pending,active,past_due,suspended,cancelled)",
    );
  });

  it("proves ownership after the PATCH commits but its response is lost", async () => {
    const { row, serviceRest } = setup({ losePatchResponseAfterCommit: true });

    const result = await claimOrdysSubscriptionCancellation("user-1", "subscription-1", serviceRest);

    expect(result).toMatchObject({
      status: "claimed",
      cancellationRequestedAt: row.cancellation_requested_at,
    });
    expect(row.cancellation_claim_id).toEqual(expect.any(String));
    expect(serviceRest).toHaveBeenCalledTimes(2);
  });

  it("does not take over another invocation's claim", async () => {
    const { serviceRest } = setup({
      patchResult: [],
      row: {
        cancellation_requested_at: "2026-11-04T14:00:00.000Z",
        cancellation_claim_id: "00000000-0000-4000-8000-000000000001",
      },
    });

    const result = await claimOrdysSubscriptionCancellation("user-1", "subscription-1", serviceRest);

    expect(result).toEqual({ status: "already_claimed" });
    expect(serviceRest).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the authoritative read-back is unavailable", async () => {
    const { serviceRest } = setup({ patchResult: [] });
    serviceRest.mockImplementation(async (path: string) => {
      if (path.startsWith("ordys_billing_subscriptions?select=id,status,provider_status")) {
        throw new Error("database readback unavailable");
      }
      return [];
    });

    await expect(claimOrdysSubscriptionCancellation("user-1", "subscription-1", serviceRest))
      .rejects.toThrow("database readback unavailable");
    expect(serviceRest).toHaveBeenCalledTimes(2);
  });

  it("returns provider-confirmed state without reserving or repeating DELETE", async () => {
    const { serviceRest } = setup({
      patchResult: [],
      row: {
        status: "suspended",
        provider_status: "DELETED",
        cancellation_requested_at: null,
      },
    });

    const result = await claimOrdysSubscriptionCancellation("user-1", "subscription-1", serviceRest);

    expect(result).toEqual({ status: "confirmed", cancellationRequestedAt: null });
    expect(serviceRest).toHaveBeenCalledTimes(2);
  });
});
