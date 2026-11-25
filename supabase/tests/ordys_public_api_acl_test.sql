BEGIN;

SELECT plan(9);

SELECT is(
  (
    SELECT count(*)::int
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
      )
  ),
  0,
  'anon and authenticated have no structural privileges on public tables'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(
      coalesce(c.relacl, acldefault('r', c.relowner))
    ) AS acl
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND acl.grantee = 0
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  0,
  'PUBLIC has no structural privilege on public tables'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_default_acl AS d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclrole = 'postgres'::regrole
      AND (
        (
          d.defaclnamespace = 'public'::regnamespace
          AND d.defaclobjtype IN ('r', 'S', 'f')
          AND acl.grantee IN (
            0,
            'anon'::regrole,
            'authenticated'::regrole
          )
        )
        OR (
          d.defaclnamespace = 0
          AND d.defaclobjtype = 'f'
          AND acl.grantee = 0
        )
      )
  ),
  0,
  'future public tables, sequences and functions have no unsafe client/PUBLIC defaults'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclnamespace = 'public'::regnamespace
      AND d.defaclobjtype = 'r'
      AND acl.grantee = 'service_role'::regrole
      AND acl.privilege_type = 'SELECT'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclnamespace = 'public'::regnamespace
      AND d.defaclobjtype = 'r'
      AND acl.grantee = 'service_role'::regrole
      AND acl.privilege_type = 'INSERT'
  ),
  'service_role retains the table defaults required by trusted server operations'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclnamespace = 'public'::regnamespace
      AND d.defaclobjtype = 'S'
      AND acl.grantee = 'service_role'::regrole
      AND acl.privilege_type = 'USAGE'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclnamespace = 'public'::regnamespace
      AND d.defaclobjtype = 'f'
      AND acl.grantee = 'service_role'::regrole
      AND acl.privilege_type = 'EXECUTE'
  ),
  'service_role retains sequence and function defaults for future server objects'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.subjects', 'SELECT')
  AND has_table_privilege('authenticated', 'public.subjects', 'INSERT')
  AND has_table_privilege('authenticated', 'public.subjects', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.subjects', 'DELETE'),
  'authenticated retains the row-level CRUD grants required by the student app'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.subjects'::regclass
  ),
  'the existing subjects RLS boundary remains enabled'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.subjects', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.subjects', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.subjects', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.subjects', 'DELETE'),
  'anon has no direct row-level access to student subjects'
);

SELECT ok(
  has_table_privilege('service_role', 'public.ordys_billing_webhook_inbox', 'SELECT')
  AND has_table_privilege('service_role', 'public.ordys_billing_webhook_inbox', 'INSERT'),
  'service_role retains access to the internal durable Asaas receipt inbox'
);

SELECT * FROM finish();
ROLLBACK;
