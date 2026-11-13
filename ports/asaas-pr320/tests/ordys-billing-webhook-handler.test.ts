import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serviceRestWithDeadline: vi.fn(),
  getSupabaseUrl: vi.fn(),
  getServiceRoleKey: vi.fn(),
  constantTimeEqual: vi.fn(),
}));

vi.mock("../edge-functions/_shared/ordys-billing.ts", () => ({
  serviceRestWithDeadline: mocks.serviceRestWithDeadline,
  getSupabaseUrl: mocks.getSupabaseUrl,
  getServiceRoleKey: mocks.getServiceRoleKey,
  constantTimeEqual: mocks.constantTimeEqual,
  billingCorsHeaders: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, asaas-access-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  billingResponse: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }),
}));

vi.mock("../edge-functions/_shared/request-body.ts", () => ({
  readRequestBodyWithLimit: async (request: Request, maxBytes: number) => {
    const body = await request.text();
    return new TextEncoder().encode(body).byteLength <= maxBytes ? body : null;
  },
}));

type WebhookHandler = (request: Request) => Response | Promise<Response>;

let registeredHandler: WebhookHandler | undefined;

async function setup(options: {
  webhookToken?: string;
  receivedTokenValid?: boolean;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  receiptResult?: unknown;
  receiptError?: Error;
  schemaStatus?: unknown;
  schemaStatusError?: Error;
} = {}) {
  vi.resetModules();
  registeredHandler = undefined;

  mocks.getSupabaseUrl.mockReset().mockReturnValue(
    options.supabaseUrl === undefined
      ? "https://project-ref.supabase.co"
      : options.supabaseUrl,
  );
  mocks.getServiceRoleKey.mockReset().mockReturnValue(
    options.serviceRoleKey === undefined
      ? "service-role-test-key"
      : options.serviceRoleKey,
  );
  mocks.constantTimeEqual.mockReset().mockReturnValue(
    options.receivedTokenValid ?? true,
  );
  mocks.serviceRestWithDeadline.mockReset().mockImplementation(async (path: string) => {
    if (path === "rpc/ordys_billing_schema_status") {
      if (options.schemaStatusError) throw options.schemaStatusError;
      return Object.prototype.hasOwnProperty.call(options, "schemaStatus")
        ? options.schemaStatus
        : "ready";
    }
    if (path !== "rpc/ordys_receive_asaas_billing_webhook") {
      throw new Error("Webhook endpoint must not perform billing-state processing.");
    }
    if (options.receiptError) throw options.receiptError;
    return Object.prototype.hasOwnProperty.call(options, "receiptResult")
      ? options.receiptResult
      : {
        accepted: true,
        processing_status: "received",
        duplicate: false,
        event_id_conflict: false,
      };
  });

  vi.stubGlobal("Deno", {
    env: {
      get: (key: string) =>
        key === "ASAAS_WEBHOOK_TOKEN"
          ? options.webhookToken ?? "webhook-test-token-0123456789-abcdef"
          : undefined,
    },
    serve: (handler: WebhookHandler) => {
      registeredHandler = handler;
    },
  });

  await import("../edge-functions/ordys-billing-webhook/index.ts");
  if (!registeredHandler) {
    throw new Error("Asaas webhook Edge Function did not register its HTTP handler.");
  }
  return registeredHandler;
}

function webhookRequest(
  payload: unknown = {
    id: "evt_ordys_handler_test",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_ordys_handler_test" },
  },
  token = "received-webhook-token",
) {
  return new Request(
    "https://project-ref.supabase.co/functions/v1/ordys-billing-webhook",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "asaas-access-token": token,
      },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Asaas webhook durable acknowledgement contract", () => {
  it("returns HTTP 200 after the inbox confirms durable receipt, without processing billing inline", async () => {
    const handler = await setup();
    const response = await handler(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      queued: true,
      processed: false,
    });
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledTimes(2);
    expect(mocks.serviceRestWithDeadline).toHaveBeenNthCalledWith(
      2,
      "rpc/ordys_receive_asaas_billing_webhook",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"id":"evt_ordys_handler_test"'),
      }),
      1_500,
    );
  });

  it("keeps a duplicate receipt queued when the original event is still pending", async () => {
    const handler = await setup({
      receiptResult: {
        accepted: true,
        processing_status: "received",
        duplicate: true,
        event_id_conflict: false,
      },
    });
    const response = await handler(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, queued: true });
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledTimes(2);
  });

  it.each(["processed", "ignored", "quarantined"])(
    "acknowledges an already terminal %s receipt without reopening it",
    async (status) => {
      const handler = await setup({
        receiptResult: {
          accepted: true,
          processing_status: status,
          duplicate: true,
          event_id_conflict: status === "quarantined",
        },
      });
      const response = await handler(webhookRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        received: true,
        queued: false,
        processed: false,
      });
      expect(mocks.serviceRestWithDeadline).toHaveBeenCalledTimes(2);
    },
  );

  it("does not acknowledge a webhook while the SQL worker is not ready", async () => {
    const handler = await setup({ schemaStatus: "partial" });
    const response = await handler(webhookRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "O processamento financeiro ainda não está disponível.",
    });
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledOnce();
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledWith(
      "rpc/ordys_billing_schema_status",
      expect.objectContaining({ method: "POST", body: "{}" }),
      1_500,
    );
  });

  it("does not acknowledge a webhook when schema readiness cannot be checked", async () => {
    const handler = await setup({ schemaStatusError: new Error("schema status unavailable") });
    const response = await handler(webhookRequest());

    expect(response.status).toBe(503);
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledOnce();
  });

  it("returns HTTP 500 when the durable receipt cannot be committed", async () => {
    const handler = await setup({ receiptError: new Error("receipt unavailable") });
    const response = await handler(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    undefined,
    {},
    { accepted: false, processing_status: "received", duplicate: false, event_id_conflict: false },
    { accepted: true, processing_status: "unknown", duplicate: false, event_id_conflict: false },
    { accepted: true, processing_status: "received", duplicate: false },
  ])("does not acknowledge an invalid receipt response: %j", async (receiptResult) => {
    const handler = await setup({ receiptResult });
    const response = await handler(webhookRequest());

    expect(response.status).toBe(500);
  });

  it("does not call the database when the webhook authentication token is rejected", async () => {
    const handler = await setup({ receivedTokenValid: false });
    const response = await handler(webhookRequest());

    expect(response.status).toBe(401);
    expect(mocks.serviceRestWithDeadline).not.toHaveBeenCalled();
  });

  it("returns HTTP 503 when the database service credentials are unavailable", async () => {
    const handler = await setup({ serviceRoleKey: "" });
    const response = await handler(webhookRequest());

    expect(response.status).toBe(503);
    expect(mocks.serviceRestWithDeadline).not.toHaveBeenCalled();
  });

  it("rejects an invalid JSON envelope without calling the database", async () => {
    const handler = await setup();
    const response = await handler(webhookRequest("{not-json"));

    expect(response.status).toBe(400);
    expect(mocks.serviceRestWithDeadline).not.toHaveBeenCalled();
  });
});
