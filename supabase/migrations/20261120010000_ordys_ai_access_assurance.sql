-- Server-owned evidence and consent state for per-account AI access.
-- No raw identity documents, full birth dates, or guardian email addresses are stored.
-- Client roles have no Data API access to this table; only trusted server code may
-- create or update records after validating platform/provider evidence.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ordys_ai_access_assurance (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  age_band TEXT NOT NULL DEFAULT 'unknown'
    CHECK (age_band IN ('under_13', '13_15', '16_17', '18_plus', 'unknown')),
  age_assurance_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (age_assurance_status IN ('verified', 'supervised', 'declared', 'unknown', 'revoked')),
  age_assurance_source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (age_assurance_source IN ('google_play', 'apple_declared_age_range', 'external_provider', 'operator_review', 'unknown')),
  age_assurance_verified_at TIMESTAMPTZ,
  age_assurance_expires_at TIMESTAMPTZ,
  guardian_consent_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (guardian_consent_status IN ('granted', 'pending', 'denied', 'revoked', 'expired', 'not_required', 'unknown')),
  guardian_consent_source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (guardian_consent_source IN ('verified_guardian_portal', 'external_provider', 'operator_review', 'unknown')),
  guardian_identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  guardian_relationship_verified BOOLEAN NOT NULL DEFAULT FALSE,
  guardian_consent_at TIMESTAMPTZ,
  guardian_consent_expires_at TIMESTAMPTZ,
  guardian_consent_policy_version TEXT,
  ai_safety_policy_version TEXT,
  evidence_reference TEXT CHECK (evidence_reference IS NULL OR char_length(evidence_reference) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    age_assurance_status <> 'verified'
    OR (age_assurance_source <> 'unknown' AND age_assurance_verified_at IS NOT NULL AND age_assurance_expires_at IS NOT NULL)
  ),
  CHECK (
    guardian_consent_status <> 'granted'
    OR (
      guardian_consent_source <> 'unknown'
      AND guardian_identity_verified
      AND guardian_relationship_verified
      AND guardian_consent_at IS NOT NULL
      AND guardian_consent_expires_at IS NOT NULL
      AND guardian_consent_policy_version IS NOT NULL
    )
  )
);

ALTER TABLE public.ordys_ai_access_assurance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ordys_ai_access_assurance FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ordys_ai_access_assurance TO service_role;

COMMENT ON TABLE public.ordys_ai_access_assurance IS
  'Server-only age assurance and guardian-consent evidence used to decide Ordys OpenAI access per account.';

COMMENT ON COLUMN public.ordys_ai_access_assurance.evidence_reference IS
  'Opaque provider/operator reference only. Never store an ID image, document number, or raw provider payload here.';

COMMIT;
