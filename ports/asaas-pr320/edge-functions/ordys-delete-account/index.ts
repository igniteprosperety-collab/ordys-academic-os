import { asaasRequest, assertAsaasConfigured, serviceRest } from "../_shared/ordys-billing.ts";
import {
  createOutboundRequestDeadline,
  fetchWithOutboundTimeout,
  OutboundRequestTimeoutError,
  responseJsonWithOutboundTimeout,
  withAbortableOutboundRequestTimeout,
} from "../_shared/request-timeout.ts";
import {
  AccountDeletionProcessingError,
  BillingCancellationPendingError,
  CheckoutCreationInProgressError,
  cancelOrdysBillingBeforeAccountDeletion,
  releaseOrdysAccountDeletionProcessing,
} from "../_shared/ordys-delete-account-billing.ts";

const AUTH_USER_TIMEOUT_MS = 8_000;
const AUTH_USER_BODY_TIMEOUT_MS = 3_000;
const BILLING_DATABASE_TIMEOUT_MS = 8_000;
const ASAAS_REQUEST_TIMEOUT_MS = 12_000;
const ACCOUNT_DATA_DELETE_TIMEOUT_MS = 15_000;
const AUTH_ADMIN_DELETE_TIMEOUT_MS = 15_000;
const ACCOUNT_DELETION_MAX_DURATION_MS = 100_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function getBillingSchemaStatus(signal: AbortSignal): Promise<string> {
  const status = await serviceRest("rpc/ordys_billing_core_schema_status", {
    method: "POST",
    body: "{}",
    signal,
  });
  if (typeof status !== "string") {
    throw new Error("Não foi possível confirmar a estrutura de assinaturas. Nenhum dado foi apagado.");
  }
  return status;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return response({ error: "Sessão inválida." }, 401);

  try {
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

    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      return response({ error: "Serviço de exclusão indisponível." }, 503);
    }

    let userResult: Response;
    try {
      userResult = await fetchWithOutboundTimeout(
        `${supabaseUrl}/auth/v1/user`,
        {
          method: "GET",
          headers: { apikey: publishableKey, Authorization: authorization },
        },
        AUTH_USER_TIMEOUT_MS,
      );
    } catch {
      return response({ error: "Não foi possível validar sua sessão agora. Tente novamente." }, 503);
    }

    if (userResult.status === 401 || userResult.status === 403) {
      return response({ error: "Sessão inválida." }, 401);
    }
    if (!userResult.ok) {
      return response({ error: "O serviço de autenticação está indisponível. Nenhum dado foi apagado." }, 503);
    }

    let user: Record<string, unknown>;
    try {
      user = jsonObject(
        await responseJsonWithOutboundTimeout<unknown>(
          userResult,
          AUTH_USER_BODY_TIMEOUT_MS,
        ),
      );
    } catch {
      return response({ error: "Não foi possível validar sua sessão. Nenhum dado foi apagado." }, 503);
    }
    const userId = typeof user["id"] === "string" ? user["id"] : "";
    if (!userId) {
      return response({ error: "Não foi possível validar sua sessão. Nenhum dado foi apagado." }, 503);
    }

    // The request gateway's idle timeout is 150 seconds. Leave room for the
    // 8s+3s Auth validation and an 8s lease release by capping the destructive
    // phase at 100 seconds. The 10-minute database lease still outlasts a
    // terminated Edge worker, preventing overlapping provider operations.
    const requestTimeoutWithinLease = createOutboundRequestDeadline(
      ACCOUNT_DELETION_MAX_DURATION_MS,
    );
    const boundedServiceRest = (path: string, init: RequestInit = {}) =>
      withAbortableOutboundRequestTimeout(
        (signal) => serviceRest(path, { ...init, signal }),
        path === "rpc/ordys_release_account_deletion_processing"
          ? BILLING_DATABASE_TIMEOUT_MS
          : requestTimeoutWithinLease(BILLING_DATABASE_TIMEOUT_MS),
      );
    const boundedAsaasRequest = (path: string, init: RequestInit = {}) =>
      withAbortableOutboundRequestTimeout(
        (signal) => asaasRequest(path, { ...init, signal }),
        requestTimeoutWithinLease(ASAAS_REQUEST_TIMEOUT_MS),
      );
    const boundedBillingSchemaStatus = () =>
      withAbortableOutboundRequestTimeout(
        (signal) => getBillingSchemaStatus(signal),
        requestTimeoutWithinLease(BILLING_DATABASE_TIMEOUT_MS),
      );

    // Hold one processing lease through billing cancellation and destructive cleanup.
    let processingToken: string | null = null;
    try {
      processingToken = await cancelOrdysBillingBeforeAccountDeletion(userId, {
        getBillingSchemaStatus: boundedBillingSchemaStatus,
        serviceRest: boundedServiceRest,
        asaasRequest: boundedAsaasRequest,
        assertAsaasConfigured,
      });
    } catch (error) {
      if (error instanceof CheckoutCreationInProgressError) {
        return response({ error: error.message, code: "checkout_creation_in_progress" }, 409);
      }
      if (error instanceof AccountDeletionProcessingError) {
        return response({ error: error.message, code: "account_deletion_in_progress" }, 409);
      }
      if (error instanceof BillingCancellationPendingError) {
        return response({ error: error.message, code: error.code }, 409);
      }
      console.error(
        "ORDYS account deletion blocked by billing cancellation:",
        error instanceof Error ? error.name : "unknown_error",
      );
      return response({
        error: error instanceof OutboundRequestTimeoutError
          ? "Não foi possível confirmar o estado das cobranças agora. Nenhum dado foi apagado. Tente novamente após a conciliação."
          : error instanceof Error
            ? error.message
            : "Não foi possível cancelar as cobranças da conta. Nenhum dado foi apagado.",
      }, 502);
    }

    try {
      let clearResult: Response;
      try {
        clearResult = await fetchWithOutboundTimeout(
          `${supabaseUrl}/rest/v1/rpc/delete_own_data`,
          {
            method: "POST",
            headers: {
              apikey: publishableKey,
              Authorization: authorization,
              "Content-Type": "application/json",
            },
            body: "{}",
          },
          requestTimeoutWithinLease(ACCOUNT_DATA_DELETE_TIMEOUT_MS),
        );
      } catch {
        return response({
          error: "Não foi possível confirmar a remoção dos dados. A solicitação pode ter sido concluída; verifique o acesso antes de repetir.",
          code: "account_data_deletion_unconfirmed",
        }, 502);
      }
      if (!clearResult.ok) {
        return response({ error: "Não foi possível excluir os dados da conta." }, 502);
      }

      let deleteResult: Response;
      try {
        deleteResult = await fetchWithOutboundTimeout(
          `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
          {
            method: "DELETE",
            headers: serviceRoleKey.startsWith("sb_secret_")
              ? { apikey: serviceRoleKey }
              : { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
          },
          requestTimeoutWithinLease(AUTH_ADMIN_DELETE_TIMEOUT_MS),
        );
      } catch {
        return response({
          error: "Os dados do Ordys foram removidos, mas não foi possível confirmar se a conta de acesso foi excluída. Encerre a sessão e verifique o acesso antes de solicitar outra exclusão.",
          code: "auth_identity_deletion_unconfirmed",
        }, 502);
      }
      if (!deleteResult.ok) {
        return response({
          error: "Os dados do Ordys foram removidos, mas o Supabase não confirmou a exclusão da conta de acesso. Encerre a sessão e verifique o acesso antes de solicitar outra exclusão.",
          code: "auth_identity_deletion_unconfirmed",
        }, 502);
      }
      return response({ deleted: true });
    } finally {
      if (processingToken) {
        await releaseOrdysAccountDeletionProcessing(userId, processingToken, boundedServiceRest)
          .catch((error) => {
            console.error(
              "ORDYS account deletion processing lease release failed:",
              error instanceof Error ? error.name : "unknown_error",
            );
          });
      }
    }
  } catch (error) {
    console.error("ORDYS account deletion failed:", error instanceof Error ? error.name : "unknown_error");
    return response({ error: "Não foi possível concluir a exclusão da conta." }, 500);
  }
});
