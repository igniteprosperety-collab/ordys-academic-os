import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serviceRest: vi.fn(),
  asaasRequest: vi.fn(),
  assertAsaasConfigured: vi.fn(),
}));

vi.mock("../edge-functions/_shared/ordys-billing.ts", () => ({
  serviceRest: mocks.serviceRest,
  asaasRequest: mocks.asaasRequest,
  assertAsaasConfigured: mocks.assertAsaasConfigured,
}));

type DeleteAccountHandler = (request: Request) => Response | Promise<Response>;

let registeredHandler: DeleteAccountHandler | undefined;

function readRegisteredHandler(): DeleteAccountHandler | undefined {
  return registeredHandler;
}
const envValues: Record<string, string> = {
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
};

function waitForAbort(signal?: AbortSignal): Promise<never> {
  if (!signal) return new Promise<never>(() => undefined);
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });
}

function requestWithSession(body: unknown = {}) {
  return new Request(
    "https://project-ref.supabase.co/functions/v1/ordys-delete-account",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer user-session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

async function setup(options: {
  authStatus?: number;
  clearDataStatus?: number;
  deleteAuthStatus?: number;
  billingSchemaStatus?: string;
  reservationStatus?: string;
  processingStatus?: string;
  authNetworkFailure?: boolean;
  authNeverSettles?: boolean;
  billingSchemaNeverSettles?: boolean;
  clearDataNeverSettles?: boolean;
  asaasNeverSettles?: boolean;
  adminDeleteNeverSettles?: boolean;
  authBody?: Record<string, unknown>;
} = {}) {
  vi.resetModules();
  registeredHandler = undefined;
  const timeline: string[] = [];

  mocks.assertAsaasConfigured.mockReset();
  mocks.serviceRest.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    timeline.push(`serviceRest:${path}`);
    if (path === "rpc/ordys_billing_core_schema_status") {
      if (options.billingSchemaNeverSettles) return waitForAbort(init?.signal as AbortSignal | undefined);
      return options.billingSchemaStatus ?? "absent";
    }
    if (path === "rpc/ordys_reserve_account_deletion") {
      return options.reservationStatus ?? "reserved";
    }
    if (path === "rpc/ordys_claim_account_deletion_processing") return options.processingStatus ?? "claimed";
    if (path === "rpc/ordys_release_account_deletion_processing") return "not_reserved";
    if (path.startsWith("ordys_billing_checkout_attempts?")) return [];
    if (path.startsWith("ordys_billing_subscriptions?")) return [];
    throw new Error(`Unexpected serviceRest path: ${path}`);
  });

  mocks.asaasRequest.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    timeline.push(`asaas:${path}`);
    if (options.asaasNeverSettles) return waitForAbort(init?.signal as AbortSignal | undefined);
    return {};
  });

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    timeline.push(`fetch:${url}`);

    if (url.endsWith("/auth/v1/user")) {
      if (options.authNeverSettles) return waitForAbort(init?.signal as AbortSignal | undefined);
      if (options.authNetworkFailure) throw new Error("network unavailable");
      return Response.json(
        options.authBody ?? { id: "authenticated-user-123" },
        { status: options.authStatus ?? 200 },
      );
    }
    if (url.endsWith("/rest/v1/rpc/delete_own_data")) {
      if (options.clearDataNeverSettles) return waitForAbort(init?.signal as AbortSignal | undefined);
      return new Response(null, { status: options.clearDataStatus ?? 204 });
    }
    if (url.endsWith("/auth/v1/admin/users/authenticated-user-123")) {
      if (options.adminDeleteNeverSettles) return waitForAbort(init?.signal as AbortSignal | undefined);
      return new Response(null, { status: options.deleteAuthStatus ?? 204 });
    }
    return Response.json({ error: "Unexpected outbound request" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Deno", {
    env: { get: (key: string) => envValues[key] },
    serve: (handler: DeleteAccountHandler) => {
      registeredHandler = handler;
    },
  });

  await import("../edge-functions/ordys-delete-account/index.ts");
  const handler = readRegisteredHandler();
  if (typeof handler !== "function") {
    throw new Error("A função Edge de exclusão não registrou seu handler HTTP.");
  }

  return { handler, fetchMock, timeline };
}

