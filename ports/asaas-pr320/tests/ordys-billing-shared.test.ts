import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsaasApiError,
  asaasRequest,
  assertAsaasConfigured,
  authenticateBillingRequest,
  billingResponse,
  calculateAge,
  calculateAgeInTimeZone,
  constantTimeEqual,
  jsonObject,
  serviceRest,
  serviceRestWithDeadline,
  isOrdysPlusEligible,
  getUserAgeProfile,
} from "../edge-functions/_shared/ordys-billing";

describe("shared billing security helpers", () => {
  describe("authenticateBillingRequest", () => {
    const request = (authorization = "Bearer valid-test-token") =>
      new Request("https://project-ref.supabase.co/functions/v1/billing", {
        method: "POST",
        headers: authorization ? { Authorization: authorization } : {},
      });

    const stubBillingAuthEnvironment = (values: Record<string, string>) => {
      vi.stubGlobal("Deno", {
        env: { get: (key: string) => values[key] },
      });
    };

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("returns the authenticated user when Supabase Auth confirms the token", async () => {
      stubBillingAuthEnvironment({
        SUPABASE_URL: "https://project-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
      });
      const fetchMock = vi.fn(async () => Response.json({ id: "billing-user-123" }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await authenticateBillingRequest(
        request(),
        "Entre na sua conta.",
      );

      expect(result.response).toBeNull();
      expect(result.user).toEqual({
        id: "billing-user-123",
        authorization: "Bearer valid-test-token",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("preserves 401 for a missing or explicitly rejected access token", async () => {
      stubBillingAuthEnvironment({
        SUPABASE_URL: "https://project-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
      });
      const fetchMock = vi.fn(async () => Response.json({ message: "invalid token" }, { status: 401 }));
      vi.stubGlobal("fetch", fetchMock);

      const missing = await authenticateBillingRequest(request(""), "Entre na sua conta.");
      const rejected = await authenticateBillingRequest(request(), "Entre na sua conta.");

      expect(missing.response?.status).toBe(401);
      expect(rejected.response?.status).toBe(401);
      expect(rejected.user).toBeNull();
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("returns 503 when the Auth service responds with a temporary server error", async () => {
      stubBillingAuthEnvironment({
        SUPABASE_URL: "https://project-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
      });
      const fetchMock = vi.fn(async () => Response.json({ message: "temporarily unavailable" }, { status: 503 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await authenticateBillingRequest(request(), "Entre na sua conta.");

      expect(result.user).toBeNull();
      expect(result.response?.status).toBe(503);
      await expect(result.response?.json()).resolves.toEqual({
        error: "Não foi possível validar sua sessão agora. Tente novamente.",
      });
    });

    it("returns 503 when the Auth request fails at the network layer", async () => {
      stubBillingAuthEnvironment({
        SUPABASE_URL: "https://project-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
      });
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new Error("network unavailable");
      }));

      const result = await authenticateBillingRequest(request(), "Entre na sua conta.");

      expect(result.user).toBeNull();
      expect(result.response?.status).toBe(503);
    });

    it("returns 503 when required server-side Auth configuration is missing", async () => {
      stubBillingAuthEnvironment({
        SUPABASE_URL: "https://project-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "",
      });
      const fetchMock = vi.fn(async () => Response.json({}));
      vi.stubGlobal("fetch", fetchMock);

      const result = await authenticateBillingRequest(request(), "Entre na sua conta.");

      expect(result.user).toBeNull();
      expect(result.response?.status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("forwards an AbortSignal to the underlying Supabase PostgREST request", async () => {
    vi.stubGlobal("Deno", {
      env: {
        get: (key: string) => ({
          SUPABASE_URL: "https://project-ref.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        } as Record<string, string>)[key],
      },
    });
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => Response.json({ status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      serviceRest("rpc/ordys_billing_schema_status", {
        method: "POST",
        signal: controller.signal,
      }),
    ).resolves.toEqual({ status: "ready" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://project-ref.supabase.co/rest/v1/rpc/ordys_billing_schema_status",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
      }),
    );
  });

  describe("calculateAge", () => {
    it("returns null when birth date is missing or malformed", () => {
      expect(calculateAge(null, new Date(2026, 9, 31))).toBeNull();
      expect(calculateAge("", new Date(2026, 9, 31))).toBeNull();
      expect(calculateAge("31/12/2000", new Date(2026, 9, 31))).toBeNull();
    });

    it("rejects impossible dates, future dates, and ages above 130", () => {
      const today = new Date(2026, 9, 31);
      expect(calculateAge("2001-02-29", today)).toBeNull();
      expect(calculateAge("2027-01-01", today)).toBeNull();
      expect(calculateAge("1800-01-01", today)).toBeNull();
    });

    it("calculates the exact age before and on the birthday", () => {
      const beforeBirthday = new Date(2026, 9, 30);
      const birthday = new Date(2026, 9, 31);
      expect(calculateAge("2008-10-31", beforeBirthday)).toBe(17);
      expect(calculateAge("2008-10-31", birthday)).toBe(18);
    });

    it("handles leap-day birthdays without accepting an invalid date", () => {
      expect(calculateAge("2008-02-29", new Date(2026, 1, 28))).toBe(17);
      expect(calculateAge("2008-02-29", new Date(2026, 2, 1))).toBe(18);
    });
  });

  describe("calculateAgeInTimeZone", () => {
    it("uses the profile time zone at the exact birthday boundary", () => {
      const beforeSaoPauloBirthday = new Date("2026-10-31T02:30:00.000Z");
      const afterSaoPauloBirthday = new Date("2026-10-31T03:30:00.000Z");

      expect(calculateAgeInTimeZone(
        "2008-10-31",
        "America/Sao_Paulo",
        beforeSaoPauloBirthday,
      )).toBe(17);
      expect(calculateAgeInTimeZone(
        "2008-10-31",
        "UTC",
        beforeSaoPauloBirthday,
      )).toBe(18);
      expect(calculateAgeInTimeZone(
        "2008-10-31",
        "America/Sao_Paulo",
        afterSaoPauloBirthday,
      )).toBe(18);
    });

    it("fails closed for missing dates, missing time zones and invalid IANA zones", () => {
      const now = new Date("2026-10-31T12:00:00.000Z");
      expect(calculateAgeInTimeZone(null, "America/Sao_Paulo", now)).toBeNull();
      expect(calculateAgeInTimeZone("2008-10-31", null, now)).toBeNull();
      expect(calculateAgeInTimeZone("2008-10-31", "", now)).toBeNull();
      expect(calculateAgeInTimeZone("2008-10-31", "Not/A_Real_Zone", now)).toBeNull();
      expect(calculateAgeInTimeZone("2008-02-30", "UTC", now)).toBeNull();
    });
  });

  describe("constantTimeEqual", () => {
    it("accepts equal strings", () => {
      expect(constantTimeEqual("webhook-secret", "webhook-secret")).toBe(true);
    });

    it("rejects different strings and different lengths", () => {
      expect(constantTimeEqual("webhook-secret", "webhook-secreT")).toBe(false);
      expect(constantTimeEqual("short", "a much longer secret")).toBe(false);
      expect(constantTimeEqual("", "")).toBe(true);
    });

    it("compares UTF-8 values consistently", () => {
      expect(constantTimeEqual("ordys-á", "ordys-á")).toBe(true);
      expect(constantTimeEqual("ordys-á", "ordys-a")).toBe(false);
    });
  });

  describe("jsonObject", () => {
    it("returns plain object values and rejects arrays or primitives", () => {
      expect(jsonObject({ id: "x" })).toEqual({ id: "x" });
      expect(jsonObject([1, 2])).toEqual({});
      expect(jsonObject(null)).toEqual({});
      expect(jsonObject("text")).toEqual({});
    });
  });

  describe("billingResponse", () => {
    it("always returns JSON without cache and includes the billing CORS headers", async () => {
      const response = billingResponse({ status: "ok" }, 409);
      expect(response.status).toBe(409);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      await expect(response.json()).resolves.toEqual({ status: "ok" });
    });
  });
});


describe("Shared billing outbound request deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const stubBillingEnvironment = () => {
    vi.stubGlobal("Deno", {
      env: {
        get: (key: string) => ({
          SUPABASE_URL: "https://project-ref.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
          ASAAS_API_KEY: "asaas-test-key",
          ASAAS_ENVIRONMENT: "sandbox",
        } as Record<string, string>)[key],
      },
    });
  };

  it("returns 503 and aborts when Supabase Auth identity verification stalls", async () => {
    vi.useFakeTimers();
    stubBillingEnvironment();
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = authenticateBillingRequest(
      new Request("https://project-ref.supabase.co/functions/v1/billing", {
        method: "POST",
        headers: { Authorization: "Bearer valid-test-token" },
      }),
      "Entre na sua conta.",
    );
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;

    expect(result.user).toBeNull();
    expect(result.response?.status).toBe(503);
    expect(capturedSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts an Asaas webhook database request at its total deadline", async () => {
    vi.useFakeTimers();
    stubBillingEnvironment();
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = serviceRestWithDeadline(
      "rpc/process_ordys_asaas_billing_event",
      { method: "POST", body: JSON.stringify({ p_event: { id: "event-1" } }) },
      7_000,
    );
    await vi.advanceTimersByTimeAsync(7_000);

    await expect(pending).rejects.toMatchObject({
      name: "OutboundRequestTimeoutError",
    });
    expect(capturedSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("shares the webhook deadline between PostgREST headers and its JSON body", async () => {
    vi.useFakeTimers();
    stubBillingEnvironment();
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
        },
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = serviceRestWithDeadline(
      "rpc/process_ordys_asaas_billing_event",
      { method: "POST", body: JSON.stringify({ p_event: { id: "event-1" } }) },
      7_000,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).rejects.toMatchObject({
      name: "OutboundRequestTimeoutError",
    });
  });

  it("aborts a stalled PostgREST lookup and propagates the timeout", async () => {
    vi.useFakeTimers();
    stubBillingEnvironment();
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = serviceRest("ordys_billing_subscriptions?select=id");
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(pending).rejects.toMatchObject({ name: "OutboundRequestTimeoutError" });
    expect(capturedSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("loads both birth date and IANA time zone from the authenticated profile", async () => {
    stubBillingEnvironment();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://project-ref.supabase.co/rest/v1/profiles?select=birth_date%2Ctimezone&id=eq.user-123&limit=1",
      );
      return Response.json([{
        birth_date: "2008-11-06",
        timezone: "America/Sao_Paulo",
      }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getUserAgeProfile("user-123", "Bearer valid-test-token"),
    ).resolves.toEqual({
      birthDate: "2008-11-06",
      timezone: "America/Sao_Paulo",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not silently invent a time zone when the profile field is absent", async () => {
    stubBillingEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{
      birth_date: "2008-11-06",
      timezone: null,
    }])));

    await expect(
      getUserAgeProfile("user-123", "Bearer valid-test-token"),
    ).resolves.toEqual({
      birthDate: "2008-11-06",
      timezone: null,
    });
  });

  it("aborts a stalled profile age-data lookup and propagates the timeout", async () => {
    vi.useFakeTimers();
    stubBillingEnvironment();
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = getUserAgeProfile("user-123", "Bearer valid-test-token");
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(pending).rejects.toMatchObject({ name: "OutboundRequestTimeoutError" });
    expect(capturedSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts a stalled Asaas request without claiming the provider rejected the operation", async () => {
    vi.useFakeTimers();
    stubBillingEnvironment();
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = asaasRequest("/checkouts", {
      method: "POST",
      body: JSON.stringify({ externalReference: "ordys-timeout-test" }),
    });
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(pending).rejects.toMatchObject({ name: "OutboundRequestTimeoutError" });
    expect(capturedSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("Ordys Plus subscription eligibility lookup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const stubEnvironment = () => {
    vi.stubGlobal("Deno", {
      env: {
        get: (key: string) => ({
          SUPABASE_URL: "https://project-ref.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        } as Record<string, string>)[key],
      },
    });
  };

  it("checks worker readiness before returning the explicit subscription eligibility result", async () => {
    stubEnvironment();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/rpc/ordys_billing_schema_status")) {
        return Response.json("ready");
      }
      expect(url).toBe("https://project-ref.supabase.co/rest/v1/rpc/is_ordys_plus_eligible");
      return Response.json(true);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(isOrdysPlusEligible("user-123")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://project-ref.supabase.co/rest/v1/rpc/ordys_billing_schema_status",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://project-ref.supabase.co/rest/v1/rpc/is_ordys_plus_eligible",
    );
  });

  it("aborts a stalled subscription entitlement request after worker readiness succeeds", async () => {
    vi.useFakeTimers();
    stubEnvironment();
    let capturedSignal: AbortSignal | undefined;
    let requestCount = 0;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const callIndex = requestCount++;
      if (callIndex === 0) return Promise.resolve(Response.json("ready"));
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = isOrdysPlusEligible("user-123");
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(pending).rejects.toThrow("Não foi possível validar a assinatura desta conta agora. Tente novamente.");
    expect(capturedSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("Asaas configuration preflight", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects a missing API key before any outbound request", () => {
    vi.stubGlobal("Deno", {
      env: { get: (key: string) => ({
        ASAAS_ENVIRONMENT: "sandbox",
      } as Record<string, string>)[key] },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => assertAsaasConfigured()).toThrow(
      "O provedor de pagamentos ainda não está configurado.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid environment before any outbound request", () => {
    vi.stubGlobal("Deno", {
      env: { get: (key: string) => ({
        ASAAS_API_KEY: "test-asaas-key",
        ASAAS_ENVIRONMENT: "production-shadow",
      } as Record<string, string>)[key] },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => assertAsaasConfigured()).toThrow(
      "ASAAS_ENVIRONMENT deve ser configurado explicitamente como sandbox ou production.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an absent environment instead of silently selecting Sandbox", () => {
    vi.stubGlobal("Deno", {
      env: { get: (key: string) => ({
        ASAAS_API_KEY: "test-asaas-key",
      } as Record<string, string>)[key] },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => assertAsaasConfigured()).toThrow(
      "ASAAS_ENVIRONMENT deve ser configurado explicitamente como sandbox ou production.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["sandbox", "production"])(
    "accepts the configured %s environment when the API key exists",
    (environment) => {
      vi.stubGlobal("Deno", {
        env: { get: (key: string) => ({
          ASAAS_API_KEY: "test-asaas-key",
          ASAAS_ENVIRONMENT: environment,
        } as Record<string, string>)[key] },
      });

      expect(() => assertAsaasConfigured()).not.toThrow();
    },
  );
});

describe("asaasRequest subscription deletion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not default a direct Asaas request to Sandbox when the environment is missing", async () => {
    vi.stubGlobal("Deno", {
      env: {
        get: (key: string) => ({
          ASAAS_API_KEY: "test-asaas-key",
        } as Record<string, string>)[key],
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(asaasRequest("/subscriptions/subscription-1", {
      method: "DELETE",
    })).rejects.toThrow(
      "ASAAS_ENVIRONMENT deve ser configurado explicitamente como sandbox ou production.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not interpret 404 as proof that a subscription was deleted", async () => {
    vi.stubGlobal("Deno", {
      env: {
        get: (key: string) => ({
          ASAAS_API_KEY: "test-asaas-key",
          ASAAS_ENVIRONMENT: "sandbox",
        } as Record<string, string>)[key],
      },
    });
    const fetchMock = vi.fn(async () =>
      Response.json({ errors: [{ code: "notFound" }] }, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    await expect(
      asaasRequest("/subscriptions/subscription-not-accessible", {
        method: "DELETE",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      name: "AsaasApiError",
      status: 404,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-sandbox.asaas.com/v3/subscriptions/subscription-not-accessible",
      expect.objectContaining({ method: "DELETE", signal: controller.signal }),
    );
  });
});
