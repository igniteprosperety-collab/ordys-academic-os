import { describe, expect, it } from "vitest";
import {
  isConfirmedAccountDeletionResponse,
  isUnconfirmedAuthIdentityDeletionPayload,
} from "../src/lib/account-deletion-outcome";

describe("account deletion response confirmation", () => {
  it("accepts only the explicit deleted=true success contract", () => {
    expect(isConfirmedAccountDeletionResponse({ deleted: true })).toBe(true);
  });

  it.each([
    null,
    undefined,
    false,
    "deleted",
    [],
    {},
    { deleted: false },
    { deleted: "true" },
    { deleted: true, error: "partial failure" },
  ])("rejects an incomplete or malformed success payload: %j", (value) => {
    expect(isConfirmedAccountDeletionResponse(value)).toBe(false);
  });
});


describe("account deletion partial completion", () => {
  it("recognizes an explicit unconfirmed Auth identity deletion", () => {
    expect(isUnconfirmedAuthIdentityDeletionPayload({
      error: "application data was removed",
      code: "auth_identity_deletion_unconfirmed",
    })).toBe(true);
  });

  it.each([
    null,
    undefined,
    {},
    { code: "checkout_cancellation_processing" },
    { code: "billing_cancellation_processing" },
    { code: "auth_identity_deletion_unconfirmed", deleted: true },
    [],
  ])("rejects payloads that do not represent an Auth identity deletion uncertainty: %j", (value) => {
    expect(isUnconfirmedAuthIdentityDeletionPayload(value)).toBe(false);
  });
});
