import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboundRequestTimeoutError } from "../edge-functions/_shared/request-timeout";

const mocks = vi.hoisted(() => ({
  serviceRest: vi.fn(),
  asaasRequest: vi.fn(),
  assertAsaasConfigured: vi.fn(),
  authenticateBillingRequest: vi.fn(),
}));

vi.mock("../edge-functions/_shared/ordys-billing.ts", () => ({
  AsaasApiError: class AsaasApiError extends Error {
    constructor(readonly status: number) {
      super(`Asaas HTTP ${status}`);
    }
  },
  serviceRest: mocks.serviceRest,
  asaasRequest: mocks.asaasRequest,
  assertAsaasConfigured: mocks.assertAsaasConfigured,
  assertBillingEnabled: vi.fn().mockResolvedValue(undefined),
  checkoutAttemptDisposition: (status: string, expiresAt: string, now = Date.now()) => {
    if (["cancelled", "expired", "failed"].includes(status)) return "retry";
    if (status !== "pending") return "block";
    const expiration = Date.parse(expiresAt);
    if (!Number.isFinite(expiration)) return "block";
    return expiration > now ? "reuse" : "cancel_remote";
  },
  billingCorsHeaders: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  billingResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  }),
  calculateAgeInTimeZone: (birthDate: string | null, timezone: string | null) =>
    birthDate && timezone ? 25 : null,
  getUserAgeProfile: vi.fn().mockResolvedValue({
    birthDate: "2000-01-01",
    timezone: "America/Sao_Paulo",
  }),
  jsonObject: (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {},
  authenticateBillingRequest: mocks.authenticateBillingRequest,
}));

vi.mock("../edge-functions/_shared/request-body.ts", () => ({
  readRequestBodyWithLimit: async (request: Request, maxBytes: number) => {
    const body = await request.text();
    return new TextEncoder().encode(body).byteLength <= maxBytes ? body : null;
  },
}));

type CheckoutHandler = (request: Request) => Response | Promise<Response>;

let registeredHandler: CheckoutHandler | undefined;

function requestWithPlan() {
  return new Request("https://project-ref.supabase.co/functions/v1/ordys-billing-checkout", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-session-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ planCode: "plus_monthly" }),
  });
}

