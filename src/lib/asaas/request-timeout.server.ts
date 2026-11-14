import "@tanstack/react-start/server-only";
export class OutboundRequestTimeoutError extends Error {
  constructor() {
    super("ORDYS_OUTBOUND_REQUEST_TIMEOUT");
    this.name = "OutboundRequestTimeoutError";
  }
}

/** Keep a multi-step operation inside a wider provider/database lease. */
export function createOutboundRequestDeadline(totalTimeoutMs: number) {
  if (!Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= 0) {
    throw new RangeError("Total outbound request deadline must be a positive finite number.");
  }
  const deadline = Date.now() + totalTimeoutMs;
  return (perRequestTimeoutMs: number): number => {
    if (!Number.isFinite(perRequestTimeoutMs) || perRequestTimeoutMs <= 0) {
      throw new RangeError("Per-request timeout must be a positive finite number.");
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new OutboundRequestTimeoutError();
    return Math.min(perRequestTimeoutMs, remainingMs);
  };
}

/** Release an Edge Function caller when an outbound request never settles. */
export async function withOutboundRequestTimeout<T>(
  request: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Outbound request timeout must be a positive finite number.");
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(request),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new OutboundRequestTimeoutError()),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Bound an SDK/database request and abort its underlying fetch at the deadline. */
export async function withAbortableOutboundRequestTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  try {
    return await withOutboundRequestTimeout(
      () => request(controller.signal),
      timeoutMs,
    );
  } catch (error) {
    if (error instanceof OutboundRequestTimeoutError) controller.abort();
    throw error;
  }
}

/** Bound fetch and abort the underlying request when the deadline is reached. */
export async function fetchWithOutboundTimeout(
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return withAbortableOutboundRequestTimeout(
    (signal) => fetch(input, { ...init, signal }),
    timeoutMs,
  );
}

/** Bound JSON body consumption and cancel a stalled stream. */
export async function responseJsonWithOutboundTimeout<T = unknown>(
  response: Response,
  timeoutMs: number,
): Promise<T> {
  const reader = response.body?.["getReader"]();
  if (!reader) return JSON.parse("") as T;

  let timedOut = false;
  try {
    return await withOutboundRequestTimeout(async () => {
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        chunks.push(value);
      }

      const body = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        body["set"](chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(body)) as T;
    }, timeoutMs);
  } catch (error) {
    if (error instanceof OutboundRequestTimeoutError) {
      timedOut = true;
      void reader.cancel().catch(() => undefined);
    }
    throw error;
  } finally {
    if (!timedOut) reader.releaseLock();
  }
}
