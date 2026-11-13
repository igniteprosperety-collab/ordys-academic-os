-- Trigger functions are invoked by PostgreSQL as part of table writes; clients
-- must not be able to call them directly through PostgREST RPC.
-- Revoke direct execution from PUBLIC, anon and authenticated for every
-- existing trigger-returning function in the public schema. This is idempotent
-- and also covers trigger functions added before the default-privilege hardening.
DO $$
DECLARE
  trigger_function RECORD;
BEGIN
  FOR trigger_function IN
    SELECT DISTINCT
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_trigger AS t
    JOIN pg_proc AS p ON p.oid = t.tgfoid
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      trigger_function.nspname,
      trigger_function.proname,
      trigger_function.identity_arguments
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'trigger'::regtype
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) THEN
    RAISE EXCEPTION
      'A public trigger function remains executable by anon or authenticated';
  END IF;
END;
$$;
