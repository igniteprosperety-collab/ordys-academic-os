import "@tanstack/react-start/server-only";
type JsonRecord = Record<string, unknown>;
type ServiceRest = (path: string, init?: RequestInit) => Promise<unknown>;

export type SubscriptionCancellationClaim =
  | { status: "claimed"; cancellationRequestedAt: string }
  | { status: "already_claimed" }
  | { status: "confirmed"; cancellationRequestedAt: string | null };

function jsonObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

/**
 * Atomically reserve the one-time recurring-subscription DELETE.
 *
 * The claim UUID distinguishes this invocation's committed PATCH from a
 * concurrent claim when PostgREST commits the update but its response is lost.
 * Only the invocation that can prove ownership may contact Asaas.
 */
export async function claimOrdysSubscriptionCancellation(
  userId: string,
  subscriptionId: string,
  serviceRest: ServiceRest,
): Promise<SubscriptionCancellationClaim> {
  if (!userId || !subscriptionId) {
    throw new Error("Não foi possível identificar a conta e a assinatura para reservar o cancelamento.");
  }

  const claimId = crypto.randomUUID();
  const encodedUserId = encodeURIComponent(userId);
  const encodedSubscriptionId = encodeURIComponent(subscriptionId);
  const cancellationRequestedAt = new Date().toISOString();
  const claimQuery =
    `ordys_billing_subscriptions?id=eq.${encodedSubscriptionId}&user_id=eq.${encodedUserId}&status=in.(pending,active,past_due,suspended,cancelled)&cancellation_requested_at=is.null&cancellation_claim_id=is.null&cancellation_confirmed_at=is.null`;

  let claimResult: unknown;
  try {
    claimResult = await serviceRest(claimQuery, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        cancellation_requested_at: cancellationRequestedAt,
        cancellation_claim_id: claimId,
        updated_at: cancellationRequestedAt,
      }),
    });
  } catch {
    // The PATCH may have committed even though its response was lost.
    // Read back the unique owner token before deciding whether DELETE is safe.
    claimResult = null;
  }

  if (Array.isArray(claimResult)) {
    const claimed = claimResult
      .map(jsonObject)
      .find((row) =>
        row["id"] === subscriptionId &&
        row["cancellation_claim_id"] === claimId &&
        row["cancellation_requested_at"] === cancellationRequestedAt
      );
    if (claimed) return { status: "claimed", cancellationRequestedAt };
  }

  const latestResult = await serviceRest(
    `ordys_billing_subscriptions?select=id,status,provider_status,cancellation_requested_at,cancellation_confirmed_at,cancellation_claim_id&user_id=eq.${encodedUserId}&id=eq.${encodedSubscriptionId}&limit=1`,
  );
  if (!Array.isArray(latestResult) || latestResult.length !== 1) {
    throw new Error("Não foi possível confirmar a reserva do cancelamento da assinatura. Nenhum dado foi apagado.");
  }

  const latest = jsonObject(latestResult[0]);
  if (latest["id"] !== subscriptionId) {
    throw new Error("A assinatura retornada não corresponde à solicitação de cancelamento.");
  }

  const latestRequestedAt = typeof latest["cancellation_requested_at"] === "string"
    ? latest["cancellation_requested_at"]
    : null;
  if (
    typeof latest["cancellation_confirmed_at"] === "string" ||
    latest["provider_status"] === "DELETED"
  ) {
    return { status: "confirmed", cancellationRequestedAt: latestRequestedAt };
  }

  if (
    latest["cancellation_claim_id"] === claimId &&
    latestRequestedAt === cancellationRequestedAt
  ) {
    return { status: "claimed", cancellationRequestedAt };
  }

  if (latestRequestedAt !== null || typeof latest["cancellation_claim_id"] === "string") {
    return { status: "already_claimed" };
  }

  return { status: "already_claimed" };
}
