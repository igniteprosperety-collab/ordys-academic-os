import { describe, expect, it } from "vitest";
import {
  evaluateOrdysAiAccess,
  ORDYS_AI_GUARDIAN_CONSENT_POLICY_VERSION,
  ORDYS_AI_SAFETY_POLICY_VERSION,
  type OrdysAiAssuranceRecord,
} from "../src/lib/ordys-ai-access-policy";

const now = new Date("2026-11-20T15:00:00.000Z");
const current = "2026-11-20T14:00:00.000Z";
const future = "2027-11-20T14:00:00.000Z";

function record(overrides: Partial<OrdysAiAssuranceRecord> = {}): OrdysAiAssuranceRecord {
  return {
    age_band: "18_plus",
    age_assurance_status: "verified",
    age_assurance_source: "external_provider",
    age_assurance_verified_at: current,
    age_assurance_expires_at: future,
    guardian_consent_status: "not_required",
    guardian_consent_source: "unknown",
    guardian_identity_verified: false,
    guardian_relationship_verified: false,
    guardian_consent_at: null,
    guardian_consent_expires_at: null,
    guardian_consent_policy_version: null,
    age_evidence_reference: "age-evidence-reference",
    guardian_evidence_reference: null,
    ai_safety_policy_version: ORDYS_AI_SAFETY_POLICY_VERSION,
    ...overrides,
  };
}

