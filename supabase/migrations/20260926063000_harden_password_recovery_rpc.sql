-- Keep the recovery pre-check internal. Do not expose account existence through a public RPC.
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
    RETURN json_build_object('allowed', false, 'reason', 'invalid_email');
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
    RETURN json_build_object('allowed', false, 'reason', 'rate_limited');
  END IF;

  SELECT count(*) INTO daily_count
  FROM public.password_recovery_attempts
  WHERE email_hash = can_request_password_recovery.email_hash
    AND requested_at >= now() - interval '24 hours';

  IF daily_count >= 10 THEN
    RETURN json_build_object('allowed', false, 'reason', 'rate_limited');
  END IF;

  INSERT INTO public.password_recovery_attempts (email_hash) VALUES (email_hash);

  -- Pre-check the account internally, but never return this boolean to the client.
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(email) = normalized
  ) INTO exists_user;

  PERFORM exists_user;

  RETURN json_build_object('allowed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.can_request_password_recovery(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_request_password_recovery(TEXT) TO anon, authenticated, service_role;
