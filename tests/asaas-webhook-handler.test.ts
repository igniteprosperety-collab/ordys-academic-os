import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serviceRestWithDeadline: vi.fn(),
  getSupabaseUrl: vi.fn(),
  getServiceRoleKey: vi.fn(),
}));

vi.mock("../src/lib/asaas/ordys-billing.server", () => ({
  billingCorsHeaders: {},
  billingResponse: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }),
  constantTimeEqual: (expected: string, received: string) => expected === received,
  getSupabaseUrl: mocks.getSupabaseUrl,
  getServiceRoleKey: mocks.getServiceRoleKey,
  serviceRestWithDeadline: mocks.serviceRestWithDeadline,
}));

import { handleWebhook } from "../src/lib/asaas/webhook.server";

type SetupOptions = {
  coreSchemaStatus?: unknown;
  coreSchemaStatusError?: Error;
  receiptResult?: unknown;
  receiptError?: Error;
};

const defaultReceipt = {
  accepted: true,
  processing_status: "received",
  duplicate: false,
  event_id_conflict: false,
};

function setup(options: SetupOptions = {}) {
  vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "webhook-test-token-0123456789-abcdef");

  mocks.getSupabaseUrl.mockReset().mockReturnValue("https://project-ref.supabase.co");
  mocks.getServiceRoleKey.mockReset().mockReturnValue("service-role-test-key");
  mocks.serviceRestWithDeadline.mockReset().mockImplementation(async (path: string) => {
    if (path === "rpc/ordys_billing_core_schema_status") {
      if (options.coreSchemaStatusError) throw options.coreSchemaStatusError;
      return Object.prototype.hasOwnProperty.call(options, "coreSchemaStatus")
        ? options.coreSchemaStatus
        : "ready";
    }
    if (path === "rpc/ordys_receive_asaas_billing_webhook") {
      if (options.receiptError) throw options.receiptError;
      return Object.prototype.hasOwnProperty.call(options, "receiptResult")
        ? options.receiptResult
        : defaultReceipt;
    }
    throw new Error(`Unexpected database RPC: ${path}`);
  });
}

function webhookRequest(
  payload: unknown = {
    id: "evt_ordys_route_test",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_ordys_route_test" },
  },
  token = "webhook-test-token-0123456789-abcdef",
) {
  return new Request("https://ordys.example/api/public/asaas/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "asaas-access-token": token,
    },
    body: JSON.stringify(payload),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Asaas TanStack webhook durable receipt", () => {
  it("acknowledges only after the durable inbox receipt commits", async () => {
    setup();
    const response = await handleWebhook(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      queued: true,
      processed: false,
    });
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledTimes(2);
    expect(mocks.serviceRestWithDeadline).toHaveBeenNthCalledWith(
      1,
      "rpc/ordys_billing_core_schema_status",
      { method: "POST", body: "{}" },
      1_500,
    );
    expect(mocks.serviceRestWithDeadline).toHaveBeenNthCalledWith(
      2,
      "rpc/ordys_receive_asaas_billing_webhook",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"id":"evt_ordys_route_test"'),
      }),
      1_500,
    );
    expect(mocks.serviceRestWithDeadline).not.toHaveBeenCalledWith(
      "rpc/ordys_billing_schema_status",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not couple receipt acknowledgement to cron worker liveness", async () => {
    setup();
    const response = await handleWebhook(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.serviceRestWithDeadline).not.toHaveBeenCalledWith(
      "rpc/ordys_billing_schema_status",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not persist a receipt when the structural billing schema is partial", async () => {
    setup({ coreSchemaStatus: "partial" });
    const response = await handleWebhook(webhookRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "A estrutura financeira ainda não está disponível.",
    });
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledOnce();
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledWith(
      "rpc/ordys_billing_core_schema_status",
      { method: "POST", body: "{}" },
      1_500,
    );
  });

  it("does not persist a receipt when structural readiness cannot be checked", async () => {
    setup({ coreSchemaStatusError: new Error("database unavailable") });
    const response = await handleWebhook(webhookRequest());

    expect(response.status).toBe(503);
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledOnce();
    expect(mocks.serviceRestWithDeadline).not.toHaveBeenCalledWith(
      "rpc/ordys_receive_asaas_billing_webhook",
      expect.anything(),
      expect.anything(),
    );
  });

  it("returns HTTP 500 when the durable receipt cannot be committed", async () => {
    setup({ receiptError: new Error("receipt unavailable") });
    const response = await handleWebhook(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.serviceRestWithDeadline).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid webhook token without querying the database", async () => {
    setup();
    const response = await handleWebhook(webhookRequest(undefined, "wrong-token"));

    expect(response.status).toBe(401);
    expect(mocks.serviceRestWithDeadline).not.toHaveBeenCalled();
  });
});
