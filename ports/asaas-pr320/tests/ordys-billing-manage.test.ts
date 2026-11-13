import { readFileSync } from "node:fs";
import { OutboundRequestTimeoutError } from "../edge-functions/_shared/request-timeout";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serviceRest: vi.fn(),
  asaasRequest: vi.fn(),
  assertAsaasConfigured: vi.fn(),
  authenticateBillingRequest: vi.fn(),
}));

vi.mock("../edge-functions/_shared/ordys-billing.ts", () => ({
  serviceRest: mocks.serviceRest,
  asaasRequest: mocks.asaasRequest,
  assertAsaasConfigured: mocks.assertAsaasConfigured,
  authenticateBillingRequest: mocks.authenticateBillingRequest,
  billingCorsHeaders: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  billingResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  }),
}));

type ManageHandler = (request: Request) => Response | Promise<Response>;
let registeredHandler: ManageHandler | undefined;

function requestWithSession(body: unknown = { action: "cancel" }) {
  return new Request("https://project-ref.supabase.co/functions/v1/ordys-billing-manage", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-session-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function setup(options: {
  status?: string;
  providerStatus?: string;
  cancellationRequestedAt?: string | null;
  cancellationConfirmedAt?: string | null;
  markerResult?: unknown;
  confirmationResult?: unknown;
  markerResponseLost?: boolean;
  latestAfterMarkerFailure?: {
    status?: string;
    cancellationRequestedAt?: string | null;
    cancellationClaimId?: string | null;
    cancellationConfirmedAt?: string | null;
  };
  configurationError?: Error;
} = {}) {
  vi.resetModules();
  registeredHandler = undefined;
  let subscriptionReadCount = 0;
  const subscription: Record<string, unknown> = {
    id: "subscription-1",
    checkout_attempt_id: "checkout-1",
    provider_subscription_id: "asaas-subscription-1",
    provider_status: options.providerStatus ?? "ACTIVE",
    status: options.status ?? "active",
    current_period_end: "2026-12-01T00:00:00.000Z",
    cancellation_requested_at: options.cancellationRequestedAt ?? null,
    cancellation_claim_id: null,
    cancellation_confirmed_at: options.cancellationConfirmedAt ?? null,
  };

  mocks.authenticateBillingRequest.mockReset().mockResolvedValue({
    response: null,
    user: { id: "user-1", authorization: "Bearer user-session-token" },
  });
  mocks.serviceRest.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("ordys_billing_subscriptions?") && init?.method === "PATCH" &&
      path.includes("cancellation_requested_at=is.null")) {
      if (options.markerResult !== undefined) return options.markerResult;
      Object.assign(subscription, JSON.parse(String(init.body ?? "{}")));
      if (options.markerResponseLost) throw new Error("PATCH response lost after commit");
      return [{ ...subscription }];
    }
    if (path === "rpc/ordys_confirm_subscription_cancellation") {
      return options.confirmationResult ?? "confirmed";
    }
    if (path.startsWith("ordys_billing_subscriptions?")) {
      subscriptionReadCount += 1;
      if (subscriptionReadCount > 1 && options.latestAfterMarkerFailure) {
        return [{
          ...subscription,
          status: options.latestAfterMarkerFailure.status ?? subscription.status,
          cancellation_requested_at: options.latestAfterMarkerFailure.cancellationRequestedAt ?? null,
          cancellation_claim_id: options.latestAfterMarkerFailure.cancellationClaimId ?? null,
          cancellation_confirmed_at: options.latestAfterMarkerFailure.cancellationConfirmedAt ?? null,
        }];
      }
      return [{ ...subscription }];
    }
    if (path.startsWith("ordys_billing_checkout_attempts?") && init?.method === "PATCH") return [];
    throw new Error(`Unexpected serviceRest call: ${path}`);
  });
  mocks.assertAsaasConfigured.mockReset().mockImplementation(() => {
    if (options.configurationError) throw options.configurationError;
  });
  mocks.asaasRequest.mockReset().mockResolvedValue({});

  vi.stubGlobal("Deno", {
    serve: (handler: ManageHandler) => { registeredHandler = handler; },
  });
  await import("../edge-functions/ordys-billing-manage/index.ts");
  if (!registeredHandler) throw new Error("Manage Edge Function did not register its HTTP handler.");
  return { handler: registeredHandler, subscription };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ORDYS billing subscription cancellation", () => {
  it("does not persist a cancellation claim when Asaas configuration is invalid", async () => {
    const { handler, subscription } = await setup({
      configurationError: new Error("O provedor de pagamentos ainda não está configurado."),
    });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({
      error: "O provedor de pagamentos ainda não está configurado.",
    });
    expect(mocks.assertAsaasConfigured).toHaveBeenCalledOnce();
    expect(subscription.cancellation_requested_at).toBeNull();
    expect(subscription.cancellation_claim_id).toBeNull();
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(mocks.serviceRest).not.toHaveBeenCalledWith(
      expect.stringContaining("cancellation_requested_at=is.null"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });
  it("persists intent before Asaas and confirms without overwriting a suspended status", async () => {
    const { handler } = await setup({ status: "suspended" });
    const result = await handler(requestWithSession());

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ cancelled: true, accessUntil: "2026-12-01T00:00:00.000Z" });
    expect(mocks.asaasRequest).toHaveBeenCalledWith("/subscriptions/asaas-subscription-1", expect.objectContaining({ method: "DELETE" }));

    const markerCall = mocks.serviceRest.mock.calls.findIndex(([path]) =>
      String(path).includes("cancellation_requested_at=is.null"),
    );
    const providerCall = mocks.asaasRequest.mock.invocationCallOrder[0]!;
    const confirmCall = mocks.serviceRest.mock.calls.findIndex(([path]) =>
      path === "rpc/ordys_confirm_subscription_cancellation",
    );
    expect(markerCall).toBeGreaterThanOrEqual(0);
    expect(mocks.serviceRest.mock.invocationCallOrder[markerCall]!).toBeLessThan(providerCall);
    expect(providerCall).toBeLessThan(mocks.serviceRest.mock.invocationCallOrder[confirmCall]!);
    expect(mocks.serviceRest).toHaveBeenCalledWith("rpc/ordys_confirm_subscription_cancellation", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"p_subscription_id":"subscription-1"'),
    }));
  });

  it("sends one Asaas DELETE when its own committed claim PATCH response is lost", async () => {
    const { handler, subscription } = await setup({ markerResponseLost: true });
    const result = await handler(requestWithSession());

    expect(result.status).toBe(200);
    expect(subscription.cancellation_requested_at).toEqual(expect.any(String));
    expect(subscription.cancellation_claim_id).toEqual(expect.any(String));
    expect(mocks.asaasRequest).toHaveBeenCalledTimes(1);
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/subscriptions/asaas-subscription-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("does not send Asaas DELETE when another invocation owns the claim UUID", async () => {
    const { handler } = await setup({
      markerResult: [],
      latestAfterMarkerFailure: {
        status: "active",
        cancellationRequestedAt: "2026-11-04T14:00:00.000Z",
        cancellationClaimId: "00000000-0000-4000-8000-000000000001",
      },
    });
    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "subscription_cancellation_processing" });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("reconciles a legacy locally cancelled subscription when Asaas still reports it active", async () => {
    const { handler, subscription } = await setup({
      status: "cancelled",
      providerStatus: "ACTIVE",
    });
    const result = await handler(requestWithSession());

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ cancelled: true });
    expect(subscription.cancellation_requested_at).toEqual(expect.any(String));
    expect(subscription.cancellation_claim_id).toEqual(expect.any(String));
    expect(mocks.asaasRequest).toHaveBeenCalledTimes(1);
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/subscriptions/asaas-subscription-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not repeat Asaas DELETE while a previous cancellation is unconfirmed", async () => {
    const { handler } = await setup({
      status: "suspended",
      cancellationRequestedAt: "2026-11-03T20:00:00.000Z",
      cancellationConfirmedAt: null,
    });
    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "subscription_cancellation_processing" });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(mocks.serviceRest).toHaveBeenCalledOnce();
  });

  it("treats an already confirmed suspended cancellation as idempotent", async () => {
    const { handler } = await setup({
      status: "suspended",
      cancellationRequestedAt: "2026-11-03T20:00:00.000Z",
      cancellationConfirmedAt: "2026-11-03T20:01:00.000Z",
    });
    const result = await handler(requestWithSession());

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ cancelled: true });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(mocks.serviceRest).toHaveBeenCalledTimes(2);
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"p_cancellation_requested_at"'),
      }),
    );
  });

  it("reconciles a provider-confirmed suspended subscription when the legacy intent marker is missing", async () => {
    const { handler } = await setup({
      status: "suspended",
      providerStatus: "DELETED",
      cancellationRequestedAt: null,
      cancellationConfirmedAt: "2026-11-03T20:01:00.000Z",
    });
    const result = await handler(requestWithSession());

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ cancelled: true });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(mocks.serviceRest).toHaveBeenCalledTimes(2);
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"p_cancellation_requested_at":null'),
      }),
    );
  });

  it("reconciles a legacy provider-deleted suspended subscription without another DELETE", async () => {
    const { handler } = await setup({
      status: "suspended",
      providerStatus: "DELETED",
      cancellationRequestedAt: null,
      cancellationConfirmedAt: null,
    });
    const result = await handler(requestWithSession());

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ cancelled: true });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"p_cancellation_requested_at":null'),
      }),
    );
  });

  it("keeps cancellation processing when the Asaas DELETE times out", async () => {
    const { handler, subscription } = await setup();
    mocks.asaasRequest.mockRejectedValueOnce(new OutboundRequestTimeoutError());

    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      code: "subscription_cancellation_processing",
      error: "O Asaas pode ter recebido o pedido de cancelamento, mas a confirmação não chegou. Mantivemos a assinatura em conciliação. Não tente cancelar novamente agora.",
    });
    expect(subscription.cancellation_requested_at).toEqual(expect.any(String));
    expect(subscription.cancellation_confirmed_at).toBeNull();
    expect(mocks.asaasRequest).toHaveBeenCalledOnce();
    expect(mocks.serviceRest).not.toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.anything(),
    );
  });

  it("keeps cancellation unconfirmed when Asaas returns 404 for an inaccessible subscription", async () => {
    const { handler, subscription } = await setup();
    mocks.asaasRequest.mockRejectedValueOnce(Object.assign(new Error("provider resource not accessible"), {
      name: "AsaasApiError",
      status: 404,
    }));

    const result = await handler(requestWithSession());

    expect(result.status).toBe(502);
    expect(subscription.cancellation_requested_at).toEqual(expect.any(String));
    expect(subscription.cancellation_confirmed_at).toBeNull();
    expect(mocks.serviceRest).not.toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.anything(),
    );
  });
  it("does not call Asaas when the deletion webhook wins the cancellation compare-and-set", async () => {
    const { handler } = await setup({
      status: "suspended",
      markerResult: [],
      latestAfterMarkerFailure: {
        status: "suspended",
        cancellationRequestedAt: "2026-11-03T20:00:00.000Z",
        cancellationConfirmedAt: "2026-11-03T20:01:00.000Z",
      },
    });
    const result = await handler(requestWithSession());

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ cancelled: true });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    const compareAndSetCall = mocks.serviceRest.mock.calls.find(([path, init]) =>
      String(path).includes("cancellation_requested_at=is.null") && init?.method === "PATCH",
    );
    expect(compareAndSetCall?.[0]).toContain("cancellation_confirmed_at=is.null");
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_confirm_subscription_cancellation",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fails closed when the claim PATCH does not prove ownership", async () => {
    const { handler } = await setup({ markerResult: [] });
    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "subscription_cancellation_processing" });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });
});


describe("direct account-data deletion billing guard", () => {
  it("locks the authenticated RPC to provider-reconciled billing state", () => {
    const migration = readFileSync(
      new URL("../supabase/migrations/20261103030000_guard_delete_own_data_billing_reconciliation.sql", import.meta.url),
      "utf8",
    );
    for (const required of [
      "public.ordys_billing_schema_status()",
      "pg_advisory_xact_lock(",
      "'ordys:billing-lifecycle:' || uid::TEXT",
      "processing_token IS NOT NULL",
      "processing_until > now()",
      "status IN ('creating', 'pending', 'paid', 'linked')",
      "public.ordys_billing_payments AS payment",
      "payment.provider_subscription_id = subscription.provider_subscription_id",
      "billing payment cannot be reconciled",
      "cancellation_confirmed_at IS NULL",
      "GRANT EXECUTE ON FUNCTION public.delete_own_data() TO authenticated",
    ]) {
      expect(migration).toContain(required);
    }
  });
});
