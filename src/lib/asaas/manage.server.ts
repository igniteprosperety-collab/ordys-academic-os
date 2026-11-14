import "@tanstack/react-start/server-only";
import {
  asaasRequest,
  assertAsaasConfigured,
  billingCorsHeaders,
  billingResponse,
  serviceRest,
  authenticateBillingRequest,
} from "./ordys-billing.server";
import { readRequestBodyWithLimit } from "./request-body["server"]";
import { claimOrdysSubscriptionCancellation } from "./ordys-subscription-cancellation.server";
import { OutboundRequestTimeoutError, withAbortableOutboundRequestTimeout } from "./request-timeout.server";

const MAX_MANAGE_REQUEST_BYTES = 4_096;
const MANAGE_REQUEST_BODY_TIMEOUT_MS = 8_000;
const BILLING_DATABASE_TIMEOUT_MS = 8_000;
const ASAAS_REQUEST_TIMEOUT_MS = 12_000;

export async function handleManage(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: billingCorsHeaders });
  if (request.method !== "POST") return billingResponse({ error: "Método não permitido." }, 405);

  const authentication = await authenticateBillingRequest(
    request,
    "Entre na sua conta para gerenciar a assinatura.",
  );
  if (authentication.response) return authentication.response;
  const user = authentication.user;
  let providerCancellationStarted = false;

  try {
    const boundedServiceRest = (path: string, init: RequestInit = {}) =>
      withAbortableOutboundRequestTimeout(
        (signal) => serviceRest(path, { ...init, signal }),
        BILLING_DATABASE_TIMEOUT_MS,
      );
    const boundedAsaasRequest = (path: string, init: RequestInit = {}) =>
      withAbortableOutboundRequestTimeout(
        (signal) => asaasRequest(path, { ...init, signal }),
        ASAAS_REQUEST_TIMEOUT_MS,
      );

    // Cancellation must remain available even when new subscriptions are disabled.

    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_MANAGE_REQUEST_BYTES) {
      return billingResponse({ error: "Solicitação inválida." }, 413);
    }
    const text = await readRequestBodyWithLimit(request, MAX_MANAGE_REQUEST_BYTES, MANAGE_REQUEST_BODY_TIMEOUT_MS);
    if (text === null) {
      return billingResponse({ error: "Solicitação inválida." }, 413);
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return billingResponse({ error: "Solicitação inválida." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return billingResponse({ error: "Solicitação inválida." }, 400);
    }

    if (body["action"] !== "cancel") {
      return billingResponse({ error: "Ação não permitida." }, 400);
    }

    const rows = await boundedServiceRest(
      `ordys_billing_subscriptions?select=id,provider_subscription_id,provider_status,current_period_end,cancellation_requested_at,cancellation_claim_id,cancellation_confirmed_at&user_id=eq.${encodeURIComponent(user.id)}&status=in.(pending,active,past_due,suspended,cancelled)&order=created_at.desc&limit=1`,
    ) as Array<Record<string, unknown>> | null;
    const subscription = rows?.[0];
    const providerSubscriptionId =
      typeof subscription?.["provider_subscription_id"] === "string"
        ? subscription["provider_subscription_id"]
        : "";
    const localId = typeof subscription?.["id"] === "string" ? subscription["id"] : "";
    const accessUntil = typeof subscription?.["current_period_end"] === "string"
      ? subscription["current_period_end"]
      : null;

    if (!subscription || !providerSubscriptionId || !localId) {
      return billingResponse({
        error: "Não encontramos uma assinatura ativa para cancelar.",
        code: "subscription_not_found",
      }, 404);
    }

    const successResponse = () => billingResponse({ cancelled: true, accessUntil });
    const confirmLocalCancellation = async (requestedAt: string | null) => {
      const confirmation = await boundedServiceRest("rpc/ordys_confirm_subscription_cancellation", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_subscription_id: localId,
          p_cancellation_requested_at: requestedAt,
        }),
      });
      if (confirmation !== "confirmed" && confirmation !== "already_confirmed") {
        throw new Error("O Asaas já confirmou o cancelamento, mas não foi possível reconciliar o Checkout vinculado. Não repita a solicitação; procure a conciliação da assinatura.");
      }
    };

    // A provider-confirmed cancellation is idempotent, including for accounts
    // whose chargeback restriction intentionally keeps local status suspended.
    // Re-run the local transaction when the intent marker exists so a record
    // written by an older release also closes its linked Checkout attempt.
    if (typeof subscription["cancellation_confirmed_at"] === "string") {
      const requestedAt = typeof subscription["cancellation_requested_at"] === "string"
        ? subscription["cancellation_requested_at"]
        : null;
      await confirmLocalCancellation(requestedAt);
      return successResponse();
    }
    if (subscription["provider_status"] === "DELETED") {
      await confirmLocalCancellation(null);
      return successResponse();
    }
    if (typeof subscription["cancellation_requested_at"] === "string") {
      return billingResponse({
        error: "O cancelamento desta assinatura já foi solicitado e aguarda confirmação do Asaas. Não envie outra solicitação.",
        code: "subscription_cancellation_processing",
      }, 409);
    }

    // Detect missing credentials or an invalid environment before persisting
    // the one-shot claim. Failures after the request may have started remain
    // ambiguous and keep the claim locked.
    assertAsaasConfigured();

    // Claim the one-time provider DELETE with a UUID. If PostgREST commits
    // the intent but loses its response, only this invocation may continue
    // after reading back its own token; concurrent requests remain blocked.
    const claim = await claimOrdysSubscriptionCancellation(user.id, localId, boundedServiceRest);
    if (claim.status === "confirmed") {
      await confirmLocalCancellation(claim.cancellationRequestedAt);
      return successResponse();
    }
    if (claim.status === "already_claimed") {
      return billingResponse({
        error: "Outra solicitação de cancelamento já está em andamento. Aguarde a confirmação do Asaas.",
        code: "subscription_cancellation_processing",
      }, 409);
    }

    // Asaas cancels future recurring charges. Payments already confirmed remain
    // valid, so current_period_end is intentionally preserved in our database.
    providerCancellationStarted = true;
    await boundedAsaasRequest(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, {
      method: "DELETE",
    });

    // The SQL RPC evaluates the current row state, retaining "suspended" if a
    // refund/chargeback webhook arrived while the provider request was in flight.
    await confirmLocalCancellation(claim.cancellationRequestedAt);

    return successResponse();
  } catch (error) {
    console.error(
      "ORDYS billing cancellation failed:",
      error instanceof Error ? error.name : "unknown_error",
    );
    if (error instanceof OutboundRequestTimeoutError && providerCancellationStarted) {
      return billingResponse({
        error: "O Asaas pode ter recebido o pedido de cancelamento, mas a confirmação não chegou. Mantivemos a assinatura em conciliação. Não tente cancelar novamente agora.",
        code: "subscription_cancellation_processing",
      }, 409);
    }
    if (error instanceof OutboundRequestTimeoutError) {
      return billingResponse({
        error: "Não foi possível confirmar o estado da solicitação de cancelamento. Aguarde a atualização antes de tentar novamente.",
        code: "billing_service_timeout",
      }, 503);
    }
    return billingResponse({
      error: error instanceof Error ? error.message : "Não foi possível cancelar a assinatura.",
    }, 502);
  }
}
