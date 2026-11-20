/**
 * Server policy for AI access assurance.
 *
 * This module is pure and may be imported by server code and tests.
 * Its record must come from a server-only table/provider, never from
 * profiles.birth_date or a client-supplied boolean.
 * The current UI kill switch remains separate until trusted providers and
 * guardian consent are deployed and verified end to end.
 */
export const ORDYS_AI_SAFETY_POLICY_VERSION = "2026-11-20.1";
export const ORDYS_AI_GUARDIAN_CONSENT_POLICY_VERSION = "2026-11-20.1";

export type OrdysAiAgeBand = "under_14" | "14_15" | "16_17" | "18_plus" | "unknown";
export type OrdysAgeAssuranceStatus =
  "verified" | "supervised" | "declared" | "unknown" | "revoked";
export type OrdysAgeAssuranceSource =
  | "google_play_tier_d"
  | "google_play_tier_b_supervised"
  | "apple_confirmed_age_range"
  | "apple_guardian_declared_age_range"
  | "external_provider_verified"
  | "unknown";
export type OrdysGuardianConsentStatus =
  "granted" | "pending" | "denied" | "revoked" | "expired" | "not_required" | "unknown";
export type OrdysGuardianConsentSource =
  "verified_guardian_portal" | "external_provider_verified" | "unknown";

export type OrdysAiAssuranceRecord = {
  age_band: OrdysAiAgeBand;
  age_assurance_status: OrdysAgeAssuranceStatus;
  age_assurance_source: OrdysAgeAssuranceSource;
  age_assurance_verified_at: string | null;
  age_assurance_expires_at: string | null;
  guardian_consent_status: OrdysGuardianConsentStatus;
  guardian_consent_source: OrdysGuardianConsentSource;
  guardian_identity_verified: boolean;
  guardian_relationship_verified: boolean;
  guardian_consent_at: string | null;
  guardian_consent_expires_at: string | null;
  guardian_consent_policy_version: string | null;
  age_evidence_reference: string | null;
  guardian_evidence_reference: string | null;
  ai_safety_policy_version: string | null;
};

export type OrdysAiAccessDecision =
  | { allowed: true; tier: "adult"; reason: "verified_adult" }
  | { allowed: true; tier: "minor_protected"; reason: "verified_guardian_consent" }
  | {
      allowed: false;
      tier: "blocked";
      reason:
        | "assurance_missing"
        | "age_band_unsupported"
        | "age_assurance_invalid"
        | "guardian_consent_required"
        | "guardian_consent_invalid"
        | "policy_version_outdated";
    };

const VERIFIED_AGE_SOURCES = new Set<OrdysAgeAssuranceSource>([
  "google_play_tier_d",
  "apple_confirmed_age_range",
  "external_provider_verified",
]);

const SUPERVISED_AGE_SOURCES = new Set<OrdysAgeAssuranceSource>([
  "google_play_tier_b_supervised",
  "apple_guardian_declared_age_range",
]);

const TRUSTED_GUARDIAN_SOURCES = new Set<OrdysGuardianConsentSource>([
  "verified_guardian_portal",
  "external_provider_verified",
]);

/**
 * Map the current Google Play Age Signals source after Play Integrity has been
 * verified server-side. TIER_A (declared) and TIER_C (estimated) are not used
 * to unlock OpenAI access in this policy.
 */
export function mapOrdysGooglePlayAgeSource(source: string | null | undefined) {
  if (source === "TIER_D") {
    return {
      status: "verified" as const,
      source: "google_play_tier_d" as const,
    };
  }
  if (source === "TIER_B") {
    return {
      status: "supervised" as const,
      source: "google_play_tier_b_supervised" as const,
    };
  }
  return null;
}

/**
 * Map Apple's Declared Age Range declaration. The app must separately check
 * platform entitlement, sharing state and applicable OS availability.
 * Self-declared ranges do not grant AI access.
 */
