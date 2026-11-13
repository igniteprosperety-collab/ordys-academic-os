-- Harden the public schema and SECURITY DEFINER functions.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

ALTER FUNCTION public.handle_new_user()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.enforce_same_owner_refs()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.can_request_password_recovery(TEXT)
  SET search_path = pg_catalog, public, auth, extensions;

ALTER FUNCTION public.consume_usage_limit(UUID, TEXT, INT, INT)
  SET search_path = pg_catalog, public;

-- Internal tables must remain inaccessible to API roles.
REVOKE ALL ON public.password_recovery_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.assistant_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.usage_events FROM PUBLIC, anon, authenticated;
