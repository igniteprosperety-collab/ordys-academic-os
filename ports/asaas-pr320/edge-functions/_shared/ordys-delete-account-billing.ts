import { claimOrdysCheckoutCancellation } from "./ordys-checkout-cancellation.ts";
import type { CheckoutCancellationClaim } from "./ordys-checkout-cancellation.ts";
import { claimOrdysSubscriptionCancellation } from "./ordys-subscription-cancellation.ts";

export type BillingSchemaStatus = "absent" | "ready" | "partial";

type JsonRecord = Record<string, unknown>;
type ServiceRest = (path: string, init?: RequestInit) => Promise<unknown>;
type AsaasRequest = (path: string, init?: RequestInit) => Promise<unknown>;

export type BillingCancellationPendingCode =
  | "checkout_cancellation_processing"
  | "billing_cancellation_processing"
  | "billing_reconciliation_required";

export class BillingCancellationPendingError extends Error {
  constructor(
    message: string,
    readonly code: BillingCancellationPendingCode = "billing_cancellation_processing",
  ) {
    super(message);
    this.name = "BillingCancellationPendingError";
  }
}

export class CheckoutCreationInProgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutCreationInProgressError";
  }
}

export class AccountDeletionProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionProcessingError";
  }
}

function jsonObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export async function cancelOrdysBillingBeforeAccountDeletion(
  userId: string,
  dependencies: {
    getBillingSchemaStatus: () => Promise<string>;
    serviceRest: ServiceRest;
    asaasRequest: AsaasRequest;
    assertAsaasConfigured: () => void;
  },
): Promise<string | null> {
  const schemaStatus = await dependencies.getBillingSchemaStatus();

  // Billing is an optional, disabled feature in the free core release. If none
  // of its tables exist, no ORDYS checkout or subscription can have been
  // created through this application, so account deletion may proceed.
  if (schemaStatus === "absent") return null;

  // A partially installed schema or an unexpected status must fail closed.
  if (schemaStatus !== "ready") {
    throw new Error("A estrutura de assinaturas está incompleta. Nenhum dado foi apagado.");
  }

  // This RPC shares the same PostgreSQL advisory transaction lock as checkout
  // creation. It refuses to reserve deletion while an Asaas request may still
  // be in flight, and remains reserved across provider-cancellation retries.
  const reservationStatus = await dependencies.serviceRest("rpc/ordys_reserve_account_deletion", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId }),
  });
  if (reservationStatus === "checkout_creation_in_progress") {
    throw new CheckoutCreationInProgressError(
      "Uma contratação ainda está sendo iniciada. Aguarde a conclusão ou reconciliação e tente excluir a conta novamente. Nenhum dado foi apagado.",
    );
  }
  if (reservationStatus !== "reserved") {
    throw new Error("Não foi possível reservar a exclusão da conta com segurança. Nenhum dado foi apagado.");
  }

  const processingToken = crypto.randomUUID();
  const processingStatus = await dependencies.serviceRest("rpc/ordys_claim_account_deletion_processing", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId, p_processing_token: processingToken }),
  });
  if (processingStatus === "deletion_processing") {
    throw new AccountDeletionProcessingError(
      "A exclusão desta conta já está sendo processada. Aguarde a conclusão antes de tentar novamente. Nenhum dado foi apagado.",
    );
  }
  if (processingStatus !== "claimed") {
    throw new Error("Não foi possível obter o bloqueio de exclusão da conta. Nenhum dado foi apagado.");
  }

  let completed = false;
  try {
    const [attemptResult, subscriptionResult] = await Promise.all([
      dependencies.serviceRest(
        `ordys_billing_checkout_attempts?select=id,status,provider_checkout_id,cancellation_requested_at,cancellation_claim_id&user_id=eq.${encodeURIComponent(userId)}&status=in.(creating,pending,paid,linked)`,
      ),
      dependencies.serviceRest(
        `ordys_billing_subscriptions?select=id,status,checkout_attempt_id,provider_subscription_id,provider_status,cancellation_requested_at,cancellation_claim_id,cancellation_confirmed_at&user_id=eq.${encodeURIComponent(userId)}`,
      ),
    ]);

    // Do not turn an unexpected response into an empty account-billing history.
    if (!Array.isArray(attemptResult) || !Array.isArray(subscriptionResult)) {
      throw new Error("Não foi possível confirmar as cobranças desta conta. Nenhum dado foi apagado.");
    }

    const attempts = attemptResult.map(jsonObject);
    const subscriptions = subscriptionResult.map(jsonObject);
    let checkoutCancellationRequested = false;
    let subscriptionCancellationRequested = false;
    let billingReconciliationRequired = false;

    const confirmLocalSubscriptionCancellation = async (
      subscriptionId: string,
      cancellationRequestedAt: string | null,
    ) => {
      const confirmResult = await dependencies.serviceRest(
        "rpc/ordys_confirm_subscription_cancellation",
        {
          method: "POST",
          body: JSON.stringify({
            p_user_id: userId,
            p_subscription_id: subscriptionId,
            p_cancellation_requested_at: cancellationRequestedAt,
          }),
        },
      );
      if (confirmResult !== "confirmed" && confirmResult !== "already_confirmed") {
        throw new Error("A confirmação do Asaas existe, mas não foi possível reconciliar o checkout vinculado. Nenhum dado foi apagado.");
      }
    };

    // A single unresolved Checkout must not prevent independent, identifiable
    // Checkouts and subscriptions from being cancelled. Keep a durable pending
    // flag, continue the loops, and block destructive cleanup at the end.
    for (const attempt of attempts) {
      const status = typeof attempt["status"] === "string" ? attempt["status"] : "";
      const attemptId = typeof attempt["id"] === "string" ? attempt["id"] : "";
      const checkoutId = typeof attempt["provider_checkout_id"] === "string"
        ? attempt["provider_checkout_id"]
        : "";

      if (!attemptId) {
        billingReconciliationRequired = true;
        continue;
      }

      if (status === "paid" || status === "linked") {
        const linked = subscriptions.some((subscription) => subscription["checkout_attempt_id"] === attemptId);
        if (!linked) billingReconciliationRequired = true;
        continue;
      }

      if (status !== "creating" && status !== "pending") {
        billingReconciliationRequired = true;
        continue;
      }

      if (!checkoutId) {
        checkoutCancellationRequested = true;
        continue;
      }

      // A prior request may have reached Asaas even if its response/webhook was
      // lost. Never repeat the non-idempotent cancellation POST automatically.
      if (typeof attempt["cancellation_requested_at"] === "string") {
        checkoutCancellationRequested = true;
        continue;
      }

      // A missing API key or invalid environment is known before any provider
      // request starts. Detect it before making the cancellation claim durable.
      dependencies.assertAsaasConfigured();
      let claim: CheckoutCancellationClaim;
      try {
        claim = await claimOrdysCheckoutCancellation(userId, attemptId, dependencies.serviceRest);
      } catch {
        // The conditional claim or its read-back is inconclusive. Do not send
        // a provider request unless this invocation proves ownership.
        checkoutCancellationRequested = true;
        continue;
      }
      if (claim === "terminal") continue;

      checkoutCancellationRequested = true;
      if (claim === "already_claimed") continue;

      // The request may be accepted even when its response is lost. Keep the
      // claim and reconcile by CHECKOUT_CANCELED; never repeat the POST.
      try {
        await dependencies.asaasRequest(
          `/checkouts/${encodeURIComponent(checkoutId)}/cancel`,
          { method: "POST" },
        );
      } catch {
        // Preserve the durable claim and still attempt other independent rows.
        checkoutCancellationRequested = true;
      }
    }

    for (const subscription of subscriptions) {
      const subscriptionId = typeof subscription["id"] === "string" ? subscription["id"] : "";
      const providerSubscriptionId = typeof subscription["provider_subscription_id"] === "string"
        ? subscription["provider_subscription_id"]
        : "";
      if (!subscriptionId || !providerSubscriptionId) {
        billingReconciliationRequired = true;
        continue;
      }

      const providerDeletionConfirmed = subscription["provider_status"] === "DELETED";
      if (providerDeletionConfirmed || typeof subscription["cancellation_confirmed_at"] === "string") {
        // Older releases could persist provider_status=DELETED before the new
        // confirmation marker existed, and a later local Checkout update could
        // fail. Reconcile that terminal provider state atomically without
        // sending another cancellation request to Asaas.
        const existingCancellationRequest = subscription["cancellation_requested_at"];
        try {
          await confirmLocalSubscriptionCancellation(
            subscriptionId,
            typeof existingCancellationRequest === "string" ? existingCancellationRequest : null,
          );
        } catch {
          subscriptionCancellationRequested = true;
        }
        continue;
      }

      // A legacy local "cancelled" status is not provider confirmation.
      // When no earlier intent marker exists, let the same atomic claim used
      // by profile cancellation reserve exactly one Asaas DELETE. Ambiguous or
      // previously claimed requests remain blocked by the claim helper below.
      if (typeof subscription["cancellation_requested_at"] === "string") {
        // A prior DELETE may have succeeded even if its response was lost.
        // Wait for SUBSCRIPTION_DELETED rather than repeat the provider call.
        subscriptionCancellationRequested = true;
        continue;
      }

      // Validate deterministic provider configuration before saving a
      // one-shot claim. Ambiguous failures after fetch starts retain the claim.
      dependencies.assertAsaasConfigured();

      // Claim the one-time provider DELETE with a UUID. If PostgREST commits
      // the intent but loses its response, only this invocation may continue
      // after reading back its own token; concurrent requests remain blocked.
      let claim: Awaited<ReturnType<typeof claimOrdysSubscriptionCancellation>>;
      try {
        claim = await claimOrdysSubscriptionCancellation(
          userId,
          subscriptionId,
          dependencies.serviceRest,
        );
      } catch {
        // An uncertain claim cannot authorize a provider request, but it must
        // not prevent attempts for other independently known subscriptions.
        subscriptionCancellationRequested = true;
        continue;
      }

      if (claim.status === "confirmed") {
        try {
          await confirmLocalSubscriptionCancellation(subscriptionId, claim.cancellationRequestedAt);
        } catch {
          subscriptionCancellationRequested = true;
        }
        continue;
      }
      if (claim.status === "already_claimed") {
        subscriptionCancellationRequested = true;
        continue;
      }

      // An ambiguous provider response keeps the claim and marker durable.
      // Never repeat the non-idempotent DELETE automatically.
      try {
        await dependencies.asaasRequest(
          `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
          { method: "DELETE" },
        );
      } catch {
        subscriptionCancellationRequested = true;
        continue;
      }

      try {
        await confirmLocalSubscriptionCancellation(subscriptionId, claim.cancellationRequestedAt);
      } catch {
        subscriptionCancellationRequested = true;
      }
    }

    // A subscription can exist at Asaas before its webhook can be linked to
    // the local Checkout (for example, SUBSCRIPTION_CREATED before CHECKOUT_PAID).
    // The Checkout may later become locally terminal, so checking only current
    // subscription rows is insufficient. The privileged RPC correlates held
    // provider events to this user's attempts/subscriptions and fails closed.
    const hasUnreconciledProviderEvents = await dependencies.serviceRest(
      "rpc/ordys_has_unreconciled_billing_events",
      {
        method: "POST",
        body: JSON.stringify({ p_user_id: userId }),
      },
    );
    if (hasUnreconciledProviderEvents === true) {
      billingReconciliationRequired = true;
    } else if (hasUnreconciledProviderEvents !== false) {
      throw new Error("Não foi possível confirmar os webhooks de cobrança desta conta. Nenhum dado foi apagado.");
    }

    if (billingReconciliationRequired) {
      throw new BillingCancellationPendingError(
        "Há pagamentos ou registros de cobrança que precisam de conciliação. As demais cobranças identificáveis foram processadas; nenhum dado da conta foi apagado.",
        "billing_reconciliation_required",
      );
    }
    if (subscriptionCancellationRequested) {
      throw new BillingCancellationPendingError(
        "Uma ou mais assinaturas aguardam confirmação ou conciliação do Asaas. As demais assinaturas identificáveis foram processadas; nenhum dado da conta foi apagado.",
        "billing_cancellation_processing",
      );
    }
    if (checkoutCancellationRequested) {
      throw new BillingCancellationPendingError(
        "Um ou mais Checkouts aguardam confirmação ou conciliação do Asaas. Os demais registros identificáveis foram processados; nenhum dado da conta foi apagado.",
        "checkout_cancellation_processing",
      );
    }

    completed = true;
    return processingToken;
  } finally {
    if (!completed) {
      const releaseStatus = await dependencies.serviceRest("rpc/ordys_release_account_deletion_processing", {
        method: "POST",
        body: JSON.stringify({ p_user_id: userId, p_processing_token: processingToken }),
      });
      if (releaseStatus !== "released") {
        throw new Error("Não foi possível liberar o bloqueio temporário de exclusão. A reserva permanece protegida.");
      }
    }
  }
}

export async function releaseOrdysAccountDeletionProcessing(
  userId: string, processingToken: string, serviceRest: ServiceRest,
): Promise<void> {
  const releaseStatus = await serviceRest("rpc/ordys_release_account_deletion_processing", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId, p_processing_token: processingToken }),
  });
  if (releaseStatus !== "released" && releaseStatus !== "not_reserved") {
    throw new Error("Não foi possível liberar o bloqueio temporário de exclusão.");
  }
}
