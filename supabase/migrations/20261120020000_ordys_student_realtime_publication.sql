-- Enable owner-scoped Postgres Changes for student-facing ORDYS data.
-- No table data or row-level security policy is changed by this migration.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'profiles',
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
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = table_name
      )
    THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;
