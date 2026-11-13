-- Harden future public-schema objects created by the project migration role.
--
-- The production Lovable Cloud SQL connection was inspected read-only on
-- 2026-10-31: current_user/session_user are both postgres, and every existing
-- public application table is owned by postgres. That role is not a member of
-- supabase_admin, so this migration deliberately changes only postgres-owned
-- defaults instead of attempting an unauthorized ALTER DEFAULT PRIVILEGES for
-- the platform-managed supabase_admin role.
--
-- Preserve service_role (and the platform's sandbox_exec defaults) unchanged.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. A schema-
-- scoped REVOKE cannot subtract privileges inherited from the global default,
-- so remove PUBLIC EXECUTE globally for functions created by postgres; this
-- does not remove grants from existing functions.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Verify the effective default ACL catalog without creating any application
-- objects. This is intentionally catalog-only so release static checks do
-- not mistake a probe table for a new user-facing data table.
DO $$
DECLARE
  v_owner oid := 'postgres'::regrole;
  v_schema oid := 'public'::regnamespace;
  v_anon oid := 'anon'::regrole;
  v_authenticated oid := 'authenticated'::regrole;
  v_service_role oid := 'service_role'::regrole;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = v_owner
      AND (
        (
          d.defaclnamespace = v_schema
          AND d.defaclobjtype IN ('r', 'S')
          AND a.grantee IN (0, v_anon, v_authenticated)
        )
        OR (
          d.defaclnamespace = v_schema
          AND d.defaclobjtype = 'f'
          AND a.grantee IN (0, v_anon, v_authenticated)
        )
        OR (
          d.defaclnamespace = 0
          AND d.defaclobjtype = 'f'
          AND a.grantee = 0
        )
      )
  ) THEN
    RAISE EXCEPTION 'Unsafe default ACL remains for future public objects created by postgres';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = v_owner
      AND d.defaclnamespace = v_schema
      AND d.defaclobjtype = 'r'
      AND a.grantee = v_service_role
      AND a.privilege_type IN ('SELECT', 'INSERT')
    GROUP BY d.oid
    HAVING count(DISTINCT a.privilege_type) = 2
  ) THEN
    RAISE EXCEPTION 'Expected service_role table defaults were not preserved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = v_owner
      AND d.defaclnamespace = v_schema
      AND d.defaclobjtype = 'S'
      AND a.grantee = v_service_role
      AND a.privilege_type = 'USAGE'
  ) THEN
    RAISE EXCEPTION 'Expected service_role sequence default was not preserved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = v_owner
      AND d.defaclnamespace = v_schema
      AND d.defaclobjtype = 'f'
      AND a.grantee = v_service_role
      AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Expected service_role function default was not preserved';
  END IF;
END;
$$;
