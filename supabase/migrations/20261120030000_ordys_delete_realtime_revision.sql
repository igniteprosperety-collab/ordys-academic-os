-- Turn owner-scoped profile UPDATE events into a safe signal for remote deletes.
-- Supabase Postgres Changes does not apply RLS to DELETE events, so clients must
-- never subscribe to unfiltered DELETE payloads from student tables.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS realtime_revision BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.realtime_revision IS
  'Monotonic owner-scoped invalidation revision. Incremented by academic row DELETE triggers.';

CREATE OR REPLACE FUNCTION public.bump_ordys_profile_realtime_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $ordys$
BEGIN
  -- A statement-level transition table coalesces bulk deletes to one profile
  -- revision bump per affected student and per deleted table.
  UPDATE public.profiles AS profile
     SET realtime_revision = profile.realtime_revision + 1
   WHERE profile.id IN (
     SELECT DISTINCT deleted_rows.user_id
       FROM deleted_rows
   )
     -- During auth.users ON DELETE CASCADE the parent is already invisible.
     -- Skip the bump so account deletion cannot update a profile being removed.
     AND EXISTS (
       SELECT 1
         FROM auth.users AS auth_user
        WHERE auth_user.id = profile.id
     );

  RETURN NULL;
END;
$ordys$;

REVOKE ALL ON FUNCTION public.bump_ordys_profile_realtime_revision()
  FROM PUBLIC, anon, authenticated;

DO $ordys$
DECLARE
  v_table_name TEXT;
  student_tables TEXT[] := ARRAY[
    'subjects',
    'subject_schedules',
    'topics',
    'tasks',
    'subtasks',
    'exams',
    'grades',
    'attendance_records',
    'focus_sessions',
    'plan_sessions',
    'reviews',
    'goals',
    'notifications',
    'notification_preferences',
    'calendar_events',
    'calendar_connections',
    'daily_checkins',
    'quiz_attempts',
    'quiz_answers'
  ];
BEGIN
  FOREACH v_table_name IN ARRAY student_tables LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required ORDYS table public.% is missing', v_table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.columns AS column_info
       WHERE column_info.table_schema = 'public'
         AND column_info.table_name = v_table_name
         AND column_info.column_name = 'user_id'
    ) THEN
      RAISE EXCEPTION 'Required owner column public.%.user_id is missing', v_table_name;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS ordys_profile_revision_after_delete ON public.%I',
      v_table_name
    );
    EXECUTE format(
      'CREATE TRIGGER ordys_profile_revision_after_delete
         AFTER DELETE ON public.%I
         REFERENCING OLD TABLE AS deleted_rows
         FOR EACH STATEMENT
         EXECUTE FUNCTION public.bump_ordys_profile_realtime_revision()',
      v_table_name
    );
  END LOOP;
END;
$ordys$;
