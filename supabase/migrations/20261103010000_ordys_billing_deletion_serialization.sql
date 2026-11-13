-- Serialize checkout creation and account deletion for each ORDYS user.
-- Lifecycle RPCs take the same transaction-scoped advisory lock. No external
-- Asaas request is made while this database transaction is open.

-- Billing is optional. Do not create a reservation table by itself, or
-- the schema-status RPC would misclassify an otherwise absent billing schema.
DO $$
BEGIN
  IF to_regclass('public.ordys_billing_checkout_attempts') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS public.ordys_account_deletion_reservations (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processing_token UUID,
      processing_until TIMESTAMPTZ,
      CONSTRAINT ordys_account_deletion_processing_pair
        CHECK ((processing_token IS NULL) = (processing_until IS NULL))
    );

    ALTER TABLE public.ordys_account_deletion_reservations
      ADD COLUMN IF NOT EXISTS processing_token UUID,
      ADD COLUMN IF NOT EXISTS processing_until TIMESTAMPTZ;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.ordys_account_deletion_reservations'::regclass
        AND conname = 'ordys_account_deletion_processing_pair'
    ) THEN
      ALTER TABLE public.ordys_account_deletion_reservations
        ADD CONSTRAINT ordys_account_deletion_processing_pair
        CHECK ((processing_token IS NULL) = (processing_until IS NULL));
    END IF;

    ALTER TABLE public.ordys_billing_checkout_attempts
      ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cancellation_claim_id UUID;

    COMMENT ON COLUMN public.ordys_billing_checkout_attempts.cancellation_claim_id IS
      'Unique owner token for the one-time Asaas Checkout cancellation claim, allowing the claimant to distinguish its own lost PATCH response from a concurrent claim.';

    ALTER TABLE public.ordys_billing_subscriptions
      ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cancellation_claim_id UUID,
      ADD COLUMN IF NOT EXISTS cancellation_confirmed_at TIMESTAMPTZ;

    COMMENT ON COLUMN public.ordys_billing_subscriptions.cancellation_claim_id IS
      'Unique owner token for the one-time Asaas recurring-subscription cancellation claim, allowing the claimant to distinguish its own lost PATCH response from a concurrent claim.';

    ALTER TABLE public.ordys_account_deletion_reservations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.ordys_account_deletion_reservations FROM PUBLIC, anon, authenticated;
    GRANT ALL ON public.ordys_account_deletion_reservations TO service_role;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ordys_begin_billing_checkout_attempt(
  p_user_id UUID,
  p_attempt_id UUID,
  p_plan_code TEXT,
  p_external_reference TEXT,
  p_amount_cents BIGINT,
  p_expires_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_user_id IS NULL
    OR p_attempt_id IS NULL
    OR p_plan_code IS NULL
    OR btrim(p_plan_code) = ''
    OR p_external_reference IS NULL
    OR btrim(p_external_reference) = ''
    OR p_amount_cents IS NULL
    OR p_amount_cents <= 0
    OR p_expires_at IS NULL
    OR p_expires_at <= now()
    OR p_expires_at > now() + INTERVAL '2 hours' THEN
    RAISE EXCEPTION 'Invalid ORDYS checkout attempt parameters';
  END IF;

  -- This exact lock key is also used by ordys_reserve_account_deletion.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:billing-lifecycle:' || p_user_id::TEXT, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.ordys_account_deletion_reservations AS reservation
    WHERE reservation.user_id = p_user_id
  ) THEN
    RETURN 'deletion_reserved';
  END IF;

  -- Recheck unresolved attempts under the per-user lock. The earlier Edge
  -- Function read is advisory only and cannot prevent simultaneous requests.
  IF EXISTS (
    SELECT 1
    FROM public.ordys_billing_checkout_attempts AS attempt
    WHERE attempt.user_id = p_user_id
      AND attempt.status IN ('creating', 'pending', 'paid', 'linked')
  ) THEN
    RETURN 'checkout_in_progress';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ordys_billing_settings AS settings
    WHERE settings.id = 1
      AND settings.billing_enabled = TRUE
  ) THEN
    RAISE EXCEPTION 'ORDYS billing is not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ordys_billing_plans AS plan
    WHERE plan.plan_code = p_plan_code
      AND plan.enabled = TRUE
      AND plan.price_cents = p_amount_cents
      AND plan.currency = 'BRL'
  ) THEN
    RAISE EXCEPTION 'ORDYS billing plan is unavailable';
  END IF;

  INSERT INTO public.ordys_billing_checkout_attempts (
    id,
    user_id,
    plan_code,
    external_reference,
    amount_cents,
    status,
    expires_at
  )
  VALUES (
    p_attempt_id,
    p_user_id,
    p_plan_code,
    p_external_reference,
    p_amount_cents,
    'creating',
    p_expires_at
  );

  RETURN 'created';
