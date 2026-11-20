import { describe, expect, it } from "vitest";
import {
  assertOrdysAiAccessPolicyReady,
  ORDYS_AGE_ASSURANCE_VERIFIED,
  ORDYS_GUARDIAN_CONSENT_POLICY_VERIFIED,
  ORDYS_AI_ACCESS_POLICY_READY,
  ORDYS_AI_ACCESS_POLICY_LOCK_MESSAGE,
} from "../src/lib/ordys-ai-access";

describe("Ordys trusted AI release gate", () => {
  it("remains closed until trusted age assurance or a guardian policy is verified", async () => {
    expect(ORDYS_AGE_ASSURANCE_VERIFIED).toBe(false);
    expect(ORDYS_GUARDIAN_CONSENT_POLICY_VERIFIED).toBe(false);
    expect(ORDYS_AI_ACCESS_POLICY_READY).toBe(false);
    await expect(assertOrdysAiAccessPolicyReady()).rejects.toThrow(
      ORDYS_AI_ACCESS_POLICY_LOCK_MESSAGE,
    );
  });
});
