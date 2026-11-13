export const ORDYS_BILLING_WEBHOOK_PROCESSOR_ERRORS = [
  "ambiguous_customer_association",
  "amount_mismatch",
  "checkout_customer_mismatch",
  "checkout_paid_after_closed",
  "checkout_reference_mismatch",
  "confirmed_payment_unmatched",
  "negative_payment_unmatched",
  "payment_customer_mismatch",
  "payment_identity_mismatch",
  "payment_subscription_unmatched",
  "subscription_amount_mismatch",
  "subscription_checkout_mismatch",
  "subscription_checkout_unmatched",
  "subscription_customer_mismatch",
  "subscription_delete_unmatched",
  "subscription_identity_mismatch",
] as const;

export type OrdysBillingWebhookProcessorError =
  (typeof ORDYS_BILLING_WEBHOOK_PROCESSOR_ERRORS)[number];

const allowedProcessorErrors = new Set<string>(
  ORDYS_BILLING_WEBHOOK_PROCESSOR_ERRORS,
);

export type OrdysBillingWebhookProcessorResult = {
  processed: boolean;
  error?: OrdysBillingWebhookProcessorError;
};

/**
 * Validate the JSONB contract returned by process_ordys_asaas_billing_event.
 * A malformed/empty PostgREST response is not an acknowledgement: the caller
 * must return a non-2xx response so Asaas can retry the original event.
 */
export function parseOrdysBillingWebhookProcessorResult(
  value: unknown,
): OrdysBillingWebhookProcessorResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("O processador de webhooks retornou uma resposta inválida.");
  }

  const result = value as Record<string, unknown>;
  const keys = Object.keys(result);
  if (typeof result.processed !== "boolean") {
    throw new Error("O processador de webhooks não confirmou o estado do evento.");
  }

  if (result.processed) {
    const allowedKeys = ["processed", "event"];
    if (result.ignored_stale_payment_event !== undefined) {
      if (result.ignored_stale_payment_event !== true) {
        throw new Error(
          "O processador de webhooks retornou um marcador de evento ignorado inválido.",
        );
      }
      allowedKeys.push("ignored_stale_payment_event");
    }

    if (
      !keys.every((key) => allowedKeys.includes(key)) ||
      result.duplicate !== undefined ||
      result.error !== undefined ||
      typeof result.event !== "string" ||
      !result.event.trim()
    ) {
      throw new Error("O processador de webhooks não identificou um resultado concluído válido.");
    }
    return { processed: true };
  }

  if (result.duplicate === true) {
    if (
      keys.length !== 2 ||
      !keys.every((key) => key === "processed" || key === "duplicate")
    ) {
      throw new Error("O processador de webhooks retornou uma duplicidade inconsistente.");
    }
    return { processed: false };
  }

  if (
    keys.length === 2 &&
    keys.every((key) => key === "processed" || key === "error") &&
    typeof result.error === "string" &&
    allowedProcessorErrors.has(result.error)
  ) {
    return {
      processed: false,
      error: result.error as OrdysBillingWebhookProcessorError,
    };
  }

  throw new Error("O processador de webhooks não confirmou o resultado do evento.");
}
