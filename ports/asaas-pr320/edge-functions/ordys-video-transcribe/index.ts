import { readRequestBodyWithLimit } from "../_shared/request-body.ts";
import { calculateAgeInTimeZone, getUserAgeProfile, isOrdysPlusEligible } from "../_shared/ordys-billing.ts";
import { ORDYS_PLUS_AI_ENABLED, ORDYS_PLUS_LOCK_MESSAGE } from "../_shared/ordys-ai-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENAI_TRANSCRIPT_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 34 * 1024 * 1024;
const MAX_REQUEST_BYTES = 36 * 1024 * 1024;
const SUPPORTED_VIDEO_TRANSCRIPTION_FORMATS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
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

function stringValue(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function consumeUsageLimit(_request: Request, userId: string, kind: string, hourlyLimit: number, dailyLimit: number) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
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

  if (!supabaseUrl || !serviceRoleKey) throw new Error("Limite de uso não configurado no servidor.");

  const serviceHeaders: Record<string, string> = serviceRoleKey.startsWith("sb_secret_")
    ? { apikey: serviceRoleKey }
    : { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };

  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_usage_limit`, {
    method: "POST",
    headers: { ...serviceHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ p_user_id: userId, p_kind: kind, p_hourly_limit: hourlyLimit, p_daily_limit: dailyLimit }),
  });
  if (!result.ok) {
    console.error("Supabase usage-limit request failed:", result.status);
    throw new Error("Não foi possível validar o limite de uso.");
  }
  const payload = jsonObject(await result.json().catch(() => ({})));
  if (payload["allowed"] !== true) throw new Error("Limite de uso atingido. Aguarde antes de tentar novamente.");
}

async function validateUser(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")?.trim();
  const supabaseKey = publishableKeysRaw
    ? (() => {
        try {
          const keys = JSON.parse(publishableKeysRaw) as Record<string, unknown>;
          return typeof keys["default"] === "string" ? keys["default"].trim() : "";
        } catch {
          return "";
        }
      })()
    : (Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY"))?.trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Configuração de autenticação indisponível no servidor.");
  }
  const result = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseKey, Authorization: authorization },
  });
  if (result.status === 401 || result.status === 403) return null;
  if (!result.ok) throw new Error("O serviço de autenticação não respondeu corretamente.");
  const user = jsonObject(await result.json().catch(() => ({})));
  if (typeof user["id"] !== "string") throw new Error("Resposta inválida do serviço de autenticação.");
  return user["id"];
}

async function assertAiEligible(request: Request, userId: string) {
  const ageProfile = await getUserAgeProfile(
    userId,
    request.headers.get("Authorization") ?? "",
  );
  const age = calculateAgeInTimeZone(ageProfile.birthDate, ageProfile.timezone);
  if (age === null || age < 18) {
    throw new Error("Os recursos de IA que usam a OpenAI estão disponíveis apenas para contas com 18 anos ou mais.");
  }
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/);
  if (!match) throw new Error("Conteúdo do vídeo inválido.");
  if (dataUrl.length > MAX_DATA_URL_CHARS) throw new Error("O vídeo excede o limite para transcrição.");

  const mimeType = (match[1] || "").toLowerCase();
  if (!Object.hasOwn(SUPPORTED_VIDEO_TRANSCRIPTION_FORMATS, mimeType)) {
    throw new Error("A transcrição de áudio aceita apenas vídeos MP4 ou WebM.");
  }

  const payload = match[2] || "";
  if (!dataUrl.includes(";base64,")) throw new Error("O vídeo precisa ser enviado em base64.");

  const binary = atob(payload);
  if (binary.length > MAX_BYTES) throw new Error("O vídeo excede o limite de 24 MB para transcrição.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, mimeType };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ status: "failed", error: "Método não permitido." }, 405);

  let userId: string | null;
  try {
    userId = await validateUser(request);
  } catch {
    return response({ status: "failed", error: "Não foi possível validar sua sessão agora. Tente novamente." }, 503);
  }
  if (!userId) return response({ status: "failed", error: "Sessão inválida." }, 401);

  try {
    await assertAiEligible(request, userId);
    if (!ORDYS_PLUS_AI_ENABLED) {
      return response({ status: "failed", error: ORDYS_PLUS_LOCK_MESSAGE }, 402);
    }
    const plusEligible = await isOrdysPlusEligible(userId);
    if (!plusEligible) {
      return response({ status: "failed", error: ORDYS_PLUS_LOCK_MESSAGE }, 402);
    }
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return response({ status: "failed", error: "A solicitação de transcrição excede o limite permitido." }, 413);
    }
    const requestText = await readRequestBodyWithLimit(request, MAX_REQUEST_BYTES);
    if (requestText === null) {
      return response({ status: "failed", error: "A solicitação de transcrição excede o limite permitido." }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = jsonObject(JSON.parse(requestText));
    } catch {
      return response({ status: "failed", error: "Corpo JSON inválido." }, 400);
    }
    const dataUrl = typeof body["dataUrl"] === "string" ? body["dataUrl"].trim() : "";
    if (!dataUrl.startsWith("data:")) return response({ status: "failed", error: "Envie um vídeo válido." }, 400);
    if (dataUrl.length > MAX_DATA_URL_CHARS) {
      return response({ status: "failed", error: "O vídeo excede o limite para transcrição." }, 413);
    }

    const rawFilename = stringValue(body["filename"], 180);
    const filename = rawFilename.split(/[\\/]/).pop() || "video.mp4";
    const declaredMime = stringValue(body["mimeType"], 120).toLowerCase();
    const headerMatch = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,/);
    const declaredDataUrlMime = (headerMatch?.[1] || "").toLowerCase();
    const supportedExtension = SUPPORTED_VIDEO_TRANSCRIPTION_FORMATS[declaredDataUrlMime];
    const actualExtension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

    if (!supportedExtension || declaredMime !== declaredDataUrlMime || actualExtension !== supportedExtension) {
      return response({
        status: "failed",
        error: "A transcrição de áudio aceita apenas arquivos MP4 ou WebM com tipo e extensão correspondentes. Outros vídeos continuam disponíveis para análise visual.",
      }, 415);
    }

    const { bytes, mimeType } = decodeDataUrl(dataUrl);
    const file = new File([bytes], filename, { type: mimeType });
    const form = new FormData();
    form.append("file", file);
    form.append("model", "gpt-transcribe");
    form.append("response_format", "json");
    form.append("languages[]", "pt");

    const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
    if (!apiKey) throw new Error("O serviço de transcrição está indisponível no momento.");

    // Validate the file and runtime configuration before consuming the user's quota.
    await consumeUsageLimit(request, userId, "video-transcription", 5, 20);
    let result: Response;
    try {
      result = await fetch(OPENAI_TRANSCRIPT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch {
      throw new Error("O serviço de transcrição está temporariamente indisponível. Tente novamente.");
    }
    const payload = jsonObject(await result.json().catch(() => ({})));
    if (!result.ok) {
      throw new Error("O serviço de transcrição não conseguiu processar o áudio. Tente novamente.");
    }

    const transcript = stringValue(payload["text"], 120_000);
    return response({ status: "completed", transcript });
  } catch (error) {
    return response({ status: "failed", error: error instanceof Error ? error.message : "Não foi possível transcrever o vídeo." }, 502);
  }
});
