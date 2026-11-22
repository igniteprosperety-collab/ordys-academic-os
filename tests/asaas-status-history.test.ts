import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateBillingRequest: vi.fn(),
  getBillingSchemaStatus: vi.fn(),
  serviceRest: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));

vi.mock("../src/lib/asaas/ordys-billing.server", () => ({
  billingCorsHeaders: {},
  billingResponse: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    }),
  authenticateBillingRequest: mocks.authenticateBillingRequest,
  getBillingSchemaStatus: mocks.getBillingSchemaStatus,
  serviceRest: mocks.serviceRest,
}));

import { handleStatus } from "../src/lib/asaas/status.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.authenticateBillingRequest.mockReset();
  mocks.getBillingSchemaStatus.mockReset();
  mocks.serviceRest.mockReset();
});

function stubAuthenticatedUser() {
  mocks.authenticateBillingRequest.mockResolvedValue({
    user: { id: "student-user-123", authorization: "Bearer session-token" },
    response: null,
  });
}

describe("ORDYS TanStack billing status", () => {
  it("returns an empty Free-only status without querying billing tables when the schema is absent", async () => {
    stubAuthenticatedUser();
    mocks.getBillingSchemaStatus.mockResolvedValue("absent");

    const response = await handleStatus(
      new Request("https://ordys.example/api/asaas/status", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: false,
      plans: [],
      subscription: null,
      payments: [],
    });
    expect(mocks.serviceRest).not.toHaveBeenCalled();
  });

  it("keeps the subscription and ten most recent payment records scoped to the authenticated user", async () => {
    stubAuthenticatedUser();
    mocks.getBillingSchemaStatus.mockResolvedValue("ready");
    const paymentRows = Array.from({ length: 10 }, (_, index) => ({
      amount_cents: 1_990 + index,
      status: index === 0 ? "PAYMENT_CONFIRMED" : "PAYMENT_PENDING",
      due_date: "2026-12-01",
      confirmed_at: index === 0 ? "2026-11-22T12:00:00.000Z" : null,
      refunded_at: null,
      created_at: `2026-11-${String(22 - index).padStart(2, "0")}T12:00:00.000Z`,
    }));
    mocks.serviceRest.mockImplementation(async (path: string) => {
      if (path.startsWith("ordys_billing_subscriptions?")) {
        return [
          {
            plan_code: "plus_monthly",
            status: "active",
            amount_cents: 1_990,
            currency: "BRL",
            current_period_end: "2026-12-22T00:00:00.000Z",
            grace_until: null,
            cancelled_at: null,
          },
        ];
      }
      if (path.startsWith("ordys_billing_payments?")) return paymentRows;
      throw new Error(`Unexpected billing query: ${path}`);
    });

    const response = await handleStatus(
      new Request("https://ordys.example/api/asaas/status", { method: "POST" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      enabled: false,
      plans: [],
      subscription: {
        planCode: "plus_monthly",
        amountCents: 1_990,
        currency: "BRL",
        hasAccess: false,
      },
    });
    expect(payload.payments).toHaveLength(10);
    expect(payload.payments[0]).toEqual({
      amountCents: 1_990,
      currency: "BRL",
      status: "PAYMENT_CONFIRMED",
      dueDate: "2026-12-01",
      confirmedAt: "2026-11-22T12:00:00.000Z",
      refundedAt: null,
      createdAt: "2026-11-22T12:00:00.000Z",
    });

    const subscriptionQuery = mocks.serviceRest.mock.calls.find(([path]) =>
      path.startsWith("ordys_billing_subscriptions?"),
    )?.[0] as string;
    const paymentsQuery = mocks.serviceRest.mock.calls.find(([path]) =>
      path.startsWith("ordys_billing_payments?"),
    )?.[0] as string;
    expect(subscriptionQuery).toContain("user_id=eq.student-user-123");
    expect(paymentsQuery).toContain("user_id=eq.student-user-123");
    expect(paymentsQuery).toContain("limit=10");
  });

  it("fails closed without reading payment records when the billing schema is partial", async () => {
    stubAuthenticatedUser();
    mocks.getBillingSchemaStatus.mockResolvedValue("partial");

    const response = await handleStatus(
      new Request("https://ordys.example/api/asaas/status", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(mocks.serviceRest).not.toHaveBeenCalled();
  });

  it("drops malformed payment amounts rather than returning non-finite currency values", async () => {
    stubAuthenticatedUser();
    mocks.getBillingSchemaStatus.mockResolvedValue("ready");
    mocks.serviceRest.mockImplementation(async (path: string) => {
      if (path.startsWith("ordys_billing_subscriptions?")) return [];
      if (path.startsWith("ordys_billing_payments?")) {
        return [
          {
            amount_cents: "1990",
            status: "PAYMENT_CONFIRMED",
            created_at: "2026-11-22T12:00:00.000Z",
          },
          {
            amount_cents: "not-a-number",
            status: "PAYMENT_CONFIRMED",
          },
          {
            amount_cents: Number.MAX_SAFE_INTEGER + 1,
            status: "PAYMENT_CONFIRMED",
          },
        ];
      }
      throw new Error(`Unexpected billing query: ${path}`);
    });

    const response = await handleStatus(
      new Request("https://ordys.example/api/asaas/status", { method: "POST" }),
    );
    const payload = await response.json();

    expect(payload.payments).toEqual([
      {
        amountCents: 1_990,
        currency: "BRL",
        status: "PAYMENT_CONFIRMED",
        dueDate: null,
        confirmedAt: null,
        refundedAt: null,
        createdAt: "2026-11-22T12:00:00.000Z",
      },
    ]);
  });
});
