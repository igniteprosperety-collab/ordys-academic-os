import { readRequestBodyWithLimit } from "../_shared/request-body.ts";
import { validateRecoveryRedirect } from "../_shared/validate-recovery-redirect.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const MAX_EMAIL_CHARS = 320;
const MAX_REQUEST_BYTES = 16 * 1024;

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, MAX_EMAIL_CHARS + 1) : "";
}

async function canRequestRecovery(supabaseUrl: string, serviceRoleKey: string, email: string) {
  const serviceHeaders: Record<string, string> = serviceRoleKey.startsWith("sb_secret_")
    ? { apikey: serviceRoleKey, "Content-Type": "application/json" }
    : { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };

  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/can_request_password_recovery`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({ p_email: email }),
  });
  if (!result.ok) throw new Error("Não foi possível validar a solicitação.");
  return jsonObject(await result.json().catch(() => ({})));
}

async function sendRecoveryEmail(
  supabaseUrl: string,
  publishableKey: string,
  email: string,
  redirectTo: string,
) {
  const result = await fetch(`${supabaseUrl}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, redirect_to: redirectTo }),
  });
  if (!result.ok) throw new Error("Não foi possível enviar o link de recuperação.");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ status: "failed", error: "Método não permitido." }, 405);

  try {
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return response({ status: "failed", error: "A solicitação excede o limite permitido." }, 413);
    }
    const requestText = await readRequestBodyWithLimit(request, MAX_REQUEST_BYTES);
    if (requestText === null) {
      return response({ status: "failed", error: "A solicitação excede o limite permitido." }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = jsonObject(JSON.parse(requestText));
    } catch {
      return response({ status: "failed", error: "Corpo JSON inválido." }, 400);
    }
    const email = normalizedEmail(body["email"]);
    const redirectTo =
      typeof body["redirectTo"] === "string" ? body["redirectTo"].trim() : "";
    const publicAppUrl = Deno.env.get("ORDYS_PUBLIC_APP_URL")?.trim() ?? "";

    if (email.length > MAX_EMAIL_CHARS) return response({ status: "failed", error: "Informe um e-mail válido." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return response({ status: "failed", error: "Informe um e-mail válido." }, 400);
    if (!validateRecoveryRedirect(request, redirectTo, publicAppUrl)) {
      return response({ status: "failed", error: "Destino de recuperação inválido." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")?.trim();
    const publishableKey = publishableKeysRaw
      ? (() => {
          try {
            const keys = JSON.parse(publishableKeysRaw) as Record<string, unknown>;
            return typeof keys["default"] === "string" ? keys["default"].trim() : "";
          } catch {
            return "";
          }
        })()
      : (Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY"))?.trim();
    const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
    const serviceRoleKey = secretKeysRaw
      ? (() => {
          try {
            const keys = JSON.parse(secretKeysRaw) as Record<string, unknown>;
            return typeof keys["default"] === "string" ? keys["default"].trim() : "";
          } catch {
            return "";
          }
        })()
      : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!supabaseUrl || !publishableKey || !serviceRoleKey) return response({ status: "failed", error: "Serviço de recuperação indisponível." }, 503);

    const guard = await canRequestRecovery(supabaseUrl, serviceRoleKey, email);
    if (guard["allowed"] !== true) {
      if (guard["reason"] === "rate_limited") return response({ status: "rate_limited", error: "Muitas solicitações. Aguarde antes de tentar novamente." }, 429);
      return response({ status: "failed", error: "Não foi possível processar a solicitação." }, 400);
    }

    // Always call Supabase Auth for valid, non-rate-limited requests.
    // Auth intentionally does not reveal account existence; skipping the call
    // for unknown emails would create a measurable timing side channel.
    await sendRecoveryEmail(supabaseUrl, publishableKey, email, redirectTo);

    return response({ status: "completed" });
  } catch (error) {
    console.error("ORDYS password recovery failed:", error instanceof Error ? error.name : "unknown_error");
    return response({ status: "failed", error: "Não foi possível concluir a recuperação agora." }, 502);
  }
});