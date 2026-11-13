import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AsaasApiError } from "../edge-functions/_shared/ordys-billing";
import {
  AccountDeletionProcessingError,
  BillingCancellationPendingError,
  CheckoutCreationInProgressError,
  cancelOrdysBillingBeforeAccountDeletion,
} from "../edge-functions/_shared/ordys-delete-account-billing";

function makeDependencies(
  schemaStatus: string,
  attemptRows: unknown = [],
  subscriptionRows: unknown = [],
  options: {
    subscriptionMarkerResponseLost?: boolean;
    unreconciledBillingEvents?: boolean;
    providerConfigurationError?: Error;
  } = {},
) {
  const getBillingSchemaStatus = vi.fn(async () => schemaStatus);
  const serviceRest = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
    if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
    if (path === "rpc/ordys_release_account_deletion_processing") return "released";
    if (path === "rpc/ordys_has_unreconciled_billing_events") {
      return options.unreconciledBillingEvents ?? false;
    }
    if (path === "rpc/ordys_confirm_subscription_cancellation") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        p_subscription_id?: string;
        p_cancellation_requested_at?: string | null;
      };
      const target = Array.isArray(subscriptionRows)
        ? subscriptionRows.find((row) => row && typeof row === "object" &&
          (row as Record<string, unknown>).id === body.p_subscription_id)
        : undefined;
      if (!target || typeof target !== "object") return "not_owner";
      const row = target as Record<string, unknown>;
      if (body.p_cancellation_requested_at === null) {
        if (
          (row.provider_status !== "DELETED" && typeof row.cancellation_confirmed_at !== "string") ||
          (row.status !== "cancelled" && row.status !== "suspended")
        ) return "not_owner";
      } else if (row.cancellation_requested_at !== body.p_cancellation_requested_at) {
        return "not_owner";
      }
      row.status = row.status === "suspended" ? "suspended" : "cancelled";
      row.provider_status = "DELETED";
      row.cancellation_confirmed_at ??= new Date().toISOString();
      row.cancelled_at ??= new Date().toISOString();
      if (typeof row.checkout_attempt_id === "string" && Array.isArray(attemptRows)) {
        const linkedAttempt = attemptRows.find((attempt) =>
          attempt && typeof attempt === "object" &&
          (attempt as Record<string, unknown>).id === row.checkout_attempt_id
        ) as Record<string, unknown> | undefined;
        if (linkedAttempt && (linkedAttempt.status === "linked" || linkedAttempt.status === "paid")) {
          linkedAttempt.status = "cancelled";
        }
      }
      return "confirmed";
    }
    if (path.startsWith("ordys_billing_checkout_attempts?") && init?.method === "PATCH") {
      const firstAttempt = Array.isArray(attemptRows) ? attemptRows[0] : null;
      if (!firstAttempt || typeof firstAttempt !== "object") return [];
      const patch = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      Object.assign(firstAttempt as Record<string, unknown>, patch);
      return [{ ...(firstAttempt as Record<string, unknown>) }];
    }
    if (path.startsWith("ordys_billing_subscriptions?") && init?.method === "PATCH") {
      const idMatch = path.match(/(?:^|&)id=eq\.([^&]+)/);
      const id = idMatch?.[1] ? decodeURIComponent(idMatch[1]) : "";
      const target = Array.isArray(subscriptionRows)
        ? subscriptionRows.find((row) => row && typeof row === "object" && (row as Record<string, unknown>).id === id)
        : undefined;
      if (!target || typeof target !== "object") return [];
      const patch = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      Object.assign(target, patch);
      if (options.subscriptionMarkerResponseLost) {
        throw new Error("PATCH response lost after commit");
      }
      return [{ ...(target as Record<string, unknown>) }];
    }
    if (path.startsWith("ordys_billing_checkout_attempts?")) return attemptRows;
    if (path.startsWith("ordys_billing_subscriptions?")) return subscriptionRows;
    throw new Error(`Unexpected serviceRest path: ${path}`);
  });
  const asaasRequest = vi.fn(async () => ({}));
  const assertAsaasConfigured = vi.fn(() => {
    if (options.providerConfigurationError) throw options.providerConfigurationError;
  });
  return { getBillingSchemaStatus, serviceRest, asaasRequest, assertAsaasConfigured };
}