describe("Ordys server-owned AI access assurance", () => {
  it("allows an adult only with a current trusted age-assurance record", () => {
    expect(evaluateOrdysAiAccess(record(), now)).toEqual({
      allowed: true,
      tier: "adult",
      reason: "verified_adult",
    });
  });


  it("accepts a supervised minor only after separate verified guardian consent", () => {
    expect(
      evaluateOrdysAiAccess(
        record({
          age_band: "13_15",
          age_assurance_status: "supervised",
          age_assurance_source: "google_play",
          guardian_consent_status: "granted",
          guardian_consent_source: "external_provider",
          guardian_identity_verified: true,
          guardian_relationship_verified: true,
          guardian_consent_at: current,
          guardian_consent_expires_at: future,
          guardian_consent_policy_version: ORDYS_AI_GUARDIAN_CONSENT_POLICY_VERSION,
          guardian_evidence_reference: "guardian-evidence-reference",
        }),
        now,
      ),
    ).toEqual({
      allowed: true,
      tier: "minor_protected",
      reason: "verified_guardian_consent",
    });
  });

  it("does not treat a supervised account as an adult", () => {
    expect(
      evaluateOrdysAiAccess(record({ age_assurance_status: "supervised" }), now),
    ).toEqual({ allowed: false, tier: "blocked", reason: "age_assurance_invalid" });
  });

  it("does not allow a self-declared adult, even when the profile says 18+", () => {
    expect(
      evaluateOrdysAiAccess(
        record({ age_assurance_status: "declared", age_assurance_source: "google_play" }),
        now,
      ),
    ).toEqual({ allowed: false, tier: "blocked", reason: "age_assurance_invalid" });
  });

  it("allows a 13–17 account only with current trusted age evidence and verified guardian consent", () => {
    expect(
      evaluateOrdysAiAccess(
        record({
          age_band: "16_17",
          age_assurance_source: "apple_declared_age_range",
          guardian_consent_status: "granted",
          guardian_consent_source: "verified_guardian_portal",
          guardian_identity_verified: true,
          guardian_relationship_verified: true,
          guardian_consent_at: current,
          guardian_consent_expires_at: future,
          guardian_consent_policy_version: ORDYS_AI_GUARDIAN_CONSENT_POLICY_VERSION,
          guardian_evidence_reference: "guardian-evidence-reference",
        }),
        now,
      ),
    ).toEqual({
      allowed: true,
      tier: "minor_protected",
      reason: "verified_guardian_consent",
    });
  });

  it.each(["pending", "denied", "revoked", "expired", "unknown", "not_required"] as const)(
    "blocks a minor with guardian consent status %s",
    (guardian_consent_status) => {
      expect(
        evaluateOrdysAiAccess(
          record({
            age_band: "13_15",
            guardian_consent_status,
            guardian_consent_source: "verified_guardian_portal",
            guardian_identity_verified: true,
            guardian_relationship_verified: true,
            guardian_consent_at: current,
            guardian_consent_expires_at: future,
            guardian_consent_policy_version: ORDYS_AI_GUARDIAN_CONSENT_POLICY_VERSION,
          guardian_evidence_reference: "guardian-evidence-reference",
          }),
          now,
        ).allowed,
      ).toBe(false);
    },
  );

  it("does not treat a verified guardian email alone as proof of the legal relationship", () => {
    expect(
      evaluateOrdysAiAccess(
        record({
          age_band: "13_15",
          guardian_consent_status: "granted",
          guardian_consent_source: "verified_guardian_portal",
          guardian_identity_verified: true,
          guardian_relationship_verified: false,
          guardian_consent_at: current,
          guardian_consent_expires_at: future,
          guardian_consent_policy_version: ORDYS_AI_GUARDIAN_CONSENT_POLICY_VERSION,
          guardian_evidence_reference: "guardian-evidence-reference",
        }),
        now,
      ),
    ).toEqual({ allowed: false, tier: "blocked", reason: "guardian_consent_invalid" });
  });

  it("blocks unsupported under-13 accounts, even when a guardian consent exists", () => {
    expect(
      evaluateOrdysAiAccess(
        record({
          age_band: "under_13",
          guardian_consent_status: "granted",
          guardian_consent_source: "verified_guardian_portal",
          guardian_identity_verified: true,
          guardian_relationship_verified: true,
          guardian_consent_at: current,
          guardian_consent_expires_at: future,
          guardian_consent_policy_version: ORDYS_AI_GUARDIAN_CONSENT_POLICY_VERSION,
          guardian_evidence_reference: "guardian-evidence-reference",
        }),
        now,
      ),
    ).toEqual({ allowed: false, tier: "blocked", reason: "age_band_unsupported" });
  });

  it("blocks expired or future-dated age evidence", () => {
    const expired = evaluateOrdysAiAccess(record({ age_assurance_expires_at: current }), now);
    const futureDated = evaluateOrdysAiAccess(record({ age_assurance_verified_at: future }), now);
    expect(expired.allowed).toBe(false);
    expect(futureDated.allowed).toBe(false);
  });

  it("blocks guardian consent without an opaque evidence reference", () => {
    expect(
      evaluateOrdysAiAccess(
        record({
          age_band: "13_15",
          guardian_consent_status: "granted",
          guardian_consent_source: "verified_guardian_portal",
          guardian_identity_verified: true,
          guardian_relationship_verified: true,
          guardian_consent_at: current,
          guardian_consent_expires_at: future,
          guardian_consent_policy_version: ORDYS_AI_GUARDIAN_CONSENT_POLICY_VERSION,
          guardian_evidence_reference: null,
        }),
        now,
      ),
    ).toEqual({ allowed: false, tier: "blocked", reason: "guardian_consent_invalid" });
  });

  it("blocks guardian consent with an outdated policy version", () => {
    expect(
      evaluateOrdysAiAccess(
        record({
          age_band: "13_15",
          guardian_consent_status: "granted",
          guardian_consent_source: "operator_review",
          guardian_identity_verified: true,
          guardian_relationship_verified: true,
          guardian_consent_at: current,
          guardian_consent_expires_at: future,
          guardian_consent_policy_version: "2026-10-01",
          guardian_evidence_reference: "guardian-evidence-reference",
        }),
        now,
      ),
    ).toEqual({ allowed: false, tier: "blocked", reason: "guardian_consent_invalid" });
  });

  it("requires an explicit current AI-safety policy version", () => {
    expect(
      evaluateOrdysAiAccess(record({ ai_safety_policy_version: null }), now),
    ).toEqual({ allowed: false, tier: "blocked", reason: "policy_version_outdated" });
  });

  it("never allows an account with no server-owned assurance record", () => {
    expect(evaluateOrdysAiAccess(null, now)).toEqual({
      allowed: false,
      tier: "blocked",
      reason: "assurance_missing",
    });
  });
});