export function mapOrdysAppleAgeDeclaration(declaration: string | null | undefined) {
  if (declaration === "confirmed") {
    return {
      status: "verified" as const,
      source: "apple_confirmed_age_range" as const,
    };
  }
  if (declaration === "guardianDeclared") {
    return {
      status: "supervised" as const,
      source: "apple_guardian_declared_age_range" as const,
    };
  }
  return null;
}

function isValidTimestamp(value: string | null, nowMs: number): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= nowMs;
}

function isFutureTimestamp(value: string | null, nowMs: number): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > nowMs;
}

function hasEvidenceReference(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

function hasCurrentAgeAssurance(record: OrdysAiAssuranceRecord, nowMs: number): boolean {
  const verified =
    record.age_assurance_status === "verified" &&
    VERIFIED_AGE_SOURCES.has(record.age_assurance_source);
  const supervised =
    record.age_assurance_status === "supervised" &&
    SUPERVISED_AGE_SOURCES.has(record.age_assurance_source);

  return (
    hasEvidenceReference(record.age_evidence_reference) &&
    (verified || supervised) &&
    isValidTimestamp(record.age_assurance_verified_at, nowMs) &&
    isFutureTimestamp(record.age_assurance_expires_at, nowMs)
  );
}

function hasCurrentGuardianConsent(record: OrdysAiAssuranceRecord, nowMs: number): boolean {
  return (
    record.guardian_consent_status === "granted" &&
    TRUSTED_GUARDIAN_SOURCES.has(record.guardian_consent_source) &&
    record.guardian_identity_verified === true &&
    record.guardian_relationship_verified === true &&
    isValidTimestamp(record.guardian_consent_at, nowMs) &&
    isFutureTimestamp(record.guardian_consent_expires_at, nowMs) &&
    record.guardian_consent_policy_version === ORDYS_AI_GUARDIAN_CONSENT_POLICY_VERSION &&
    hasEvidenceReference(record.guardian_evidence_reference)
  );
}

/**
 * Decide access using a server-owned assurance record.
 *
 * Birth date, profile timezone, local storage, client flags and self-attestation
 * are intentionally absent from this input contract.
 */
export function evaluateOrdysAiAccess(
  record: OrdysAiAssuranceRecord | null | undefined,
  now = new Date(),
): OrdysAiAccessDecision {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return { allowed: false, tier: "blocked", reason: "assurance_missing" };
  }

  if (!record) {
    return { allowed: false, tier: "blocked", reason: "assurance_missing" };
  }

  const nowMs = now.getTime();
  if (record.ai_safety_policy_version !== ORDYS_AI_SAFETY_POLICY_VERSION) {
    return { allowed: false, tier: "blocked", reason: "policy_version_outdated" };
  }

  if (record.age_band === "unknown" || record.age_assurance_status === "unknown") {
    return { allowed: false, tier: "blocked", reason: "assurance_missing" };
  }

  if (record.age_band === "under_14") {
    return { allowed: false, tier: "blocked", reason: "age_band_unsupported" };
  }

  if (!hasCurrentAgeAssurance(record, nowMs)) {
    return { allowed: false, tier: "blocked", reason: "age_assurance_invalid" };
  }

  if (record.age_band === "18_plus") {
    if (record.age_assurance_status !== "verified") {
      return { allowed: false, tier: "blocked", reason: "age_assurance_invalid" };
    }
    return { allowed: true, tier: "adult", reason: "verified_adult" };
  }

  if (record.age_band !== "14_15" && record.age_band !== "16_17") {
    return { allowed: false, tier: "blocked", reason: "age_band_unsupported" };
  }

  if (
    record.guardian_consent_status === "pending" ||
    record.guardian_consent_status === "not_required" ||
    record.guardian_consent_status === "unknown"
  ) {
    return { allowed: false, tier: "blocked", reason: "guardian_consent_required" };
  }

  if (!hasCurrentGuardianConsent(record, nowMs)) {
    return { allowed: false, tier: "blocked", reason: "guardian_consent_invalid" };
  }

  return { allowed: true, tier: "minor_protected", reason: "verified_guardian_consent" };
}
