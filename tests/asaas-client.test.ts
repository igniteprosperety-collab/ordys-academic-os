import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  nativeRequest: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
  CapacitorHttp: { request: mocks.nativeRequest },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

import {
  OrdysApiResponseError,
  OrdysApiTransportError,
  requestOrdysAsaasApi,
} from "../src/lib/asaas-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.isNativePlatform.mockReset();
  mocks.nativeRequest.mockReset();
  mocks.getSession.mockReset();
});

function stubAuthenticatedSession() {
  mocks.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: "student-session-token",
      },
    },
    error: null,
  });
}

describe("authenticated Asaas TanStack API client", () => {
  it("uses same-origin fetch for web and sends only the current user's bearer token", async () => {
    stubAuthenticatedSession();
    mocks.isNativePlatform.mockReturnValue(false);
    const fetchMock = vi.fn(async () =>
      Response.json({ enabled: false, plans: [], subscription: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOrdysAsaasApi<{
      enabled: boolean;
      plans: unknown[];
      subscription: unknown;
    }>("/api/asaas/status", {});

    expect(result).toEqual({
      enabled: false,
      plans: [],
      subscription: null,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/asaas/status");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer student-session-token",
    );
    expect(JSON.parse(String(init?.body))).toEqual({});
  });

  it("uses CapacitorHttp for native Android and disables redirects", async () => {
    stubAuthenticatedSession();
    mocks.isNativePlatform.mockReturnValue(true);
    vi.stubEnv("VITE_PUBLIC_APP_URL", "https://app.ordys.example");
    mocks.nativeRequest.mockResolvedValue({
      status: 200,
      data: { checkoutUrl: "https://asaas.com/checkoutSession/show?id=checkout-1" },
      headers: { "content-type": "application/json" },
      url: "https://app.ordys.example/api/asaas/checkout",
    });

    const result = await requestOrdysAsaasApi<{
      checkoutUrl: string;
    }>("/api/asaas/checkout", { planCode: "plus_monthly" });

    expect(result.checkoutUrl).toBe(
      "https://asaas.com/checkoutSession/show?id=checkout-1",
    );
    expect(mocks.nativeRequest).toHaveBeenCalledOnce();
    const options = mocks.nativeRequest.mock.calls[0]?.[0];
    expect(options.url).toBe("https://app.ordys.example/api/asaas/checkout");
    expect(options.method).toBe("POST");
    expect(options.disableRedirects).toBe(true);
    expect(options.connectTimeout).toBe(8_000);
    expect(options.readTimeout).toBeGreaterThanOrEqual(30_000);
    expect(new Headers(options.headers).get("authorization")).toBe(
      "Bearer student-session-token",
    );
    expect(options.data).toEqual({ planCode: "plus_monthly" });
  });

  it("fails closed on a missing or non-HTTPS native app origin", async () => {
    stubAuthenticatedSession();
    mocks.isNativePlatform.mockReturnValue(true);
    vi.stubEnv("VITE_PUBLIC_APP_URL", "http://localhost:3000");

    await expect(
      requestOrdysAsaasApi("/api/asaas/status", {}),
    ).rejects.toThrow("VITE_PUBLIC_APP_URL somente com a origem HTTPS oficial");
    expect(mocks.nativeRequest).not.toHaveBeenCalled();
  });

  it("does not forward authentication to a redirect response", async () => {
    stubAuthenticatedSession();
    mocks.isNativePlatform.mockReturnValue(true);
    vi.stubEnv("VITE_PUBLIC_APP_URL", "https://app.ordys.example");
    mocks.nativeRequest.mockResolvedValue({
      status: 302,
      data: { location: "https://unexpected.example/collect" },
      headers: { location: "https://unexpected.example/collect" },
      url: "https://app.ordys.example/api/asaas/status",
    });

    await expect(
      requestOrdysAsaasApi("/api/asaas/status", {}),
    ).rejects.toBeInstanceOf(OrdysApiResponseError);
    expect(mocks.nativeRequest).toHaveBeenCalledOnce();
    expect(mocks.nativeRequest.mock.calls[0]?.[0]?.disableRedirects).toBe(true);
  });

  it("preserves conflict responses for safe account-deletion handling", async () => {
    stubAuthenticatedSession();
    mocks.isNativePlatform.mockReturnValue(false);
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          error: "Uma contratação está sendo iniciada.",
          code: "checkout_creation_in_progress",
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await requestOrdysAsaasApi("/api/asaas/delete-account", {}).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(OrdysApiResponseError);
    expect(error.context.status).toBe(409);
    await expect(error.context.json()).resolves.toMatchObject({
      code: "checkout_creation_in_progress",
    });
  });

  it("marks transport failures as inconclusive instead of suggesting a retry", async () => {
    stubAuthenticatedSession();
    mocks.isNativePlatform.mockReturnValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection reset");
      }),
    );

    await expect(
      requestOrdysAsaasApi("/api/asaas/delete-account", {}),
    ).rejects.toMatchObject({
      name: "FunctionsFetchError",
    });
    expect(new OrdysApiTransportError()).toBeInstanceOf(Error);
  });

  it("rejects an unsupported path before sending the bearer token", async () => {
    stubAuthenticatedSession();
    mocks.isNativePlatform.mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestOrdysAsaasApi("/api/unknown" as never, {}),
    ).rejects.toThrow("Rota de API não permitida.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.nativeRequest).not.toHaveBeenCalled();
  });
});