async function setup(options: {
  cancellationRequestedAt?: string | null;
  markerResult?: unknown;
  markerError?: Error;
  latestStatus?: string;
  latestCancellationRequestedAt?: string | null;
  latestCancellationClaimId?: string | null;
  providerError?: Error;
  providerErrorStatus?: number;
  subscriptions?: Array<Record<string, unknown>>;
  pendingAttempt?: boolean;
  beginAttemptResult?: unknown;
  finalizeResult?: unknown;
  finalizeError?: Error;
  configurationError?: Error;
} = {}) {
  vi.resetModules();
  registeredHandler = undefined;

  const attempt: Record<string, unknown> = {
    id: "checkout-attempt-1",
    user_id: "user-1",
    plan_code: "plus_monthly",
    provider_checkout_id: "asaas-checkout-1",
    checkout_url: "https://asaas.com/checkoutSession/show?id=asaas-checkout-1",
    status: "pending",
    expires_at: "2026-10-01T00:00:00.000Z",
    cancellation_requested_at: options.cancellationRequestedAt ?? null,
    cancellation_claim_id: null,
  };

  mocks.authenticateBillingRequest.mockReset().mockResolvedValue({
    response: null,
    user: { id: "user-1", authorization: "Bearer user-session-token" },
  });
  mocks.serviceRest.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("ordys_billing_subscriptions?")) return options.subscriptions ?? [];
    if (path.startsWith("ordys_billing_plans?")) {
      return [{
        plan_code: "plus_monthly",
        price_cents: 5990,
        billing_cycle: "MONTHLY",
        currency: "BRL",
      }];
    }
    if (path.includes("ordys_billing_checkout_attempts?") && path.includes("status=eq.paid")) {
      return [];
    }
    if (path.includes("ordys_billing_checkout_attempts?") && path.includes("status=in.(creating,pending,linked)")) {
      return options.pendingAttempt === false ? [] : [{ ...attempt }];
    }
    if (
      path.startsWith("ordys_billing_checkout_attempts?") &&
      init?.method === "PATCH" &&
      path.includes("cancellation_requested_at=is.null")
    ) {
      if (options.markerResult !== undefined || options.markerError) {
        if (typeof options.latestCancellationRequestedAt === "string") {
          attempt.cancellation_requested_at = options.latestCancellationRequestedAt;
        }
        if (typeof options.latestCancellationClaimId === "string") {
          attempt.cancellation_claim_id = options.latestCancellationClaimId;
        }
        if (typeof options.latestStatus === "string") attempt.status = options.latestStatus;
        if (options.markerError) {
          Object.assign(attempt, JSON.parse(String(init.body ?? "{}")));
          throw options.markerError;
        }
        return options.markerResult;
      }
      Object.assign(attempt, JSON.parse(String(init.body ?? "{}")));
      const claimedAttemptId = path.match(/[?&]id=eq\.([^&]+)/)?.[1];
      if (claimedAttemptId) attempt.id = decodeURIComponent(claimedAttemptId);
      return [{ ...attempt }];
    }
    if (path === "rpc/ordys_begin_billing_checkout_attempt") return options.beginAttemptResult ?? "created";
    if (path === "rpc/ordys_finalize_billing_checkout_attempt") {
      if (options.finalizeError) throw options.finalizeError;
      return options.finalizeResult ?? "ready";
    }
    if (
      path.startsWith("ordys_billing_checkout_attempts?id=eq.") &&
      init?.method === "PATCH"
    ) return [];
    if (path.startsWith("ordys_billing_checkout_attempts?") && path.includes("select=id,status,cancellation_requested_at,cancellation_claim_id")) {
      return [{ ...attempt }];
    }
    throw new Error(`Unexpected serviceRest call: ${path}`);
  });

  mocks.assertAsaasConfigured.mockReset().mockImplementation(() => {
    if (options.configurationError) throw options.configurationError;
  });
  mocks.asaasRequest.mockReset();
  if (options.providerErrorStatus !== undefined) {
    const { AsaasApiError } = await import("../edge-functions/_shared/ordys-billing.ts");
    mocks.asaasRequest.mockRejectedValue(new AsaasApiError(options.providerErrorStatus));
  } else if (options.providerError) {
    mocks.asaasRequest.mockRejectedValue(options.providerError);
  } else {
    mocks.asaasRequest.mockResolvedValue({ id: "asaas-checkout-new" });
  }

  vi.stubGlobal("Deno", {
    serve: (handler: CheckoutHandler) => { registeredHandler = handler; },
  });
  await import("../edge-functions/ordys-billing-checkout/index.ts");
  if (!registeredHandler) throw new Error("Checkout Edge Function did not register its HTTP handler.");
  return { handler: registeredHandler, attempt };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ORDYS checkout first charge due date", () => {
  it("serializes the first recurring due date in America/Sao_Paulo wall time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T12:00:00.000Z"));
    const { handler } = await setup({ pendingAttempt: false });

    const response = await handler(requestWithPlan());

    expect(response.status).toBe(200);
    const checkoutCall = mocks.asaasRequest.mock.calls.find(([path]) => path === "/checkouts");
    expect(checkoutCall).toBeDefined();
    const payload = JSON.parse(String(checkoutCall?.[1]?.body ?? "{}"));
    expect(payload.subscription.nextDueDate).toBe("2026-11-14 09:00:00");
  });
});

describe("ORDYS checkout reconciliation admission", () => {
  it("returns 409 and does not contact Asaas when the database requires webhook reconciliation", async () => {
    const { handler } = await setup({
      pendingAttempt: false,
      beginAttemptResult: "billing_reconciliation_required",
    });

    const response = await handler(requestWithPlan());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "billing_reconciliation_required",
    });
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_begin_billing_checkout_attempt",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });
});

