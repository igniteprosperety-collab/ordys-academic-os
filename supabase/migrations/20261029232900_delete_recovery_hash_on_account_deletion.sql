-- Keep password-recovery abuse prevention pseudonymous. These hashes are not
-- linked to auth.users, because looking up an account inside the recovery RPC
-- would reintroduce an account-existence timing side channel.
--
-- The seven-day threshold is enforced opportunistically: a later valid
-- recovery request prunes rows older than seven days. There is no scheduled
-- cleanup job in this migration, so without a later request old hashes may
-- remain longer than seven days. When the signed-in owner deletes an account,
-- hashes for that account's current normalized email are removed immediately.
-- Hashes for previous email addresses remain pseudonymous until opportunistic
-- cleanup runs.
--
-- This migration changes schema/functions only and does not read or modify
-- academic records beyond the account-deletion RPC's existing owner-scoped cleanup.
CREATE OR REPLACE FUNCTION public.can_request_password_recovery(p_email TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $ordys$
DECLARE
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  hashed_email text;
  recent_count bigint;
  daily_count bigint;
BEGIN
  IF normalized_email = '' OR position('@' IN normalized_email) < 2 THEN
    RETURN json_build_object('allowed', false, 'reason', 'invalid_email');
  END IF;

  hashed_email := encode(digest(normalized_email, 'sha256'), 'hex');

  -- Serialize requests for the same normalized address before counting.
  PERFORM pg_advisory_xact_lock(hashtextextended(hashed_email, 0));

  DELETE FROM public.password_recovery_attempts
  WHERE requested_at < now() - interval '7 days';

  SELECT count(*)
  INTO recent_count
  FROM public.password_recovery_attempts AS attempt
  WHERE attempt.email_hash = hashed_email
    AND attempt.requested_at >= now() - interval '1 hour';

  IF recent_count >= 3 THEN
    RETURN json_build_object('allowed', false, 'reason', 'rate_limited');
  END IF;

  SELECT count(*)
  INTO daily_count
  FROM public.password_recovery_attempts AS attempt
  WHERE attempt.email_hash = hashed_email
    AND attempt.requested_at >= now() - interval '24 hours';

  IF daily_count >= 10 THEN
    RETURN json_build_object('allowed', false, 'reason', 'rate_limited');
  END IF;

  -- Do not query auth.users here. The Edge Function always calls the generic
  -- Supabase Auth recovery endpoint for every valid, non-rate-limited request.
  INSERT INTO public.password_recovery_attempts (email_hash)
  VALUES (hashed_email);

  RETURN json_build_object('allowed', true);
END;
$ordys$;

REVOKE ALL ON FUNCTION public.can_request_password_recovery(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_request_password_recovery(TEXT)
  TO service_role;

-- Remove recovery hashes for the currently authenticated account's email
-- during account deletion. Historical hashes for older addresses are not
-- linkable without weakening enumeration protections; they expire within
-- the same seven-day retention period.
CREATE OR REPLACE FUNCTION public.delete_own_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, extensions
AS $ordys$
DECLARE
  uid uuid := auth.uid();
  normalized_email text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT lower(btrim(email))
  INTO normalized_email
  FROM auth.users
  WHERE id = uid;

  IF normalized_email IS NOT NULL AND normalized_email <> '' THEN
    DELETE FROM public.password_recovery_attempts
    WHERE email_hash = encode(digest(normalized_email, 'sha256'), 'hex');
  END IF;

  DELETE FROM public.assistant_jobs WHERE user_id = uid;
  DELETE FROM public.quiz_answers WHERE user_id = uid;
  DELETE FROM public.quiz_attempts WHERE user_id = uid;
  DELETE FROM public.usage_events WHERE user_id = uid;
  DELETE FROM public.daily_checkins WHERE user_id = uid;
  DELETE FROM public.reviews WHERE user_id = uid;
  DELETE FROM public.plan_sessions WHERE user_id = uid;
  DELETE FROM public.focus_sessions WHERE user_id = uid;
  DELETE FROM public.goals WHERE user_id = uid;
  DELETE FROM public.grades WHERE user_id = uid;
  DELETE FROM public.attendance_records WHERE user_id = uid;
  DELETE FROM public.exam_topics WHERE user_id = uid;
  DELETE FROM public.exams WHERE user_id = uid;
  DELETE FROM public.subtasks WHERE user_id = uid;
  DELETE FROM public.tasks WHERE user_id = uid;
  DELETE FROM public.topics WHERE user_id = uid;
  DELETE FROM public.subject_schedules WHERE user_id = uid;
  DELETE FROM public.calendar_events WHERE user_id = uid;
  DELETE FROM public.calendar_connections WHERE user_id = uid;
  DELETE FROM public.subjects WHERE user_id = uid;
  DELETE FROM public.notifications WHERE user_id = uid;
  DELETE FROM public.push_subscriptions WHERE user_id = uid;
  DELETE FROM public.notification_preferences WHERE user_id = uid;
  DELETE FROM public.profiles WHERE id = uid;
END;
$ordys$;

REVOKE ALL ON FUNCTION public.delete_own_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_data() TO authenticated;