END;
$$;

REVOKE ALL ON FUNCTION public.ordys_begin_billing_checkout_attempt(UUID, UUID, TEXT, TEXT, BIGINT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_begin_billing_checkout_attempt(UUID, UUID, TEXT, TEXT, BIGINT, TIMESTAMPTZ)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ordys_reserve_account_deletion(
  p_user_id UUID
)
RETURNS TEXT
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid ORDYS account deletion user';
  END IF;

  -- Must match the lock key used by ordys_begin_billing_checkout_attempt.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:billing-lifecycle:' || p_user_id::TEXT, 0)
  );

  -- Repeated deletion requests are safe and continue the existing workflow.
  IF EXISTS (
    SELECT 1
    FROM public.ordys_account_deletion_reservations AS reservation
    WHERE reservation.user_id = p_user_id
  ) THEN
    RETURN 'reserved';
  END IF;

  -- Do not reserve deletion while an Edge Function may still be creating a
  -- remote Asaas Checkout. The caller must retry after it is reconciled.
  IF EXISTS (
    SELECT 1
    FROM public.ordys_billing_checkout_attempts AS attempt
    WHERE attempt.user_id = p_user_id
      AND attempt.status = 'creating'
  ) THEN
    RETURN 'checkout_creation_in_progress';
  END IF;

  INSERT INTO public.ordys_account_deletion_reservations (user_id)
  VALUES (p_user_id);

  RETURN 'reserved';
END;
$$;

