import { readRequestBodyWithLimit } from "../_shared/request-body.ts";
import {
  AI_CONTENT_REPORT_LIMITS,
  parseAiContentReport,
  type AiContentReport,
} from "../_shared/ai-content-report.ts";

const AUTH_USER_PATH = "/auth/v1/user";
const REPORT_RPC_PATH = "/rest/v1/rpc/insert_ai_content_report";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readDefaultKey(raw: string | undefined) {
  if (!raw?.trim()) return "";
  try {
    const keys = JSON.parse(raw) as Record<string, unknown>;
    return typeof keys["default"] === "string" ? keys["default"].trim() : "";
  } catch {
    return "";
  }
}

function serviceHeaders(serviceKey: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    apikey: serviceKey,
    "Content-Type": "application/json",
    ...extra,
  };
  // New sb_secret_* keys are opaque API keys, not JWTs. Do not send them
  // through Authorization: Bearer, which would trigger JWT parsing.
  if (!serviceKey.startsWith("sb_secret_")) {
    headers["Authorization"] = `Bearer ${serviceKey}`;
  }
  return headers;
}

async function authenticateUser(request: Request, supabaseUrl: string, publishableKey: string) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;

  const result = await fetch(`${supabaseUrl}${AUTH_USER_PATH}`, {
    method: "GET",
    headers: {
      apikey: publishableKey,
      Authorization: authorization,
    },
  });
  if (result.status === 401 || result.status === 403) return null;
  if (!result.ok) throw new Error("Supabase Auth is temporarily unavailable.");

  const user = jsonObject(await result.json().catch(() => ({})));
  if (typeof user["id"] !== "string") {
    throw new Error("Supabase Auth returned an invalid user response.");
  }
  return user["id"];
}

async function storeReport(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  report: AiContentReport,
) {
  const result = await fetch(`${supabaseUrl}${REPORT_RPC_PATH}`, {
    method: "POST",
    headers: serviceHeaders(serviceKey),
    body: JSON.stringify({
      p_user_id: userId,
      p_source: report.source,
      p_reason: report.reason,
      p_content: report.content,
      p_details: report.details,
    }),
  });
  if (!result.ok) throw new Error("Could not store the report.");
  return (await result.text()).trim() !== "null";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response({ status: "failed", error: "Método não permitido." }, 405);
  }

  try {
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > AI_CONTENT_REPORT_LIMITS.requestBytes) {
      return response({ status: "failed", error: "O relato excede o limite permitido." }, 413);
    }

    const requestText = await readRequestBodyWithLimit(request, AI_CONTENT_REPORT_LIMITS.requestBytes);
    if (requestText === null) {
      return response({ status: "failed", error: "O relato excede o limite permitido." }, 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(requestText);
    } catch {
      return response({ status: "failed", error: "Solicitação inválida." }, 400);
    }

    const parsed = parseAiContentReport(body);
    if (!parsed.ok) {
      return response({ status: "failed", error: "Confira o conteúdo e o motivo do relato." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim().replace(/\/+$/, "");
    const publishableKey = readDefaultKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) ||
      (Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
    const serviceKey = readDefaultKey(Deno.env.get("SUPABASE_SECRET_KEYS")) ||
      (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return response({ status: "failed", error: "O envio de relatos está indisponível no momento." }, 503);
    }

    let userId: string | null;
    try {
      userId = await authenticateUser(request, supabaseUrl, publishableKey);
    } catch {
      return response({
        status: "failed",
        error: "Não foi possível validar sua sessão agora. Tente novamente.",
      }, 503);
    }
    if (!userId) {
      return response({ status: "failed", error: "Entre novamente na sua conta para enviar o relato." }, 401);
    }

    const stored = await storeReport(supabaseUrl, serviceKey, userId, parsed.report);
    if (!stored) {
      return response({ status: "rate_limited", error: "Você atingiu o limite de relatos. Tente novamente mais tarde." }, 429);
    }
    return response({ status: "received" });
  } catch (error) {
    // Intentionally do not log request body, message content, or account identifiers.
    console.error("ORDYS AI content report failed:", error instanceof Error ? error.name : "unknown_error");
    return response({ status: "failed", error: "Não foi possível enviar o relato agora. Tente novamente." }, 502);
  }
});