describe("ORDYS checkout finalization against in-flight webhooks", () => {
  it("does not expose the Checkout link and requests one cancellation when a relevant webhook arrived during creation", async () => {
    const { handler, attempt } = await setup({ pendingAttempt: false, finalizeResult: "cancel_required" });
    const result = await handler(requestWithPlan());
    const body = await result.json();

    expect(result.status).toBe(409);
    expect(body).toMatchObject({ code: "checkout_cancellation_processing" });
    expect(body).not.toHaveProperty("checkoutUrl");
    expect(attempt.cancellation_requested_at).toEqual(expect.any(String));
    expect(attempt.cancellation_claim_id).toEqual(expect.any(String));
    expect(mocks.asaasRequest).toHaveBeenCalledTimes(2);
    expect(mocks.asaasRequest).toHaveBeenNthCalledWith(
      2,
      "/checkouts/asaas-checkout-new/cancel",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_finalize_billing_checkout_attempt",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not return a Checkout link when finalization reports an already reconciled payment", async () => {
    const { handler } = await setup({ pendingAttempt: false, finalizeResult: "reconciled" });
    const result = await handler(requestWithPlan());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "checkout_payment_processing" });
    expect(mocks.asaasRequest).toHaveBeenCalledOnce();
  });
});
describe("ORDYS checkout finalization timeout", () => {
  it("keeps the Checkout URL private when the finalization response is lost", async () => {
    const { handler } = await setup({
      pendingAttempt: false,
      finalizeError: new Error("finalization response lost after commit"),
    });

    const result = await handler(requestWithPlan());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      code: "checkout_reconciliation_required",
    });
    expect(mocks.asaasRequest).toHaveBeenCalledOnce();

    const fallbackWrite = mocks.serviceRest.mock.calls.find(([path, init]) =>
      String(path).startsWith("ordys_billing_checkout_attempts?id=eq.") &&
      init?.method === "PATCH" &&
      JSON.parse(String(init.body ?? "{}")).provider_checkout_id === "asaas-checkout-new",
    );
    expect(fallbackWrite).toBeDefined();
    const fallbackBody = JSON.parse(String(fallbackWrite?.[1]?.body ?? "{}"));
    expect(fallbackBody).toMatchObject({ provider_checkout_id: "asaas-checkout-new" });
    expect(fallbackBody).not.toHaveProperty("checkout_url");
    expect(fallbackBody).not.toHaveProperty("status");
  });
});