beforeEach(() => {
  vi.stubGlobal("console", { ...console, error: vi.fn(), warn: vi.fn(), log: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ORDYS account deletion Edge Function", () => {
  it("rejects requests without a bearer session before calling any backend", async () => {
    const { handler, fetchMock } = await setup();
    const request = new Request(
      "https://project-ref.supabase.co/functions/v1/ordys-delete-account",
      { method: "POST", body: "{}" },
    );

    const result = await handler(request);

    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ error: "Sessão inválida." });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.serviceRest).not.toHaveBeenCalled();
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("does not delete data when Supabase Auth rejects the supplied session", async () => {
    const { handler, fetchMock } = await setup({ authStatus: 401 });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ error: "Sessão inválida." });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/auth\/v1\/user$/);
    expect(mocks.serviceRest).not.toHaveBeenCalled();
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("returns service unavailable and performs no deletion when Auth responds with 503", async () => {
    const { handler, fetchMock } = await setup({ authStatus: 503 });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      error: "O serviço de autenticação está indisponível. Nenhum dado foi apagado.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.serviceRest).not.toHaveBeenCalled();
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("returns service unavailable and performs no deletion when Auth fails at the network layer", async () => {
    const { handler, fetchMock } = await setup({ authNetworkFailure: true });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      error: "Não foi possível validar sua sessão agora. Tente novamente.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.serviceRest).not.toHaveBeenCalled();
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("fails closed when Auth returns a malformed successful response", async () => {
    const { handler, fetchMock } = await setup({ authBody: { email: "user@example.invalid" } });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      error: "Não foi possível validar sua sessão. Nenhum dado foi apagado.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.serviceRest).not.toHaveBeenCalled();
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("derives the deletion target from the verified session, never from the request body", async () => {
    const { handler, fetchMock } = await setup();
    const result = await handler(requestWithSession({ user_id: "attacker-controlled-user" }));

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ deleted: true });
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_billing_core_schema_status",
      expect.objectContaining({ method: "POST", body: "{}", signal: expect.any(AbortSignal) }),
    );

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toContain("https://project-ref.supabase.co/auth/v1/user");
    expect(urls).toContain("https://project-ref.supabase.co/rest/v1/rpc/delete_own_data");
    expect(urls).toContain(
      "https://project-ref.supabase.co/auth/v1/admin/users/authenticated-user-123",
    );
    expect(urls.some((url) => url.includes("attacker-controlled-user"))).toBe(false);

    const clearCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/rest/v1/rpc/delete_own_data"),
    );
    const clearHeaders = new Headers(clearCall?.[1]?.headers);
    expect(clearHeaders.get("apikey")).toBe("publishable-test-key");
    expect(clearHeaders.get("authorization")).toBe("Bearer user-session-token");
    expect(clearCall?.[1]?.body).toBe("{}");

    const adminCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/auth/v1/admin/users/authenticated-user-123"),
    );
    const adminHeaders = new Headers(adminCall?.[1]?.headers);
    expect(adminHeaders.get("apikey")).toBe("service-role-test-key");
    expect(adminHeaders.get("authorization")).toBe("Bearer service-role-test-key");
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("fails closed when the core billing schema is partial and deletes no application data", async () => {
    const { handler, fetchMock } = await setup({ billingSchemaStatus: "partial" });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({
      error: "A estrutura de assinaturas está incompleta. Nenhum dado foi apagado.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(mocks.serviceRest).toHaveBeenCalledOnce();
  });

  it("does not depend on the cron worker heartbeat when the core billing schema is ready", async () => {
    const { handler, fetchMock } = await setup({ billingSchemaStatus: "ready" });
    mocks.serviceRest.mockImplementation(async (path: string) => {
      if (path === "rpc/ordys_billing_core_schema_status") return "ready";
      if (path === "rpc/ordys_billing_schema_status") return "partial";
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "released";
      if (path.startsWith("ordys_billing_checkout_attempts?")) return [];
      if (path.startsWith("ordys_billing_subscriptions?")) return [];
      throw new Error("Unexpected serviceRest path: " + path);
    });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ deleted: true });
    expect(mocks.serviceRest).toHaveBeenCalledWith(
      "rpc/ordys_billing_core_schema_status",
      expect.objectContaining({ method: "POST", body: "{}", signal: expect.any(AbortSignal) }),
    );
    expect(mocks.serviceRest).not.toHaveBeenCalledWith(
      "rpc/ordys_billing_schema_status",
      expect.anything(),
    );
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      "https://project-ref.supabase.co/rest/v1/rpc/delete_own_data",
    );
  });

  it("rejects a concurrent account deletion while another request owns the processing lease", async () => {
    const { handler, fetchMock } = await setup({
      billingSchemaStatus: "ready",
      processingStatus: "deletion_processing",
    });
    const result = await handler(requestWithSession());
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "account_deletion_in_progress" });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/rest/v1/rpc/delete_own_data"))).toBe(false);
    expect(mocks.serviceRest).toHaveBeenCalledTimes(3);
  });

  it("does not clear account data while a checkout creation is still in flight", async () => {
    const { handler, fetchMock } = await setup({
      billingSchemaStatus: "ready",
      reservationStatus: "checkout_creation_in_progress",
    });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      code: "checkout_creation_in_progress",
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://project-ref.supabase.co/auth/v1/user",
    ]);
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(mocks.serviceRest).toHaveBeenCalledTimes(2);
    expect(mocks.serviceRest.mock.calls[1]?.[0]).toBe("rpc/ordys_reserve_account_deletion");
  });

  it("waits for provider confirmation before clearing data for a pending checkout", async () => {
    const { handler, fetchMock, timeline } = await setup({ billingSchemaStatus: "ready" });
    mocks.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      timeline.push(`serviceRest:${path}`);
      if (path === "rpc/ordys_billing_core_schema_status") return "ready";
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "released";
      if (path.includes("cancellation_requested_at=is.null")) {
        const patch = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return [{
          id: "checkout-attempt-1",
          status: "pending",
          ...patch,
        }];
      }
      if (path.includes("select=id,status,cancellation_requested_at,cancellation_claim_id")) {
        return [{
          id: "checkout-attempt-1",
          status: "pending",
          cancellation_requested_at: "2026-11-03T20:00:00.000Z",
          cancellation_claim_id: "already-owned",
        }];
      }
      if (path.startsWith("ordys_billing_checkout_attempts?")) {
        return [{
          id: "checkout-attempt-1",
          status: "pending",
          provider_checkout_id: "asaas-checkout-1",
        }];
      }
      if (path.startsWith("ordys_billing_subscriptions?")) return [];
      throw new Error(`Unexpected serviceRest path: ${path}`);
    });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "checkout_cancellation_processing" });
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/checkouts/asaas-checkout-1/cancel",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://project-ref.supabase.co/auth/v1/user",
    ]);
    expect(timeline.some(item => item.endsWith("/rest/v1/rpc/delete_own_data"))).toBe(false);
  });

  it("returns the reconciliation-specific code when a paid Checkout has no linked subscription", async () => {
    const { handler, fetchMock } = await setup({ billingSchemaStatus: "ready" });
    mocks.serviceRest.mockImplementation(async (path: string) => {
      if (path === "rpc/ordys_billing_core_schema_status") return "ready";
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "released";
      if (path.startsWith("ordys_billing_checkout_attempts?")) {
        return [{ id: "paid-checkout-without-subscription", status: "paid" }];
      }
      if (path.startsWith("ordys_billing_subscriptions?")) return [];
      throw new Error("Unexpected serviceRest path: " + path);
    });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "billing_reconciliation_required" });
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/rest/v1/rpc/delete_own_data"),
    )).toBe(false);
  });

  it("cancels an active subscription before clearing the account and deleting Auth identity", async () => {
    const { handler, fetchMock, timeline } = await setup({ billingSchemaStatus: "ready" });
    mocks.serviceRest.mockImplementation(async (path: string) => {
      timeline.push(`serviceRest:${path}`);
      if (path === "rpc/ordys_billing_core_schema_status") return "ready";
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "not_reserved";
      if (path === "rpc/ordys_confirm_subscription_cancellation") return "confirmed";
      if (path.startsWith("ordys_billing_checkout_attempts?")) return [];
      if (path.startsWith("ordys_billing_subscriptions?") && path.includes("cancellation_requested_at=is.null")) {
        return [{
          id: "subscription-1",
          status: "active",
          provider_subscription_id: "asaas-subscription-1",
          cancellation_requested_at: "2026-11-03T20:00:00.000Z",
        }];
      }
      if (path.startsWith("ordys_billing_subscriptions?")) {
        return [{
          id: "subscription-1",
          status: "active",
          provider_subscription_id: "asaas-subscription-1",
        }];
      }
      throw new Error(`Unexpected serviceRest path: ${path}`);
    });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ deleted: true });
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/subscriptions/asaas-subscription-1",
      expect.objectContaining({ method: "DELETE", signal: expect.any(AbortSignal) }),
    );

    const cancelIndex = timeline.indexOf("asaas:/subscriptions/asaas-subscription-1");
    const confirmIndex = timeline.indexOf("serviceRest:rpc/ordys_confirm_subscription_cancellation");
    const clearIndex = timeline.indexOf(
      "fetch:https://project-ref.supabase.co/rest/v1/rpc/delete_own_data",
    );
    const authDeleteIndex = timeline.indexOf(
      "fetch:https://project-ref.supabase.co/auth/v1/admin/users/authenticated-user-123",
    );
    expect(cancelIndex).toBeGreaterThanOrEqual(0);
    expect(cancelIndex).toBeLessThan(confirmIndex);
    expect(confirmIndex).toBeLessThan(clearIndex);
    expect(clearIndex).toBeLessThan(authDeleteIndex);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not delete the Auth identity when application-data deletion fails", async () => {
    const { handler, fetchMock } = await setup({ clearDataStatus: 500 });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({
      error: "Não foi possível excluir os dados da conta.",
    });
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some(url => url.includes("/auth/v1/admin/users/"))).toBe(false);
  });

  it("reports a partial failure when application data is gone but Auth identity deletion fails", async () => {
    const { handler, fetchMock } = await setup({ deleteAuthStatus: 500 });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({
      code: "auth_identity_deletion_unconfirmed",
    });
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/rest/v1/rpc/delete_own_data"),
    )).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/auth/v1/admin/users/authenticated-user-123"),
    )).toBe(true);
  });

  it("bounds Auth session verification before starting billing cancellation", async () => {
    vi.useFakeTimers();
    const { handler, fetchMock } = await setup({ authNeverSettles: true });
    const pending = handler(requestWithSession());

    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;

    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      error: "Não foi possível validar sua sessão agora. Tente novamente.",
    });
    expect((fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(mocks.serviceRest).not.toHaveBeenCalled();
    expect(mocks.asaasRequest).not.toHaveBeenCalled();
  });

  it("bounds billing schema lookup before reserving account deletion", async () => {
    vi.useFakeTimers();
    const { handler, fetchMock } = await setup({
      billingSchemaStatus: "ready",
      billingSchemaNeverSettles: true,
    });
    const pending = handler(requestWithSession());

    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;

    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({
      error: "Não foi possível confirmar o estado das cobranças agora. Nenhum dado foi apagado. Tente novamente após a conciliação.",
    });
    expect((mocks.serviceRest.mock.calls[0]?.[1]?.signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/rest/v1/rpc/delete_own_data"))).toBe(false);
  });

  it("aborts a stalled Asaas Checkout cancellation without clearing account data", async () => {
    vi.useFakeTimers();
    const { handler, fetchMock } = await setup({
      billingSchemaStatus: "ready",
      asaasNeverSettles: true,
    });
    mocks.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "rpc/ordys_billing_core_schema_status") return "ready";
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "released";
      if (path.startsWith("ordys_billing_checkout_attempts?select=id,status,provider_checkout_id")) {
        return [{ id: "checkout-attempt-1", status: "pending", provider_checkout_id: "asaas-checkout-1" }];
      }
      if (path.includes("cancellation_requested_at=is.null")) {
        const patch = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return [{
          id: "checkout-attempt-1",
          status: "pending",
          ...patch,
        }];
      }
      if (path.startsWith("ordys_billing_subscriptions?")) return [];
      throw new Error(`Unexpected serviceRest path: ${path}`);
    });

    const pending = handler(requestWithSession());
    for (let index = 0; index < 100 && !mocks.asaasRequest.mock.calls.length; index += 1) {
      await Promise.resolve();
    }
    expect(mocks.asaasRequest).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "checkout_cancellation_processing" });
    expect((mocks.asaasRequest.mock.calls[0]?.[1]?.signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(mocks.serviceRest.mock.calls.some(([path]) => String(path).includes("cancellation_requested_at=is.null"))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/rest/v1/rpc/delete_own_data"))).toBe(false);
  });

  it("aborts a stalled Asaas recurring cancellation without confirming or clearing account data", async () => {
    vi.useFakeTimers();
    const { handler, fetchMock } = await setup({
      billingSchemaStatus: "ready",
      asaasNeverSettles: true,
    });
    mocks.serviceRest.mockImplementation(async (path: string) => {
      if (path === "rpc/ordys_billing_core_schema_status") return "ready";
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "released";
      if (path.startsWith("ordys_billing_checkout_attempts?")) return [];
      if (path.startsWith("ordys_billing_subscriptions?select=id,status,checkout_attempt_id")) {
        return [{
          id: "subscription-1",
          status: "active",
          provider_subscription_id: "asaas-subscription-1",
          cancellation_requested_at: null,
          cancellation_confirmed_at: null,
        }];
      }
      if (path.includes("cancellation_requested_at=is.null")) {
        return [{
          id: "subscription-1",
          cancellation_requested_at: "2026-11-04T10:00:00.000Z",
          cancellation_confirmed_at: null,
        }];
      }
      throw new Error(`Unexpected serviceRest path: ${path}`);
    });

    const pending = handler(requestWithSession());
    for (let index = 0; index < 100 && !mocks.asaasRequest.mock.calls.length; index += 1) {
      await Promise.resolve();
    }
    expect(mocks.asaasRequest).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "billing_cancellation_processing" });
    expect((mocks.asaasRequest.mock.calls[0]?.[1]?.signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/subscriptions/asaas-subscription-1",
      expect.objectContaining({ method: "DELETE", signal: expect.any(AbortSignal) }),
    );
    expect(mocks.serviceRest.mock.calls.some(([path]) =>
      String(path) === "rpc/ordys_confirm_subscription_cancellation",
    )).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/rest/v1/rpc/delete_own_data"),
    )).toBe(false);
  });

  it("aborts a stalled Auth identity deletion and reports the partial account state", async () => {
    vi.useFakeTimers();
    const { handler, fetchMock } = await setup({ adminDeleteNeverSettles: true });
    const pending = handler(requestWithSession());
    for (let index = 0; index < 100 && !fetchMock.mock.calls.some(([input]) => String(input).includes("/auth/v1/admin/users/")); index += 1) {
      await Promise.resolve();
    }
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/auth/v1/admin/users/"))).toBe(true);

    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({
      code: "auth_identity_deletion_unconfirmed",
    });
    const adminCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/auth/v1/admin/users/authenticated-user-123"),
    );
    expect((adminCall?.[1]?.signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/rest/v1/rpc/delete_own_data"))).toBe(true);
  });


  it("does not delete the Auth identity when application-data deletion times out", async () => {
    vi.useFakeTimers();
    const { handler, fetchMock } = await setup({ clearDataNeverSettles: true });
    const pending = handler(requestWithSession());
    for (let index = 0; index < 100 && !fetchMock.mock.calls.some(([input]) => String(input).endsWith("/rest/v1/rpc/delete_own_data")); index += 1) {
      await Promise.resolve();
    }
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/rest/v1/rpc/delete_own_data"))).toBe(true);

    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(result.status).toBe(502);
    expect(await result.json()).toMatchObject({
      code: "account_data_deletion_unconfirmed",
    });
    const clearCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/rest/v1/rpc/delete_own_data"),
    );
    expect((clearCall?.[1]?.signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/auth/v1/admin/users/"))).toBe(false);
  });


  it("blocks deletion when a timed-out Checkout claim commits after its read-back", async () => {
    const { handler } = await setup({ billingSchemaStatus: "ready" });
    let cancellationRequestedAt: string | null = null;
    let cancellationClaimId: string | null = null;

    mocks.serviceRest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "rpc/ordys_billing_core_schema_status") return Promise.resolve("ready");
      if (path === "rpc/ordys_reserve_account_deletion") return Promise.resolve("reserved");
      if (path === "rpc/ordys_claim_account_deletion_processing") return Promise.resolve("claimed");
      if (path === "rpc/ordys_release_account_deletion_processing") return Promise.resolve("released");
      if (path === "rpc/ordys_has_unreconciled_billing_events") return Promise.resolve(false);

      if (path.startsWith("ordys_billing_checkout_attempts?")) {
        if (init?.method === "PATCH") {
          const patch = JSON.parse(String(init.body)) as { cancellation_claim_id: string };
          return new Promise((resolve) => {
            setTimeout(() => {
              cancellationRequestedAt = "2026-11-06T10:00:09.000Z";
              cancellationClaimId = patch.cancellation_claim_id;
              resolve([{
                id: "checkout-attempt-1",
                status: "pending",
                cancellation_requested_at: cancellationRequestedAt,
                cancellation_claim_id: cancellationClaimId,
              }]);
            }, 9_000);
          });
        }

        if (path.includes("select=id,status,cancellation_requested_at,cancellation_claim_id")) {
          return Promise.resolve([{
            id: "checkout-attempt-1",
            status: "pending",
            cancellation_requested_at: cancellationRequestedAt,
            cancellation_claim_id: cancellationClaimId,
          }]);
        }

        return Promise.resolve([{
          id: "checkout-attempt-1",
          status: "pending",
          provider_checkout_id: "asaas-checkout-1",
          cancellation_requested_at: cancellationRequestedAt,
          cancellation_claim_id: cancellationClaimId,
        }]);
      }

      if (path.startsWith("ordys_billing_subscriptions?")) return Promise.resolve([]);
      throw new Error("Unexpected serviceRest path: " + path);
    });

    vi.useFakeTimers();
    try {
      const firstPromise = handler(requestWithSession());
      await vi.advanceTimersByTimeAsync(8_000);
      const first = await firstPromise;

      expect(first.status).toBe(409);
      expect(await first.json()).toMatchObject({ code: "checkout_cancellation_processing" });
      expect(cancellationRequestedAt).toBeNull();
      expect(mocks.asaasRequest).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(cancellationRequestedAt).not.toBeNull();
      expect(cancellationClaimId).toMatch(/^[0-9a-f-]{36}$/);

      const second = await handler(requestWithSession());
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: "checkout_cancellation_processing" });
      expect(mocks.asaasRequest).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues cancelling independent Checkouts after another claim becomes inconclusive", async () => {
    const { handler, timeline } = await setup({ billingSchemaStatus: "ready" });
    mocks.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      timeline.push("serviceRest:" + (init?.method ?? "GET") + ":" + path);
      if (path === "rpc/ordys_billing_core_schema_status") return "ready";
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "released";
      if (path === "rpc/ordys_has_unreconciled_billing_events") return false;

      if (path.startsWith("ordys_billing_checkout_attempts?")) {
        if (init?.method === "PATCH" && path.includes("id=eq.checkout-attempt-1")) return [];

        if (
          path.includes("select=id,status,cancellation_requested_at,cancellation_claim_id") &&
          path.includes("id=eq.checkout-attempt-1")
        ) {
          return [{
            id: "checkout-attempt-1",
            status: "pending",
            cancellation_requested_at: null,
            cancellation_claim_id: null,
          }];
        }

        if (init?.method === "PATCH" && path.includes("id=eq.checkout-attempt-2")) {
          const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
          return [{
            id: "checkout-attempt-2",
            status: "pending",
            ...patch,
          }];
        }

        return [
          {
            id: "checkout-attempt-1",
            status: "pending",
            provider_checkout_id: "asaas-checkout-1",
            cancellation_requested_at: null,
            cancellation_claim_id: null,
          },
          {
            id: "checkout-attempt-2",
            status: "pending",
            provider_checkout_id: "asaas-checkout-2",
            cancellation_requested_at: null,
            cancellation_claim_id: null,
          },
        ];
      }

      if (path.startsWith("ordys_billing_subscriptions?")) return [];
      throw new Error("Unexpected serviceRest path: " + path);
    });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "checkout_cancellation_processing" });
    expect(mocks.asaasRequest).toHaveBeenCalledTimes(1);
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/checkouts/asaas-checkout-2/cancel",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
    expect(mocks.asaasRequest.mock.calls.some(([path]) =>
      path === "/checkouts/asaas-checkout-1/cancel",
    )).toBe(false);
    expect(timeline.some(item =>
      item.includes("id=eq.checkout-attempt-1") && item.startsWith("serviceRest:PATCH:"),
    )).toBe(true);
    expect(timeline.some(item =>
      item.includes("id=eq.checkout-attempt-2") && item.startsWith("serviceRest:PATCH:"),
    )).toBe(true);
  });

  it("continues cancelling identified Checkouts when another Checkout has no provider ID yet", async () => {
    const { handler, fetchMock } = await setup({ billingSchemaStatus: "ready" });
    mocks.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "rpc/ordys_billing_core_schema_status") return "ready";
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "released";
      if (path === "rpc/ordys_has_unreconciled_billing_events") return false;

      if (path.startsWith("ordys_billing_checkout_attempts?")) {
        if (init?.method === "PATCH" && path.includes("id=eq.checkout-attempt-2")) {
          const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
          return [{
            id: "checkout-attempt-2",
            status: "pending",
            ...patch,
          }];
        }

        return [
          {
            id: "checkout-attempt-no-provider-id",
            status: "creating",
            provider_checkout_id: null,
            cancellation_requested_at: null,
            cancellation_claim_id: null,
          },
          {
            id: "checkout-attempt-2",
            status: "pending",
            provider_checkout_id: "asaas-checkout-2",
            cancellation_requested_at: null,
            cancellation_claim_id: null,
          },
        ];
      }

      if (path.startsWith("ordys_billing_subscriptions?")) return [];
      throw new Error("Unexpected serviceRest path: " + path);
    });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "checkout_cancellation_processing" });
    expect(mocks.asaasRequest).toHaveBeenCalledTimes(1);
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/checkouts/asaas-checkout-2/cancel",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
    expect(mocks.asaasRequest.mock.calls.some(([path]) =>
      String(path).includes("checkout-attempt-no-provider-id"),
    )).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/rest/v1/rpc/delete_own_data"),
    )).toBe(false);
  });

  it("attempts every known subscription cancellation when one provider response is uncertain", async () => {
    const { handler, fetchMock } = await setup({ billingSchemaStatus: "ready" });
    const subscriptions = [
      {
        id: "subscription-1",
        status: "active",
        provider_subscription_id: "asaas-subscription-1",
        cancellation_requested_at: null,
        cancellation_claim_id: null,
        cancellation_confirmed_at: null,
      },
      {
        id: "subscription-2",
        status: "active",
        provider_subscription_id: "asaas-subscription-2",
        cancellation_requested_at: null,
        cancellation_claim_id: null,
        cancellation_confirmed_at: null,
      },
    ];

    mocks.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "rpc/ordys_billing_core_schema_status") return "ready";
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "released";
      if (path === "rpc/ordys_has_unreconciled_billing_events") return false;
      if (path === "rpc/ordys_confirm_subscription_cancellation") return "confirmed";

      if (path.startsWith("ordys_billing_checkout_attempts?")) return [];

      if (path.startsWith("ordys_billing_subscriptions?")) {
        if (init?.method === "PATCH") {
          const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
          const id = path.includes("id=eq.subscription-1") ? "subscription-1" : "subscription-2";
          return [{ ...subscriptions.find(row => row.id === id), ...patch }];
        }

        if (path.includes("select=id,status,provider_status,cancellation_requested_at,cancellation_confirmed_at,cancellation_claim_id")) {
          const id = path.includes("id=eq.subscription-1") ? "subscription-1" : "subscription-2";
          return [subscriptions.find(row => row.id === id)];
        }

        return subscriptions;
      }

      throw new Error("Unexpected serviceRest path: " + path);
    });

    mocks.asaasRequest.mockRejectedValueOnce(new Error("provider response uncertain"));

    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "billing_cancellation_processing" });
    expect(mocks.asaasRequest).toHaveBeenCalledTimes(2);
    expect(mocks.asaasRequest).toHaveBeenNthCalledWith(
      1,
      "/subscriptions/asaas-subscription-1",
      expect.objectContaining({ method: "DELETE", signal: expect.any(AbortSignal) }),
    );
    expect(mocks.asaasRequest).toHaveBeenNthCalledWith(
      2,
      "/subscriptions/asaas-subscription-2",
      expect.objectContaining({ method: "DELETE", signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/rest/v1/rpc/delete_own_data"),
    )).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes("/auth/v1/admin/users/"),
    )).toBe(false);
  });

  it("continues known subscription cancellations when Checkout records need reconciliation", async () => {
    const { handler, fetchMock } = await setup({ billingSchemaStatus: "ready" });
    const subscription = {
      id: "subscription-known",
      status: "active",
      checkout_attempt_id: "some-other-checkout",
      provider_subscription_id: "asaas-subscription-known",
      cancellation_requested_at: null,
      cancellation_claim_id: null,
      cancellation_confirmed_at: null,
    };

    mocks.serviceRest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "rpc/ordys_billing_core_schema_status") return "ready";
      if (path === "rpc/ordys_reserve_account_deletion") return "reserved";
      if (path === "rpc/ordys_claim_account_deletion_processing") return "claimed";
      if (path === "rpc/ordys_release_account_deletion_processing") return "released";
      if (path === "rpc/ordys_has_unreconciled_billing_events") return false;
      if (path === "rpc/ordys_confirm_subscription_cancellation") return "confirmed";

      if (path.startsWith("ordys_billing_checkout_attempts?")) {
        return [
          {
            id: "paid-checkout-without-subscription",
            status: "paid",
            provider_checkout_id: "asaas-checkout-unlinked",
          },
          {
            id: "paid-checkout-without-local-subscription",
            status: "paid",
            provider_checkout_id: "asaas-checkout-unlinked-2",
          },
        ];
      }

      if (path.startsWith("ordys_billing_subscriptions?")) {
        if (init?.method === "PATCH") {
          const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
          return [{ ...subscription, ...patch }];
        }
        if (path.includes("select=id,status,provider_status,cancellation_requested_at,cancellation_confirmed_at,cancellation_claim_id")) {
          return [subscription];
        }
        return [subscription];
      }

      throw new Error("Unexpected serviceRest path: " + path);
    });

    const result = await handler(requestWithSession());

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "billing_reconciliation_required" });
    expect(mocks.asaasRequest).toHaveBeenCalledTimes(1);
    expect(mocks.asaasRequest).toHaveBeenCalledWith(
      "/subscriptions/asaas-subscription-known",
      expect.objectContaining({ method: "DELETE", signal: expect.any(AbortSignal) }),
    );
    expect(mocks.asaasRequest.mock.calls.some(([path]) =>
      String(path).startsWith("/checkouts/"),
    )).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/rest/v1/rpc/delete_own_data"),
    )).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes("/auth/v1/admin/users/"),
    )).toBe(false);
  });

});
