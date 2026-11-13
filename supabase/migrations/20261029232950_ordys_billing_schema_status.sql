-- Allow the core account-deletion endpoint to distinguish an uninstalled
-- optional billing schema from a partial or unavailable billing schema.
-- Only service_role may inspect this deployment state.
CREATE OR REPLACE FUNCTION public.ordys_billing_schema_status()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN to_regclass('public.ordys_billing_settings') IS NULL
      AND to_regclass('public.ordys_billing_plans') IS NULL
      AND to_regclass('public.ordys_billing_checkout_attempts') IS NULL
      AND to_regclass('public.ordys_billing_subscriptions') IS NULL
      AND to_regclass('public.ordys_billing_payments') IS NULL
      AND to_regclass('public.ordys_billing_webhook_events') IS NULL
    THEN 'absent'
    WHEN to_regclass('public.ordys_billing_settings') IS NOT NULL
      AND to_regclass('public.ordys_billing_plans') IS NOT NULL
      AND to_regclass('public.ordys_billing_checkout_attempts') IS NOT NULL
      AND to_regclass('public.ordys_billing_subscriptions') IS NOT NULL
      AND to_regclass('public.ordys_billing_payments') IS NOT NULL
      AND to_regclass('public.ordys_billing_webhook_events') IS NOT NULL
    THEN 'ready'
    ELSE 'partial'
  END;
$$;

REVOKE ALL ON FUNCTION public.ordys_billing_schema_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_billing_schema_status()
  TO service_role;