describe("account deletion billing guard", () => {
  it("does not persist a Checkout cancellation claim when Asaas configuration is invalid", async () => {
    const dependencies = makeDependencies("ready", [{
      id: "checkout-1",
      status: "pending",
      provider_checkout_id: "asaas-checkout-1",
      cancellation_requested_at: null,
    }], [], {
      providerConfigurationError: new Error("ASAAS_API_KEY ausente."),
    });

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toThrow("ASAAS_API_KEY ausente.");

    expect(dependencies.assertAsaasConfigured).toHaveBeenCalledOnce();
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
    expect(dependencies.serviceRest).not.toHaveBeenCalledWith(
      expect.stringContaining("cancellation_requested_at=is.null"),
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_release_account_deletion_processing",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not persist a subscription cancellation claim when Asaas configuration is invalid", async () => {
    const dependencies = makeDependencies("ready", [], [{
      id: "subscription-1",
      status: "active",
      provider_subscription_id: "asaas-subscription-1",
    }], {
      providerConfigurationError: new Error("O provedor de pagamentos ainda não está configurado."),
    });

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toThrow("O provedor de pagamentos ainda não está configurado.");

    expect(dependencies.assertAsaasConfigured).toHaveBeenCalledOnce();
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
    expect(dependencies.serviceRest).not.toHaveBeenCalledWith(
      expect.stringContaining("cancellation_requested_at=is.null"),
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_release_account_deletion_processing",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("allows core account deletion when the optional billing schema is absent", async () => {
    const dependencies = makeDependencies("absent");

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies)).resolves.toBeNull();

    expect(dependencies.getBillingSchemaStatus).toHaveBeenCalledOnce();
    expect(dependencies.serviceRest).not.toHaveBeenCalled();
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("fails closed when the billing schema is only partially installed", async () => {
    const dependencies = makeDependencies("partial");

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toThrow("estrutura de assinaturas está incompleta");
    expect(dependencies.serviceRest).not.toHaveBeenCalled();
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("blocks deletion while a provider subscription webhook remains unmatched to the local Checkout", async () => {
    const dependencies = makeDependencies("ready", [], [], {
      unreconciledBillingEvents: true,
    });

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toMatchObject({
        name: "BillingCancellationPendingError",
        code: "billing_reconciliation_required",
      });

    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_has_unreconciled_billing_events",
      {
        method: "POST",
        body: JSON.stringify({ p_user_id: "user-1" }),
      },
    );
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("fails closed when the billing schema status cannot be read", async () => {
    const dependencies = makeDependencies("ready");
    dependencies.getBillingSchemaStatus.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toThrow("database unavailable");
    expect(dependencies.serviceRest).not.toHaveBeenCalled();
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("does not reserve deletion while a checkout creation is still in flight", async () => {
    const dependencies = makeDependencies("ready");
    dependencies.serviceRest.mockImplementation(async (path: string) => {
      if (path === "rpc/ordys_reserve_account_deletion") return "checkout_creation_in_progress";
      throw new Error(`Unexpected serviceRest path after reservation refusal: ${path}`);
    });

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toBeInstanceOf(CheckoutCreationInProgressError);

    expect(dependencies.serviceRest).toHaveBeenCalledOnce();
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_reserve_account_deletion",
      { method: "POST", body: JSON.stringify({ p_user_id: "user-1" }) },
    );
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("keeps the processing lease for the caller to hold through account deletion", async () => {
    const dependencies = makeDependencies("ready");
    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies)).resolves.toEqual(expect.any(String));
    expect(dependencies.serviceRest).toHaveBeenCalledTimes(5);
    expect(dependencies.serviceRest.mock.calls[0]?.[0]).toBe("rpc/ordys_reserve_account_deletion");
    expect(dependencies.serviceRest.mock.calls[1]?.[0]).toBe("rpc/ordys_claim_account_deletion_processing");
    expect(dependencies.serviceRest.mock.calls[2]?.[0]).toMatch(/^ordys_billing_checkout_attempts/);
    expect(dependencies.serviceRest.mock.calls[3]?.[0]).toMatch(/^ordys_billing_subscriptions/);
    expect(dependencies.serviceRest.mock.calls[4]?.[0]).toBe("rpc/ordys_has_unreconciled_billing_events");
    expect(dependencies.serviceRest).not.toHaveBeenCalledWith("rpc/ordys_release_account_deletion_processing", expect.anything());
  });

  it("rejects a competing deletion before it can call Asaas or read billing rows", async () => {
    const dependencies = makeDependencies("ready");
    dependencies.serviceRest.mockImplementation(async (path: string) => {
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "deletion_processing";
      throw new Error(`Unexpected serviceRest path while another deletion owns the lease: ${path}`);
    });
    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toBeInstanceOf(AccountDeletionProcessingError);
    expect(dependencies.serviceRest).toHaveBeenCalledTimes(2);
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("does not treat an unexpected table response as an empty billing history", async () => {
    const dependencies = makeDependencies("ready", null, []);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toThrow("confirmar as cobranças");
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("requests provider cancellation for active subscriptions before account deletion", async () => {
    const dependencies = makeDependencies("ready", [], [{
      id: "subscription-1",
      status: "active",
      provider_subscription_id: "asaas-subscription-1",
    }]);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies)).resolves.toEqual(expect.any(String));

    expect(dependencies.asaasRequest).toHaveBeenCalledWith(
      "/subscriptions/asaas-subscription-1",
      { method: "DELETE" },
    );
  });

  it("persists subscription cancellation intent before Asaas and records the synchronous confirmation", async () => {
    const dependencies = makeDependencies("ready", [], [{
      id: "subscription-1",
      status: "active",
      provider_subscription_id: "asaas-subscription-1",
    }]);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .resolves.toEqual(expect.any(String));

    const requestMarkerIndex = dependencies.serviceRest.mock.invocationCallOrder.find((_, index) =>
      dependencies.serviceRest.mock.calls[index]?.[0].includes("cancellation_requested_at=is.null"),
    );
    const providerDeleteIndex = dependencies.asaasRequest.mock.invocationCallOrder[0];
    const confirmationMarkerIndex = dependencies.serviceRest.mock.invocationCallOrder.find((_, index) =>
      dependencies.serviceRest.mock.calls[index]?.[0] === "rpc/ordys_confirm_subscription_cancellation",
    );
    expect(requestMarkerIndex!).toBeLessThan(providerDeleteIndex!);
    expect(providerDeleteIndex!).toBeLessThan(confirmationMarkerIndex!);
    expect(dependencies.asaasRequest).toHaveBeenCalledWith(
      "/subscriptions/asaas-subscription-1",
      { method: "DELETE" },
    );
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"p_subscription_id":"subscription-1"'),
      }),
    );
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({
        body: expect.stringContaining('"p_cancellation_requested_at"'),
      }),
    );
    expect(dependencies.serviceRest).not.toHaveBeenCalledWith(
      expect.stringContaining("cancellation_confirmed_at=eq."),
      expect.anything(),
    );
  });

  it("continues with one Asaas DELETE when its own subscription claim committed but the PATCH response was lost", async () => {
    const subscription = {
      id: "subscription-1",
      status: "active",
      provider_subscription_id: "asaas-subscription-1",
      cancellation_requested_at: null,
      cancellation_claim_id: null,
      cancellation_confirmed_at: null,
    };
    const dependencies = makeDependencies("ready", [], [subscription], {
      subscriptionMarkerResponseLost: true,
    });

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .resolves.toEqual(expect.any(String));

    expect(subscription.cancellation_requested_at).toEqual(expect.any(String));
    expect(subscription.cancellation_claim_id).toEqual(expect.any(String));
    expect(dependencies.asaasRequest).toHaveBeenCalledTimes(1);
    expect(dependencies.asaasRequest).toHaveBeenCalledWith(
      "/subscriptions/asaas-subscription-1",
      { method: "DELETE" },
    );
  });

  it("keeps account deletion blocked when Asaas returns 404 for an inaccessible subscription", async () => {
    const subscription = {
      id: "subscription-1",
      status: "active",
      provider_subscription_id: "asaas-subscription-1",
    };
    const dependencies = makeDependencies("ready", [], [subscription]);
    dependencies.asaasRequest.mockRejectedValueOnce(new AsaasApiError(404));

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toMatchObject({
        name: "BillingCancellationPendingError",
        code: "billing_cancellation_processing",
      });

    expect(subscription.cancellation_requested_at).toEqual(expect.any(String));
    expect(subscription.cancellation_confirmed_at).toBeUndefined();
    expect(dependencies.serviceRest).not.toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.anything(),
    );
    expect(dependencies.serviceRest).not.toHaveBeenCalledWith(
      "rpc/ordys_release_account_deletion_reservation",
      expect.anything(),
    );
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_release_account_deletion_processing",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("does not call Asaas when the provider webhook confirms cancellation before the intent compare-and-set", async () => {
    const dependencies = makeDependencies("ready", [], [{
      id: "subscription-1",
      status: "active",
      provider_subscription_id: "asaas-subscription-1",
    }]);
    dependencies.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "released";
      if (path === "rpc/ordys_confirm_subscription_cancellation") return "confirmed";
      if (path === "rpc/ordys_has_unreconciled_billing_events") return false;
      if (path.startsWith("ordys_billing_checkout_attempts?")) return [];
      if (path.startsWith("ordys_billing_subscriptions?") && init?.method === "PATCH") return [];
      if (path.includes("select=id,status,provider_status,cancellation_requested_at,cancellation_confirmed_at,cancellation_claim_id")) {
        return [{
          id: "subscription-1",
          status: "suspended",
          provider_subscription_id: "asaas-subscription-1",
          cancellation_requested_at: "2026-11-03T20:00:00.000Z",
          cancellation_confirmed_at: "2026-11-03T20:01:00.000Z",
        }];
      }
      if (path.startsWith("ordys_billing_subscriptions?")) {
        return [{
          id: "subscription-1",
          status: "active",
          provider_subscription_id: "asaas-subscription-1",
          cancellation_requested_at: null,
          cancellation_confirmed_at: null,
        }];
      }
      throw new Error(`Unexpected serviceRest path during webhook/CAS race: ${path}`);
    });

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .resolves.toEqual(expect.any(String));

    expect(dependencies.serviceRest.mock.calls.some(([path]) =>
      path.includes("cancellation_confirmed_at=is.null"),
    )).toBe(true);
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("does not resend subscription DELETE after an ambiguous prior request", async () => {
    const dependencies = makeDependencies("ready", [], [{
      id: "subscription-1",
      status: "active",
      provider_subscription_id: "asaas-subscription-1",
      cancellation_requested_at: "2026-11-03T20:00:00.000Z",
      cancellation_confirmed_at: null,
    }]);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toBeInstanceOf(BillingCancellationPendingError);

    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
    expect(dependencies.serviceRest).not.toHaveBeenCalledWith(
      expect.stringContaining("cancellation_requested_at=is.null"),
      expect.anything(),
    );
  });

  it("does not resend a subscription DELETE already confirmed by Asaas", async () => {
    const dependencies = makeDependencies("ready", [], [{
      id: "subscription-1",
      status: "active",
      provider_subscription_id: "asaas-subscription-1",
      cancellation_requested_at: "2026-11-03T20:00:00.000Z",
      cancellation_confirmed_at: "2026-11-03T20:01:00.000Z",
    }]);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .resolves.toEqual(expect.any(String));

    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"p_cancellation_requested_at"'),
      }),
    );
  });

  it.each(["cancelled", "suspended"])(
    "reconciles legacy provider-confirmed deletions without repeating Asaas for a %s subscription",
    async (status) => {
      const attempts = [{ id: "attempt-legacy", status: "linked" }];
      const subscriptions = [{
        id: "subscription-legacy",
        status,
        provider_status: "DELETED",
        checkout_attempt_id: "attempt-legacy",
        provider_subscription_id: "asaas-subscription-legacy",
        cancellation_requested_at: null,
        cancellation_confirmed_at: null,
      }];
      const dependencies = makeDependencies("ready", attempts, subscriptions);

      await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
        .resolves.toEqual(expect.any(String));

      expect(dependencies.asaasRequest).not.toHaveBeenCalled();
      expect(dependencies.serviceRest).toHaveBeenCalledWith(
        "rpc/ordys_confirm_subscription_cancellation",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"p_cancellation_requested_at":null'),
        }),
      );
      expect(subscriptions[0]?.cancellation_confirmed_at).toBeTruthy();
      expect(attempts[0]?.status).toBe("cancelled");
    },
  );

  it("allows deletion after Asaas confirms cancellation of a chargeback-suspended subscription", async () => {
    const dependencies = makeDependencies("ready", [], [{
      id: "subscription-suspended",
      status: "suspended",
      provider_subscription_id: "asaas-subscription-suspended",
      cancellation_requested_at: "2026-11-03T20:00:00.000Z",
      cancellation_confirmed_at: "2026-11-03T20:01:00.000Z",
    }]);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .resolves.toEqual(expect.any(String));

    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("blocks deletion until a pending checkout cancellation is reconciled", async () => {
    const dependencies = makeDependencies("ready", [{
      id: "attempt-1",
      status: "pending",
      provider_checkout_id: "asaas-checkout-1",
    }], []);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toBeInstanceOf(BillingCancellationPendingError);
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_release_account_deletion_processing",
      expect.objectContaining({ method: "POST" }),
    );
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      expect.stringContaining("cancellation_requested_at=is.null"),
      expect.objectContaining({ method: "PATCH" }),
    );
    const markerWriteOrder = dependencies.serviceRest.mock.invocationCallOrder.find((_, index) =>
      dependencies.serviceRest.mock.calls[index]?.[0].includes("cancellation_requested_at=is.null"),
    );
    const providerCancelOrder = dependencies.asaasRequest.mock.invocationCallOrder[0];
    expect(markerWriteOrder).toBeDefined();
    expect(markerWriteOrder!).toBeLessThan(providerCancelOrder!);
    expect(dependencies.asaasRequest).toHaveBeenCalledWith(
      "/checkouts/asaas-checkout-1/cancel",
      { method: "POST" },
    );
  });

  it("sends the Checkout cancellation when its own committed claim PATCH response is lost", async () => {
    const attempts = [{
      id: "attempt-claim-owned",
      status: "pending",
      provider_checkout_id: "asaas-checkout-claim-owned",
      cancellation_requested_at: null,
      cancellation_claim_id: null,
    }];
    const dependencies = makeDependencies("ready", attempts, []);
    const original = dependencies.serviceRest.getMockImplementation();
    if (!original) throw new Error("Missing serviceRest mock implementation");

    dependencies.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("ordys_billing_checkout_attempts?") && init?.method === "PATCH") {
        Object.assign(attempts[0]!, JSON.parse(String(init.body ?? "{}")));
        throw new Error("PATCH response lost after commit");
      }
      return original(path, init);
    });

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toBeInstanceOf(BillingCancellationPendingError);

    expect(attempts[0]?.cancellation_claim_id).toEqual(expect.any(String));
    expect(dependencies.asaasRequest).toHaveBeenCalledOnce();
    expect(dependencies.asaasRequest).toHaveBeenCalledWith(
      "/checkouts/asaas-checkout-claim-owned/cancel",
      { method: "POST" },
    );
  });

  it("does not send Checkout cancellation when a different claim owner won the PATCH", async () => {
    const attempts = [{
      id: "attempt-claim-other",
      status: "pending",
      provider_checkout_id: "asaas-checkout-claim-other",
      cancellation_requested_at: null,
      cancellation_claim_id: null,
    }];
    const dependencies = makeDependencies("ready", attempts, []);
    const original = dependencies.serviceRest.getMockImplementation();
    if (!original) throw new Error("Missing serviceRest mock implementation");

    dependencies.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("ordys_billing_checkout_attempts?") && init?.method === "PATCH") {
        Object.assign(attempts[0]!, JSON.parse(String(init.body ?? "{}")));
        attempts[0]!.cancellation_claim_id = "another-invocation";
        return [];
      }
      return original(path, init);
    });

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toBeInstanceOf(BillingCancellationPendingError);

    expect(attempts[0]?.cancellation_claim_id).toBe("another-invocation");
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("does not resend Checkout cancellation after a previous request awaits webhook reconciliation", async () => {
    const dependencies = makeDependencies("ready", [{
      id: "attempt-1",
      status: "pending",
      provider_checkout_id: "asaas-checkout-1",
      cancellation_requested_at: "2026-11-03T20:00:00.000Z",
    }], []);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toBeInstanceOf(BillingCancellationPendingError);

    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
    expect(dependencies.serviceRest).not.toHaveBeenCalledWith(
      expect.stringContaining("cancellation_requested_at=is.null"),
      expect.anything(),
    );
  });

  it("continues cancelling identified Checkouts when another Checkout has no provider ID yet", async () => {
    const attempts = [
      {
        id: "attempt-without-provider-id",
        status: "creating",
        provider_checkout_id: null,
        cancellation_requested_at: null,
        cancellation_claim_id: null,
      },
      {
        id: "attempt-identifiable",
        status: "pending",
        provider_checkout_id: "asaas-checkout-identifiable",
        cancellation_requested_at: null,
        cancellation_claim_id: null,
      },
    ];
    const dependencies = makeDependencies("ready", attempts, []);
    const original = dependencies.serviceRest.getMockImplementation();
    if (!original) throw new Error("Missing serviceRest mock implementation");

    dependencies.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("ordys_billing_checkout_attempts?") && init?.method === "PATCH") {
        const idMatch = path.match(/(?:^|&)id=eq\.([^&]+)/);
        const id = idMatch?.[1] ? decodeURIComponent(idMatch[1]) : "";
        const target = attempts.find((attempt) => attempt.id === id);
        if (!target) return [];
        Object.assign(target, JSON.parse(String(init.body ?? "{}")));
        return [{ ...target }];
      }
      return original(path, init);
    });

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toMatchObject({
        name: "BillingCancellationPendingError",
        code: "checkout_cancellation_processing",
      });

    expect(dependencies.asaasRequest).toHaveBeenCalledOnce();
    expect(dependencies.asaasRequest).toHaveBeenCalledWith(
      "/checkouts/asaas-checkout-identifiable/cancel",
      { method: "POST" },
    );
  });

  it("continues cancelling independent Checkouts after another claim becomes inconclusive", async () => {
    const attempts = [
      {
        id: "attempt-claim-inconclusive",
        status: "pending",
        provider_checkout_id: "asaas-checkout-inconclusive",
        cancellation_requested_at: null,
        cancellation_claim_id: null,
      },
      {
        id: "attempt-claim-owned",
        status: "pending",
        provider_checkout_id: "asaas-checkout-owned",
        cancellation_requested_at: null,
        cancellation_claim_id: null,
      },
    ];
    const dependencies = makeDependencies("ready", attempts, []);
    const original = dependencies.serviceRest.getMockImplementation();
    if (!original) throw new Error("Missing serviceRest mock implementation");

    dependencies.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      const idMatch = path.match(/(?:^|&)id=eq\.([^&]+)/);
      const id = idMatch?.[1] ? decodeURIComponent(idMatch[1]) : "";
      if (path.startsWith("ordys_billing_checkout_attempts?") && init?.method === "PATCH") {
        if (id === "attempt-claim-inconclusive") return [];
        const target = attempts.find((attempt) => attempt.id === id);
        if (!target) return [];
        Object.assign(target, JSON.parse(String(init.body ?? "{}")));
        return [{ ...target }];
      }
      if (
        path.startsWith("ordys_billing_checkout_attempts?") &&
        path.includes("select=id,status,cancellation_requested_at,cancellation_claim_id") &&
        id === "attempt-claim-inconclusive"
      ) {
        return [{ ...attempts[0] }];
      }
      return original(path, init);
    });

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toMatchObject({
        name: "BillingCancellationPendingError",
        code: "checkout_cancellation_processing",
      });

    expect(dependencies.asaasRequest).toHaveBeenCalledOnce();
    expect(dependencies.asaasRequest).toHaveBeenCalledWith(
      "/checkouts/asaas-checkout-owned/cancel",
      { method: "POST" },
    );
    expect(attempts[0]?.cancellation_claim_id).toBeNull();
    expect(attempts[1]?.cancellation_claim_id).toEqual(expect.any(String));
  });

  it("continues known subscription cancellations when Checkout records need reconciliation", async () => {
    const dependencies = makeDependencies("ready", [{
      id: "attempt-paid-unlinked",
      status: "paid",
      provider_checkout_id: "asaas-checkout-paid-unlinked",
    }], [{
      id: "subscription-known",
      status: "active",
      checkout_attempt_id: "another-checkout",
      provider_subscription_id: "asaas-subscription-known",
    }]);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toMatchObject({
        name: "BillingCancellationPendingError",
        code: "billing_reconciliation_required",
      });

    expect(dependencies.asaasRequest).toHaveBeenCalledOnce();
    expect(dependencies.asaasRequest).toHaveBeenCalledWith(
      "/subscriptions/asaas-subscription-known",
      { method: "DELETE" },
    );
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"p_subscription_id":"subscription-known"'),
      }),
    );
  });

  it("attempts every known subscription cancellation when one provider response is uncertain", async () => {
    const dependencies = makeDependencies("ready", [], [
      {
        id: "subscription-first",
        status: "active",
        provider_subscription_id: "asaas-subscription-first",
      },
      {
        id: "subscription-second",
        status: "active",
        provider_subscription_id: "asaas-subscription-second",
      },
    ]);
    dependencies.asaasRequest.mockRejectedValueOnce(new AsaasApiError(404));

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toMatchObject({
        name: "BillingCancellationPendingError",
        code: "billing_cancellation_processing",
      });

    expect(dependencies.asaasRequest).toHaveBeenCalledTimes(2);
    expect(dependencies.asaasRequest).toHaveBeenNthCalledWith(
      1,
      "/subscriptions/asaas-subscription-first",
      { method: "DELETE" },
    );
    expect(dependencies.asaasRequest).toHaveBeenNthCalledWith(
      2,
      "/subscriptions/asaas-subscription-second",
      { method: "DELETE" },
    );
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"p_subscription_id":"subscription-second"'),
      }),
    );
  });

  it("blocks deletion when a paid checkout has no linked subscription record", async () => {
    const dependencies = makeDependencies("ready", [{
      id: "attempt-1",
      status: "paid",
      provider_checkout_id: "asaas-checkout-1",
    }], []);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .rejects.toMatchObject({
        name: "BillingCancellationPendingError",
        code: "billing_reconciliation_required",
      });
    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
  });

  it("reconciles a provider-confirmed subscription after a late inactivation event", async () => {
    const attemptRows = [{
      id: "attempt-linked-confirmed",
      status: "linked",
    }];
    const subscriptionRows = [{
      id: "subscription-confirmed-late-event",
      status: "cancelled",
      checkout_attempt_id: "attempt-linked-confirmed",
      provider_status: "INACTIVE",
      provider_subscription_id: "asaas-subscription-confirmed-late-event",
      cancellation_requested_at: null,
      cancellation_confirmed_at: "2026-11-04T14:00:00.000Z",
    }];
    const dependencies = makeDependencies("ready", attemptRows, subscriptionRows);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .resolves.toEqual(expect.any(String));

    expect(dependencies.asaasRequest).not.toHaveBeenCalled();
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"p_cancellation_requested_at":null'),
      }),
    );
    expect(attemptRows[0]?.status).toBe("cancelled");
  });

  it("cancels a legacy locally cancelled subscription before account deletion", async () => {
    const subscriptionRows = [{
      id: "subscription-legacy-cancelled",
      status: "cancelled",
      provider_status: "ACTIVE",
      provider_subscription_id: "asaas-subscription-legacy-cancelled",
      cancellation_requested_at: null,
      cancellation_claim_id: null,
      cancellation_confirmed_at: null,
    }];
    const dependencies = makeDependencies("ready", [], subscriptionRows);

    await expect(cancelOrdysBillingBeforeAccountDeletion("user-1", dependencies))
      .resolves.toEqual(expect.any(String));

    const claimCall = dependencies.serviceRest.mock.calls.find(([path, init]) =>
      String(path).startsWith("ordys_billing_subscriptions?") && init?.method === "PATCH",
    );
    expect(claimCall?.[0]).toContain(
      "status=in.(pending,active,past_due,suspended,cancelled)",
    );
    expect(claimCall?.[0]).toContain("cancellation_requested_at=is.null");
    expect(claimCall?.[0]).toContain("cancellation_claim_id=is.null");
    expect(claimCall?.[0]).toContain("cancellation_confirmed_at=is.null");
    expect(dependencies.asaasRequest).toHaveBeenCalledOnce();
    expect(dependencies.asaasRequest).toHaveBeenCalledWith(
      "/subscriptions/asaas-subscription-legacy-cancelled",
      { method: "DELETE" },
    );
    expect(dependencies.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"p_subscription_id":"subscription-legacy-cancelled"'),
      }),
    );
    expect(subscriptionRows[0]?.status).toBe("cancelled");
    expect(subscriptionRows[0]?.provider_status).toBe("DELETED");
    expect(subscriptionRows[0]?.cancellation_confirmed_at).toEqual(expect.any(String));
    expect(dependencies.serviceRest).not.toHaveBeenCalledWith(
      "rpc/ordys_release_account_deletion_processing",
      expect.anything(),
    );
  });
});


