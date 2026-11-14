import "@tanstack/react-start/server-only";
import {
  createOutboundRequestDeadline,
  fetchWithOutboundTimeout,
  OutboundRequestTimeoutError,
  responseJsonWithOutboundTimeout,
} from "./request-timeout.server";

const SUPABASE_REQUEST_TIMEOUT_MS = 8_000;
const SUPABASE_RESPONSE_BODY_TIMEOUT_MS = 3_000;
const ASAAS_REQUEST_TIMEOUT_MS = 12_000;
const ASAAS_RESPONSE_BODY_TIMEOUT_MS = 5_000;

export const billingCorsHeaders = {};

export function billingResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...billingCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getSupabaseUrl() {
  return process.env["SUPABASE_URL"]?.trim() ?? "";
}

export function getPublishableKey() {
  const keysRaw = process.env["SUPABASE_PUBLISHABLE_KEYS"]?.trim();
  if (keysRaw) {
    try {
      const keys = JSON.parse(keysRaw) as Record<string, unknown>;
      return typeof keys["default"] === "string" ? keys["default"].trim() : "";
    } catch {
      return "";
    }
  }
  return (process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_ANON_KEY"])?.trim() ?? "";
}

export function getServiceRoleKey() {
  const keysRaw = process.env["SUPABASE_SECRET_KEYS"]?.trim();
  if (keysRaw) {
    try {
      const keys = JSON.parse(keysRaw) as Record<string, unknown>;
      return typeof keys["default"] === "string" ? keys["default"].trim() : "";
    } catch {
      return "";
    }
  }
  return (process.env["SUPABASE_SERVICE_ROLE_KEY"] || "").trim();
}

export function serviceHeaders(): Record<string, string> {
  const key = getServiceRoleKey();
  if (!key) throw new Error("Billing database access is not configured.");
  return key.startsWith("sb_secret_")
    ? { apikey: key, "Content-Type": "application/json" }
    : { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export async function validateBillingUser(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;

  const supabaseUrl = getSupabaseUrl();
  const publishableKey = getPublishableKey();
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Billing authentication is not configured.");
  }

  const result = await fetchWithOutboundTimeout(
    `${supabaseUrl}/auth/v1/user`,
    { headers: { apikey: publishableKey, Authorization: authorization } },
    SUPABASE_REQUEST_TIMEOUT_MS,
  );
  if (result.status === 401 || result.status === 403) return null;
  if (!result.ok) throw new Error("Supabase Auth is temporarily unavailable.");

  const userPayload = await responseJsonWithOutboundTimeout<unknown>(
    result,
    SUPABASE_RESPONSE_BODY_TIMEOUT_MS,
  );
  const user = jsonObject(userPayload);
  if (typeof user["id"] !== "string") {
    throw new Error("Supabase Auth returned an invalid user response.");
  }
  return { id: user["id"], authorization };
}

export type BillingAuthResult =
  | { user: { id: string; authorization: string }; response: null }
  | { user: null; response: Response };

export async function authenticateBillingRequest(
  request: Request,
  unauthorizedMessage: string,
): Promise<BillingAuthResult> {
  try {
    const user = await validateBillingUser(request);
    if (!user) {
      return {
        user: null,
        response: billingResponse({ error: unauthorizedMessage }, 401),
      };
    }
    return { user, response: null };
  } catch {
    return {
      user: null,
      response: billingResponse({
        error: "Não foi possível validar sua sessão agora. Tente novamente.",
      }, 503),
    };
  }
}

/**
 * Execute a short-lived webhook database operation within one total deadline.
 * The request and JSON response body share the same budget so their combined
 * duration cannot exceed the provider's acknowledgement window.
 */
export async function serviceRestWithDeadline(
  path: string,
  init: RequestInit,
  totalTimeoutMs: number,
) {
  const deadline = createOutboundRequestDeadline(totalTimeoutMs);
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("Billing database access is not configured.");

  const headers = new Headers(serviceHeaders());
  if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const result = await fetchWithOutboundTimeout(
    `${supabaseUrl}/rest/v1/${path}`,
    { ...init, headers },
    deadline(SUPABASE_REQUEST_TIMEOUT_MS),
  );
  if (!result.ok) {
    console.error("ORDYS billing database request failed:", result.status);
    throw new Error("Não foi possível consultar o serviço de assinaturas.");
  }
  if (result.status === 204 || result.body === null) return null;

  try {
    return await responseJsonWithOutboundTimeout<unknown>(
      result,
      deadline(SUPABASE_RESPONSE_BODY_TIMEOUT_MS),
    );
  } catch (error) {
    if (error instanceof OutboundRequestTimeoutError) throw error;
    return null;
  }
}

export async function serviceRest(path: string, init: RequestInit = {}) {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("Billing database access is not configured.");

  const headers = new Headers(serviceHeaders());
  if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const url = `${supabaseUrl}/rest/v1/${path}`;
  const requestInit = { ...init, headers, redirect: "manual" as const };
  // Preserve caller-owned abort signals from longer billing/deletion leases.
  const result = init.signal
    ? await fetch(url, requestInit)
    : await fetchWithOutboundTimeout(url, requestInit, SUPABASE_REQUEST_TIMEOUT_MS);
  if (!result.ok) {
    const status = result.status;
    console.error("ORDYS billing database request failed:", status);
    throw new Error("Não foi possível consultar o serviço de assinaturas.");
  }
  if (result.status === 204 || result.body === null) return null;
  try {
    return await responseJsonWithOutboundTimeout<unknown>(
      result,
      SUPABASE_RESPONSE_BODY_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof OutboundRequestTimeoutError) throw error;
    return null;
  }
}

export function getAsaasApiBase() {
  if (process.env["ASAAS_ENVIRONMENT"]?.trim().toLowerCase() !== "sandbox") {
    throw new Error("ASAAS_ENVIRONMENT deve ser sandbox nesta etapa.");
  }
  return "https://api-sandbox.asaas.com/v3";
}

export function assertAsaasConfigured() {
  getAsaasApiBase();
  if (!process.env["ASAAS_API_KEY"]?.trim()) throw new Error("O provedor de pagamentos ainda não está configurado.");
}

export class AsaasApiError extends Error {
  constructor(readonly status: number) {
    super("O Asaas não conseguiu concluir a operação. Verifique a configuração e tente novamente.");
    this.name = "AsaasApiError";
  }
}

export function checkoutAttemptDisposition(status: string, expiresAt: string, now = Date.now()) {
  if (status === "cancelled" || status === "expired" || status === "failed") return "retry" as const;
  if (status !== "pending") return "block" as const;
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration)) return "block" as const;
  return expiration > now ? "reuse" as const : "cancel_remote" as const;
}

