import { AuthRequestTimeoutError } from "./auth-request-timeout";

/**
 * True when the request may have reached the function but its result is unknown:
 * connection failure, client timeout, or a 500/502/504 server response.
 * A 404/410 means the function never ran, so it is not inconclusive.
 */
export function isInconclusiveFunctionRequestError(error: unknown): boolean {
  if (error instanceof AuthRequestTimeoutError) return true;
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; context?: unknown };
  if (record.name === "FunctionsFetchError" || record.name === "FunctionsRelayError") return true;
  const status = record.context && typeof record.context === "object"
    ? (record.context as { status?: unknown }).status
    : undefined;
  return status === 500 || status === 502 || status === 504;
}
