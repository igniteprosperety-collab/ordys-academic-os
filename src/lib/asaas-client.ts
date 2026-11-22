import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { AuthRequestTimeoutError } from "@/lib/auth-request-timeout";

export type OrdysAsaasApiPath =
  "/api/asaas/status" | "/api/asaas/checkout" | "/api/asaas/manage" | "/api/asaas/delete-account";

type JsonObject = Record<string, unknown>;

type NativeHttpResult = {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
};

const ALLOWED_PATHS = new Set<OrdysAsaasApiPath>([
  "/api/asaas/status",
  "/api/asaas/checkout",
  "/api/asaas/manage",
  "/api/asaas/delete-account",
]);

const CONNECT_TIMEOUT_MS = 8_000;
const STANDARD_REQUEST_TIMEOUT_MS = 90_000;
const DELETE_REQUEST_TIMEOUT_MS = 115_000;

export class OrdysApiResponseError extends Error {
  readonly context: Response;

  constructor(context: Response) {
    super(`A solicitação ao servidor falhou (HTTP ${context.status}).`);
    this.name = "OrdysApiResponseError";
    this.context = context;
  }
}

/** Matches the existing inconclusive-function handling for a transport failure. */
export class OrdysApiTransportError extends Error {
  constructor() {
    super(
      "Não foi possível confirmar a resposta do servidor. Verifique a conexão antes de tentar novamente.",
    );
    this.name = "FunctionsFetchError";
  }
}

function nativeAppOrigin(): string {
  const raw = import.meta.env["VITE_PUBLIC_APP_URL"]?.trim() ?? "";
  if (!raw) {
    throw new Error("A origem HTTPS do Ordys não foi configurada para esta versão do aplicativo.");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("A origem HTTPS configurada para o Ordys é inválida.");
  }

  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Configure VITE_PUBLIC_APP_URL somente com a origem HTTPS oficial do Ordys.");
  }

  return parsed.origin;
}

function asWebResponse(result: NativeHttpResult): Response {
  if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599) {
    throw new OrdysApiTransportError();
  }

  const headers = new Headers(result.headers ?? {});
  if (!headers.has("Content-Type") && result.data !== null && result.status !== 204) {
    headers.set("Content-Type", "application/json");
  }

  const body =
    result.status === 204 || result.status === 304 || result.data === null
      ? null
      : typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data);

  return new Response(body, { status: result.status, headers });
}

async function withRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      request(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AuthRequestTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function responsePayload(response: Response): Promise<JsonObject> {
  return response
    .clone()
    .json()
    .then((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("O servidor retornou uma resposta inválida.");
      }
      return value as JsonObject;
    });
}

/**
 * Sends authenticated requests only to the allowlisted first-party TanStack
 * routes. Web uses same-origin fetch; native builds use CapacitorHttp and the
 * explicit VITE_PUBLIC_APP_URL origin, with redirects disabled so the Bearer
 * token can never be forwarded to another host.
 */
export async function requestOrdysAsaasApi<T = JsonObject>(
  path: OrdysAsaasApiPath,
  body: JsonObject,
): Promise<T> {
  if (!ALLOWED_PATHS.has(path)) {
    throw new Error("Rota de API não permitida.");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    throw new Error("Sua sessão não está disponível. Entre novamente no ORDYS.");
  }

  const timeoutMs =
    path === "/api/asaas/delete-account" ? DELETE_REQUEST_TIMEOUT_MS : STANDARD_REQUEST_TIMEOUT_MS;

  let response: Response;
  try {
    if (Capacitor.isNativePlatform()) {
      const origin = nativeAppOrigin();
      const result = await withRequestDeadline(async () => {
        const nativeResult = await CapacitorHttp.request({
          url: `${origin}${path}`,
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          data: body,
          connectTimeout: CONNECT_TIMEOUT_MS,
          readTimeout: timeoutMs,
          disableRedirects: true,
          responseType: "json",
        });
        return nativeResult as NativeHttpResult;
      }, timeoutMs);
      response = asWebResponse(result);
    } else {
      response = await withRequestDeadline(
        (signal) =>
          fetch(path, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(body),
            credentials: "same-origin",
            redirect: "manual",
            signal,
          }),
        timeoutMs,
      );
    }
  } catch (error) {
    if (error instanceof AuthRequestTimeoutError) throw error;
    if (error instanceof Error && error.message.startsWith("A origem ")) throw error;
    if (error instanceof Error && error.message.startsWith("Configure VITE_PUBLIC_APP_URL")) {
      throw error;
    }
    throw new OrdysApiTransportError();
  }

  if (!response.ok) {
    throw new OrdysApiResponseError(response);
  }

  return (await responsePayload(response)) as T;
}
