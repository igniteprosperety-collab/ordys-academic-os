import { describe, expect, it } from "vitest";
import { checkoutAttemptDisposition } from "../edge-functions/_shared/ordys-billing";

describe("Asaas checkout retry safety", () => {
  const now = Date.parse("2026-10-31T12:00:00.000Z");

  it("reuses a pending checkout while its local expiry is still in the future", () => {
    expect(checkoutAttemptDisposition("pending", "2026-10-31T12:05:00.000Z", now)).toBe("reuse");
  });

  it("requires remote cancellation after a pending checkout reaches local expiry", () => {
    expect(checkoutAttemptDisposition("pending", "2026-10-31T11:59:59.000Z", now)).toBe("cancel_remote");
  });

  it.each(["creating", "paid", "linked"])("blocks an unresolved %s attempt", (status) => {
    expect(checkoutAttemptDisposition(status, "2026-10-31T11:00:00.000Z", now)).toBe("block");
  });

  it.each(["cancelled", "expired", "failed"])("allows retry after the terminal state %s is recorded", (status) => {
    expect(checkoutAttemptDisposition(status, "2026-10-31T11:00:00.000Z", now)).toBe("retry");
  });

  it("blocks a pending attempt with a missing or invalid expiry timestamp", () => {
    expect(checkoutAttemptDisposition("pending", "", now)).toBe("block");
    expect(checkoutAttemptDisposition("pending", "not-a-date", now)).toBe("block");
  });
});
