import "@tanstack/react-start/server-only";
import { readRequestBodyWithLimit } from "./request-body["server"]";
import {
  billingCorsHeaders,
  billingResponse,
  constantTimeEqual,
  getServiceRoleKey,
  getSupabaseUrl,
  serviceRestWithDeadline,
} from "./ordys-billing.server";

const WEBHOOK_REQUEST_BODY_TIMEOUT_MS = 1_000;
const WEBHOOK_RECEIPT_DATABASE_DEADLINE_MS = 1_500;

export async function handleWebhook(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: billingCorsHeaders });
  if (request.method !== "POST") return billingResponse({ error: "Método não permitido." }, 405);

  const expectedToken = process.env["ASAAS_WEBHOOK_TOKEN"]?.trim() ?? "";
  const receivedToken = request.headers.get("asaas-access-token") ?? "";
  if (!expectedToken || expectedToken.length < 32 || expectedToken.length > 255 || /\s/.test(expectedToken)) {
    console.error("ORDYS Asaas webhook token is not configured.");
    return billingResponse({ error: "Webhook não configurado." }, 503);
  }
  if (!constantTimeEqual(expectedToken, receivedToken)) {
    return billingResponse({ error: "Não autorizado." }, 401);
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 1_048_576) {
    return billingResponse({ error: "Evento excede o limite permitido." }, 413);
  }

  try {
    const text = await readRequestBodyWithLimit(request, 1_048_576, WEBHOOK_REQUEST_BODY_TIMEOUT_MS);
    if (text === null) {
      return billingResponse({ error: "Evento excede o limite permitido." }, 413);
    }

    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return billingResponse({ error: "Evento inválido." }, 400);
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      return billingResponse({ error: "Evento inválido." }, 400);
    }

    if (typeof payload["id"] !== "string" || !payload["id"] || payload["id"].length > 255 || typeof payload["event"] !== "string" || !payload["event"] || payload["event"].length > 128) {
      return billingResponse({ error: "Evento inválido." }, 400);
    }

    if (!getSupabaseUrl() || !getServiceRoleKey()) {
      console.error("ORDYS Asaas webhook database access is not configured.");
      return billingResponse({ error: "Serviço temporariamente indisponível." }, 503);
    }

    // Never acknowledge a provider event while the durable SQL worker is
    // absent/disabled. A non-200 response allows Asaas to retry delivery.
    let schemaStatus: unknown;
    try {
      schemaStatus = await serviceRestWithDeadline(
        "rpc/ordys_billing_schema_status",
        { method: "POST", body: "{}" },
        WEBHOOK_RECEIPT_DATABASE_DEADLINE_MS,
      );
    } catch {
      return billingResponse({ error: "O processamento financeiro ainda não está disponível." }, 503);
    }
    if (schemaStatus !== "ready") {
      return billingResponse({ error: "O processamento financeiro ainda não está disponível." }, 503);
    }

    // Commit a minimal allowlisted receipt before any billing-state processing.
    // A later processing failure leaves this row visible to Checkout admission.
    const receiptResult = await serviceRestWithDeadline(
      "rpc/ordys_receive_asaas_billing_webhook",
      {
        method: "POST",
        body: JSON.stringify({ p_event: payload }),
      },
      WEBHOOK_RECEIPT_DATABASE_DEADLINE_MS,
    );
    if (!receiptResult || typeof receiptResult !== "object" || Array.isArray(receiptResult)) {
      throw new Error("O recebimento durável do webhook retornou uma resposta inválida.");
    }
    const receipt = receiptResult as Record<string, unknown>;
    const receiptKeys = Object.keys(receipt);
    const receiptStatuses = ["received", "processed", "ignored", "quarantined"];
    if (
      receipt["accepted"] !== true ||
      typeof receipt["processing_status"] !== "string" ||
      !receiptStatuses.includes(receipt["processing_status"]) ||
      typeof receipt["duplicate"] !== "boolean" ||
      typeof receipt["event_id_conflict"] !== "boolean" ||
      receiptKeys.length !== 4 ||
      !receiptKeys.every((key) =>
        ["accepted", "processing_status", "duplicate", "event_id_conflict"].includes(key)
      )
    ) {
      throw new Error("O recebimento durável do webhook não confirmou um estado válido.");
    }

    // A duplicate or quarantined receipt is already durable. Never process a
    // conflicting event ID/payload pair or reopen an already terminal event.
    if (receipt["processing_status"] !== "received") {
      if (receipt["processing_status"] === "quarantined" || receipt["event_id_conflict"] === true) {
        console.error("ORDYS Asaas webhook is durably quarantined; billing access was not granted.");
      }
      return billingResponse({ received: true, queued: false, processed: false }, 200);
    }

    // The durable inbox receipt is the acknowledgement boundary. The scheduled
    // worker applies billing state after this HTTP 200, independently of Asaas.
    return billingResponse({
      received: true,
      queued: receipt["processing_status"] === "received",
      processed: false,
    }, 200);
  } catch (error) {
    console.error(
      "ORDYS Asaas webhook processing failed:",
      error instanceof Error ? error.name : "unknown_error",
    );
    // Non-200 is reserved for failures to validate or durably persist the
    // receipt. Once a valid receipt is committed, business processing happens
    // independently in the scheduled worker.
    return billingResponse({ error: "Não foi possível processar o evento." }, 500);
  }
}
