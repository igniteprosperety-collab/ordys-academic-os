import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAsaasConfigured,
  getAsaasApiBase,
  getBillingCoreSchemaStatus,
  getBillingSchemaStatus,
} from "../src/lib/asaas/ordys-billing.server";

const billingTables = [
  "ordys_billing_settings",
  "ordys_billing_plans",
  "ordys_billing_checkout_attempts",
  "ordys_billing_subscriptions",
  "ordys_billing_payments",
  "ordys_billing_webhook_events",
  "ordys_billing_webhook_inbox",
  "ordys_account_deletion_reservations",
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubBillingEnvironment() {
  vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
}

function missingSchemaFetch(availableTable?: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (
      url.includes("/rpc/ordys_billing_schema_status") ||
      url.includes("/rpc/ordys_billing_core_schema_status")
    ) {
      return Response.json({ code: "PGRST202" }, { status: 404 });
    }

    const table = billingTables.find((name) => url.includes(`/rest/v1/${name}?`));
    if (!table) throw new Error(`Unexpected database request: ${url}`);
    if (table === availableTable) return Response.json([]);
    return Response.json({ code: "PGRST205" }, { status: 404 });
  });
}

describe("Asaas runtime environment gate", () => {
  it("uses only the Sandbox API base", () => {
    vi.stubEnv("ASAAS_ENVIRONMENT", "sandbox");
    expect(getAsaasApiBase()).toBe("https://api-sandbox.asaas.com/v3");
  });

  it("rejects the Production environment in this release", () => {
    vi.stubEnv("ASAAS_ENVIRONMENT", "production");
    expect(() => getAsaasApiBase()).toThrow("ASAAS_ENVIRONMENT deve ser sandbox nesta etapa.");
  });

  it("rejects a missing or unsupported Asaas environment", () => {
    vi.stubEnv("ASAAS_ENVIRONMENT", "");
    expect(() => getAsaasApiBase()).toThrow("ASAAS_ENVIRONMENT deve ser sandbox nesta etapa.");
  });

  it("requires an API key even when Sandbox is selected", () => {
    vi.stubEnv("ASAAS_ENVIRONMENT", "sandbox");
    vi.stubEnv("ASAAS_API_KEY", "");
    expect(() => assertAsaasConfigured()).toThrow(
      "O provedor de pagamentos ainda não está configurado.",
    );
  });

  it("accepts a configured Sandbox API key", () => {
    vi.stubEnv("ASAAS_ENVIRONMENT", "sandbox");
    vi.stubEnv("ASAAS_API_KEY", "asaas-sandbox-test-key");
    expect(assertAsaasConfigured()).toBeUndefined();
  });
});

describe("ORDYS optional billing schema readiness", () => {
  it("returns absent when the billing RPCs and all known billing tables are missing", async () => {
    stubBillingEnvironment();
    const fetchMock = missingSchemaFetch();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBillingSchemaStatus()).resolves.toBe("absent");
    expect(fetchMock).toHaveBeenCalledTimes(1 + billingTables.length);
  });

  it("returns partial when a billing table exists but the readiness RPC is missing", async () => {
    stubBillingEnvironment();
    const fetchMock = missingSchemaFetch("ordys_billing_settings");
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBillingSchemaStatus()).resolves.toBe("partial");
  });

  it("preserves a ready runtime status without probing every table", async () => {
    stubBillingEnvironment();
    const fetchMock = vi.fn(async () => Response.json("ready"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBillingSchemaStatus()).resolves.toBe("ready");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("lets account deletion proceed in the Free-only state when its core RPC and billing tables are absent", async () => {
    stubBillingEnvironment();
    const fetchMock = missingSchemaFetch();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBillingCoreSchemaStatus(new AbortController().signal)).resolves.toBe("absent");
    expect(fetchMock).toHaveBeenCalledTimes(1 + billingTables.length);
  });

  it("fails closed when the core RPC is missing but part of the billing schema remains", async () => {
    stubBillingEnvironment();
    const fetchMock = missingSchemaFetch("ordys_billing_subscriptions");
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBillingCoreSchemaStatus(new AbortController().signal)).resolves.toBe("partial");
  });
});
