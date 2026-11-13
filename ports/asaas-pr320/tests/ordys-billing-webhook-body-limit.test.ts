import { describe, expect, it } from "vitest";
import { readRequestBodyWithLimit } from "../supabase/functions/_shared/request-body";

describe("Bounded Edge request body reader", () => {
  it("decodes a UTF-8 body that stays within the byte limit", async () => {
    const content = JSON.stringify({ event: "PAYMENT_CONFIRMED", description: "Cobrança recebida" });
    const encoded = new TextEncoder().encode(content);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    });

    await expect(
      readRequestBodyWithLimit({ body: stream } as Request, encoded.byteLength),
    ).resolves.toBe(content);
  });

  it("cancels the request stream as soon as the byte limit is exceeded", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1_024));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      readRequestBodyWithLimit({ body: stream } as Request, 512),
    ).resolves.toBeNull();
    expect(cancelled).toBe(true);
  });

  it("returns an empty string when the request has no body", async () => {
    await expect(
      readRequestBodyWithLimit({ body: null } as Request, 1_048_576),
    ).resolves.toBe("");
  });
});
