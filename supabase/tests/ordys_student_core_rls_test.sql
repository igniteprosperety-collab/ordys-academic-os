begin;

select plan(18);

-- Deterministic synthetic identities. The whole test runs in one transaction
-- and is rolled back at the end; no real user or remote project is touched.
insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'ordys-rls-a@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Ordys RLS Student A"}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'ordys-rls-b@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Ordys RLS Student B"}'::jsonb,
    now(),
    now()
  );

insert into public.subjects (id, user_id, name)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Matemática do aluno A'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'História do aluno B'
  );

-- Every table that stores individual student data must have RLS and an
-- authenticated ownership policy. The list is intentionally explicit.
select is(
  (
    select count(*)::int
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname = any (array[
        'profiles',
        'subjects',
        'subject_schedules',
        'topics',
        'tasks',
        'subtasks',
        'exams',
        'exam_topics',
        'grades',
        'attendance_records',
        'focus_sessions',
        'plan_sessions',
        'reviews',
        'quiz_attempts',
        'quiz_answers',
        'daily_checkins',
        'goals',
        'calendar_events',
        'calendar_connections',
        'notifications',
        'notification_preferences',
        'push_subscriptions'
      ])
      and c.relrowsecurity
  ),
  22,
  'RLS is enabled on every individual student data table'
);

select is(
  (
    select count(distinct p.tablename)::int
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any (array[
        'profiles',
        'subjects',
        'subject_schedules',
        'topics',
        'tasks',
        'subtasks',
        'exams',
        'exam_topics',
        'grades',
        'attendance_records',
        'focus_sessions',
        'plan_sessions',
        'reviews',
        'quiz_attempts',
        'quiz_answers',
        'daily_checkins',
        'goals',
        'calendar_events',
        'calendar_connections',
        'notifications',
        'notification_preferences',
        'push_subscriptions'
      ])
      and p.roles @> array['authenticated']::name[]
  ),
  22,
  'Every individual student table has an authenticated policy'
);

select is(
  (
    select count(*)::int
    from unnest(array[
      'profiles',
      'subjects',
      'subject_schedules',
      'topics',
      'tasks',
      'subtasks',
      'exams',
      'exam_topics',
      'grades',
      'attendance_records',
      'focus_sessions',
      'plan_sessions',
      'reviews',
      'quiz_attempts',
      'quiz_answers',
      'daily_checkins',
      'goals',
      'calendar_events',
      'calendar_connections',
      'notifications',
      'notification_preferences',
      'push_subscriptions'
    ]) as t(table_name)
    where has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
       or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
       or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', table_name), 'DELETE')
  ),
  0,
  'The anon role has no direct access to individual student data tables'
);

select ok(
  has_table_privilege('authenticated', 'public.subjects', 'SELECT')
  and has_table_privilege('authenticated', 'public.subjects', 'INSERT')
  and has_table_privilege('authenticated', 'public.subjects', 'UPDATE')
  and has_table_privilege('authenticated', 'public.subjects', 'DELETE'),
  'authenticated has the CRUD privileges required by the student app'
);

-- Student A: own rows visible, another student's rows hidden.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',
  true
);

select is(
  (select count(*)::int from public.subjects
   where id = '20000000-0000-4000-8000-000000000001'),
  1,
  'student A can read their own subject'
);

select is(
  (select count(*)::int from public.subjects
   where id = '20000000-0000-4000-8000-000000000002'),
  0,
  'student A cannot read student B subject'
);

select lives_ok(
  $$insert into public.tasks (user_id, subject_id, title)
    values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Task owned by student A'
    )$$,
  'student A can create a task linked to their own subject'
);

select throws_ok(
  $$insert into public.tasks (user_id, subject_id, title)
    values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'Task linked to student B subject'
    )$$,
  'P0001',
  'referenced record does not belong to the current user',
  'student A cannot create a record linked to student B data'
);

select throws_ok(
  $$insert into public.subjects (user_id, name)
    values (
      '10000000-0000-4000-8000-000000000002',
      'Forged subject owned by student B'
    )$$,
  '42501',
  null,
  'student A cannot insert a row under student B identity'
);

select throws_ok(
  $$update public.subjects
    set user_id = '10000000-0000-4000-8000-000000000002'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'P0001',
  'ownership change not allowed',
  'student A cannot transfer ownership of an existing row'
);

-- Student B: the same policy must protect against reverse access as well.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aud":"authenticated"}',
  true
);

select is(
  (select count(*)::int from public.subjects
   where id = '20000000-0000-4000-8000-000000000001'),
  0,
  'student B cannot read student A subject'
);

select lives_ok(
  'delete from public.subjects where id = ''20000000-0000-4000-8000-000000000001''',
  'student B delete is filtered by RLS without touching student A data'
);

select lives_ok(
  'update public.subjects set name = ''Alteração indevida do aluno B'' where id = ''20000000-0000-4000-8000-000000000001''',
  'student B update of student A is filtered by RLS'
);

select lives_ok(
  'update public.subjects set name = ''História atualizada pelo aluno B'' where id = ''20000000-0000-4000-8000-000000000002''',
  'student B can update their own subject'
);

select is(
  (select name from public.subjects
   where id = '20000000-0000-4000-8000-000000000002'),
  'História atualizada pelo aluno B',
  'student B own subject update is persisted'
);

-- Confirm denied operations did not damage either student's data.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',
  true
);

select is(
  (select name from public.subjects
   where id = '20000000-0000-4000-8000-000000000001'),
  'Matemática do aluno A',
  'student A subject value remains unchanged after B delete and update attempts'
);

select is(
  (select count(*)::int from public.tasks
   where user_id = '10000000-0000-4000-8000-000000000001'
     and subject_id = '20000000-0000-4000-8000-000000000001'),
  1,
  'student A task persists under the correct owner'
);

select * from finish();
rollback;
