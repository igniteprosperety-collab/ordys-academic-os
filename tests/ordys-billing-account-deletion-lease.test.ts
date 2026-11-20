import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BillingCancellationPendingError,
  cancelOrdysBillingBeforeAccountDeletion,
} from "../src/lib/asaas/ordys-delete-account-billing.server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("account deletion processing lease cleanup", () => {
  it("preserves the original billing reconciliation error when lease release fails", async () => {
    const serviceRest = vi.fn(async (path: string) => {
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path.startsWith("ordys_billing_checkout_attempts?")) return [];
      if (path.startsWith("ordys_billing_subscriptions?")) return [];
      if (path === "rpc/ordys_has_unreconciled_billing_events") return true;
      if (path === "rpc/ordys_release_account_deletion_processing") {
        throw new Error("temporary database failure");
      }
      throw new Error(`Unexpected database call: ${path}`);
    });
    const releaseLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const error = await cancelOrdysBillingBeforeAccountDeletion("user-1", {
      getBillingSchemaStatus: async () => "ready",
      serviceRest,
      asaasRequest: vi.fn(),
      assertAsaasConfigured: vi.fn(),
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BillingCancellationPendingError);
    expect(error).toMatchObject({ code: "billing_reconciliation_required" });
    expect(serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_release_account_deletion_processing",
      expect.objectContaining({ method: "POST" }),
    );
    expect(releaseLog).toHaveBeenCalled();
  });
});
