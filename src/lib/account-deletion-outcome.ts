/**
 * Confirm that the account-deletion Edge Function returned its explicit
 * success contract. An empty, extended, or malformed 2xx response is not proof
 * that destructive cleanup and Auth-user deletion both completed.
 */
export function isConfirmedAccountDeletionResponse(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, "deleted") &&
    (value as { deleted?: unknown }).deleted === true
  );
}


/** Identify the endpoint's explicit partial-success state after local data was removed. */
export function isUnconfirmedAuthIdentityDeletionPayload(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { code?: unknown }).code === "auth_identity_deletion_unconfirmed" &&
    (value as { deleted?: unknown }).deleted !== true
  );
}