export async function asaasRequest(path: string, init: RequestInit = {}) {
  const apiKey = process.env["ASAAS_API_KEY"]?.trim();
  if (!apiKey) throw new Error("O provedor de pagamentos ainda não está configurado.");

  const headers = new Headers({
    access_token: apiKey,
    accept: "application/json",
    "User-Agent": "OrdysAcademy/1.0",
  });
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..") || path.includes("\\")) throw new Error("Caminho Asaas inválido.");
  const url = `${getAsaasApiBase()}${path}`;
  // A parent billing/deletion lease owns the deadline when it supplies a signal.
  // Otherwise bound the provider request locally.
  const requestInit = { ...init, headers, redirect: "manual" as const };
  const result = init.signal
    ? await fetch(url, requestInit)
    : await fetchWithOutboundTimeout(url, requestInit, ASAAS_REQUEST_TIMEOUT_MS);
  let payload: Record<string, unknown> = {};
  if (result.body !== null) {
    try {
      payload = jsonObject(await responseJsonWithOutboundTimeout<unknown>(
        result,
        ASAAS_RESPONSE_BODY_TIMEOUT_MS,
      ));
    } catch (error) {
      // For a non-idempotent provider operation, an unreadable response is
      // ambiguous. Never convert it into a definitive provider rejection.
      if (error instanceof OutboundRequestTimeoutError) throw error;
      if (result.ok || result.status >= 500 || (result.status >= 300 && result.status < 400) || result.status === 408) {
        throw new Error("Resposta Asaas inconclusiva; aguarde conciliação.");
      }
    }
  }
  // Fail closed for every provider error, including 404. Asaas may return 404
  // when an identifier is not accessible to the API account currently
  // authenticated; that does not prove a recurrence created under another
  // account/environment has stopped generating charges. Reconcile identity
  // with the owning Asaas account before confirming local cancellation.
  if (!result.ok) {
    const errors = Array.isArray(payload["errors"]) ? payload["errors"] : [];
    const firstError = jsonObject(errors[0]);
    console.error("Asaas API request failed:", result.status, typeof firstError["code"] === "string" ? firstError["code"] : "provider_error");
    throw new AsaasApiError(result.status);
  }
  return payload;
}

export function constantTimeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function getBillingSchemaStatus(): Promise<"absent" | "ready" | "partial"> {
  const result = await serviceRest("rpc/ordys_billing_schema_status", {
    method: "POST",
    body: "{}",
  });
  return result === "absent" || result === "ready" ? result : "partial";
}

/** Local release gate: cannot be opened by a database setting or self-declared age. */
export async function assertBillingEnabled(): Promise<void> {
  throw new Error("O serviço de assinaturas ainda não está disponível: age assurance #323 pendente.");
}

export async function isOrdysPlusEligible(_userId: string): Promise<boolean> {
  return false;
}
