import "@tanstack/react-start/server-only";
export class RequestBodyTimeoutError extends Error {
  constructor() {
    super("ORDYS_REQUEST_BODY_TIMEOUT");
    this.name = "RequestBodyTimeoutError";
  }
}

/**
 * Read a bounded request body. An optional total deadline protects endpoints
 * that should not wait indefinitely for a slow or stalled incoming stream.
 * Callers that omit timeoutMs retain the existing size-only behavior.
 */
export async function readRequestBodyWithLimit(
  request: Request,
  maxBytes: number,
  timeoutMs?: number,
): Promise<string | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer.");
  }
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new RangeError("timeoutMs must be a positive finite number.");
  }

  const reader = request.body?.["getReader"]();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const readBody = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body["set"](chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
  };

  try {
    if (timeoutMs === undefined) return await readBody();

    return await Promise.race([
      readBody(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          reject(new RequestBodyTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      // Cancellation releases the pending read. Do not await it: a stalled
      // underlying stream must not extend the deadline that just fired.
      void reader.cancel().catch(() => undefined);
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    // A timed-out read may still be unwinding while cancellation propagates.
    // Avoid releaseLock while that read is pending.
    if (!timedOut) reader.releaseLock();
  }
}
