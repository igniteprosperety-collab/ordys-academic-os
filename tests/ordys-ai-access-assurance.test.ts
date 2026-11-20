import { describe, expect, it } from "vitest";
import {
  evaluateOrdysAiAccess,
  ORDYS_AI_GUARDIAN_CONSENT_POLICY_VERSION,
  ORDYS_AI_SAFETY_POLICY_VERSION,
  mapOrdysAppleAgeDeclaration,
  mapOrdysGooglePlayAgeSource,
  mapOrdysAgeBandFromBounds,
  type OrdysAiAssuranceRecord,
} from "../src/lib/ordys-ai-access-policy";

const now = new Date("2026-11-20T15:00:00.000Z");
const current = "2026-11-20T14:00:00.000Z";
const future = "2027-11-20T14:00:00.000Z";

function record(overrides: Partial<OrdysAiAssuranceRecord> = {}): OrdysAiAssuranceRecord {
  return {
    age_band: "18_plus",
    age_assurance_status: "verified",
    age_assurance_source: "external_provider_verified",
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

describe("Ordys platform age signal mapping", () => {
  it("accepts Google Play TIER_D as verified age evidence", () => {
    expect(mapOrdysGooglePlayAgeSource("TIER_D")).toEqual({
      status: "verified",
      source: "google_play_tier_d",
    });
  });

  it("maps Google Play TIER_B to supervised, not verified, age evidence", () => {
    expect(mapOrdysGooglePlayAgeSource("TIER_B")).toEqual({
      status: "supervised",
      source: "google_play_tier_b_supervised",
    });
  });

  it.each(["TIER_A", "TIER_C", "UNSPECIFIED", null, undefined])(
    "does not use Google Play %s as verified age evidence",
    (source) => {
      expect(mapOrdysGooglePlayAgeSource(source)).toBeNull();
    },
  );

  it("accepts Apple's confirmed declaration as verified age evidence", () => {
    expect(mapOrdysAppleAgeDeclaration("confirmed")).toEqual({
      status: "verified",
      source: "apple_confirmed_age_range",
    });
  });

  it("maps Apple's guardian declaration to supervised age evidence", () => {
    expect(mapOrdysAppleAgeDeclaration("guardianDeclared")).toEqual({
      status: "supervised",
      source: "apple_guardian_declared_age_range",
    });
  });

  it("does not use Apple's self-declared age range as verified evidence", () => {
    expect(mapOrdysAppleAgeDeclaration("selfDeclared")).toBeNull();
  });
});

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
          age_band: "14_15",
          age_assurance_status: "supervised",
          age_assurance_source: "google_play_tier_b_supervised",
          guardian_consent_status: "granted",
          guardian_consent_source: "external_provider_verified",
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
    expect(evaluateOrdysAiAccess(record({ age_assurance_status: "supervised" }), now)).toEqual({
      allowed: false,
      tier: "blocked",
      reason: "age_assurance_invalid",
    });
  });

  it("does not allow a self-declared adult, even when the profile says 18+", () => {
    expect(
      evaluateOrdysAiAccess(
        record({
          age_assurance_status: "declared",
          age_assurance_source: "google_play_tier_b_supervised",
        }),
        now,
      ),
    ).toEqual({ allowed: false, tier: "blocked", reason: "age_assurance_invalid" });
  });

  it("allows a 14–17 account only with current trusted age evidence and verified guardian consent", () => {
    expect(
      evaluateOrdysAiAccess(
        record({
          age_band: "16_17",
          age_assurance_source: "apple_confirmed_age_range",
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
            age_band: "14_15",
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
          age_band: "14_15",
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

  it("blocks unsupported under-14 accounts, even when a guardian consent exists", () => {
    expect(
      evaluateOrdysAiAccess(
        record({
          age_band: "under_14",
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
          age_band: "14_15",
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
          age_band: "14_15",
          guardian_consent_status: "granted",
          guardian_consent_source: "external_provider_verified",
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
    expect(evaluateOrdysAiAccess(record({ ai_safety_policy_version: null }), now)).toEqual({
      allowed: false,
      tier: "blocked",
      reason: "policy_version_outdated",
    });
  });

  it("never allows an account with no server-owned assurance record", () => {
    expect(evaluateOrdysAiAccess(null, now)).toEqual({
      allowed: false,
      tier: "blocked",
      reason: "assurance_missing",
    });
  });

  it("never rounds a provider age range that crosses the V1 minimum upward", () => {
    expect(mapOrdysAgeBandFromBounds(13, 15)).toBe("unknown");
    expect(mapOrdysAgeBandFromBounds(13, 17)).toBe("unknown");
    expect(mapOrdysAgeBandFromBounds(0, 13)).toBe("under_14");
    expect(mapOrdysAgeBandFromBounds(14, 15)).toBe("14_15");
    expect(mapOrdysAgeBandFromBounds(16, 17)).toBe("16_17");
    expect(mapOrdysAgeBandFromBounds(18, null)).toBe("18_plus");
    expect(mapOrdysAgeBandFromBounds(18, 99)).toBe("18_plus");
    expect(mapOrdysAgeBandFromBounds(15, 14)).toBe("unknown");
  });

});
