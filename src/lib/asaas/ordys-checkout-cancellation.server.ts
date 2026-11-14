import "@tanstack/react-start/server-only";
type JsonRecord = Record<string, unknown>;
type ServiceRest = (path: string, init?: RequestInit) => Promise<unknown>;

export type CheckoutCancellationClaim = "claimed" | "already_claimed" | "terminal";

function jsonObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

/**
 * Atomically reserve the one-time Checkout cancellation POST.
 *
 * The claim UUID distinguishes this invocation's committed PATCH from a
 * concurrent claim when PostgREST commits the update but its response is lost.
 * Only the invocation that can prove ownership may contact Asaas.
 */
export async function claimOrdysCheckoutCancellation(
  userId: string,
  attemptId: string,
  serviceRest: ServiceRest,
): Promise<CheckoutCancellationClaim> {
  if (!userId || !attemptId) {
    throw new Error("Não foi possível identificar a conta e o checkout para reservar o cancelamento.");
  }

  const claimId = crypto.randomUUID();
  const encodedUserId = encodeURIComponent(userId);
  const encodedAttemptId = encodeURIComponent(attemptId);
  const cancellationRequestedAt = new Date().toISOString();
  const claimQuery =
    `ordys_billing_checkout_attempts?id=eq.${encodedAttemptId}&user_id=eq.${encodedUserId}&status=in.(creating,pending)&cancellation_requested_at=is.null`;

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
    // Read back the unique owner token before deciding whether POST is safe.
    claimResult = null;
  }

  if (Array.isArray(claimResult)) {
    const claimed = claimResult
      .map(jsonObject)
      .find((row) => row["id"] === attemptId && row["cancellation_claim_id"] === claimId);
    if (claimed) {
      const status = String(claimed["status"] ?? "");
      if (["cancelled", "expired", "failed"].includes(status)) return "terminal";
      if (status === "creating" || status === "pending") return "claimed";
    }
  }

  const latestResult = await serviceRest(
    `ordys_billing_checkout_attempts?select=id,status,cancellation_requested_at,cancellation_claim_id&user_id=eq.${encodedUserId}&id=eq.${encodedAttemptId}&limit=1`,
  );
  if (!Array.isArray(latestResult) || latestResult.length !== 1) {
    throw new Error("Não foi possível confirmar a reserva do cancelamento do checkout. Nenhum dado foi apagado.");
  }

  const latest = jsonObject(latestResult[0]);
  if (latest["id"] !== attemptId) {
    throw new Error("O checkout retornado não corresponde à solicitação de cancelamento.");
  }

  const latestStatus = typeof latest["status"] === "string" ? latest["status"] : "";
  if (["cancelled", "expired", "failed"].includes(latestStatus)) return "terminal";

  if (
    (latestStatus === "creating" || latestStatus === "pending") &&
    typeof latest["cancellation_requested_at"] === "string"
  ) {
    return latest["cancellation_claim_id"] === claimId ? "claimed" : "already_claimed";
  }

  throw new Error("Não foi possível reservar o cancelamento do checkout com segurança. Nenhum dado foi apagado.");
}
