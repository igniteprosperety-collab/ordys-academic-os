import { afterEach, describe, expect, it, vi } from "vitest";

const SUPABASE_URL = "https://ordys-test.supabase.co";
const SERVICE_KEY = "service-role-test-key";

function setupFetch(responses: unknown[]) {
  let requestCount = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const index = requestCount++;
    const url = String(input);
    const value = responses[index];
    if (index >= responses.length) throw new Error("Unexpected Supabase request: " + url);
    return Response.json(value);
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("Deno", {
    env: {
      get: (name: string) => {
        if (name === "SUPABASE_URL") return SUPABASE_URL;
        if (name === "SUPABASE_SERVICE_ROLE_KEY") return SERVICE_KEY;
        return undefined;
      },
    },
  });
  return fetcher;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("Ordys Plus server-side entitlement gate", () => {
  it("fails closed and does not query subscription eligibility while the worker is partial", async () => {
    const fetcher = setupFetch(["partial"]);
    const { isOrdysPlusEligible } = await import("../edge-functions/_shared/ordys-billing.ts");

    await expect(isOrdysPlusEligible("00000000-0000-0000-0000-000000000001")).resolves.toBe(false);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      SUPABASE_URL + "/rest/v1/rpc/ordys_billing_schema_status",
    );
  });

  it("checks the payment ledger only after the webhook worker reports ready", async () => {
    const fetcher = setupFetch(["ready", true]);
    const { isOrdysPlusEligible } = await import("../edge-functions/_shared/ordys-billing.ts");

    await expect(isOrdysPlusEligible("00000000-0000-0000-0000-000000000001")).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/rpc/ordys_billing_schema_status");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("/rpc/is_ordys_plus_eligible");
  });
});
