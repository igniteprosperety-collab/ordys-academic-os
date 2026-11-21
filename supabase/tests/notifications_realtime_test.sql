BEGIN;

SELECT plan(1);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ),
  'notifications is included in the Supabase Realtime publication'
);

SELECT * FROM finish();

ROLLBACK;
