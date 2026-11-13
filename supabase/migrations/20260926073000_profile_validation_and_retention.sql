-- Data validation that depends on the current date belongs in a trigger, not a CHECK.
CREATE OR REPLACE FUNCTION public.validate_profile_birth_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $ordys$
BEGIN
  IF NEW.birth_date IS NOT NULL AND NEW.birth_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'birth_date cannot be in the future';
  END IF;
  RETURN NEW;
END;
$ordys$;

DROP TRIGGER IF EXISTS profiles_birth_date_validate ON public.profiles;
CREATE TRIGGER profiles_birth_date_validate
  BEFORE INSERT OR UPDATE OF birth_date ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profile_birth_date();

-- Include long-running assistant job records in the account data deletion path.
CREATE OR REPLACE FUNCTION public.delete_own_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $ordys$DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
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
