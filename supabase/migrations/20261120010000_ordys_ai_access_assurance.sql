-- Server-owned evidence and consent state for per-account AI access.
-- No raw identity documents, full birth dates, or guardian email addresses are stored.
-- Client roles have no Data API access to this table; only trusted server code may
-- create or update records after validating platform/provider evidence.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ordys_ai_access_assurance (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  age_band TEXT NOT NULL DEFAULT 'unknown'
    CHECK (age_band IN ('under_14', '14_15', '16_17', '18_plus', 'unknown')),
  age_assurance_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (age_assurance_status IN ('verified', 'supervised', 'declared', 'unknown', 'revoked')),
  age_assurance_source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (age_assurance_source IN ('google_play_tier_d', 'google_play_tier_b_supervised', 'apple_confirmed_age_range', 'apple_guardian_declared_age_range', 'external_provider_verified', 'unknown')),
  age_assurance_verified_at TIMESTAMPTZ,
  age_assurance_expires_at TIMESTAMPTZ,
  guardian_consent_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (guardian_consent_status IN ('granted', 'pending', 'denied', 'revoked', 'expired', 'not_required', 'unknown')),
  guardian_consent_source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (guardian_consent_source IN ('verified_guardian_portal', 'external_provider_verified', 'unknown')),
  guardian_identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  guardian_relationship_verified BOOLEAN NOT NULL DEFAULT FALSE,
  guardian_consent_at TIMESTAMPTZ,
  guardian_consent_expires_at TIMESTAMPTZ,
  guardian_consent_policy_version TEXT,
  age_evidence_reference TEXT CHECK (age_evidence_reference IS NULL OR char_length(btrim(age_evidence_reference)) BETWEEN 1 AND 200),
  guardian_evidence_reference TEXT CHECK (guardian_evidence_reference IS NULL OR char_length(btrim(guardian_evidence_reference)) BETWEEN 1 AND 200),
  ai_safety_policy_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    age_assurance_status NOT IN ('verified', 'supervised')
    OR (age_assurance_source <> 'unknown' AND age_assurance_verified_at IS NOT NULL AND age_assurance_expires_at IS NOT NULL AND age_evidence_reference IS NOT NULL)
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
      AND guardian_evidence_reference IS NOT NULL
    )
  )
);

ALTER TABLE public.ordys_ai_access_assurance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ordys_ai_access_assurance FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ordys_ai_access_assurance TO service_role;

COMMENT ON TABLE public.ordys_ai_access_assurance IS
  'Server-only age assurance and guardian-consent evidence used to decide Ordys OpenAI access per account.';

COMMENT ON COLUMN public.ordys_ai_access_assurance.age_evidence_reference IS
  'Opaque age-provider reference only. Store no ID image, document number, raw provider payload, or direct contact data.';

COMMENT ON COLUMN public.ordys_ai_access_assurance.guardian_evidence_reference IS
  'Opaque guardian-verification and consent reference only. Store no ID image, document number, raw provider payload, or direct contact data.';

CREATE TABLE IF NOT EXISTS public.ordys_ai_access_audit (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'age_assurance_recorded',
      'guardian_consent_granted',
      'guardian_consent_revoked',
      'guardian_consent_expired',
      'ai_access_granted',
      'ai_access_denied',
      'policy_updated'
    )
  ),
  actor_type TEXT NOT NULL CHECK (
    actor_type IN ('student', 'guardian', 'provider', 'operator', 'system')
  ),
  age_band TEXT CHECK (age_band IS NULL OR age_band IN ('under_14', '14_15', '16_17', '18_plus', 'unknown')),
  age_assurance_source TEXT CHECK (age_assurance_source IS NULL OR age_assurance_source IN ('google_play_tier_d', 'google_play_tier_b_supervised', 'apple_confirmed_age_range', 'apple_guardian_declared_age_range', 'external_provider_verified', 'unknown')),
  guardian_consent_status TEXT CHECK (guardian_consent_status IS NULL OR guardian_consent_status IN ('granted', 'pending', 'denied', 'revoked', 'expired', 'not_required', 'unknown')),
  guardian_consent_source TEXT CHECK (guardian_consent_source IS NULL OR guardian_consent_source IN ('verified_guardian_portal', 'external_provider_verified', 'unknown')),
  guardian_consent_policy_version TEXT,
  ai_safety_policy_version TEXT,
  age_evidence_reference TEXT CHECK (age_evidence_reference IS NULL OR char_length(btrim(age_evidence_reference)) BETWEEN 1 AND 200),
  guardian_evidence_reference TEXT CHECK (guardian_evidence_reference IS NULL OR char_length(btrim(guardian_evidence_reference)) BETWEEN 1 AND 200),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ordys_ai_access_audit_user_time_idx
  ON public.ordys_ai_access_audit(user_id, occurred_at DESC);

ALTER TABLE public.ordys_ai_access_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ordys_ai_access_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ordys_ai_access_audit TO service_role;

CREATE OR REPLACE FUNCTION public.reject_ordys_ai_access_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $ordys_ai_access_audit$
BEGIN
  RAISE EXCEPTION 'ORDYS_AI_ACCESS_AUDIT_APPEND_ONLY';
END;
$ordys_ai_access_audit$;

REVOKE ALL ON FUNCTION public.reject_ordys_ai_access_audit_mutation()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ordys_ai_access_audit_append_only
BEFORE UPDATE OR DELETE ON public.ordys_ai_access_audit
FOR EACH ROW EXECUTE FUNCTION public.reject_ordys_ai_access_audit_mutation();

COMMENT ON TABLE public.ordys_ai_access_audit IS
  'Server-only append-only audit events for age assurance, guardian consent, and per-account AI authorization. Contains no raw identity documents or direct contact information.';

COMMIT;