it("requires the final billing readiness function to verify all 16 webhook error guards", () => {
  const migration = readFileSync(
    "supabase/migrations/20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql",
    "utf8",
  );
  const readinessStart = migration.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.ordys_billing_schema_status()",
  );
  const readinessEnd = migration.indexOf("\n$$;", readinessStart);
  const readiness = migration.slice(readinessStart, readinessEnd);
  const helperGuardStart = readiness.indexOf(
    "WHERE oid = to_regprocedure('public.ordys_has_unreconciled_billing_events_except(uuid,text,text)')",
  );
  const helperGuardEnd = readiness.indexOf("\n      )", helperGuardStart);
  const helperGuard = readiness.slice(helperGuardStart, helperGuardEnd);
  const guardedCodes = [
    "checkout_customer_mismatch",
    "checkout_paid_after_closed",
    "checkout_reference_mismatch",
    "confirmed_payment_unmatched",
    "negative_payment_unmatched",
    "payment_subscription_unmatched",
    "subscription_checkout_unmatched",
    "subscription_delete_unmatched",
    "ambiguous_customer_association",
    "subscription_checkout_mismatch",
    "subscription_customer_mismatch",
    "subscription_identity_mismatch",
    "subscription_amount_mismatch",
    "payment_customer_mismatch",
    "payment_identity_mismatch",
    "amount_mismatch",
  ];

  expect(helperGuardStart).toBeGreaterThanOrEqual(0);
  expect(helperGuardEnd).toBeGreaterThan(helperGuardStart);
  for (const code of guardedCodes) {
    expect(helperGuard).toContain(`prosrc LIKE '%${code}%'`);
  }
  expect(helperGuard).toContain(
    "prosrc LIKE '%inbox.event_payload #>> ''{checkout,id}'' = p_allowed_provider_checkout_id%'",
  );
  expect(helperGuard).toContain(
    "prosrc LIKE '%inbox.event_payload #>> ''{checkout,externalReference}'' IS NULL%'",
  );
  expect(readiness).toContain("AND relrowsecurity");
  expect(readiness).toContain("NOT has_table_privilege('anon', 'public.ordys_billing_webhook_inbox', 'SELECT')");
  expect(readiness).toContain("NOT has_table_privilege('authenticated', 'public.ordys_billing_webhook_inbox', 'SELECT')");
  expect(readiness).toContain("has_table_privilege('service_role', 'public.ordys_billing_webhook_inbox', 'SELECT')");
  expect(readiness).toContain("ordys_billing_webhook_inbox_admission_idx");
  expect(readiness).toContain("ordys_sync_billing_webhook_inbox_status");
  expect(readiness).toContain("UPDATE public.ordys_billing_webhook_inbox");
  expect(readiness).toContain(
    "prosrc LIKE '%invalid_text_representation OR numeric_value_out_of_range OR feature_not_supported%'",
  );
  expect(readiness).toContain(
    "prosrc LIKE '%v_value_numeric * 100 <> trunc(v_value_numeric * 100)%'",
  );
  expect(readiness).toContain(
    "prosrc LIKE '%invalid_datetime_format OR datetime_field_overflow%'",
  );
  expect(readiness).toContain(
    "prosrc LIKE '%v_paid_at := LEAST(COALESCE(v_paid_at, now()), now())%'",
  );
  expect(readiness).toContain("prosrc LIKE '%IF v_paid_at IS NULL THEN%'");
  expect(readiness).toContain("ordys_billing_payment_subscription_paid_at_idx");
  expect(migration).toContain("CREATE INDEX IF NOT EXISTS ordys_billing_webhook_subscription_delete_id_retry_idx");
  expect(migration).toContain("CREATE INDEX IF NOT EXISTS ordys_billing_webhook_confirmed_payment_subscription_retry_idx");
  expect(migration).toContain("CREATE INDEX IF NOT EXISTS ordys_billing_webhook_negative_payment_identity_retry_idx");
  expect(readiness).toContain("to_regclass('public.ordys_billing_webhook_subscription_delete_id_retry_idx') IS NOT NULL");
  expect(readiness).toContain("to_regclass('public.ordys_billing_webhook_confirmed_payment_subscription_retry_idx') IS NOT NULL");
  expect(readiness).toContain("to_regclass('public.ordys_billing_webhook_negative_payment_identity_retry_idx') IS NOT NULL");
  expect(readiness).toContain("attname = 'paid_at'");
  expect(readiness).toContain("attnotnull");
  expect(readiness).toContain(
    "prosrc LIKE '%ORDER BY payment.paid_at, payment.provider_payment_id%'",
  );
  expect(readiness).toContain("prosrc LIKE '%current_period_end = v_period_end%'");
  expect(readiness).toContain("prosrc LIKE '%payment.provider_payment_id = v_payment_id%'");
});;

  it("requires schema readiness to verify every quarantined webhook error code", () => {
    const migration = readFileSync(
      "supabase/migrations/20261105040000_ordys_guard_permanent_billing_mismatches.sql",
      "utf8",
    );
    const readinessStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.ordys_billing_schema_status()",
    );
    const readinessEnd = migration.indexOf("\n$$;", readinessStart);
    const readiness = migration.slice(readinessStart, readinessEnd);
    const guardedCodes = [
      "checkout_customer_mismatch",
      "checkout_paid_after_closed",
      "checkout_reference_mismatch",
      "confirmed_payment_unmatched",
      "negative_payment_unmatched",
      "payment_subscription_unmatched",
      "subscription_checkout_unmatched",
      "subscription_delete_unmatched",
      "ambiguous_customer_association",
      "subscription_checkout_mismatch",
      "subscription_customer_mismatch",
      "subscription_identity_mismatch",
      "subscription_amount_mismatch",
      "payment_customer_mismatch",
      "payment_identity_mismatch",
      "amount_mismatch",
    ];

    for (const code of guardedCodes) {
      expect(readiness).toContain(`prosrc LIKE \'%${code}%\'`);
    }
  });
  it("requires the final durable-inbox migration to serialize every account-deletion RPC before the per-user lock", () => {
    const migration = readFileSync(
      "supabase/migrations/20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql",
      "utf8",
    );
    const readinessStart = migration.lastIndexOf(
      "CREATE OR REPLACE FUNCTION public.ordys_billing_schema_status()",
    );
    const readinessEnd = migration.indexOf("\n$;", readinessStart);
    const readiness = migration.slice(readinessStart, readinessEnd);
    expect(readiness).toContain("strpos(prosrc, 'ordys:asaas-inbox-admission') = 0");
    expect(readiness).toContain("strpos(prosrc, 'ordys:billing-lifecycle:') = 0");
    expect(readiness).toContain("strpos(prosrc, 'ordys:asaas-inbox-admission') > strpos(prosrc, 'ordys:billing-lifecycle:')");
    expect(readiness).toContain("prosrc LIKE '%ordys_apply_asaas_billing_event%'");
    expect(readiness).toContain("prosrc LIKE '%ordys_receive_asaas_billing_webhook%'");
    expect(readiness).toContain("prosrc LIKE '%v_null_candidate_count > 0%'");

    const receiveStart = migration.lastIndexOf(
      "CREATE OR REPLACE FUNCTION public.ordys_receive_asaas_billing_webhook",
    );
    const receiveEnd = migration.indexOf("$;", receiveStart);
    const receiveFunction = migration.slice(receiveStart, receiveEnd);
    expect(receiveFunction).toContain("count(*) FILTER (WHERE candidate.user_id IS NULL)");
    expect(receiveFunction).toContain(
      "IF v_candidate_count <> 1 OR v_null_candidate_count > 0 THEN",
    );
  });

