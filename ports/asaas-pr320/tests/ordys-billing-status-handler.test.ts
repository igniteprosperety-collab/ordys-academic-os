import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBillingSchemaStatus: vi.fn(),
  serviceRest: vi.fn(),
  authenticateBillingRequest: vi.fn(),
}));

vi.mock("../supabase/functions/_shared/ordys-billing.ts", () => ({
  billingCorsHeaders: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  billingResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  }),
  getBillingSchemaStatus: mocks.getBillingSchemaStatus,
  serviceRest: mocks.serviceRest,
  authenticateBillingRequest: mocks.authenticateBillingRequest,
}));

type BillingStatusHandler = (request: Request) => Response | Promise<Response>;

let registeredHandler: BillingStatusHandler | undefined;

async function setup(options: {
  schemaStatus: "absent" | "partial" | "ready";
  billingEnabled?: boolean;
  subscriptions?: Array<Record<string, unknown>>;
}) {
  vi.resetModules();
  registeredHandler = undefined;

  mocks.getBillingSchemaStatus.mockReset().mockResolvedValue(options.schemaStatus);
  mocks.authenticateBillingRequest.mockReset().mockResolvedValue({
    response: null,
    user: { id: "user-1", authorization: "Bearer user-session-token" },
  });
  mocks.serviceRest.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith("ordys_billing_settings?")) {
      return [{ billing_enabled: options.billingEnabled === true }];
    }
    if (path.startsWith("ordys_billing_plans?")) return [];
    if (path.startsWith("ordys_billing_subscriptions?")) return options.subscriptions ?? [];
    throw new Error(`Unexpected serviceRest call: ${path}`);
  });

  vi.stubGlobal("Deno", {
    serve: (handler: BillingStatusHandler) => { registeredHandler = handler; },
  });
  await import("../supabase/functions/ordys-billing-status/index.ts");
  if (!registeredHandler) throw new Error("Billing status Edge Function did not register its HTTP handler.");

  return { handler: registeredHandler };
}

function request() {
  return new Request("https://project-ref.supabase.co/functions/v1/ordys-billing-status", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-session-token",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ORDYS billing status schema readiness", () => {
  it.each(["absent", "partial"] as const)(
    "does not query billing tables when the schema is %s",
    async (schemaStatus) => {
      const { handler } = await setup({ schemaStatus });

      const response = await handler(request());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        enabled: false,
        plans: [],
        subscription: null,
      });
      expect(mocks.getBillingSchemaStatus).toHaveBeenCalledOnce();
      expect(mocks.serviceRest).not.toHaveBeenCalled();
    },
  );

  it("keeps existing paid access readable when new billing sales are disabled", async () => {
    const { handler } = await setup({
      schemaStatus: "ready",
      billingEnabled: false,
      subscriptions: [{
        plan_code: "plus_monthly",
        status: "active",
        amount_cents: 5990,
        currency: "BRL",
        current_period_end: "2099-01-01T00:00:00.000Z",
        grace_until: null,
        cancelled_at: null,
      }],
    });

    const response = await handler(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.plans).toEqual([]);
    expect(body.subscription).toMatchObject({
      status: "active",
      hasAccess: true,
    });
    expect(mocks.serviceRest).toHaveBeenCalledTimes(2);
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "ordys_billing_settings?select=billing_enabled&id=eq.1&limit=1",
    );
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      expect.stringContaining("ordys_billing_subscriptions?"),
    );
  });
});
