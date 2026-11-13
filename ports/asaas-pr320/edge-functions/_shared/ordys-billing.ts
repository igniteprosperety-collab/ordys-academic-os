import {
  createOutboundRequestDeadline,
  fetchWithOutboundTimeout,
  OutboundRequestTimeoutError,
  responseJsonWithOutboundTimeout,
} from "./request-timeout.ts";

const SUPABASE_REQUEST_TIMEOUT_MS = 8_000;
const SUPABASE_RESPONSE_BODY_TIMEOUT_MS = 3_000;
const ASAAS_REQUEST_TIMEOUT_MS = 12_000;
const ASAAS_RESPONSE_BODY_TIMEOUT_MS = 5_000;

export const billingCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  return Deno.env.get("SUPABASE_URL")?.trim() ?? "";
}

export function getPublishableKey() {
  const keysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")?.trim();
  if (keysRaw) {
    try {
      const keys = JSON.parse(keysRaw) as Record<string, unknown>;
      return typeof keys["default"] === "string" ? keys["default"].trim() : "";
    } catch {
      return "";
    }
  }
  return (Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY"))?.trim() ?? "";
}

export function getServiceRoleKey() {
  const keysRaw = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (keysRaw) {
    try {
      const keys = JSON.parse(keysRaw) as Record<string, unknown>;
      return typeof keys["default"] === "string" ? keys["default"].trim() : "";
    } catch {
      return "";
    }
  }
  return (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
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
  const requestInit = { ...init, headers };
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

export type BillingAgeProfile = {
  birthDate: string | null;
  timezone: string | null;
};

export async function getUserAgeProfile(userId: string, authorization: string): Promise<BillingAgeProfile> {
  const supabaseUrl = getSupabaseUrl();
  const publishableKey = getPublishableKey();
  if (!supabaseUrl || !publishableKey) throw new Error("Não foi possível validar o perfil.");

  const query = new URLSearchParams({
    select: "birth_date,timezone",
    id: `eq.${userId}`,
    limit: "1",
  });
  const result = await fetchWithOutboundTimeout(
    `${supabaseUrl}/rest/v1/profiles?${query.toString()}`,
    { headers: { apikey: publishableKey, Authorization: authorization } },
    SUPABASE_REQUEST_TIMEOUT_MS,
  );
  if (!result.ok) throw new Error("Não foi possível validar a idade da conta.");
  let payload: unknown;
  try {
    payload = await responseJsonWithOutboundTimeout<unknown>(
      result,
      SUPABASE_RESPONSE_BODY_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof OutboundRequestTimeoutError) throw error;
    payload = [];
  }
  const rows = Array.isArray(payload) ? payload : [];
  const row = jsonObject(rows[0]);
  return {
    birthDate: typeof row["birth_date"] === "string" ? row["birth_date"] : null,
    timezone: typeof row["timezone"] === "string" ? row["timezone"] : null,
  };
}

// Compatibility helper for callers that only need the date field.
export async function getUserBirthDate(userId: string, authorization: string) {
  return (await getUserAgeProfile(userId, authorization)).birthDate;
}

function calculateAgeOnCalendarDate(
  birthDate: string | null,
  currentYear: number,
  currentMonth: number,
  currentDay: number,
) {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  if (
    !Number.isInteger(currentYear) ||
    !Number.isInteger(currentMonth) ||
    !Number.isInteger(currentDay) ||
    currentMonth < 1 ||
    currentMonth > 12 ||
    currentDay < 1 ||
    currentDay > 31
  ) return null;

  const year = Number(birthDate.slice(0, 4));
  const month = Number(birthDate.slice(5, 7));
  const day = Number(birthDate.slice(8, 10));
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) return null;

  let age = currentYear - year;
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

export function calculateAge(birthDate: string | null, today = new Date()) {
  if (!(today instanceof Date) || !Number.isFinite(today.getTime())) return null;
  return calculateAgeOnCalendarDate(
    birthDate,
    today.getFullYear(),
    today.getMonth() + 1,
    today.getDate(),
  );
}

/**
 * Calculate legal age using the civil date in the profile's IANA time zone.
 * Missing or invalid time zones fail closed instead of falling back to server time.
 */
export function calculateAgeInTimeZone(
  birthDate: string | null,
  timezone: string | null,
  now = new Date(),
) {
  if (
    typeof timezone !== "string" ||
    !timezone.trim() ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) return null;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  } catch {
    return null;
  }

  const values = new Map(parts.map((part) => [part.type, part.value]));
  return calculateAgeOnCalendarDate(
    birthDate,
    Number(values.get("year")),
    Number(values.get("month")),
    Number(values.get("day")),
  );
}

export function getAsaasApiBase() {
  const environment = Deno.env.get("ASAAS_ENVIRONMENT")?.trim().toLowerCase() ?? "";
  if (environment === "production") return "https://api.asaas.com/v3";
  if (environment === "sandbox") return "https://api-sandbox.asaas.com/v3";
  throw new Error("ASAAS_ENVIRONMENT deve ser configurado explicitamente como sandbox ou production.");
}

/**
 * Validate deterministic provider configuration before persisting a
 * one-shot cancellation claim. Once fetch may have started, keep the claim
 * on timeout/network failure because the provider may have accepted it.
 */
export function assertAsaasConfigured() {
  if (!Deno.env.get("ASAAS_API_KEY")?.trim()) {
    throw new Error("O provedor de pagamentos ainda não está configurado.");
  }
  const environment = Deno.env.get("ASAAS_ENVIRONMENT")?.trim().toLowerCase();
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("ASAAS_ENVIRONMENT deve ser configurado explicitamente como sandbox ou production.");
  }
  getAsaasApiBase();
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
  const apiKey = Deno.env.get("ASAAS_API_KEY")?.trim();
  if (!apiKey) throw new Error("O provedor de pagamentos ainda não está configurado.");

  const headers = new Headers({
    access_token: apiKey,
    accept: "application/json",
    "User-Agent": "OrdysAcademy/1.0",
  });
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  const url = `${getAsaasApiBase()}${path}`;
  // A parent billing/deletion lease owns the deadline when it supplies a signal.
  // Otherwise bound the provider request locally.
  const requestInit = { ...init, headers };
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

export async function assertBillingEnabled() {
  const schemaStatus = await getBillingSchemaStatus();
  if (schemaStatus !== "ready") {
    throw new Error("O serviço de assinaturas ainda não está disponível para novas contratações.");
  }

  const rows = await serviceRest("ordys_billing_settings?select=billing_enabled&id=eq.1&limit=1") as Array<Record<string, unknown>> | null;
  if (rows?.[0]?.["billing_enabled"] !== true) {
    throw new Error("As assinaturas do Ordys ainda não foram liberadas.");
  }
}


const SUBSCRIPTION_ELIGIBILITY_REQUEST_TIMEOUT_MS = 8_000;
const SUBSCRIPTION_ELIGIBILITY_BODY_TIMEOUT_MS = 3_000;

export async function isOrdysPlusEligible(userId: string) {
  // A paid entitlement is not safe while durable webhook processing is offline:
  // refunds/chargebacks could otherwise remain queued while Plus access persists.
  if (await getBillingSchemaStatus() !== "ready") return false;

  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("Billing database access is not configured.");

  let result: Response;
  try {
    result = await fetchWithOutboundTimeout(
      supabaseUrl + "/rest/v1/rpc/is_ordys_plus_eligible",
      {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ p_user_id: userId }),
      },
      SUBSCRIPTION_ELIGIBILITY_REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new Error("Não foi possível validar a assinatura desta conta agora. Tente novamente.");
  }
  if (!result.ok) {
    console.error("ORDYS subscription entitlement check failed:", result.status);
    throw new Error("Não foi possível validar a assinatura desta conta.");
  }

  try {
    return await responseJsonWithOutboundTimeout<unknown>(
      result,
      SUBSCRIPTION_ELIGIBILITY_BODY_TIMEOUT_MS,
    ) === true;
  } catch {
    throw new Error("A validação da assinatura não foi concluída. Tente novamente.");
  }
}