describe("ORDYS checkout creation failure classification", () => {
  it("does not reserve a Checkout attempt when Asaas configuration is invalid", async () => {
    const { handler } = await setup({
      pendingAttempt: false,
      configurationError: new Error("O provedor de pagamentos ainda não está configurado."),
    });

    const response = await handler(requestWithPlan());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "O provedor de pagamentos ainda não está configurado.",
    });
    expect(mocks.assertAsaasConfigured).toHaveBeenCalledOnce();
    expect(mocks.serviceRest).not.toHaveBeenCalledWith(
      "rpc/ordys_begin_billing_checkout_attempt",
      expect.anything(),
    );
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });
  it.each([403, 404, 408, 409, 422, 429, 499])(
    "keeps the attempt reserved when Asaas returns undocumented/ambiguous HTTP %i",
    async (status) => {
      const { handler } = await setup({
        pendingAttempt: false,
        providerErrorStatus: status,
      });

      const response = await handler(requestWithPlan());

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "checkout_reconciliation_required",
      });
      expect(mocks.asaasRequest).toHaveBeenCalledOnce();
      expect(mocks.serviceRest).toHaveBeenCalledWith(
        "rpc/ordys_begin_billing_checkout_attempt",
        expect.objectContaining({ method: "POST" }),
      );

      const failedWrite = mocks.serviceRest.mock.calls.find(([path, init]) =>
        String(path).startsWith("ordys_billing_checkout_attempts?id=eq.") &&
        init?.method === "PATCH" &&
        JSON.parse(String(init.body ?? "{}")).status === "failed",
      );
      expect(failedWrite).toBeUndefined();
    },
  );

  it("keeps the checkout reserved and returns a reconciliation conflict when Asaas times out", async () => {
    const { handler } = await setup({
      pendingAttempt: false,
      providerError: new OutboundRequestTimeoutError(),
    });

    const response = await handler(requestWithPlan());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "checkout_reconciliation_required",
      error: "O Asaas pode ter recebido a contratação, mas a confirmação não chegou. A tentativa foi preservada para conciliação. Não tente gerar outra cobrança agora.",
    });
    expect(mocks.asaasRequest).toHaveBeenCalledOnce();
    const failedWrite = mocks.serviceRest.mock.calls.find(([path, init]) =>
      String(path).startsWith("ordys_billing_checkout_attempts?id=eq.") &&
      init?.method === "PATCH" &&
      JSON.parse(String(init.body ?? "{}")).status === "failed",
    );
    expect(failedWrite).toBeUndefined();
  });

  it.each([400, 401])(
    "marks documented Asaas rejection HTTP %i as failed so a safe retry can be offered",
    async (status) => {
      const { handler } = await setup({
        pendingAttempt: false,
        providerErrorStatus: status,
      });

      const response = await handler(requestWithPlan());

      expect(response.status).toBe(502);
      const failedWrite = mocks.serviceRest.mock.calls.find(([path, init]) =>
        String(path).startsWith("ordys_billing_checkout_attempts?id=eq.") &&
        init?.method === "PATCH" &&
        JSON.parse(String(init.body ?? "{}")).status === "failed",
      );
      expect(failedWrite).toBeDefined();
    },
  );
});

describe("ORDYS checkout cancellation", () => {
  it("does not persist an expired Checkout cancellation claim when Asaas configuration is invalid", async () => {
    const { handler, attempt } = await setup({
      configurationError: new Error("ASAAS_ENVIRONMENT deve ser configurado explicitamente como sandbox ou production."),
    });

    const result = await handler(requestWithPlan());

    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({
      error: "ASAAS_ENVIRONMENT deve ser configurado explicitamente como sandbox ou production.",
    });
    expect(attempt.cancellation_requested_at).toBeNull();
    expect(attempt.cancellation_claim_id).toBeNull();
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(mocks.serviceRest).not.toHaveBeenCalledWith(
      expect.stringContaining("cancellation_requested_at=is.null"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });
  it("persists the cancellation intent before calling Asaas and keeps the attempt locked", async () => {
    const { handler, attempt } = await setup();
    const result = await handler(requestWithPlan());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "checkout_cancellation_processing" });
    expect(attempt.cancellation_requested_at).toEqual(expect.any(String));
    expect(attempt.cancellation_claim_id).toEqual(expect.any(String));
    expect(mocks.asaasRequest).toHaveBeenCalledOnce();
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/checkouts/asaas-checkout-1/cancel",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );

    const markerCall = mocks.serviceRest.mock.calls.findIndex(([path, init]) =>
      String(path).includes("cancellation_requested_at=is.null") && init?.method === "PATCH",
    );
    const providerCall = mocks.asaasRequest.mock.invocationCallOrder[0]!;
    expect(markerCall).toBeGreaterThanOrEqual(0);
    expect(mocks.serviceRest.mock.invocationCallOrder[markerCall]!).toBeLessThan(providerCall);
  });

  it("does not repeat a cancellation whose intent is already recorded", async () => {
    const { handler } = await setup({
      cancellationRequestedAt: "2026-11-03T20:00:00.000Z",
    });
    const result = await handler(requestWithPlan());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "checkout_cancellation_processing" });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(mocks.serviceRest).not.toHaveBeenCalledWith(
      expect.stringContaining("cancellation_requested_at=is.null"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("sends Asaas cancellation when its own committed claim PATCH response is lost", async () => {
    const { handler, attempt } = await setup({
      markerError: new Error("PATCH response lost after commit"),
    });

    const result = await handler(requestWithPlan());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "checkout_cancellation_processing" });
    expect(attempt.cancellation_requested_at).toEqual(expect.any(String));
    expect(attempt.cancellation_claim_id).toEqual(expect.any(String));
    expect(mocks.asaasRequest).toHaveBeenCalledOnce();
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/checkouts/asaas-checkout-1/cancel",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
  });

  it("does not call Asaas when another operation wins the compare-and-set", async () => {
    const { handler } = await setup({
      markerResult: [],
      latestCancellationRequestedAt: "2026-11-03T20:00:00.000Z",
      latestCancellationClaimId: "another-invocation",
    });
    const result = await handler(requestWithPlan());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "checkout_cancellation_processing" });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("keeps the marker after an ambiguous provider failure and never repeats the POST", async () => {
    const { handler, attempt } = await setup({ providerError: new Error("transport timeout") });

    const first = await handler(requestWithPlan());
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ code: "checkout_reconciliation_required" });
    expect(attempt.cancellation_requested_at).toEqual(expect.any(String));

    const second = await handler(requestWithPlan());
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "checkout_cancellation_processing" });
    expect(mocks.asaasRequest).toHaveBeenCalledOnce();
  });

  it("does not call Asaas when a webhook closes the checkout before the marker is claimed", async () => {
    const { handler } = await setup({
      markerResult: [],
      latestStatus: "cancelled",
    });
    const result = await handler(requestWithPlan());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "checkout_already_closed" });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });
});