REVOKE ALL ON FUNCTION public.ordys_reserve_account_deletion(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_reserve_account_deletion(UUID)
  TO service_role;

-- Short lease: a second delete request cannot duplicate provider cancellation.
CREATE OR REPLACE FUNCTION public.ordys_claim_account_deletion_processing(
  p_user_id UUID, p_processing_token UUID
)
RETURNS TEXT
LANGUAGE PLPGSQL
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_processing_token IS NULL THEN
    RAISE EXCEPTION 'Invalid ORDYS account deletion processing claim';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ordys:billing-lifecycle:' || p_user_id::TEXT, 0));
  UPDATE public.ordys_account_deletion_reservations
  SET processing_token = p_processing_token,
      processing_until = now() + INTERVAL '10 minutes'
  WHERE user_id = p_user_id
    AND (processing_until IS NULL OR processing_until <= now());
  IF FOUND THEN RETURN 'claimed'; END IF;
  IF EXISTS (SELECT 1 FROM public.ordys_account_deletion_reservations WHERE user_id = p_user_id) THEN
    RETURN 'deletion_processing';
  END IF;
  RETURN 'not_reserved';
END;
$$;
REVOKE ALL ON FUNCTION public.ordys_claim_account_deletion_processing(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_claim_account_deletion_processing(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ordys_release_account_deletion_processing(
  p_user_id UUID, p_processing_token UUID
)
RETURNS TEXT
LANGUAGE PLPGSQL
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_processing_token IS NULL THEN
    RAISE EXCEPTION 'Invalid ORDYS account deletion processing release';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ordys:billing-lifecycle:' || p_user_id::TEXT, 0));
  IF NOT EXISTS (SELECT 1 FROM public.ordys_account_deletion_reservations WHERE user_id = p_user_id) THEN
    RETURN 'not_reserved';
  END IF;
  UPDATE public.ordys_account_deletion_reservations
  SET processing_token = NULL, processing_until = NULL
  WHERE user_id = p_user_id AND processing_token = p_processing_token;
  IF FOUND THEN RETURN 'released'; END IF;
  RETURN 'not_owner';
END;
$$;
REVOKE ALL ON FUNCTION public.ordys_release_account_deletion_processing(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_release_account_deletion_processing(UUID, UUID)
  TO service_role;

-- Manual recovery only. The operator must independently confirm that Asaas
-- has no live Checkout or recurring subscription before passing TRUE.
CREATE OR REPLACE FUNCTION public.ordys_release_account_deletion_reservation(
  p_user_id UUID,
  p_provider_state_verified BOOLEAN
)
RETURNS TEXT
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid ORDYS account deletion user';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:billing-lifecycle:' || p_user_id::TEXT, 0)
  );

  IF p_provider_state_verified IS DISTINCT FROM TRUE THEN
    RETURN 'provider_verification_required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ordys_account_deletion_reservations
    WHERE user_id = p_user_id AND processing_until > now()
  ) THEN
    RETURN 'deletion_processing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ordys_billing_checkout_attempts AS attempt
    WHERE attempt.user_id = p_user_id
      AND attempt.status IN ('creating', 'pending', 'paid', 'linked')
  ) OR EXISTS (
    SELECT 1
    FROM public.ordys_billing_subscriptions AS subscription
    WHERE subscription.user_id = p_user_id
      AND subscription.status IN ('pending', 'active', 'past_due', 'suspended')
  ) THEN
    RETURN 'billing_reconciliation_required';
  END IF;

  DELETE FROM public.ordys_account_deletion_reservations AS reservation
  WHERE reservation.user_id = p_user_id;

  IF FOUND THEN
    RETURN 'released';
  END IF;
  RETURN 'not_reserved';
END;
$$;

REVOKE ALL ON FUNCTION public.ordys_release_account_deletion_reservation(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_release_account_deletion_reservation(UUID, BOOLEAN)
  TO service_role;

-- "ready" requires the reservation, checkout/deletion serialization RPCs,
-- processing lease fields and processing claim/release RPCs.
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
      AND to_regclass('public.ordys_account_deletion_reservations') IS NULL
    THEN 'absent'
    WHEN to_regclass('public.ordys_billing_settings') IS NOT NULL
      AND to_regclass('public.ordys_billing_plans') IS NOT NULL
      AND to_regclass('public.ordys_billing_checkout_attempts') IS NOT NULL
      AND to_regclass('public.ordys_billing_subscriptions') IS NOT NULL
      AND to_regclass('public.ordys_billing_payments') IS NOT NULL
      AND to_regclass('public.ordys_billing_webhook_events') IS NOT NULL
      AND to_regclass('public.ordys_account_deletion_reservations') IS NOT NULL
      AND to_regprocedure('public.ordys_begin_billing_checkout_attempt(uuid,uuid,text,text,bigint,timestamp with time zone)') IS NOT NULL
      AND to_regprocedure('public.ordys_reserve_account_deletion(uuid)') IS NOT NULL
      AND to_regprocedure('public.ordys_release_account_deletion_reservation(uuid,boolean)') IS NOT NULL
      AND to_regprocedure('public.ordys_claim_account_deletion_processing(uuid,uuid)') IS NOT NULL
      AND to_regprocedure('public.ordys_release_account_deletion_processing(uuid,uuid)') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations') AND attname = 'processing_token' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations') AND attname = 'processing_until' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts') AND attname = 'cancellation_requested_at' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts') AND attname = 'cancellation_claim_id' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_subscriptions') AND attname = 'cancellation_requested_at' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_subscriptions') AND attname = 'cancellation_claim_id' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_subscriptions') AND attname = 'cancellation_confirmed_at' AND NOT attisdropped)
    THEN 'ready'
    ELSE 'partial'
  END;
$$;

REVOKE ALL ON FUNCTION public.ordys_billing_schema_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_billing_schema_status()
  TO service_role;
