-- Profile fields kept as separate typed columns (not a free-form blob).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS school_name TEXT,
  ADD COLUMN IF NOT EXISTS education_level TEXT,
  ADD COLUMN IF NOT EXISTS course TEXT,
  ADD COLUMN IF NOT EXISTS class_name TEXT;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_birth_date_reasonable
    CHECK (birth_date IS NULL OR (birth_date >= DATE '1900-01-01' AND birth_date < DATE '2100-01-01')),
  ADD CONSTRAINT profiles_country_len CHECK (country IS NULL OR char_length(btrim(country)) BETWEEN 1 AND 100),
  ADD CONSTRAINT profiles_state_len CHECK (state IS NULL OR char_length(btrim(state)) BETWEEN 1 AND 100),
  ADD CONSTRAINT profiles_city_len CHECK (city IS NULL OR char_length(btrim(city)) BETWEEN 1 AND 120),
  ADD CONSTRAINT profiles_school_len CHECK (school_name IS NULL OR char_length(btrim(school_name)) BETWEEN 1 AND 180),
  ADD CONSTRAINT profiles_education_level_len CHECK (education_level IS NULL OR char_length(btrim(education_level)) BETWEEN 1 AND 100),
  ADD CONSTRAINT profiles_course_len CHECK (course IS NULL OR char_length(btrim(course)) BETWEEN 1 AND 160),
  ADD CONSTRAINT profiles_class_name_len CHECK (class_name IS NULL OR char_length(btrim(class_name)) BETWEEN 1 AND 80);

-- Password-recovery anti-abuse store. No client role can read/write this table directly.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.password_recovery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_recovery_attempts_hash_time_idx
  ON public.password_recovery_attempts(email_hash, requested_at DESC);

REVOKE ALL ON public.password_recovery_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.password_recovery_attempts TO service_role;
ALTER TABLE public.password_recovery_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_request_password_recovery(p_email TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  normalized TEXT := lower(btrim(coalesce(p_email, '')));
  email_hash TEXT;
  recent_count INT;
  daily_count INT;
  exists_user BOOLEAN;
BEGIN
  IF normalized = '' OR position('@' IN normalized) < 2 THEN
    RETURN json_build_object('allowed', false, 'exists', false, 'reason', 'invalid_email');
  END IF;

  email_hash := encode(digest(normalized, 'sha256'), 'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended(email_hash, 0));

  DELETE FROM public.password_recovery_attempts
  WHERE requested_at < now() - interval '7 days';

  SELECT count(*) INTO recent_count
  FROM public.password_recovery_attempts
  WHERE email_hash = can_request_password_recovery.email_hash
    AND requested_at >= now() - interval '1 hour';

  IF recent_count >= 3 THEN
    RETURN json_build_object('allowed', false, 'exists', false, 'reason', 'rate_limited');
  END IF;

  SELECT count(*) INTO daily_count
  FROM public.password_recovery_attempts
  WHERE email_hash = can_request_password_recovery.email_hash
    AND requested_at >= now() - interval '24 hours';

  IF daily_count >= 10 THEN
    RETURN json_build_object('allowed', false, 'exists', false, 'reason', 'rate_limited');
  END IF;

  INSERT INTO public.password_recovery_attempts (email_hash) VALUES (email_hash);

  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(email) = normalized
  ) INTO exists_user;

  RETURN json_build_object('allowed', true, 'exists', exists_user);
END;
$$;

REVOKE ALL ON FUNCTION public.can_request_password_recovery(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_request_password_recovery(TEXT) TO service_role;
