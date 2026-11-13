-- Apply least-privilege table ACLs to the public Data API roles.
--
-- RLS policies constrain row operations, but PostgreSQL does not apply RLS
-- to TRUNCATE or REFERENCES. API client roles only need row-level CRUD on
-- user-facing tables; they must not be able to truncate tables, create foreign
-- keys against them, or create triggers on them.
--
-- Preserve SELECT/INSERT/UPDATE/DELETE, sequence access, service_role grants,
-- table ownership and all existing RLS policies.
BEGIN;

REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

-- Fail the migration if a direct or inherited grant still exposes one of the
-- three privileges to either PostgREST client role.
DO $$
DECLARE
  offending_relations TEXT;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO offending_relations
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND (
      has_table_privilege('anon', c.oid, 'TRUNCATE')
      OR has_table_privilege('anon', c.oid, 'REFERENCES')
      OR has_table_privilege('anon', c.oid, 'TRIGGER')
      OR has_table_privilege('authenticated', c.oid, 'TRUNCATE')
      OR has_table_privilege('authenticated', c.oid, 'REFERENCES')
      OR has_table_privilege('authenticated', c.oid, 'TRIGGER')
    );

  IF offending_relations IS NOT NULL THEN
    RAISE EXCEPTION
      'Unsafe client table privileges remain on public relations: %',
      offending_relations;
  END IF;
END;
$$;

COMMIT;
