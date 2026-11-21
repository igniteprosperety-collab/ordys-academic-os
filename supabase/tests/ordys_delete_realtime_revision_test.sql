BEGIN;

SELECT plan(6);

SELECT has_column(
  'public',
  'profiles',
  'realtime_revision',
  'profiles exposes the owner-scoped realtime revision'
);

SELECT ok(
  (
    SELECT prosecdef
      FROM pg_proc
     WHERE oid = 'public.bump_ordys_profile_realtime_revision()'::regprocedure
  ),
  'the revision trigger function runs with SECURITY DEFINER'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.bump_ordys_profile_realtime_revision()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.bump_ordys_profile_realtime_revision()', 'EXECUTE'),
  'the trigger function cannot be called directly by client roles'
);

SELECT is(
  (
    SELECT string_agg(relation.relname::TEXT, ',' ORDER BY relation.relname::TEXT)
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND trigger_row.tgname = 'ordys_profile_revision_after_delete'
       AND NOT trigger_row.tgisinternal
  ),
  'attendance_records,calendar_connections,calendar_events,daily_checkins,exams,focus_sessions,goals,grades,notification_preferences,notifications,plan_sessions,quiz_answers,quiz_attempts,reviews,subject_schedules,subjects,subtasks,tasks,topics',
  'the revision trigger is attached to all 19 owner-scoped student tables'
);

SELECT is(
  (
    SELECT count(*)::INTEGER
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND trigger_row.tgname = 'ordys_profile_revision_after_delete'
       AND NOT trigger_row.tgisinternal
       AND (trigger_row.tgtype & 1) = 1
  ),
  0,
  'delete revision triggers are statement-level and coalesce bulk row deletes'
);

SELECT lives_ok(
  $test$
    DO $body$
    DECLARE
      test_user_id UUID := gen_random_uuid();
      revision_before BIGINT;
      revision_after BIGINT;
    BEGIN
      INSERT INTO auth.users (id, aud, role, email)
      VALUES (
        test_user_id,
        'authenticated',
        'authenticated',
        'ordys-realtime-' || replace(test_user_id::TEXT, '-', '') || '@example.test'
      );

      SELECT realtime_revision
        INTO revision_before
        FROM public.profiles
       WHERE id = test_user_id;

      INSERT INTO public.tasks (user_id, title)
      VALUES
        (test_user_id, 'Realtime delete propagation test one'),
        (test_user_id, 'Realtime delete propagation test two');

      DELETE FROM public.tasks
       WHERE user_id = test_user_id
         AND title LIKE 'Realtime delete propagation test %';

      SELECT realtime_revision
        INTO revision_after
        FROM public.profiles
       WHERE id = test_user_id;

      IF revision_after <> revision_before + 1 THEN
        RAISE EXCEPTION 'Expected one profile revision bump, got % -> %',
          revision_before, revision_after;
      END IF;

      DELETE FROM auth.users WHERE id = test_user_id;
    END
    $body$;
  $test$,
  'deleting a student row increments only that student profile revision'
);

SELECT * FROM finish();

ROLLBACK;
