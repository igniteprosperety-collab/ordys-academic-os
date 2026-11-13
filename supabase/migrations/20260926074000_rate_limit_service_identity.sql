-- Final server-only rate limiter definition.
CREATE OR REPLACE FUNCTION public.consume_usage_limit(
  p_user_id UUID,
  p_kind TEXT,
  p_hourly_limit INT,
  p_daily_limit INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := p_user_id;
  hour_count INT;
  day_count INT;
BEGIN
  -- This function is executable only by service_role. The caller (Edge Function)
  -- passes the user id obtained from Supabase Auth after validating the bearer token.
  IF uid IS NULL THEN
    RETURN json_build_object('allowed', false, 'reason', 'invalid_user');
  END IF;

  IF p_kind IS NULL OR btrim(p_kind) = '' OR p_hourly_limit < 1 OR p_daily_limit < 1 THEN
    RETURN json_build_object('allowed', false, 'reason', 'invalid_limit');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_kind, 0));

  SELECT count(*) INTO hour_count
  FROM public.usage_events
  WHERE user_id = uid
    AND kind = p_kind
    AND created_at >= now() - interval '1 hour';

  IF hour_count >= p_hourly_limit THEN
    RETURN json_build_object('allowed', false, 'reason', 'hourly_limit');
  END IF;

  SELECT count(*) INTO day_count
  FROM public.usage_events
  WHERE user_id = uid
    AND kind = p_kind
    AND created_at >= now() - interval '24 hours';

  IF day_count >= p_daily_limit THEN
    RETURN json_build_object('allowed', false, 'reason', 'daily_limit');
  END IF;

  INSERT INTO public.usage_events (user_id, kind)
  VALUES (uid, left(p_kind, 60));

  RETURN json_build_object(
    'allowed', true,
    'hourly_remaining', GREATEST(p_hourly_limit - hour_count - 1, 0),
    'daily_remaining', GREATEST(p_daily_limit - day_count - 1, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_usage_limit(UUID, TEXT, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_usage_limit(UUID, TEXT, INT, INT)
  TO service_role;