describe("account deletion deployment gates", () => {
  it("requires provider cancellation confirmation for every subscription in the release and direct-delete guards", () => {
    const lifecycleMigration = readFileSync(
      "supabase/migrations/20261103020000_ordys_suspended_subscription_deletion_confirmation.sql",
      "utf8",
    );
    const directDeleteMigration = readFileSync(
      "supabase/migrations/20261103030000_guard_delete_own_data_billing_reconciliation.sql",
      "utf8",
    );
    const releaseStart = lifecycleMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.ordys_release_account_deletion_reservation",
    );
    const releaseEnd = lifecycleMigration.indexOf("$;", releaseStart);
    const releaseFunction = lifecycleMigration.slice(releaseStart, releaseEnd);
    expect(releaseFunction).toContain("subscription.cancellation_confirmed_at IS NULL");
    expect(releaseFunction).not.toContain("subscription.status IN");

    const deleteStart = directDeleteMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.delete_own_data()",
    );
    const deleteEnd = directDeleteMigration.indexOf("$ordys$;", deleteStart);
    const deleteFunction = directDeleteMigration.slice(deleteStart, deleteEnd);
    expect(deleteFunction).toContain("subscription.cancellation_confirmed_at IS NULL");
    expect(deleteFunction).not.toContain("subscription.status IN ('pending', 'active', 'past_due', 'suspended')");
  });

  it("requires the managed deletion lease even when the billing schema has no user history", () => {
    const directDeleteMigration = readFileSync(
      "supabase/migrations/20261103030000_guard_delete_own_data_billing_reconciliation.sql",
      "utf8",
    );
    const deleteStart = directDeleteMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.delete_own_data()",
    );
    const deleteEnd = directDeleteMigration.indexOf("$ordys$;", deleteStart);
    const deleteFunction = directDeleteMigration.slice(deleteStart, deleteEnd);
    const historyStart = deleteFunction.indexOf("IF has_billing_history THEN");
    const historyEnd = deleteFunction.indexOf("\n    END IF;", historyStart);
    const leaseGuard = deleteFunction.indexOf(
      "IF NOT EXISTS (",
      historyEnd,
    );
    const firstDataDeletion = deleteFunction.indexOf("DELETE FROM public.assistant_jobs");

    expect(historyStart).toBeGreaterThanOrEqual(0);
    expect(historyEnd).toBeGreaterThan(historyStart);
    expect(leaseGuard).toBeGreaterThan(historyEnd);
    expect(leaseGuard).toBeLessThan(firstDataDeletion);
    expect(deleteFunction.slice(leaseGuard, firstDataDeletion)).toContain(
      "reservation.processing_until > now()",
    );
    expect(deleteFunction.slice(leaseGuard, firstDataDeletion)).toContain(
      "reservation.processing_token IS NOT NULL",
    );
  });

  it("verifies the account-deletion schema-status RPC after migrations and before deploying the function", () => {
    const workflow = readFileSync("ports/asaas-pr320/github-workflows/deploy-ordys-assistant.yml", "utf8");
    const migrationApply = workflow.indexOf("- name: Apply Supabase database migrations");
    const schemaGateStart = workflow.indexOf("- name: Verify account-deletion schema-status RPC before deploying core deletion");
    const deletionStart = workflow.indexOf("- name: Deploy Ordys Delete Account Edge Function");
    const checkoutStart = workflow.indexOf("- name: Deploy ORDYS Billing Checkout Edge Function");
    const managementStart = workflow.indexOf("- name: Deploy ORDYS Billing Management Edge Function");
    const managementEnd = workflow.indexOf("\n      - name:", managementStart + 1);
    const webhookStart = workflow.indexOf("- name: Deploy ORDYS Asaas Webhook Edge Function");
    const webhookEnd = workflow.indexOf("\n      - name:", webhookStart + 1);
    const schemaGate = workflow.slice(schemaGateStart, deletionStart);
    const deletionStep = workflow.slice(deletionStart, checkoutStart);
    const checkoutStep = workflow.slice(checkoutStart);
    const managementStep = workflow.slice(managementStart, managementEnd);
    const webhookStep = workflow.slice(webhookStart, webhookEnd);

    expect(migrationApply).toBeGreaterThanOrEqual(0);
    expect(schemaGateStart).toBeGreaterThan(migrationApply);
    expect(schemaGate).toContain("id: account_deletion_schema");
    expect(schemaGate).toContain('migration_version="20261029232950"');
    expect(schemaGate).toContain(
      'required_lifecycle_migrations=("20261103010000" "20261103020000" "20261103030000" "20261105010000" "20261105020000" "20261105030000" "20261105040000" "20261105050000" "20261105060000")',
    );
    expect(schemaGate).toContain("id: billing_lifecycle_lock");
    expect(deletionStart).toBeGreaterThan(schemaGateStart);
    expect(deletionStep).toContain("steps.account_deletion_schema.outputs.ready == 'true'");
    expect(deletionStep).toContain("steps.billing_lifecycle_lock.outputs.ready == 'true'");
    expect(deletionStep).not.toContain("billing_schema.outputs.ready");
    expect(checkoutStep).toContain("billing_schema.outputs.ready == 'true'");
    expect(checkoutStep).toContain("billing_lifecycle_lock.outputs.ready == 'true'");
    expect(managementStep).toContain("billing_schema.outputs.ready == 'true'");
    expect(managementStep).toContain("billing_lifecycle_lock.outputs.ready == 'true'");
    expect(webhookStep).toContain("billing_schema.outputs.ready == 'true'");
    expect(webhookStep).toContain("billing_lifecycle_lock.outputs.ready == 'true'");
  });

  it("keeps the schema-status RPC before the held email-confirmation migration", () => {
    const migrations = readdirSync("supabase/migrations").sort();
    const schemaStatusIndex = migrations.findIndex((name) => name.startsWith("20261029232950_"));
    const emailRemovalIndex = migrations.findIndex((name) => name.startsWith("20261029233000_"));
    const billingFoundationIndex = migrations.findIndex((name) => name.startsWith("20261031010000_"));
    const lifecycleSerializationIndex = migrations.findIndex((name) => name.startsWith("20261103010000_"));
    const suspendedDeletionConfirmationIndex = migrations.findIndex((name) => name.startsWith("20261103020000_"));
    const unmatchedWebhookGuardIndex = migrations.findIndex((name) => name.startsWith("20261105010000_"));
    const paymentCreatedReplayIndex = migrations.findIndex((name) => name.startsWith("20261105020000_"));
    const ambiguousCustomerGuardIndex = migrations.findIndex((name) => name.startsWith("20261105030000_"));
    const permanentMismatchGuardIndex = migrations.findIndex((name) => name.startsWith("20261105040000_"));
    const confirmedPaymentReplayIndex = migrations.findIndex((name) => name.startsWith("20261105050000_"));
    const durableWebhookInboxIndex = migrations.findIndex((name) => name.startsWith("20261105060000_"));

    expect(schemaStatusIndex).toBeGreaterThanOrEqual(0);
    expect(emailRemovalIndex).toBeGreaterThan(schemaStatusIndex);
    expect(billingFoundationIndex).toBeGreaterThan(emailRemovalIndex);
    expect(lifecycleSerializationIndex).toBeGreaterThan(billingFoundationIndex);
    expect(suspendedDeletionConfirmationIndex).toBeGreaterThan(lifecycleSerializationIndex);
    expect(unmatchedWebhookGuardIndex).toBeGreaterThan(suspendedDeletionConfirmationIndex);
    expect(paymentCreatedReplayIndex).toBeGreaterThan(unmatchedWebhookGuardIndex);
    expect(ambiguousCustomerGuardIndex).toBeGreaterThan(paymentCreatedReplayIndex);
    expect(permanentMismatchGuardIndex).toBeGreaterThan(ambiguousCustomerGuardIndex);
    expect(confirmedPaymentReplayIndex).toBeGreaterThan(permanentMismatchGuardIndex);
    expect(durableWebhookInboxIndex).toBeGreaterThan(confirmedPaymentReplayIndex);
  });

  it("preserva o ledger financeiro mínimo e desvincula o titular após excluir a conta", () => {
    const migration = readFileSync(
      "supabase/migrations/20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql",
      "utf8",
    );
    const deletionStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.delete_own_data()",
    );
    const deletionEnd = migration.indexOf("$ordys$;", deletionStart);
    const deletionFunction = migration.slice(deletionStart, deletionEnd);
    const readinessStart = migration.lastIndexOf(
      "CREATE OR REPLACE FUNCTION public.ordys_billing_schema_status()",
    );
    const readiness = migration.slice(readinessStart);
    const processorStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.ordys_apply_asaas_billing_event",
    );
    const processorEnd = migration.indexOf(
      "REVOKE ALL ON FUNCTION public.ordys_apply_asaas_billing_event",
      processorStart,
    );
    const processor = migration.slice(processorStart, processorEnd);

    for (const table of [
      "ordys_billing_checkout_attempts",
      "ordys_billing_subscriptions",
      "ordys_billing_payments",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public.${table}\n  ALTER COLUMN user_id DROP NOT NULL;`,
      );
      expect(migration).toContain(
        `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL`,
      );
      expect(readiness).toContain(
        `fk.conrelid = to_regclass('public.${table}')`,
      );
    }

    expect(deletionFunction).toContain(
      "UPDATE public.ordys_billing_webhook_inbox",
    );
    expect(deletionFunction).toContain("SET user_id = NULL");
    expect(readiness).toContain("fk.confdeltype = 'n'");
    expect(migration).toContain("FOR v_constraint IN");
    expect(readiness).toContain("fk.confdeltype <> 'n'");
    expect(readiness).toContain("prosrc LIKE '%SET user_id = NULL%'");
    expect(readiness).toContain("to_regclass('public.ordys_billing_webhook_inbox')");
    expect(readiness).toContain("attname = 'user_id' AND attnum > 0 AND NOT attisdropped AND NOT attnotnull");
    expect(processor).toContain(
      "existing_payment.user_id IS DISTINCT FROM v_billing_subscription.user_id",
    );
    expect(processor).toContain(
      "v_attempt.user_id IS DISTINCT FROM v_billing_subscription.user_id",
    );
    expect(processor).toContain(
      "existing.user_id IS DISTINCT FROM v_attempt.user_id",
    );
    expect(processor).toContain(
      "existing_payment.user_id IS NOT DISTINCT FROM v_billing_subscription.user_id",
    );
    expect(processor).toContain(
      "payment.user_id IS NOT DISTINCT FROM v_billing_subscription.user_id",
    );
    expect(processor).toContain(
      "AND user_id IS NOT DISTINCT FROM v_billing_subscription.user_id",
    );
  });

});