describe("ORDYS checkout provider-cancellation reconciliation", () => {
  it("blocks a new recurring checkout when a legacy row is locally cancelled without Asaas confirmation", async () => {
    const { handler } = await setup({
      pendingAttempt: false,
      subscriptions: [{
        id: "legacy-subscription",
        status: "cancelled",
        current_period_end: "2026-10-01T00:00:00.000Z",
        provider_subscription_id: "asaas-legacy-subscription",
        provider_status: "ACTIVE",
        cancellation_confirmed_at: null,
      }],
    });

    const result = await handler(requestWithPlan());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      code: "subscription_cancellation_reconciliation_required",
    });
    expect(mocks.serviceRest).not.toHaveBeenCalledWith(
      "rpc/ordys_begin_billing_checkout_attempt",
      expect.anything(),
    );
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("does not allow another checkout before the paid-through period ends after provider deletion", async () => {
    const { handler } = await setup({
      pendingAttempt: false,
      subscriptions: [{
        id: "legacy-subscription",
        status: "cancelled",
        current_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        provider_subscription_id: "asaas-legacy-subscription",
        provider_status: "DELETED",
        cancellation_confirmed_at: "2026-11-03T20:00:00.000Z",
      }],
    });

    const result = await handler(requestWithPlan());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      code: "subscription_active",
    });
    expect(mocks.serviceRest).not.toHaveBeenCalledWith(
      "rpc/ordys_begin_billing_checkout_attempt",
      expect.anything(),
    );
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("allows a new checkout after provider deletion is explicitly confirmed", async () => {
    const { handler } = await setup({
      pendingAttempt: false,
      subscriptions: [{
        id: "legacy-subscription",
        status: "cancelled",
        current_period_end: "2026-10-01T00:00:00.000Z",
        provider_subscription_id: "asaas-legacy-subscription",
        provider_status: "DELETED",
        cancellation_confirmed_at: "2026-11-03T20:00:00.000Z",
      }],
    });

    const result = await handler(requestWithPlan());

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      planCode: "plus_monthly",
      currency: "BRL",
      reused: false,
    });
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_begin_billing_checkout_attempt",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/checkouts",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
