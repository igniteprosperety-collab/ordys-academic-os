import { describe, expect, it } from "vitest";
import {
  parseOrdysBillingWebhookProcessorResult,
} from "../supabase/functions/_shared/ordys-billing-webhook-result.ts";

describe("Asaas webhook processor response", () => {
  it("accepts a completed event only when the event type is present", () => {
    expect(
      parseOrdysBillingWebhookProcessorResult({
        processed: true,
        event: "PAYMENT_RECEIVED",
      }),
    ).toEqual({ processed: true });
  });

  it("accepts the explicit stale-payment ignore result from the SQL processor", () => {
    expect(
      parseOrdysBillingWebhookProcessorResult({
        processed: true,
        ignored_stale_payment_event: true,
        event: "PAYMENT_OVERDUE",
      }),
    ).toEqual({ processed: true });
  });

  it("acknowledges a confirmed duplicate without treating it as newly processed", () => {
    expect(
      parseOrdysBillingWebhookProcessorResult({
        processed: false,
        duplicate: true,
      }),
    ).toEqual({ processed: false });
  });

  it("preserves an explicit quarantined processor error", () => {
    expect(
      parseOrdysBillingWebhookProcessorResult({
        processed: false,
        error: "ambiguous_customer_association",
      }),
    ).toEqual({
      processed: false,
      error: "ambiguous_customer_association",
    });
  });

  it.each([
    null,
    undefined,
    "",
    [],
    {},
    { processed: "true", event: "PAYMENT_RECEIVED" },
    { processed: true },
    { processed: true, event: " " },
    { processed: false },
    { processed: false, duplicate: false },
    { processed: false, error: " " },
    { processed: false, error: "unexpected_database_error" },
    { processed: false, error: "new_unreviewed_processor_code" },
    { processed: false, duplicate: false, error: "amount_mismatch" },
    { processed: false, duplicate: true, unexpected: true },
    { processed: false, error: "amount_mismatch", unexpected: true },
    { processed: true, event: "PAYMENT_RECEIVED", unexpected: true },
    { processed: true, event: "PAYMENT_OVERDUE", ignored_stale_payment_event: false },
    {
      processed: true,
      event: "PAYMENT_RECEIVED",
      ignored_stale_payment_event: true,
      unexpected: true,
    },
    { processed: true, event: "PAYMENT_RECEIVED", duplicate: true },
    { processed: true, event: "PAYMENT_RECEIVED", error: "amount_mismatch" },
    { processed: false, duplicate: true, error: "unexpected_database_error" },
    { processed: false, duplicate: true, event: "PAYMENT_RECEIVED" },
    { processed: false, error: "amount_mismatch", event: "PAYMENT_RECEIVED" },
  ])("rejects an incomplete or malformed processor response: %j", (value) => {
    expect(() => parseOrdysBillingWebhookProcessorResult(value)).toThrow();
  });
});
