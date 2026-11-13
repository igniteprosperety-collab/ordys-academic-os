-- Reconcile paid access from provider settlement time, not webhook arrival order.
ALTER TABLE public.ordys_billing_payments
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

UPDATE public.ordys_billing_payments
  SET paid_at = COALESCE(paid_at, confirmed_at, created_at, now())
WHERE paid_at IS NULL;

ALTER TABLE public.ordys_billing_payments
  ALTER COLUMN paid_at SET DEFAULT now(),
  ALTER COLUMN paid_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS ordys_billing_payment_subscription_paid_at_idx
  ON public.ordys_billing_payments (provider_subscription_id, paid_at, provider_payment_id)
  WHERE status IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED');
-- Index the exact JSONB selectors used by automatic replay after a provider
-- identity becomes known. These keep replay lookup from scanning every failed
-- webhook while preserving the existing financial event order.
CREATE INDEX IF NOT EXISTS ordys_billing_webhook_subscription_delete_id_retry_idx
  ON public.ordys_billing_webhook_events(
    (retry_payload -> 'subscription' ->> 'id'),
    received_at,
    provider_event_id
  )
  WHERE processing_status = 'failed'
    AND error_code = 'subscription_delete_unmatched'
    AND retry_payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS ordys_billing_webhook_confirmed_payment_subscription_retry_idx
  ON public.ordys_billing_webhook_events(
    (retry_payload -> 'payment' ->> 'subscription'),
    received_at,
    provider_event_id
  )
  WHERE processing_status = 'failed'
    AND error_code = 'confirmed_payment_unmatched'
    AND retry_payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS ordys_billing_webhook_negative_payment_identity_retry_idx
  ON public.ordys_billing_webhook_events(
    (retry_payload -> 'payment' ->> 'subscription'),
    (retry_payload -> 'payment' ->> 'id'),
    received_at,
    provider_event_id
  )
  WHERE processing_status = 'failed'
    AND error_code = 'negative_payment_unmatched'
    AND retry_payload IS NOT NULL;

-- Preserve the minimum financial ledger after Auth account deletion. Asaas can
-- still emit refunds/chargebacks after a recurring subscription was cancelled.
-- Keep provider identifiers and financial status, but detach the deleted owner.
ALTER TABLE public.ordys_billing_checkout_attempts
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.ordys_billing_subscriptions
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.ordys_billing_payments
  ALTER COLUMN user_id DROP NOT NULL;

-- Drop every existing FK on the owner column, not only the default-generated
-- name. A leftover CASCADE FK would still delete the ledger even if SET NULL
-- were added beside it.
DO $ordys$
DECLARE
  v_constraint RECORD;
BEGIN
  FOR v_constraint IN
    SELECT constraint_row.conrelid::regclass AS table_name,
           constraint_row.conname
    FROM pg_constraint AS constraint_row
    JOIN pg_attribute AS column_row
      ON column_row.attrelid = constraint_row.conrelid
     AND column_row.attnum = ANY(constraint_row.conkey)
    WHERE constraint_row.conrelid IN (
      to_regclass('public.ordys_billing_checkout_attempts'),
      to_regclass('public.ordys_billing_subscriptions'),
      to_regclass('public.ordys_billing_payments')
    )
      AND constraint_row.confrelid = to_regclass('auth.users')
      AND constraint_row.contype = 'f'
      AND column_row.attname = 'user_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT %I',
      v_constraint.table_name,
      v_constraint.conname
    );
  END LOOP;
END;
$ordys$;

ALTER TABLE public.ordys_billing_checkout_attempts
  ADD CONSTRAINT ordys_billing_checkout_attempts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.ordys_billing_subscriptions
  ADD CONSTRAINT ordys_billing_subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.ordys_billing_payments
  ADD CONSTRAINT ordys_billing_payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Durable two-stage Asaas webhook receipt and Checkout finalization.
-- The raw provider payload is never stored; only the processor allow-list is retained.


-- Serialize every account-deletion path with durable webhook receipt.
-- The global inbox lock is acquired before the per-user lifecycle lock.
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
  -- Global inbox lock always precedes the per-user lifecycle lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:asaas-inbox-admission', 0)
  );

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
  -- Global inbox lock always precedes the per-user lifecycle lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:asaas-inbox-admission', 0)
  );

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
  -- Global inbox lock always precedes the per-user lifecycle lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:asaas-inbox-admission', 0)
  );

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

  -- Global inbox lock always precedes the per-user lifecycle lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:asaas-inbox-admission', 0)
  );

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
      AND subscription.cancellation_confirmed_at IS NULL
  ) OR public.ordys_has_unreconciled_billing_events(p_user_id) THEN
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

CREATE OR REPLACE FUNCTION public.ordys_confirm_subscription_cancellation(
  p_user_id UUID,
  p_subscription_id UUID,
  p_cancellation_requested_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE PLPGSQL
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_checkout_attempt_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_subscription_id IS NULL THEN
    RAISE EXCEPTION 'Invalid ORDYS subscription cancellation confirmation';
  END IF;

  -- Global inbox lock always precedes the per-user lifecycle lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:asaas-inbox-admission', 0)
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:billing-lifecycle:' || p_user_id::TEXT, 0)
  );

  UPDATE public.ordys_billing_subscriptions
  SET status = CASE WHEN status = 'suspended' THEN 'suspended' ELSE 'cancelled' END,
      provider_status = 'DELETED',
      cancellation_confirmed_at = COALESCE(cancellation_confirmed_at, now()),
      cancelled_at = COALESCE(cancelled_at, now()),
      updated_at = now()
  WHERE id = p_subscription_id
    AND user_id = p_user_id
    AND (
      (
        p_cancellation_requested_at IS NOT NULL
        AND cancellation_requested_at = p_cancellation_requested_at
      )
      OR (
        p_cancellation_requested_at IS NULL
        AND status IN ('cancelled', 'suspended')
        AND (
          provider_status = 'DELETED'
          OR cancellation_confirmed_at IS NOT NULL
        )
      )
    )
  RETURNING checkout_attempt_id INTO v_checkout_attempt_id;

  IF FOUND THEN
    IF v_checkout_attempt_id IS NOT NULL THEN
      UPDATE public.ordys_billing_checkout_attempts
      SET status = 'cancelled', updated_at = now()
      WHERE id = v_checkout_attempt_id
        AND status IN ('linked', 'paid');
    END IF;
    RETURN 'confirmed';
  END IF;

  SELECT checkout_attempt_id
    INTO v_checkout_attempt_id
  FROM public.ordys_billing_subscriptions
  WHERE id = p_subscription_id
    AND user_id = p_user_id
    AND provider_status = 'DELETED'
    AND cancellation_confirmed_at IS NOT NULL;

  IF FOUND THEN
    IF v_checkout_attempt_id IS NOT NULL THEN
      UPDATE public.ordys_billing_checkout_attempts
      SET status = 'cancelled', updated_at = now()
      WHERE id = v_checkout_attempt_id
        AND status IN ('linked', 'paid');
    END IF;
    RETURN 'already_confirmed';
  END IF;

  RETURN 'not_owner';
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_own_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, extensions
AS $ordys$
DECLARE
  uid uuid := auth.uid();
  normalized_email text;
  billing_schema_status text;
  has_billing_history boolean := false;
  has_billing_objects boolean :=
    to_regclass('public.ordys_billing_settings') IS NOT NULL
    OR to_regclass('public.ordys_billing_plans') IS NOT NULL
    OR to_regclass('public.ordys_billing_checkout_attempts') IS NOT NULL
    OR to_regclass('public.ordys_billing_subscriptions') IS NOT NULL
    OR to_regclass('public.ordys_billing_payments') IS NOT NULL
    OR to_regclass('public.ordys_billing_webhook_events') IS NOT NULL
    OR to_regclass('public.ordys_account_deletion_reservations') IS NOT NULL
    OR to_regclass('public.ordys_billing_webhook_inbox') IS NOT NULL;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF has_billing_objects THEN
    IF to_regprocedure('public.ordys_billing_schema_status()') IS NULL THEN
      RAISE EXCEPTION 'billing schema is incomplete; account data was not deleted';
    END IF;

    SELECT public.ordys_billing_schema_status()
      INTO billing_schema_status;

    IF billing_schema_status IS DISTINCT FROM 'ready' THEN
      RAISE EXCEPTION 'billing schema is not ready; account data was not deleted';
    END IF;

    -- Serialize deletion with durable webhook receipt and Checkout admission.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ordys:asaas-inbox-admission', 0)
    );

    PERFORM pg_advisory_xact_lock(
      hashtextextended('ordys:billing-lifecycle:' || uid::TEXT, 0)
    );

    SELECT
      EXISTS (
        SELECT 1 FROM public.ordys_billing_checkout_attempts AS attempt
        WHERE attempt.user_id = uid
      )
      OR EXISTS (
        SELECT 1 FROM public.ordys_billing_subscriptions AS subscription
        WHERE subscription.user_id = uid
      )
      OR EXISTS (
        SELECT 1 FROM public.ordys_billing_payments AS payment
        WHERE payment.user_id = uid
      )
    INTO has_billing_history;

    IF has_billing_history THEN
      IF EXISTS (
        SELECT 1
        FROM public.ordys_billing_payments AS payment
        WHERE payment.user_id = uid
          AND NOT EXISTS (
            SELECT 1
            FROM public.ordys_billing_subscriptions AS subscription
            WHERE subscription.user_id = uid
              AND subscription.provider_subscription_id = payment.provider_subscription_id
          )
      ) THEN
        RAISE EXCEPTION 'billing payment cannot be reconciled; account data was not deleted';
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.ordys_account_deletion_reservations AS reservation
      WHERE reservation.user_id = uid
        AND reservation.processing_token IS NOT NULL
        AND reservation.processing_until > now()
    ) THEN
      RAISE EXCEPTION 'billing-aware account deletion is required; account data was not deleted';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.ordys_billing_checkout_attempts AS attempt
      WHERE attempt.user_id = uid
        AND attempt.status IN ('creating', 'pending', 'paid', 'linked')
    ) THEN
      RAISE EXCEPTION 'billing Checkout is not reconciled; account data was not deleted';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.ordys_billing_subscriptions AS subscription
      WHERE subscription.user_id = uid
        AND subscription.cancellation_confirmed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'billing subscription is not provider-confirmed as cancelled; account data was not deleted';
    END IF;

    IF public.ordys_has_unreconciled_billing_events(uid) THEN
      RAISE EXCEPTION 'unmatched provider billing webhook events require reconciliation; account data was not deleted';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.ordys_billing_webhook_events AS event
      JOIN public.ordys_billing_subscriptions AS subscription
        ON subscription.user_id = uid
       AND event.retry_payload -> 'payment' ->> 'subscription' = subscription.provider_subscription_id
      WHERE event.processing_status = 'failed'
        AND event.error_code = 'negative_payment_unmatched'
        AND event.retry_payload IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'billing negative payment event is awaiting reconciliation; account data was not deleted';
    END IF;

    -- The inbox keeps only allowlisted provider fields for idempotency and
    -- late-event reconciliation. Remove the deleted account's local owner link.
    UPDATE public.ordys_billing_webhook_inbox
      SET user_id = NULL
    WHERE user_id = uid;
  END IF;

  SELECT lower(btrim(email))
    INTO normalized_email
  FROM auth.users
  WHERE id = uid;

  IF normalized_email IS NOT NULL AND normalized_email <> '' THEN
    DELETE FROM public.password_recovery_attempts
    WHERE email_hash = encode(digest(normalized_email, 'sha256'), 'hex');
  END IF;

  DELETE FROM public.assistant_jobs WHERE user_id = uid;
  DELETE FROM public.quiz_answers WHERE user_id = uid;
  DELETE FROM public.quiz_attempts WHERE user_id = uid;
  DELETE FROM public.usage_events WHERE user_id = uid;
  DELETE FROM public.daily_checkins WHERE user_id = uid;
  DELETE FROM public.reviews WHERE user_id = uid;
  DELETE FROM public.plan_sessions WHERE user_id = uid;
  DELETE FROM public.focus_sessions WHERE user_id = uid;
  DELETE FROM public.goals WHERE user_id = uid;
  DELETE FROM public.grades WHERE user_id = uid;
  DELETE FROM public.attendance_records WHERE user_id = uid;
  DELETE FROM public.exam_topics WHERE user_id = uid;
  DELETE FROM public.exams WHERE user_id = uid;
  DELETE FROM public.subtasks WHERE user_id = uid;
  DELETE FROM public.tasks WHERE user_id = uid;
  DELETE FROM public.topics WHERE user_id = uid;
  DELETE FROM public.subject_schedules WHERE user_id = uid;
  DELETE FROM public.calendar_events WHERE user_id = uid;
  DELETE FROM public.calendar_connections WHERE user_id = uid;
  DELETE FROM public.subjects WHERE user_id = uid;
  DELETE FROM public.notifications WHERE user_id = uid;
  DELETE FROM public.push_subscriptions WHERE user_id = uid;
  DELETE FROM public.notification_preferences WHERE user_id = uid;
  DELETE FROM public.profiles WHERE id = uid;
END;
$ordys$;

REVOKE ALL ON FUNCTION public.delete_own_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_data() TO authenticated;

-- The final readiness definition must verify that every deletion path uses
-- the exact held-provider-event reconciliation RPC.
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
      AND to_regprocedure('public.ordys_confirm_subscription_cancellation(uuid,uuid,timestamp with time zone)') IS NOT NULL
      AND to_regprocedure('public.process_ordys_asaas_billing_event(jsonb)') IS NOT NULL
      AND to_regprocedure('public.ordys_has_unreconciled_billing_events(uuid)') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_release_account_deletion_reservation(uuid,boolean)')
          AND prosrc LIKE '%ordys_has_unreconciled_billing_events%'
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations')
          AND attname = 'processing_token' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations')
          AND attname = 'processing_until' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts')
          AND attname = 'cancellation_requested_at' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts')
          AND attname = 'cancellation_claim_id' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_requested_at' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_claim_id' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_confirmed_at' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_events')
          AND attname = 'provider_customer_id' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_events')
          AND attname = 'retry_payload' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.delete_own_data()')
          AND prosrc LIKE '%ordys_account_deletion_reservations%'
          AND prosrc LIKE '%processing_token%'
          AND prosrc LIKE '%pg_advisory_xact_lock%'
          AND prosrc LIKE '%cancellation_confirmed_at IS NULL%'
          AND prosrc LIKE '%negative_payment_unmatched%'
          AND prosrc LIKE '%ordys_has_unreconciled_billing_events%'
          AND prosrc LIKE '%billing-aware account deletion is required%'
          AND prosrc LIKE '%ordys:asaas-inbox-admission%'
      )
    THEN 'ready'
    ELSE 'partial'
  END;
$$;

-- Durable Asaas inbox. The stored JSON contains only the fields consumed by
-- the billing state machine; the provider's raw payload is never retained.
CREATE TABLE IF NOT EXISTS public.ordys_billing_webhook_inbox (
  provider_event_id TEXT PRIMARY KEY
    CHECK (length(provider_event_id) BETWEEN 1 AND 255),
  event_type TEXT NOT NULL
    CHECK (length(event_type) BETWEEN 1 AND 128),
  provider_object_id TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  external_reference TEXT,
  user_id UUID,
  event_payload JSONB NOT NULL
    CHECK (jsonb_typeof(event_payload) = 'object'),
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'ignored', 'quarantined')),
  error_code TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ordys_billing_webhook_inbox_admission_idx
  ON public.ordys_billing_webhook_inbox (user_id, processing_status, received_at)
  WHERE processing_status IN ('received', 'quarantined');

ALTER TABLE public.ordys_billing_webhook_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ordys_billing_webhook_inbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ordys_billing_webhook_inbox TO service_role;

-- Keep the legacy processor safe while older Edge Function instances are still
-- calling it directly during the coordinated function rollout. Its transaction
-- is serialized with durable receipts, Checkout admission and finalization.
CREATE OR REPLACE FUNCTION public.ordys_apply_asaas_billing_event(p_event JSONB)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_id TEXT := NULLIF(p_event ->> 'id', '');
  v_event_type TEXT := NULLIF(p_event ->> 'event', '');
  v_payment JSONB := COALESCE(p_event -> 'payment', '{}'::JSONB);
  v_subscription JSONB := COALESCE(p_event -> 'subscription', '{}'::JSONB);
  v_checkout JSONB := COALESCE(p_event -> 'checkout', '{}'::JSONB);
  v_payment_id TEXT := NULLIF(v_payment ->> 'id', '');
  v_checkout_id TEXT := NULLIF(v_checkout ->> 'id', '');
  v_customer_id TEXT := COALESCE(
    NULLIF(v_subscription ->> 'customer', ''),
    NULLIF(v_checkout ->> 'customer', ''),
    NULLIF(v_payment ->> 'customer', '')
  );
  v_provider_subscription_id TEXT := COALESCE(
    NULLIF(v_payment ->> 'subscription', ''),
    NULLIF(v_subscription ->> 'id', '')
  );
  v_external_reference TEXT := COALESCE(
    NULLIF(v_payment ->> 'externalReference', ''),
    NULLIF(v_checkout ->> 'externalReference', ''),
    NULLIF(v_subscription ->> 'externalReference', '')
  );
  v_attempt public.ordys_billing_checkout_attempts%ROWTYPE;
  v_billing_subscription public.ordys_billing_subscriptions%ROWTYPE;
  v_has_attempt BOOLEAN := FALSE;
  v_has_subscription BOOLEAN := FALSE;
  v_customer_candidate_count INTEGER := 0;
  v_value_cents BIGINT;
  v_value_numeric NUMERIC;
  v_due_date DATE;
  v_paid_at TIMESTAMPTZ;
  v_paid_row RECORD;
  v_period_end TIMESTAMPTZ;
  v_event_inserted TEXT;
  v_existing_error_code TEXT;
  v_checkout_mismatch_code TEXT;
  v_existing_payment_status TEXT;
  v_pending_event RECORD;
  v_period_interval INTERVAL;
BEGIN
  IF v_event_id IS NULL OR v_event_type IS NULL THEN
    RAISE EXCEPTION 'Invalid Asaas event envelope';
  END IF;

  -- Asaas only includes payment.subscription for charges generated by a
  -- subscription. When a known payment webhook omits it, recover the exact
  -- subscription from the globally unique payment ID before taking its lock.
  IF v_event_type LIKE 'PAYMENT_%'
    AND v_provider_subscription_id IS NULL
    AND v_payment_id IS NOT NULL THEN
    SELECT payment.provider_subscription_id
      INTO v_provider_subscription_id
    FROM public.ordys_billing_payments AS payment
    WHERE payment.provider_payment_id = v_payment_id;
  END IF;

  -- Serialize every webhook that establishes or relies on the customer-to-
  -- Checkout mapping. SUBSCRIPTION_DELETED uses the same exact-customer
  -- fallback to hold terminal events while a unique Checkout is still pending.
  -- Sharing this lock prevents a concurrent payment/subscription webhook from
  -- changing the candidate set while the deletion event is being associated.
  IF v_customer_id IS NOT NULL
    AND v_event_type IN ('CHECKOUT_PAID', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_DELETED') THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ordys:asaas-customer:' || v_customer_id, 0)
    );
  END IF;

  -- Serialize every event for the same provider subscription. Without a
  -- shared lock, a concurrent overdue/refund/deletion event could read stale
  -- payment state and overwrite a newer confirmed-payment transition.
  IF v_provider_subscription_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ordys:asaas-subscription:' || v_provider_subscription_id, 0)
    );
  END IF;

  INSERT INTO public.ordys_billing_webhook_events
    (provider_event_id, event_type, provider_object_id, processing_status)
  VALUES
    (v_event_id, v_event_type, COALESCE(v_payment_id, v_provider_subscription_id, v_checkout_id), 'received')
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING provider_event_id INTO v_event_inserted;

  IF v_event_inserted IS NULL THEN
    -- A subscription-created event can arrive before CHECKOUT_PAID. If the
    -- Asaas payload omitted externalReference, keep it failed-but-replayable
    -- and retry it after the matching Checkout supplies the customer ID.
    SELECT event.error_code
      INTO v_existing_error_code
    FROM public.ordys_billing_webhook_events AS event
    WHERE event.provider_event_id = v_event_id
      AND event.processing_status = 'failed'
    FOR UPDATE;

    IF v_existing_error_code IS NULL
      OR v_existing_error_code NOT IN (
        'subscription_checkout_unmatched',
        'confirmed_payment_unmatched',
        'subscription_delete_unmatched',
        'negative_payment_unmatched',
        'payment_subscription_unmatched'
      ) THEN
      RETURN jsonb_build_object('processed', FALSE, 'duplicate', TRUE);
    END IF;

    UPDATE public.ordys_billing_webhook_events
      SET processing_status = 'received', error_code = NULL, processed_at = NULL
    WHERE provider_event_id = v_event_id;
    v_event_inserted := v_event_id;
  END IF;

  -- A payment webhook without payment.subscription is normally a standalone
  -- charge. Ordys only grants recurring access from a known subscription payment.
  -- Ignore unrelated merchant-account activity, but quarantine a missing
  -- subscription identity when the customer or Checkout reference belongs to
  -- a known Ordys record. Never infer a subscription from customer ID alone.
  IF v_event_type LIKE 'PAYMENT_%'
    AND v_provider_subscription_id IS NULL THEN
    IF (
      v_customer_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.ordys_billing_subscriptions AS subscription
          WHERE subscription.provider_customer_id = v_customer_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.ordys_billing_checkout_attempts AS attempt
          WHERE attempt.provider_customer_id = v_customer_id
        )
      )
    ) OR (
      v_external_reference IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.ordys_billing_checkout_attempts AS attempt
        WHERE attempt.external_reference = v_external_reference
      )
    ) THEN
      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'failed',
            error_code = 'payment_subscription_unmatched',
            provider_customer_id = v_customer_id,
            retry_payload = jsonb_strip_nulls(jsonb_build_object(
              'id', v_event_id,
              'event', v_event_type,
              'dateCreated', NULLIF(p_event ->> 'dateCreated', ''),
              'payment', jsonb_strip_nulls(jsonb_build_object(
                'id', v_payment_id,
                'customer', NULLIF(v_payment ->> 'customer', ''),
                'externalReference', NULLIF(v_payment ->> 'externalReference', ''),
                'value', v_payment ->> 'value',
                'billingType', NULLIF(v_payment ->> 'billingType', ''),
                'dueDate', NULLIF(v_payment ->> 'dueDate', ''),
                'paymentDate', NULLIF(v_payment ->> 'paymentDate', ''),
                'confirmedDate', NULLIF(v_payment ->> 'confirmedDate', '')
              ))
            )),
            processed_at = now()
      WHERE provider_event_id = v_event_id;
      RETURN jsonb_build_object('processed', FALSE, 'error', 'payment_subscription_unmatched');
    END IF;

    UPDATE public.ordys_billing_webhook_events
      SET processing_status = 'ignored',
          error_code = NULL,
          retry_payload = NULL,
          processed_at = now()
    WHERE provider_event_id = v_event_id;

    RETURN jsonb_build_object(
      'processed', TRUE,
      'ignored_unlinked_payment', TRUE,
      'event', v_event_type
    );
  END IF;

  IF v_event_type LIKE 'CHECKOUT_%' THEN
    IF v_checkout_id IS NOT NULL THEN
      SELECT *
        INTO v_attempt
      FROM public.ordys_billing_checkout_attempts AS attempt
      WHERE attempt.provider_checkout_id = v_checkout_id
      LIMIT 1
      FOR UPDATE;
      v_has_attempt := FOUND;
    END IF;

    -- Best-effort recovery if the Checkout webhook includes externalReference.
    -- Some documented payload examples omit it; without it, keep the attempt locked.
    IF NOT v_has_attempt
      AND v_checkout_id IS NOT NULL
      AND v_external_reference IS NOT NULL THEN
      -- Checkout webhooks may arrive before the API request stores the provider
      -- ID, and non-sequential delivery can place CHECKOUT_PAID before CREATED.
      -- Match only the exact external reference generated for this attempt.
      SELECT *
        INTO v_attempt
      FROM public.ordys_billing_checkout_attempts AS attempt
      WHERE attempt.external_reference = v_external_reference
        AND attempt.status IN ('creating', 'pending', 'linked', 'paid')
      FOR UPDATE;
      v_has_attempt := FOUND;
      IF v_has_attempt THEN
        UPDATE public.ordys_billing_checkout_attempts
          SET provider_checkout_id = v_checkout_id,
              checkout_url = 'https://asaas.com/checkoutSession/show?id=' || v_checkout_id,
              provider_customer_id = CASE
                WHEN v_event_type = 'CHECKOUT_PAID' THEN provider_customer_id
                ELSE COALESCE(v_customer_id, provider_customer_id)
              END,
              status = CASE WHEN status IN ('linked', 'paid') THEN status ELSE 'pending' END,
              updated_at = now()
        WHERE id = v_attempt.id
        RETURNING * INTO v_attempt;
      END IF;
    END IF;

    IF v_event_type = 'CHECKOUT_PAID' AND NOT v_has_attempt THEN
      RAISE EXCEPTION 'Unable to associate paid Asaas Checkout with an ORDYS attempt';
    END IF;

    -- When Asaas supplies externalReference, it must agree with the attempt
    -- resolved by provider Checkout ID. The provider ID is not permission to
    -- ignore a conflicting account reference; quarantine rather than linking
    -- a payment or terminal event to the wrong Ordys attempt.
    IF v_has_attempt
      AND v_external_reference IS NOT NULL
      AND v_external_reference <> v_attempt.external_reference THEN
      UPDATE public.ordys_billing_subscriptions
        SET status = CASE
              WHEN status IN ('cancelled', 'suspended') THEN status
              ELSE 'suspended'
            END,
            grace_until = NULL,
            updated_at = now()
      WHERE checkout_attempt_id = v_attempt.id;

      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'failed',
            error_code = 'checkout_reference_mismatch',
            provider_customer_id = v_customer_id,
            retry_payload = jsonb_build_object(
              'id', v_event_id,
              'event', v_event_type,
              'checkoutAttemptId', v_attempt.id,
              'checkout', jsonb_build_object(
                'id', v_checkout_id,
                'customer', v_customer_id,
                'externalReference', v_external_reference
              )
            ),
            processed_at = now()
      WHERE provider_event_id = v_event_id;
      RETURN jsonb_build_object('processed', FALSE, 'error', 'checkout_reference_mismatch');
    END IF;

    IF v_event_type = 'CHECKOUT_PAID'
      AND v_has_attempt
      AND v_customer_id IS NOT NULL
      AND (
        (v_attempt.provider_customer_id IS NOT NULL
          AND v_attempt.provider_customer_id <> v_customer_id)
        OR EXISTS (
          SELECT 1
          FROM public.ordys_billing_subscriptions AS subscription
          WHERE subscription.checkout_attempt_id = v_attempt.id
            AND subscription.provider_customer_id IS NOT NULL
            AND subscription.provider_customer_id <> v_customer_id
        )
      ) THEN
      -- The Checkout and recurring subscription disagree on provider identity.
      -- Keep the attempt open, quarantine future subscription creation, and
      -- revoke any existing Plus access. Never overwrite the trusted ID.
      UPDATE public.ordys_billing_subscriptions
        SET status = CASE
              WHEN status IN ('cancelled', 'suspended') THEN status
              ELSE 'suspended'
            END,
            grace_until = NULL,
            updated_at = now()
      WHERE checkout_attempt_id = v_attempt.id
        AND provider_customer_id IS NOT NULL
        AND provider_customer_id <> v_customer_id;

      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'failed',
            error_code = 'checkout_customer_mismatch',
            provider_customer_id = v_customer_id,
            retry_payload = jsonb_build_object(
              'id', v_event_id,
              'event', v_event_type,
              'checkoutAttemptId', v_attempt.id,
              'checkout', jsonb_build_object(
                'id', v_checkout_id,
                'customer', v_customer_id,
                'externalReference', v_external_reference
              )
            ),
            processed_at = now()
      WHERE provider_event_id = v_event_id;
      RETURN jsonb_build_object('processed', FALSE, 'error', 'checkout_customer_mismatch');
    END IF;

    IF v_event_type = 'CHECKOUT_PAID'
      AND v_has_attempt
      AND v_attempt.status IN ('cancelled', 'expired', 'failed') THEN
      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'failed',
            error_code = 'checkout_paid_after_closed',
            processed_at = now()
      WHERE provider_event_id = v_event_id;
      RETURN jsonb_build_object('processed', FALSE, 'error', 'checkout_paid_after_closed');
    END IF;

    IF v_has_attempt AND v_event_type = 'CHECKOUT_PAID' THEN
      UPDATE public.ordys_billing_checkout_attempts
        SET status = CASE WHEN status = 'linked' THEN 'linked' ELSE 'paid' END,
            provider_customer_id = COALESCE(v_customer_id, provider_customer_id),
            updated_at = now()
      WHERE id = v_attempt.id;

      -- A subscription webhook without externalReference may have been safely
      -- held earlier because the matching attempt was not paid yet. Replay only
      -- those exact customer-matched events now that CHECKOUT_PAID is persisted.
      IF v_customer_id IS NOT NULL THEN
        FOR v_pending_event IN
          SELECT event.retry_payload
          FROM public.ordys_billing_webhook_events AS event
          WHERE event.provider_customer_id = v_customer_id
            AND event.processing_status = 'failed'
            AND event.error_code = 'subscription_checkout_unmatched'
            AND event.retry_payload IS NOT NULL
          ORDER BY event.received_at, event.provider_event_id
        LOOP
          PERFORM public.ordys_apply_asaas_billing_event(v_pending_event.retry_payload);
        END LOOP;
      END IF;
    ELSIF v_has_attempt AND v_event_type = 'CHECKOUT_CANCELED' THEN
      UPDATE public.ordys_billing_checkout_attempts
        SET status = 'cancelled', updated_at = now()
      WHERE id = v_attempt.id
        AND status IN ('creating', 'pending');
    ELSIF v_has_attempt AND v_event_type = 'CHECKOUT_EXPIRED' THEN
      UPDATE public.ordys_billing_checkout_attempts
        SET status = 'expired', updated_at = now()
      WHERE id = v_attempt.id
        AND status IN ('creating', 'pending');
    END IF;

    UPDATE public.ordys_billing_webhook_events
      SET processing_status = CASE WHEN v_has_attempt THEN 'processed' ELSE 'ignored' END,
          processed_at = now()
    WHERE provider_event_id = v_event_id;

    RETURN jsonb_build_object('processed', TRUE, 'event', v_event_type);
  END IF;

  IF v_event_type LIKE 'SUBSCRIPTION_%' THEN
    v_provider_subscription_id := NULLIF(v_subscription ->> 'id', '');
    v_customer_id := NULLIF(v_subscription ->> 'customer', '');
    v_external_reference := NULLIF(v_subscription ->> 'externalReference', '');

    IF v_external_reference IS NOT NULL THEN
      SELECT *
        INTO v_attempt
      FROM public.ordys_billing_checkout_attempts AS attempt
      WHERE attempt.external_reference = v_external_reference
        AND attempt.status IN ('creating', 'pending', 'paid', 'linked')
      LIMIT 1
      FOR UPDATE;
      v_has_attempt := FOUND;
    END IF;

    -- Non-creation subscription events already identify an Asaas resource by
    -- its unique provider subscription ID. Resolve that exact local row before
    -- considering customer fallback: a shared customer cannot make a known
    -- subscription ambiguous.
    IF v_event_type <> 'SUBSCRIPTION_CREATED'
      AND v_provider_subscription_id IS NOT NULL THEN
      SELECT *
        INTO v_billing_subscription
      FROM public.ordys_billing_subscriptions AS subscription
      WHERE subscription.provider_subscription_id = v_provider_subscription_id
      LIMIT 1
      FOR UPDATE;
      v_has_subscription := FOUND;

      IF v_has_subscription AND v_has_attempt
        AND (
          v_attempt.user_id IS DISTINCT FROM v_billing_subscription.user_id
          OR (
            v_billing_subscription.checkout_attempt_id IS NOT NULL
            AND v_attempt.id <> v_billing_subscription.checkout_attempt_id
          )
        ) THEN
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'subscription_checkout_mismatch',
              retry_payload = NULL,
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'subscription_checkout_mismatch');
      END IF;

      IF v_has_subscription
        AND v_customer_id IS NOT NULL
        AND v_billing_subscription.provider_customer_id IS NOT NULL
        AND v_customer_id <> v_billing_subscription.provider_customer_id THEN
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'subscription_customer_mismatch',
              retry_payload = NULL,
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'subscription_customer_mismatch');
      END IF;
    END IF;

    -- Fallback only when Asaas omits externalReference and no exact local
    -- subscription is already known. A supplied but unmatched reference must
    -- never be silently associated with another Ordys account. Customer IDs
    -- may be reused across accounts; new subscriptions still require exactly
    -- one paid Checkout candidate.
    IF NOT v_has_attempt AND NOT v_has_subscription
      AND v_external_reference IS NULL AND v_customer_id IS NOT NULL THEN
      -- Count every historical attempt for this provider customer, including
      -- terminal Checkouts. A cancelled/expired attempt may still have created
      -- a remote recurring subscription whose webhook arrived late. Excluding
      -- terminal rows would let a newer paid Checkout become the sole fallback
      -- candidate and silently inherit that older subscription.
      -- Without externalReference, more than one historical candidate is
      -- ambiguous even when all attempts belong to the same Ordys user.
      SELECT count(*)::INTEGER
        INTO v_customer_candidate_count
      FROM public.ordys_billing_checkout_attempts AS attempt
      WHERE attempt.provider_customer_id = v_customer_id;

      IF v_customer_candidate_count = 1 THEN
        SELECT *
          INTO v_attempt
        FROM public.ordys_billing_checkout_attempts AS attempt
        WHERE attempt.provider_customer_id = v_customer_id
          AND attempt.status = 'paid'
        LIMIT 1
        FOR UPDATE;
        v_has_attempt := FOUND;
      ELSIF v_customer_candidate_count > 1 THEN
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'ambiguous_customer_association',
              retry_payload = NULL,
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'ambiguous_customer_association');
      END IF;
    END IF;


    IF v_event_type = 'SUBSCRIPTION_CREATED' THEN
      IF v_has_attempt AND v_provider_subscription_id IS NOT NULL THEN
        -- A previously received Checkout with a different provider customer
        -- permanently quarantines this attempt. Do not create a subscription
        -- even if a later SUBSCRIPTION_CREATED event names the original owner.
        SELECT mismatch.error_code
          INTO v_checkout_mismatch_code
        FROM public.ordys_billing_webhook_events AS mismatch
        WHERE mismatch.processing_status = 'failed'
          AND mismatch.error_code IN ('checkout_customer_mismatch', 'checkout_reference_mismatch')
          AND mismatch.retry_payload ->> 'checkoutAttemptId' = v_attempt.id::TEXT
        ORDER BY mismatch.received_at DESC, mismatch.provider_event_id DESC
        LIMIT 1;

        IF v_checkout_mismatch_code IS NOT NULL THEN
          UPDATE public.ordys_billing_webhook_events
            SET processing_status = 'failed',
                error_code = v_checkout_mismatch_code,
                retry_payload = NULL,
                processed_at = now()
          WHERE provider_event_id = v_event_id;
          RETURN jsonb_build_object('processed', FALSE, 'error', v_checkout_mismatch_code);
        END IF;

        IF v_customer_id IS NOT NULL
          AND v_attempt.provider_customer_id IS NOT NULL
          AND v_customer_id <> v_attempt.provider_customer_id THEN
          UPDATE public.ordys_billing_webhook_events
            SET processing_status = 'failed',
                error_code = 'subscription_customer_mismatch',
                retry_payload = NULL,
                processed_at = now()
          WHERE provider_event_id = v_event_id;
          RETURN jsonb_build_object('processed', FALSE, 'error', 'subscription_customer_mismatch');
        END IF;

        -- provider_subscription_id is globally unique. A repeated creation
        -- event must not reassign an existing subscription to another user or
        -- Checkout, and must not overwrite its trusted customer identifier.
        IF EXISTS (
          SELECT 1
          FROM public.ordys_billing_subscriptions AS existing
          WHERE existing.provider_subscription_id = v_provider_subscription_id
            AND (
              existing.user_id IS DISTINCT FROM v_attempt.user_id
              OR existing.checkout_attempt_id IS DISTINCT FROM v_attempt.id
            )
        ) THEN
          UPDATE public.ordys_billing_webhook_events
            SET processing_status = 'failed',
                error_code = 'subscription_identity_mismatch',
                retry_payload = NULL,
                processed_at = now()
          WHERE provider_event_id = v_event_id;
          RETURN jsonb_build_object('processed', FALSE, 'error', 'subscription_identity_mismatch');
        END IF;

        IF v_customer_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM public.ordys_billing_subscriptions AS existing
          WHERE existing.provider_subscription_id = v_provider_subscription_id
            AND existing.provider_customer_id IS NOT NULL
            AND existing.provider_customer_id <> v_customer_id
        ) THEN
          UPDATE public.ordys_billing_webhook_events
            SET processing_status = 'failed',
                error_code = 'subscription_customer_mismatch',
                retry_payload = NULL,
                processed_at = now()
          WHERE provider_event_id = v_event_id;
          RETURN jsonb_build_object('processed', FALSE, 'error', 'subscription_customer_mismatch');
        END IF;

        BEGIN
          v_value_numeric := (v_subscription ->> 'value')::NUMERIC;
          IF v_value_numeric IS NULL
            OR v_value_numeric * 100 <> trunc(v_value_numeric * 100) THEN
            v_value_cents := NULL;
          ELSE
            v_value_cents := (v_value_numeric * 100)::BIGINT;
          END IF;
        EXCEPTION
          WHEN invalid_text_representation OR numeric_value_out_of_range OR feature_not_supported THEN
            v_value_cents := NULL;
        END;
        IF NULLIF(v_subscription ->> 'billingType', '') IS DISTINCT FROM 'CREDIT_CARD'
          OR NULLIF(v_subscription ->> 'cycle', '') IS DISTINCT FROM
            (SELECT plan.billing_cycle FROM public.ordys_billing_plans AS plan WHERE plan.plan_code = v_attempt.plan_code)
          OR v_value_cents IS NULL
          OR v_value_cents <> v_attempt.amount_cents THEN
          UPDATE public.ordys_billing_webhook_events
            SET processing_status = 'failed',
                error_code = 'subscription_amount_mismatch',
                retry_payload = NULL,
                processed_at = now()
          WHERE provider_event_id = v_event_id;
          RETURN jsonb_build_object('processed', FALSE, 'error', 'subscription_amount_mismatch');
        END IF;

        INSERT INTO public.ordys_billing_subscriptions (
          user_id, plan_code, checkout_attempt_id, provider_subscription_id,
          provider_checkout_id, provider_customer_id, provider_status, status,
          billing_cycle, billing_type, amount_cents, currency
        )
        VALUES (
          v_attempt.user_id, v_attempt.plan_code, v_attempt.id, v_provider_subscription_id,
          v_attempt.provider_checkout_id,
          COALESCE(v_customer_id, v_attempt.provider_customer_id),
          NULLIF(v_subscription ->> 'status', ''), 'pending',
          (SELECT plan.billing_cycle FROM public.ordys_billing_plans AS plan WHERE plan.plan_code = v_attempt.plan_code),
          NULLIF(v_subscription ->> 'billingType', ''), v_attempt.amount_cents, 'BRL'
        )
        ON CONFLICT (provider_subscription_id) DO UPDATE
          SET provider_checkout_id = COALESCE(EXCLUDED.provider_checkout_id, ordys_billing_subscriptions.provider_checkout_id),
              provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, ordys_billing_subscriptions.provider_customer_id),
              provider_status = CASE
                WHEN ordys_billing_subscriptions.provider_status = 'DELETED'
                  THEN ordys_billing_subscriptions.provider_status
                ELSE EXCLUDED.provider_status
              END,
              updated_at = now();

        UPDATE public.ordys_billing_checkout_attempts
          SET status = 'linked',
              provider_customer_id = COALESCE(v_customer_id, provider_customer_id),
              updated_at = now()
        WHERE id = v_attempt.id;

        -- A deletion event can precede SUBSCRIPTION_CREATED. Once the exact
        -- provider subscription is linked to this Checkout, replay its held
        -- terminal event so the local record cannot remain falsely pending.
        FOR v_pending_event IN
          SELECT event.retry_payload
          FROM public.ordys_billing_webhook_events AS event
          WHERE event.processing_status = 'failed'
            AND event.error_code = 'subscription_delete_unmatched'
            AND event.retry_payload -> 'subscription' ->> 'id' = v_provider_subscription_id
            AND event.retry_payload IS NOT NULL
          ORDER BY event.received_at, event.provider_event_id
        LOOP
          PERFORM public.ordys_apply_asaas_billing_event(v_pending_event.retry_payload);
        END LOOP;

        -- PAYMENT_CREATED is informational but must not be lost when it
        -- arrives before SUBSCRIPTION_CREATED. Replay the exact subscription ID.
        FOR v_pending_event IN
          SELECT event.retry_payload
          FROM public.ordys_billing_webhook_events AS event
          WHERE event.processing_status = 'failed'
            AND event.error_code = 'payment_subscription_unmatched'
            AND event.retry_payload -> 'payment' ->> 'subscription' = v_provider_subscription_id
            AND event.retry_payload IS NOT NULL
          ORDER BY event.received_at, event.provider_event_id
        LOOP
          PERFORM public.ordys_apply_asaas_billing_event(v_pending_event.retry_payload);
        END LOOP;

        -- A confirmed payment can be delivered before SUBSCRIPTION_CREATED.
        -- Replay only its minimal, subscription-ID-matched payload after the
        -- subscription is linked; the normal amount/customer/idempotency guards
        -- still decide whether it may grant access.
        FOR v_pending_event IN
          SELECT event.retry_payload
          FROM public.ordys_billing_webhook_events AS event
          WHERE event.processing_status = 'failed'
            AND event.error_code = 'confirmed_payment_unmatched'
            AND event.retry_payload -> 'payment' ->> 'subscription' = v_provider_subscription_id
            AND event.retry_payload IS NOT NULL
          ORDER BY event.received_at, event.provider_event_id
        LOOP
          PERFORM public.ordys_apply_asaas_billing_event(v_pending_event.retry_payload);
        END LOOP;

        -- Refund, chargeback and overdue events can also arrive before the
        -- subscription row is linked. Replay them after confirmed payments so
        -- a real refund/contestação remains the final state, while stale
        -- overdue events are still rejected by the confirmed-payment guard.
        FOR v_pending_event IN
          SELECT event.retry_payload
          FROM public.ordys_billing_webhook_events AS event
          WHERE event.processing_status = 'failed'
            AND event.error_code = 'negative_payment_unmatched'
            AND event.retry_payload -> 'payment' ->> 'subscription' = v_provider_subscription_id
            AND event.retry_payload IS NOT NULL
          ORDER BY event.received_at, event.provider_event_id
        LOOP
          PERFORM public.ordys_apply_asaas_billing_event(v_pending_event.retry_payload);
        END LOOP;
      ELSE
        -- Keep the minimal subscription fields so a later CHECKOUT_PAID event
        -- can retry this association without persisting the full webhook body.
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'subscription_checkout_unmatched',
              provider_customer_id = v_customer_id,
              retry_payload = jsonb_build_object(
                'id', v_event_id,
                'event', v_event_type,
                'subscription', jsonb_build_object(
                  'id', v_provider_subscription_id,
                  'customer', v_customer_id,
                  'externalReference', v_external_reference,
                  'value', v_subscription ->> 'value',
                  'billingType', v_subscription ->> 'billingType',
                  'cycle', v_subscription ->> 'cycle',
                  'status', v_subscription ->> 'status'
                )
              ),
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'subscription_checkout_unmatched');
      END IF;
    ELSE
      IF NOT v_has_subscription THEN
        SELECT *
          INTO v_billing_subscription
        FROM public.ordys_billing_subscriptions AS subscription
        WHERE subscription.provider_subscription_id = v_provider_subscription_id
        LIMIT 1
        FOR UPDATE;
        v_has_subscription := FOUND;
      END IF;

      IF NOT v_has_subscription
        AND v_event_type = 'SUBSCRIPTION_DELETED'
        AND v_provider_subscription_id IS NOT NULL THEN
        -- When Asaas omits externalReference, a unique non-terminal customer
        -- candidate can be pending before CHECKOUT_PAID. Retain the terminal
        -- event against that exact attempt, but do not link a subscription or
        -- grant access until the normal paid-Checkout guard succeeds.
        IF NOT v_has_attempt
          AND v_external_reference IS NULL
          AND v_customer_id IS NOT NULL
          AND v_customer_candidate_count = 1 THEN
          SELECT *
            INTO v_attempt
          FROM public.ordys_billing_checkout_attempts AS attempt
          WHERE attempt.provider_customer_id = v_customer_id
            AND attempt.status IN ('creating', 'pending', 'paid', 'linked')
          LIMIT 1
          FOR UPDATE;
          v_has_attempt := FOUND;
        END IF;

        IF v_has_attempt THEN
          -- SUBSCRIPTION_CREATED replays this minimal event after the exact
          -- provider subscription is linked locally. Ambiguous customers and
          -- supplied-but-unmatched references are never guessed.
          UPDATE public.ordys_billing_webhook_events
            SET processing_status = 'failed',
                error_code = 'subscription_delete_unmatched',
                provider_customer_id = v_customer_id,
                retry_payload = jsonb_build_object(
                  'id', v_event_id,
                  'event', v_event_type,
                  'subscription', jsonb_build_object(
                    'id', v_provider_subscription_id,
                    'customer', v_customer_id
                  )
                ),
                processed_at = now()
          WHERE provider_event_id = v_event_id;
          RETURN jsonb_build_object('processed', FALSE, 'error', 'subscription_delete_unmatched');
        END IF;
      END IF;

      IF v_has_subscription AND v_event_type = 'SUBSCRIPTION_DELETED' THEN
        UPDATE public.ordys_billing_subscriptions
          SET status = CASE WHEN status = 'suspended' THEN 'suspended' ELSE 'cancelled' END,
              provider_status = 'DELETED',
              cancellation_confirmed_at = COALESCE(cancellation_confirmed_at, now()),
              cancelled_at = now(), updated_at = now()
        WHERE provider_subscription_id = v_provider_subscription_id;

        -- A terminal provider cancellation releases the linked Checkout lock.
        -- Paid access remains controlled by current_period_end on the subscription.
        UPDATE public.ordys_billing_checkout_attempts
          SET status = 'cancelled', updated_at = now()
        WHERE id = v_billing_subscription.checkout_attempt_id
          AND status IN ('linked', 'paid');
      ELSIF v_has_subscription AND v_event_type = 'SUBSCRIPTION_INACTIVATED' THEN
        UPDATE public.ordys_billing_subscriptions
          SET status = CASE
                WHEN status IN ('cancelled', 'suspended') THEN status
                ELSE 'past_due'
              END,
              grace_until = CASE
                WHEN status IN ('cancelled', 'suspended') THEN grace_until
                WHEN current_period_end IS NOT NULL THEN GREATEST(current_period_end, now()) + INTERVAL '3 days'
                ELSE NULL
              END,
              provider_status = CASE
                WHEN provider_status = 'DELETED' THEN provider_status
                ELSE 'INACTIVE'
              END,
              updated_at = now()
        WHERE provider_subscription_id = v_provider_subscription_id;
      ELSIF v_has_subscription THEN
        UPDATE public.ordys_billing_subscriptions
          SET provider_status = CASE
                WHEN provider_status = 'DELETED' THEN provider_status
                ELSE NULLIF(v_subscription ->> 'status', '')
              END,
              updated_at = now()
        WHERE provider_subscription_id = v_provider_subscription_id;
      END IF;
    END IF;

    UPDATE public.ordys_billing_webhook_events
      SET processing_status = CASE WHEN v_has_attempt OR v_has_subscription THEN 'processed' ELSE 'ignored' END,
          retry_payload = NULL,
          error_code = NULL,
          processed_at = now()
    WHERE provider_event_id = v_event_id;

    RETURN jsonb_build_object('processed', TRUE, 'event', v_event_type);
  END IF;

  IF v_event_type LIKE 'PAYMENT_%' THEN
    IF v_provider_subscription_id IS NOT NULL THEN
      SELECT *
        INTO v_billing_subscription
      FROM public.ordys_billing_subscriptions AS subscription
      WHERE subscription.provider_subscription_id = v_provider_subscription_id
      LIMIT 1;
      v_has_subscription := FOUND;
    END IF;

    IF v_event_type IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED')
      AND NOT v_has_subscription
      AND v_provider_subscription_id IS NOT NULL
      AND v_payment_id IS NOT NULL THEN
      -- Do not lose a real payment just because the subscription webhook is
      -- delayed. Keep only the fields needed for the same payment validation
      -- and idempotent application after SUBSCRIPTION_CREATED arrives.
      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'failed',
            error_code = 'confirmed_payment_unmatched',
            provider_customer_id = v_customer_id,
            retry_payload = jsonb_build_object(
              'id', v_event_id,
              'event', v_event_type,
              'dateCreated', NULLIF(p_event ->> 'dateCreated', ''),
              'payment', jsonb_build_object(
                'id', v_payment_id,
                'subscription', v_provider_subscription_id,
                'customer', NULLIF(v_payment ->> 'customer', ''),
                'value', v_payment ->> 'value',
                'billingType', v_payment ->> 'billingType',
                'dueDate', v_payment ->> 'dueDate',
                'paymentDate', v_payment ->> 'paymentDate',
                'confirmedDate', v_payment ->> 'confirmedDate'
              )
            ),
            processed_at = now()
      WHERE provider_event_id = v_event_id;
      RETURN jsonb_build_object('processed', FALSE, 'error', 'confirmed_payment_unmatched');
    END IF;

    IF v_event_type IN (
      'PAYMENT_OVERDUE',
      'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
      'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
      'PAYMENT_REFUNDED',
      'PAYMENT_PARTIALLY_REFUNDED',
      'PAYMENT_REFUND_IN_PROGRESS',
      'PAYMENT_CHARGEBACK_REQUESTED',
      'PAYMENT_CHARGEBACK_DISPUTE',
      'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
      'PAYMENT_RECEIVED_IN_CASH_UNDONE'
    )
      AND v_has_subscription
      AND NULLIF(v_payment ->> 'customer', '') IS NOT NULL
      AND v_billing_subscription.provider_customer_id IS NOT NULL
      AND NULLIF(v_payment ->> 'customer', '') <> v_billing_subscription.provider_customer_id THEN
      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'failed',
            error_code = 'payment_customer_mismatch',
            retry_payload = NULL,
            processed_at = now()
      WHERE provider_event_id = v_event_id;
      RETURN jsonb_build_object('processed', FALSE, 'error', 'payment_customer_mismatch');
    END IF;

    -- A payment ID already owned by another Ordys user/subscription is not an
    -- unmatched payment. Reject it permanently before the immediate negative
    -- entitlement transition, so a forged/cross-linked refund cannot suspend
    -- an unrelated subscription or leave a false reconciliation blocker.
    IF v_has_subscription
      AND v_payment_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.ordys_billing_payments AS existing_payment
        WHERE existing_payment.provider_payment_id = v_payment_id
          AND (
            existing_payment.user_id IS DISTINCT FROM v_billing_subscription.user_id
            OR existing_payment.provider_subscription_id <> v_provider_subscription_id
          )
      ) THEN
      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'failed',
            error_code = 'payment_identity_mismatch',
            retry_payload = NULL,
            processed_at = now()
      WHERE provider_event_id = v_event_id;
      RETURN jsonb_build_object('processed', FALSE, 'error', 'payment_identity_mismatch');
    END IF;

    IF v_event_type IN (
      'PAYMENT_OVERDUE',
      'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
      'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
      'PAYMENT_REFUNDED',
      'PAYMENT_PARTIALLY_REFUNDED',
      'PAYMENT_REFUND_IN_PROGRESS',
      'PAYMENT_CHARGEBACK_REQUESTED',
      'PAYMENT_CHARGEBACK_DISPUTE',
      'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
      'PAYMENT_RECEIVED_IN_CASH_UNDONE'
    )
      AND v_provider_subscription_id IS NOT NULL
      AND (
        NOT v_has_subscription
        OR (
          v_event_type NOT IN (
            'PAYMENT_OVERDUE',
            'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
            'PAYMENT_REPROVED_BY_RISK_ANALYSIS'
          )
          AND (
            v_payment_id IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM public.ordys_billing_payments AS existing_payment
              WHERE existing_payment.provider_payment_id = v_payment_id
                AND existing_payment.provider_subscription_id = v_provider_subscription_id
                AND existing_payment.user_id IS NOT DISTINCT FROM v_billing_subscription.user_id
            )
          )
        )
      ) THEN
      -- Status-only unpaid events (overdue, card refusal and risk rejection)
      -- are complete subscription signals after the exact subscription is linked.
      -- They may never produce a settled-payment ledger row, so do not hold account
      -- deletion waiting for one. Before SUBSCRIPTION_CREATED they remain replayable.
      -- Refund, chargeback and reversal events still require the exact payment row;
      -- keep their minimal payload and revoke access immediately until reconciled.
      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'failed',
            error_code = 'negative_payment_unmatched',
            provider_customer_id = v_customer_id,
            retry_payload = jsonb_build_object(
              'id', v_event_id,
              'event', v_event_type,
              'dateCreated', NULLIF(p_event ->> 'dateCreated', ''),
              'payment', jsonb_build_object(
                'id', v_payment_id,
                'subscription', v_provider_subscription_id,
                'customer', NULLIF(v_payment ->> 'customer', ''),
                'value', v_payment ->> 'value',
                'billingType', v_payment ->> 'billingType',
                'dueDate', v_payment ->> 'dueDate',
                'paymentDate', v_payment ->> 'paymentDate',
                'confirmedDate', v_payment ->> 'confirmedDate'
              )
            ),
            processed_at = now()
      WHERE provider_event_id = v_event_id;

      -- The only events held here after subscription linking are settlements
      -- that still lack their exact payment row. Revoke Plus immediately while
      -- retaining the minimal event for replay after financial reconciliation.
      IF v_has_subscription THEN
        UPDATE public.ordys_billing_subscriptions
          SET status = 'suspended', grace_until = NULL, updated_at = now()
        WHERE provider_subscription_id = v_provider_subscription_id;
      END IF;

      RETURN jsonb_build_object('processed', FALSE, 'error', 'negative_payment_unmatched');
    END IF;

    IF v_event_type = 'PAYMENT_CREATED' THEN
      IF NOT v_has_subscription THEN
        -- PAYMENT_CREATED can precede SUBSCRIPTION_CREATED. Retain only the
        -- identifiers needed to associate and replay this event after linking.
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'payment_subscription_unmatched',
              provider_customer_id = v_customer_id,
              retry_payload = jsonb_build_object(
                'id', v_event_id,
                'event', v_event_type,
                'payment', jsonb_build_object(
                  'id', v_payment_id,
                  'subscription', v_provider_subscription_id,
                  'customer', v_customer_id
                )
              ),
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'payment_subscription_unmatched');
      END IF;
      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'processed', processed_at = now()
      WHERE provider_event_id = v_event_id;
      RETURN jsonb_build_object('processed', TRUE, 'event', v_event_type);
    END IF;

    IF v_event_type IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED') THEN
      IF NOT v_has_subscription OR v_payment_id IS NULL THEN
        -- A confirmed payment can arrive before SUBSCRIPTION_CREATED. Preserve
        -- only the identifiers and financial fields required for exact replay;
        -- the normal customer, amount, billing-type and idempotency checks still run.
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'confirmed_payment_unmatched',
              provider_customer_id = v_customer_id,
              retry_payload = jsonb_build_object(
                'id', v_event_id,
                'event', v_event_type,
                'dateCreated', NULLIF(p_event ->> 'dateCreated', ''),
                'payment', jsonb_build_object(
                  'id', v_payment_id,
                  'subscription', v_provider_subscription_id,
                  'customer', NULLIF(v_payment ->> 'customer', ''),
                  'value', v_payment ->> 'value',
                  'billingType', v_payment ->> 'billingType',
                  'dueDate', v_payment ->> 'dueDate',
                  'paymentDate', v_payment ->> 'paymentDate',
                  'confirmedDate', v_payment ->> 'confirmedDate'
                )
              ),
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'confirmed_payment_unmatched');
      END IF;

      IF NULLIF(v_payment ->> 'customer', '') IS NOT NULL
        AND v_billing_subscription.provider_customer_id IS NOT NULL
        AND NULLIF(v_payment ->> 'customer', '') <> v_billing_subscription.provider_customer_id THEN
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'payment_customer_mismatch',
              retry_payload = NULL,
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'payment_customer_mismatch');
      END IF;

      BEGIN
        v_value_numeric := (v_payment ->> 'value')::NUMERIC;
        IF v_value_numeric IS NULL
          OR v_value_numeric * 100 <> trunc(v_value_numeric * 100) THEN
          v_value_cents := NULL;
        ELSE
          v_value_cents := (v_value_numeric * 100)::BIGINT;
        END IF;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range OR feature_not_supported THEN
          v_value_cents := NULL;
      END;
      IF NULLIF(v_payment ->> 'billingType', '') IS DISTINCT FROM 'CREDIT_CARD'
        OR v_value_cents IS NULL
        OR v_value_cents <> v_billing_subscription.amount_cents THEN
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'amount_mismatch',
              retry_payload = NULL,
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'amount_mismatch');
      END IF;

      BEGIN
        v_due_date := NULLIF(v_payment ->> 'dueDate', '')::DATE;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow THEN
          v_due_date := NULL;
      END;

      v_paid_at := NULL;
      BEGIN
        v_paid_at := NULLIF(v_payment ->> 'paymentDate', '')::TIMESTAMPTZ;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow THEN
          v_paid_at := NULL;
      END;

      IF v_paid_at IS NULL THEN
        BEGIN
          v_paid_at := NULLIF(v_payment ->> 'confirmedDate', '')::TIMESTAMPTZ;
        EXCEPTION
          WHEN invalid_datetime_format OR datetime_field_overflow THEN
            v_paid_at := NULL;
        END;
      END IF;

      IF v_paid_at IS NULL THEN
        BEGIN
          v_paid_at := NULLIF(p_event ->> 'dateCreated', '')::TIMESTAMPTZ;
        EXCEPTION
          WHEN invalid_datetime_format OR datetime_field_overflow THEN
            v_paid_at := NULL;
        END;
      END IF;

      -- Provider timestamps are preferred, but malformed or future values
      -- must never move the start of a paid period into the future.
      v_paid_at := LEAST(COALESCE(v_paid_at, now()), now());

      v_period_interval := CASE v_billing_subscription.billing_cycle
        WHEN 'YEARLY' THEN INTERVAL '1 year'
        ELSE INTERVAL '1 month'
      END;

      INSERT INTO public.ordys_billing_payments (
        provider_payment_id, user_id, provider_subscription_id,
        amount_cents, billing_type, status, due_date, confirmed_at, paid_at
      )
      VALUES (
        v_payment_id, v_billing_subscription.user_id, v_provider_subscription_id,
        v_value_cents, NULLIF(v_payment ->> 'billingType', ''),
        v_event_type, v_due_date, now(), v_paid_at
      )
      ON CONFLICT (provider_payment_id) DO NOTHING
      RETURNING provider_payment_id INTO v_event_inserted;

      IF v_event_inserted IS NOT NULL THEN
        -- Recompute from the authoritative payment ledger in settlement-time
        -- order. A late webhook for an older payment cannot add a second period
        -- after a newer payment has already extended the subscription.
        v_period_end := NULL;
        FOR v_paid_row IN
          SELECT payment.paid_at
          FROM public.ordys_billing_payments AS payment
          WHERE payment.user_id IS NOT DISTINCT FROM v_billing_subscription.user_id
            AND payment.provider_subscription_id = v_provider_subscription_id
            AND payment.status IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED')
          ORDER BY payment.paid_at, payment.provider_payment_id
        LOOP
          v_period_end := GREATEST(
            COALESCE(v_period_end, v_paid_row.paid_at),
            v_paid_row.paid_at
          ) + v_period_interval;
        END LOOP;

        IF v_period_end IS NULL THEN
          RAISE EXCEPTION 'Confirmed Asaas payment was not present in the subscription ledger';
        END IF;

        UPDATE public.ordys_billing_subscriptions
          SET status = CASE WHEN status IN ('cancelled', 'suspended') THEN status ELSE 'active' END,
              provider_status = CASE WHEN status IN ('cancelled', 'suspended') THEN provider_status ELSE 'ACTIVE' END,
              billing_type = COALESCE(NULLIF(v_payment ->> 'billingType', ''), billing_type),
              current_period_end = v_period_end,
              grace_until = CASE WHEN status = 'suspended' THEN grace_until ELSE NULL END,
              updated_at = now()
        WHERE provider_subscription_id = v_provider_subscription_id;

        UPDATE public.ordys_billing_checkout_attempts
          SET status = 'linked', updated_at = now()
        WHERE id = v_billing_subscription.checkout_attempt_id
          AND status IN ('linked', 'paid');
      ELSE
        -- A provider payment ID is globally unique. A conflict is a duplicate
        -- only when the stored ledger row belongs to this exact Ordys user and
        -- provider subscription; never let a reused ID mutate another account.
        IF NOT EXISTS (
          SELECT 1
          FROM public.ordys_billing_payments AS existing_payment
          WHERE existing_payment.provider_payment_id = v_payment_id
            AND existing_payment.user_id IS NOT DISTINCT FROM v_billing_subscription.user_id
            AND existing_payment.provider_subscription_id = v_provider_subscription_id
        ) THEN
          UPDATE public.ordys_billing_webhook_events
            SET processing_status = 'failed',
                error_code = 'payment_identity_mismatch',
                retry_payload = NULL,
                processed_at = now()
          WHERE provider_event_id = v_event_id;
          RETURN jsonb_build_object('processed', FALSE, 'error', 'payment_identity_mismatch');
        END IF;

        -- PAYMENT_RECEIVED may follow PAYMENT_CONFIRMED. The only
        -- provider-negative state that a later positive event may resolve is
        -- PAYMENT_AWAITING_CHARGEBACK_REVERSAL, which Asaas emits when the
        -- dispute is reversed in the merchant's favor. Refunds, cash reversals
        -- and unresolved chargebacks remain final in the ledger.
        UPDATE public.ordys_billing_payments
          SET status = CASE
                WHEN status = 'PAYMENT_RECEIVED' THEN 'PAYMENT_RECEIVED'
                WHEN status = 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL' THEN v_event_type
                WHEN v_event_type = 'PAYMENT_RECEIVED'
                  AND status = 'PAYMENT_CONFIRMED'
                THEN 'PAYMENT_RECEIVED'
                ELSE status
              END,
              refunded_at = CASE
                WHEN status = 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL' THEN NULL
                ELSE refunded_at
              END,
              updated_at = now()
        WHERE provider_payment_id = v_payment_id
          AND user_id IS NOT DISTINCT FROM v_billing_subscription.user_id
          AND provider_subscription_id = v_provider_subscription_id;
      END IF;

      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'processed',
            error_code = NULL,
            retry_payload = NULL,
            processed_at = now()
      WHERE provider_event_id = v_event_id;

      -- A refund/chargeback can be delivered after the subscription is linked
      -- but before its confirmed payment row exists. Replay only events that
      -- match both exact provider identifiers after the payment is persisted.
      FOR v_pending_event IN
        SELECT event.retry_payload
        FROM public.ordys_billing_webhook_events AS event
        WHERE event.processing_status = 'failed'
          AND event.error_code = 'negative_payment_unmatched'
          AND event.retry_payload -> 'payment' ->> 'id' = v_payment_id
          AND event.retry_payload -> 'payment' ->> 'subscription' = v_provider_subscription_id
          AND event.retry_payload IS NOT NULL
        ORDER BY event.received_at, event.provider_event_id
      LOOP
        PERFORM public.ordys_apply_asaas_billing_event(v_pending_event.retry_payload);
      END LOOP;

      RETURN jsonb_build_object('processed', TRUE, 'event', v_event_type);
    END IF;

    -- A delayed negative event for a payment already confirmed must not
    -- move a paid subscription back to overdue. Asaas delivers webhooks at
    -- least once and event processing may be delayed, so check the payment
    -- record before applying overdue/refusal transitions.
    IF v_has_subscription
      AND v_event_type IN (
        'PAYMENT_OVERDUE',
        'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
        'PAYMENT_REPROVED_BY_RISK_ANALYSIS'
      )
      AND v_payment_id IS NOT NULL THEN
      SELECT payment.status
        INTO v_existing_payment_status
      FROM public.ordys_billing_payments AS payment
      WHERE payment.provider_payment_id = v_payment_id
      LIMIT 1;

      IF v_existing_payment_status IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED') THEN
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'processed',
              error_code = NULL,
              retry_payload = NULL,
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object(
          'processed', TRUE,
          'ignored_stale_payment_event', TRUE,
          'event', v_event_type
        );
      END IF;
    END IF;

    IF v_has_subscription AND v_event_type = 'PAYMENT_OVERDUE' THEN
      UPDATE public.ordys_billing_subscriptions
        SET status = CASE WHEN status IN ('cancelled', 'suspended') THEN status ELSE 'past_due' END,
            grace_until = CASE
              WHEN status IN ('cancelled', 'suspended') THEN grace_until
              WHEN current_period_end IS NOT NULL THEN GREATEST(current_period_end, now()) + INTERVAL '3 days'
              ELSE NULL
            END,
            provider_status = CASE
              WHEN provider_status = 'DELETED' THEN provider_status
              ELSE 'OVERDUE'
            END,
            updated_at = now()
      WHERE provider_subscription_id = v_provider_subscription_id;
    ELSIF v_has_subscription AND v_event_type IN (
      'PAYMENT_REFUNDED',
      'PAYMENT_PARTIALLY_REFUNDED',
      'PAYMENT_REFUND_IN_PROGRESS',
      'PAYMENT_CHARGEBACK_REQUESTED',
      'PAYMENT_CHARGEBACK_DISPUTE',
      'PAYMENT_RECEIVED_IN_CASH_UNDONE'
    ) THEN
      UPDATE public.ordys_billing_subscriptions
        SET status = 'suspended', grace_until = NULL, updated_at = now()
      WHERE provider_subscription_id = v_provider_subscription_id;

      UPDATE public.ordys_billing_payments
        SET status = v_event_type,
            refunded_at = CASE
              WHEN v_event_type IN ('PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED')
              THEN now()
              ELSE refunded_at
            END,
            updated_at = now()
      WHERE provider_payment_id = v_payment_id
        AND user_id IS NOT DISTINCT FROM v_billing_subscription.user_id
        AND provider_subscription_id = v_provider_subscription_id;
    ELSIF v_has_subscription AND v_event_type = 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL' THEN
      -- Keep Plus suspended until review, but record the provider's reversal
      -- transition. A late event cannot regress a confirmed payment or
      -- overwrite a refund/cash reversal already present in the ledger.
      UPDATE public.ordys_billing_subscriptions
        SET status = 'suspended', grace_until = NULL, updated_at = now()
      WHERE provider_subscription_id = v_provider_subscription_id;

      UPDATE public.ordys_billing_payments
        SET status = CASE
              WHEN status IN (
                'PAYMENT_CONFIRMED',
                'PAYMENT_RECEIVED',
                'PAYMENT_REFUNDED',
                'PAYMENT_PARTIALLY_REFUNDED',
                'PAYMENT_REFUND_IN_PROGRESS',
                'PAYMENT_RECEIVED_IN_CASH_UNDONE'
              ) THEN status
              ELSE 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
            END,
            refunded_at = CASE
              WHEN status IN (
                'PAYMENT_CHARGEBACK_REQUESTED',
                'PAYMENT_CHARGEBACK_DISPUTE',
                'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
              ) THEN NULL
              ELSE refunded_at
            END,
            updated_at = now()
      WHERE provider_payment_id = v_payment_id
        AND user_id IS NOT DISTINCT FROM v_billing_subscription.user_id
        AND provider_subscription_id = v_provider_subscription_id;
    ELSIF v_has_subscription AND v_event_type IN (
      'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
      'PAYMENT_REPROVED_BY_RISK_ANALYSIS'
    ) THEN
      UPDATE public.ordys_billing_subscriptions
        SET status = 'past_due',
            grace_until = CASE
              WHEN current_period_end IS NOT NULL THEN GREATEST(current_period_end, now()) + INTERVAL '3 days'
              ELSE NULL
            END,
            provider_status = 'OVERDUE',
            updated_at = now()
      WHERE provider_subscription_id = v_provider_subscription_id
        AND status NOT IN ('cancelled', 'suspended');
    END IF;
  END IF;

  UPDATE public.ordys_billing_webhook_events
    SET processing_status = CASE
          WHEN v_event_type IN (
            'PAYMENT_OVERDUE',
            'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
            'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
            'PAYMENT_REFUNDED',
            'PAYMENT_PARTIALLY_REFUNDED',
            'PAYMENT_REFUND_IN_PROGRESS',
            'PAYMENT_CHARGEBACK_REQUESTED',
            'PAYMENT_CHARGEBACK_DISPUTE',
            'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
            'PAYMENT_RECEIVED_IN_CASH_UNDONE'
          ) THEN 'processed'
          WHEN processing_status = 'received' THEN 'ignored'
          ELSE processing_status
        END,
        error_code = CASE
          WHEN error_code = 'negative_payment_unmatched' THEN NULL
          ELSE error_code
        END,
        retry_payload = CASE
          WHEN v_event_type IN (
            'PAYMENT_OVERDUE',
            'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
            'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
            'PAYMENT_REFUNDED',
            'PAYMENT_PARTIALLY_REFUNDED',
            'PAYMENT_REFUND_IN_PROGRESS',
            'PAYMENT_CHARGEBACK_REQUESTED',
            'PAYMENT_CHARGEBACK_DISPUTE',
            'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
            'PAYMENT_RECEIVED_IN_CASH_UNDONE'
          ) THEN NULL
          ELSE retry_payload
        END,
        processed_at = now()
  WHERE provider_event_id = v_event_id;

  RETURN jsonb_build_object('processed', TRUE, 'event', v_event_type);
END;
$$;



-- Final readiness definition: require the processor's retained confirmed-payment

-- payload and its exact-subscription/payment retry index.

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
      AND to_regprocedure('public.ordys_confirm_subscription_cancellation(uuid,uuid,timestamp with time zone)') IS NOT NULL
      AND to_regprocedure('public.ordys_apply_asaas_billing_event(jsonb)') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_apply_asaas_billing_event(jsonb)')
          AND prosrc LIKE '%error_code = ''confirmed_payment_unmatched''%'
          AND prosrc LIKE '%provider_customer_id = v_customer_id%'
          AND prosrc LIKE '%retry_payload = jsonb_build_object%'
          AND prosrc LIKE '%''dateCreated''%'
          AND prosrc LIKE '%invalid_text_representation OR numeric_value_out_of_range OR feature_not_supported%'
          AND prosrc LIKE '%v_value_numeric * 100 <> trunc(v_value_numeric * 100)%'
          AND prosrc LIKE '%invalid_datetime_format OR datetime_field_overflow%'
          AND prosrc LIKE '%v_paid_at := LEAST(COALESCE(v_paid_at, now()), now())%'
          AND prosrc LIKE '%ORDER BY payment.paid_at, payment.provider_payment_id%'
          AND prosrc LIKE '%current_period_end = v_period_end%'
          AND prosrc LIKE '%v_provider_subscription_id IS NULL%'
          AND prosrc LIKE '%payment.provider_payment_id = v_payment_id%'
          AND prosrc LIKE '%IF v_paid_at IS NULL THEN%'
      )
      AND to_regclass('public.ordys_billing_webhook_unmatched_payment_retry_idx') IS NOT NULL
      AND to_regprocedure('public.ordys_has_unreconciled_billing_events(uuid)') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_has_unreconciled_billing_events(uuid)')
          AND prosrc LIKE '%payment_subscription_unmatched%'
          AND prosrc LIKE '%subscription_delete_unmatched%'
          AND prosrc LIKE '%ambiguous_customer_association%'
          AND prosrc LIKE '%subscription_checkout_mismatch%'
          AND prosrc LIKE '%subscription_customer_mismatch%'
          AND prosrc LIKE '%subscription_identity_mismatch%'
          AND prosrc LIKE '%subscription_amount_mismatch%'
          AND prosrc LIKE '%payment_customer_mismatch%'
          AND prosrc LIKE '%payment_identity_mismatch%'
          AND prosrc LIKE '%amount_mismatch%'
          AND prosrc LIKE '%checkout_customer_mismatch%'
          AND prosrc LIKE '%checkout_paid_after_closed%'
          AND prosrc LIKE '%checkout_reference_mismatch%'
          AND prosrc LIKE '%confirmed_payment_unmatched%'
          AND prosrc LIKE '%negative_payment_unmatched%'
          AND prosrc LIKE '%subscription_checkout_unmatched%'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_release_account_deletion_reservation(uuid,boolean)')
          AND prosrc LIKE '%ordys_has_unreconciled_billing_events%'
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations')
          AND attname = 'processing_token' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations')
          AND attname = 'processing_until' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts')
          AND attname = 'cancellation_requested_at' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts')
          AND attname = 'cancellation_claim_id' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_requested_at' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_claim_id' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_confirmed_at' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_events')
          AND attname = 'provider_customer_id' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_events')
          AND attname = 'retry_payload' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.delete_own_data()')
          AND prosrc LIKE '%ordys_account_deletion_reservations%'
          AND prosrc LIKE '%processing_token%'
          AND prosrc LIKE '%pg_advisory_xact_lock%'
          AND prosrc LIKE '%cancellation_confirmed_at IS NULL%'
          AND prosrc LIKE '%negative_payment_unmatched%'
          AND prosrc LIKE '%ordys_has_unreconciled_billing_events%'
          AND prosrc LIKE '%billing-aware account deletion is required%'
      )
    THEN 'ready'
    ELSE 'partial'
  END;
$$;

CREATE OR REPLACE FUNCTION public.ordys_receive_asaas_billing_webhook(p_event JSONB)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_id TEXT := NULLIF(p_event ->> 'id', '');
  v_event_type TEXT := NULLIF(p_event ->> 'event', '');
  v_payment JSONB := CASE WHEN jsonb_typeof(p_event -> 'payment') = 'object'
    THEN p_event -> 'payment' ELSE '{}'::JSONB END;
  v_subscription JSONB := CASE WHEN jsonb_typeof(p_event -> 'subscription') = 'object'
    THEN p_event -> 'subscription' ELSE '{}'::JSONB END;
  v_checkout JSONB := CASE WHEN jsonb_typeof(p_event -> 'checkout') = 'object'
    THEN p_event -> 'checkout' ELSE '{}'::JSONB END;
  v_payload JSONB;
  v_payment_id TEXT;
  v_checkout_id TEXT;
  v_customer_id TEXT;
  v_provider_subscription_id TEXT;
  v_external_reference TEXT;
  v_user_id UUID;
  v_candidate_count INTEGER := 0;
  v_null_candidate_count INTEGER := 0;
  v_existing public.ordys_billing_webhook_inbox%ROWTYPE;
  v_legacy_status TEXT;
  v_legacy_error TEXT;
  v_initial_status TEXT := 'received';
  v_inserted_id TEXT;
BEGIN
  IF jsonb_typeof(p_event) IS DISTINCT FROM 'object'
    OR v_event_id IS NULL
    OR length(v_event_id) > 255
    OR v_event_type IS NULL
    OR length(v_event_type) > 128 THEN
    RAISE EXCEPTION 'Invalid Asaas webhook envelope';
  END IF;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'id', v_event_id,
    'event', v_event_type,
    'dateCreated', NULLIF(p_event ->> 'dateCreated', ''),
    'payment', jsonb_strip_nulls(jsonb_build_object(
      'id', NULLIF(v_payment ->> 'id', ''),
      'subscription', NULLIF(v_payment ->> 'subscription', ''),
      'customer', NULLIF(v_payment ->> 'customer', ''),
      'externalReference', NULLIF(v_payment ->> 'externalReference', ''),
      'value', v_payment -> 'value',
      'billingType', NULLIF(v_payment ->> 'billingType', ''),
      'dueDate', NULLIF(v_payment ->> 'dueDate', ''),
      'paymentDate', NULLIF(v_payment ->> 'paymentDate', ''),
      'confirmedDate', NULLIF(v_payment ->> 'confirmedDate', '')
    )),
    'subscription', jsonb_strip_nulls(jsonb_build_object(
      'id', NULLIF(v_subscription ->> 'id', ''),
      'customer', NULLIF(v_subscription ->> 'customer', ''),
      'externalReference', NULLIF(v_subscription ->> 'externalReference', ''),
      'billingType', NULLIF(v_subscription ->> 'billingType', ''),
      'cycle', NULLIF(v_subscription ->> 'cycle', ''),
      'value', v_subscription -> 'value',
      'status', NULLIF(v_subscription ->> 'status', '')
    )),
    'checkout', jsonb_strip_nulls(jsonb_build_object(
      'id', NULLIF(v_checkout ->> 'id', ''),
      'customer', NULLIF(v_checkout ->> 'customer', ''),
      'externalReference', NULLIF(v_checkout ->> 'externalReference', '')
    ))
  ));

  v_payment_id := NULLIF(v_payment ->> 'id', '');
  v_checkout_id := NULLIF(v_checkout ->> 'id', '');
  v_customer_id := COALESCE(
    NULLIF(v_subscription ->> 'customer', ''),
    NULLIF(v_checkout ->> 'customer', ''),
    NULLIF(v_payment ->> 'customer', '')
  );
  v_provider_subscription_id := COALESCE(
    NULLIF(v_payment ->> 'subscription', ''),
    NULLIF(v_subscription ->> 'id', '')
  );
  v_external_reference := COALESCE(
    NULLIF(v_payment ->> 'externalReference', ''),
    NULLIF(v_checkout ->> 'externalReference', ''),
    NULLIF(v_subscription ->> 'externalReference', '')
  );

  -- One lock order for every admission/receipt/finalization path prevents a
  -- webhook from being invisible while a new recurring Checkout is admitted.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:asaas-inbox-admission', 0)
  );

  -- A retained anonymized ledger row is a candidate with no owner.
  -- Do not assign the event to the only non-NULL candidate when a NULL-owner
  -- record also matches the same provider identity; ownership is ambiguous.
  SELECT
    count(DISTINCT candidate.user_id)::INTEGER,
    (count(*) FILTER (WHERE candidate.user_id IS NULL))::INTEGER,
    (array_agg(DISTINCT candidate.user_id) FILTER (WHERE candidate.user_id IS NOT NULL))[1]
  INTO v_candidate_count, v_null_candidate_count, v_user_id
  FROM (
    SELECT attempt.user_id
    FROM public.ordys_billing_checkout_attempts AS attempt
    WHERE (v_checkout_id IS NOT NULL AND attempt.provider_checkout_id = v_checkout_id)
      OR (v_external_reference IS NOT NULL AND attempt.external_reference = v_external_reference)
      OR (v_customer_id IS NOT NULL AND attempt.provider_customer_id = v_customer_id)
    UNION
    SELECT subscription.user_id
    FROM public.ordys_billing_subscriptions AS subscription
    WHERE (v_provider_subscription_id IS NOT NULL
      AND subscription.provider_subscription_id = v_provider_subscription_id)
      OR (v_customer_id IS NOT NULL AND subscription.provider_customer_id = v_customer_id)
  ) AS candidate;

  IF v_candidate_count <> 1 OR v_null_candidate_count > 0 THEN
    v_user_id := NULL;
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ordys:billing-lifecycle:' || v_user_id::TEXT, 0)
    );
  END IF;

  SELECT *
    INTO v_existing
  FROM public.ordys_billing_webhook_inbox AS inbox
  WHERE inbox.provider_event_id = v_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.event_payload IS DISTINCT FROM v_payload THEN
      UPDATE public.ordys_billing_webhook_inbox
        SET processing_status = 'quarantined',
            error_code = 'event_id_payload_mismatch',
            user_id = NULL,
            processed_at = now()
      WHERE provider_event_id = v_event_id;
      RETURN jsonb_build_object(
        'accepted', TRUE,
        'processing_status', 'quarantined',
        'duplicate', TRUE,
        'event_id_conflict', TRUE
      );
    END IF;

    IF v_existing.processing_status = 'received'
      AND v_existing.user_id IS NULL
      AND v_user_id IS NOT NULL THEN
      UPDATE public.ordys_billing_webhook_inbox
        SET user_id = v_user_id
      WHERE provider_event_id = v_event_id;
      v_existing.user_id := v_user_id;
    END IF;

    RETURN jsonb_build_object(
      'accepted', TRUE,
      'processing_status', v_existing.processing_status,
      'duplicate', TRUE,
      'event_id_conflict', FALSE
    );
  END IF;

  -- Events processed by the previous synchronous handler remain idempotent
  -- across rollout. A legacy failed event is imported as quarantined.
  SELECT event.processing_status, event.error_code
    INTO v_legacy_status, v_legacy_error
  FROM public.ordys_billing_webhook_events AS event
  WHERE event.provider_event_id = v_event_id;

  IF FOUND THEN
    v_initial_status := CASE v_legacy_status
      WHEN 'processed' THEN 'processed'
      WHEN 'ignored' THEN 'ignored'
      WHEN 'failed' THEN 'quarantined'
      ELSE 'received'
    END;
  END IF;

  INSERT INTO public.ordys_billing_webhook_inbox (
    provider_event_id, event_type, provider_object_id,
    provider_customer_id, provider_subscription_id, external_reference,
    user_id, event_payload, processing_status, error_code, processed_at
  )
  VALUES (
    v_event_id, v_event_type,
    COALESCE(v_payment_id, v_provider_subscription_id, v_checkout_id),
    v_customer_id, v_provider_subscription_id, v_external_reference,
    v_user_id, v_payload, v_initial_status, v_legacy_error,
    CASE WHEN v_initial_status IN ('processed', 'ignored', 'quarantined') THEN now() ELSE NULL END
  )
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING provider_event_id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    RAISE EXCEPTION 'Asaas webhook inbox receipt conflicted unexpectedly';
  END IF;

  RETURN jsonb_build_object(
    'accepted', TRUE,
    'processing_status', v_initial_status,
    'duplicate', FALSE,
    'event_id_conflict', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ordys_receive_asaas_billing_webhook(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_receive_asaas_billing_webhook(JSONB)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ordys_sync_billing_webhook_inbox_status()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.ordys_billing_webhook_inbox
    SET processing_status = CASE NEW.processing_status
          WHEN 'processed' THEN 'processed'
          WHEN 'ignored' THEN 'ignored'
          WHEN 'failed' THEN 'quarantined'
          ELSE 'received'
        END,
        error_code = NEW.error_code,
        processed_at = CASE
          WHEN NEW.processing_status IN ('processed', 'ignored', 'failed')
            THEN COALESCE(NEW.processed_at, now())
          ELSE NULL
        END
  WHERE provider_event_id = NEW.provider_event_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ordys_sync_billing_webhook_inbox_status()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ordys_sync_billing_webhook_inbox_status
  ON public.ordys_billing_webhook_events;
CREATE TRIGGER ordys_sync_billing_webhook_inbox_status
AFTER INSERT OR UPDATE ON public.ordys_billing_webhook_events
FOR EACH ROW
EXECUTE FUNCTION public.ordys_sync_billing_webhook_inbox_status();

CREATE OR REPLACE FUNCTION public.ordys_process_asaas_billing_webhook(p_event_id TEXT)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inbox public.ordys_billing_webhook_inbox%ROWTYPE;
  v_processor_result JSONB;
  v_legacy_status TEXT;
  v_legacy_error TEXT;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' OR length(p_event_id) > 255 THEN
    RAISE EXCEPTION 'Invalid Asaas webhook event ID';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:asaas-inbox-admission', 0)
  );

  SELECT *
    INTO v_inbox
  FROM public.ordys_billing_webhook_inbox AS inbox
  WHERE inbox.provider_event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asaas webhook event was not durably received';
  END IF;

  IF v_inbox.processing_status IN ('processed', 'ignored') THEN
    RETURN jsonb_build_object('processed', FALSE, 'duplicate', TRUE);
  END IF;
  IF v_inbox.processing_status = 'quarantined' THEN
    IF v_inbox.error_code IN (
      'ambiguous_customer_association', 'amount_mismatch', 'checkout_customer_mismatch',
      'checkout_paid_after_closed', 'checkout_reference_mismatch', 'confirmed_payment_unmatched',
      'negative_payment_unmatched', 'payment_customer_mismatch', 'payment_identity_mismatch',
      'payment_subscription_unmatched', 'subscription_amount_mismatch', 'subscription_checkout_mismatch',
      'subscription_checkout_unmatched', 'subscription_customer_mismatch', 'subscription_delete_unmatched',
      'subscription_identity_mismatch'
    ) THEN
      RETURN jsonb_build_object('processed', FALSE, 'error', v_inbox.error_code);
    END IF;
    RETURN jsonb_build_object('processed', FALSE, 'duplicate', TRUE);
  END IF;

  IF v_inbox.user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ordys:billing-lifecycle:' || v_inbox.user_id::TEXT, 0)
    );
  END IF;

  -- The durable inbox row committed in a previous transaction. If this
  -- processor rolls back or times out, the receipt remains visible as received.
  v_processor_result := public.ordys_apply_asaas_billing_event(v_inbox.event_payload);

  SELECT event.processing_status, event.error_code
    INTO v_legacy_status, v_legacy_error
  FROM public.ordys_billing_webhook_events AS event
  WHERE event.provider_event_id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asaas webhook processor did not persist its event state';
  END IF;

  UPDATE public.ordys_billing_webhook_inbox
    SET processing_status = CASE v_legacy_status
          WHEN 'processed' THEN 'processed'
          WHEN 'ignored' THEN 'ignored'
          WHEN 'failed' THEN 'quarantined'
          ELSE 'received'
        END,
        error_code = v_legacy_error,
        processed_at = CASE
          WHEN v_legacy_status IN ('processed', 'ignored', 'failed') THEN now()
          ELSE NULL
        END
  WHERE provider_event_id = p_event_id;

  IF v_legacy_status = 'failed' AND v_legacy_error IS NOT NULL THEN
    RETURN jsonb_build_object('processed', FALSE, 'error', v_legacy_error);
  END IF;
  IF v_legacy_status NOT IN ('processed', 'ignored') THEN
    RAISE EXCEPTION 'Asaas webhook processing did not reach a terminal state';
  END IF;

  RETURN v_processor_result;
END;
$$;

REVOKE ALL ON FUNCTION public.ordys_process_asaas_billing_webhook(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_process_asaas_billing_webhook(TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.process_ordys_asaas_billing_event(p_event JSONB)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_receipt JSONB;
  v_event_id TEXT := NULLIF(p_event ->> 'id', '');
  v_status TEXT;
  v_error TEXT;
BEGIN
  -- Compatibility bridge for an old Edge Function instance still calling the
  -- legacy one-RPC contract. The legacy handler acknowledges every successful
  -- RPC response with HTTP 200, even when the returned JSON has no "processed"
  -- field. Process the first receipt in this same transaction so it can only
  -- be acknowledged after a terminal processor result. If processing raises,
  -- the transaction rolls back the receipt and the legacy Edge Function
  -- returns non-2xx, allowing Asaas to retry. The current Edge Function keeps
  -- the separate two-transaction receive/process flow for durable receipts.
  v_receipt := public.ordys_receive_asaas_billing_webhook(p_event);
  v_status := v_receipt ->> 'processing_status';

  IF v_status = 'received' THEN
    RETURN public.ordys_process_asaas_billing_webhook(v_event_id);
  END IF;

  IF v_status IN ('processed', 'ignored') THEN
    RETURN jsonb_build_object('processed', FALSE, 'duplicate', TRUE);
  END IF;

  IF v_status = 'quarantined' THEN
    SELECT inbox.error_code
      INTO v_error
    FROM public.ordys_billing_webhook_inbox AS inbox
    WHERE inbox.provider_event_id = v_event_id;

    IF v_error IN (
      'ambiguous_customer_association', 'amount_mismatch', 'checkout_customer_mismatch',
      'checkout_paid_after_closed', 'checkout_reference_mismatch', 'confirmed_payment_unmatched',
      'negative_payment_unmatched', 'payment_customer_mismatch', 'payment_identity_mismatch',
      'payment_subscription_unmatched', 'subscription_amount_mismatch', 'subscription_checkout_mismatch',
      'subscription_checkout_unmatched', 'subscription_customer_mismatch', 'subscription_delete_unmatched',
      'subscription_identity_mismatch'
    ) THEN
      RETURN jsonb_build_object('processed', FALSE, 'error', v_error);
    END IF;

    RETURN jsonb_build_object('processed', FALSE, 'duplicate', TRUE);
  END IF;

  RAISE EXCEPTION 'Asaas webhook compatibility receipt returned an invalid state';
END;
$$;

REVOKE ALL ON FUNCTION public.process_ordys_asaas_billing_event(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_ordys_asaas_billing_event(JSONB)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ordys_has_unreconciled_billing_events_except(
  p_user_id UUID,
  p_allowed_checkout_reference TEXT,
  p_allowed_provider_checkout_id TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN TRUE
    ELSE (
      EXISTS (
      SELECT 1
      FROM public.ordys_billing_webhook_events AS event
      WHERE event.processing_status = 'failed'
        AND (
          (
            event.error_code = 'subscription_checkout_unmatched'
            AND EXISTS (
              SELECT 1
              FROM public.ordys_billing_checkout_attempts AS attempt
              WHERE attempt.user_id = p_user_id
                AND (
                  (
                    event.provider_customer_id IS NOT NULL
                    AND attempt.provider_customer_id = event.provider_customer_id
                  )
                  OR NULLIF(event.retry_payload -> 'subscription' ->> 'externalReference', '') =
                    attempt.external_reference
                )
            )
          )
          OR (
            event.error_code IN ('confirmed_payment_unmatched', 'negative_payment_unmatched')
            AND (
              EXISTS (
                SELECT 1
                FROM public.ordys_billing_subscriptions AS subscription
                WHERE subscription.user_id = p_user_id
                  AND event.retry_payload -> 'payment' ->> 'subscription' =
                    subscription.provider_subscription_id
              )
              OR EXISTS (
                SELECT 1
                FROM public.ordys_billing_checkout_attempts AS attempt
                WHERE attempt.user_id = p_user_id
                  AND event.provider_customer_id IS NOT NULL
                  AND attempt.provider_customer_id = event.provider_customer_id
              )
            )
          )
          OR (
            -- When a subscription-created event cannot be tied to ANY local
            -- attempt, its owner is unknowable. Fail closed for account deletion
            -- until an operator reconciles or clears that orphaned provider event.
            event.error_code = 'subscription_checkout_unmatched'
            AND NOT EXISTS (
              SELECT 1
              FROM public.ordys_billing_checkout_attempts AS candidate
              WHERE (
                event.provider_customer_id IS NOT NULL
                AND candidate.provider_customer_id = event.provider_customer_id
              )
              OR NULLIF(event.retry_payload -> 'subscription' ->> 'externalReference', '') =
                candidate.external_reference
            )
          )
          OR (
            -- A confirmed payment, refund or chargeback can arrive before its
            -- subscription row and before its Checkout/customer association.
            -- If neither identifier maps to local data, the owner is unknown:
            -- block account deletion globally until an operator reconciles it.
            event.error_code IN ('confirmed_payment_unmatched', 'negative_payment_unmatched')
            AND NOT EXISTS (
              SELECT 1
              FROM public.ordys_billing_subscriptions AS known_subscription
              WHERE known_subscription.provider_subscription_id =
                event.retry_payload -> 'payment' ->> 'subscription'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.ordys_billing_checkout_attempts AS candidate
              WHERE event.provider_customer_id IS NOT NULL
                AND candidate.provider_customer_id = event.provider_customer_id
            )
          )
          OR (
            event.error_code IN ('checkout_customer_mismatch', 'checkout_reference_mismatch')
            AND EXISTS (
              SELECT 1
              FROM public.ordys_billing_checkout_attempts AS attempt
              WHERE attempt.user_id = p_user_id
                AND attempt.id::TEXT = event.retry_payload ->> 'checkoutAttemptId'
            )
          )
          OR (
            event.error_code = 'checkout_paid_after_closed'
            AND EXISTS (
              SELECT 1
              FROM public.ordys_billing_checkout_attempts AS attempt
              WHERE attempt.user_id = p_user_id
                AND attempt.provider_checkout_id = event.provider_object_id
            )
          )
          OR (
            event.error_code = 'payment_subscription_unmatched'
            AND (
              EXISTS (
                SELECT 1
                FROM public.ordys_billing_subscriptions AS subscription
                WHERE subscription.user_id = p_user_id
                  AND event.retry_payload -> 'payment' ->> 'subscription' =
                    subscription.provider_subscription_id
              )
              OR EXISTS (
                SELECT 1
                FROM public.ordys_billing_checkout_attempts AS attempt
                WHERE attempt.user_id = p_user_id
                  AND event.provider_customer_id IS NOT NULL
                  AND attempt.provider_customer_id = event.provider_customer_id
              )
            )
          )
          OR (
            event.error_code = 'payment_subscription_unmatched'
            AND NOT EXISTS (
              SELECT 1
              FROM public.ordys_billing_subscriptions AS known_subscription
              WHERE known_subscription.provider_subscription_id =
                event.retry_payload -> 'payment' ->> 'subscription'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.ordys_billing_checkout_attempts AS candidate
              WHERE event.provider_customer_id IS NOT NULL
                AND candidate.provider_customer_id = event.provider_customer_id
            )
          )
          OR (
            event.error_code = 'subscription_delete_unmatched'
            AND (
              EXISTS (
                SELECT 1
                FROM public.ordys_billing_subscriptions AS subscription
                WHERE subscription.user_id = p_user_id
                  AND event.retry_payload -> 'subscription' ->> 'id' =
                    subscription.provider_subscription_id
              )
              OR EXISTS (
                SELECT 1
                FROM public.ordys_billing_checkout_attempts AS attempt
                WHERE attempt.user_id = p_user_id
                  AND event.provider_customer_id IS NOT NULL
                  AND attempt.provider_customer_id = event.provider_customer_id
              )
            )
          )
          OR (
            event.error_code = 'subscription_delete_unmatched'
            AND NOT EXISTS (
              SELECT 1
              FROM public.ordys_billing_subscriptions AS known_subscription
              WHERE known_subscription.provider_subscription_id =
                event.retry_payload -> 'subscription' ->> 'id'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.ordys_billing_checkout_attempts AS candidate
              WHERE event.provider_customer_id IS NOT NULL
                AND candidate.provider_customer_id = event.provider_customer_id
            )
          )
          -- This provider event was quarantined because customer identity is ambiguous.
          -- No local owner can be trusted; keep every account deletion blocked
          -- until an operator reconciles the Asaas customer/subscription mapping.
          OR event.error_code = 'ambiguous_customer_association'
          -- Permanent identity/value quarantine errors have no safe automatic
          -- replay. Until an operator compares provider records with the local
          -- Checkout/payment ledger, no account can be deleted.
          OR event.error_code IN (
            'subscription_checkout_mismatch',
            'subscription_customer_mismatch',
            'subscription_identity_mismatch',
            'subscription_amount_mismatch',
            'payment_customer_mismatch',
            'payment_identity_mismatch',
            'amount_mismatch'
          )
          OR (
            event.error_code IN ('checkout_customer_mismatch', 'checkout_reference_mismatch')
            AND NOT EXISTS (
              SELECT 1
              FROM public.ordys_billing_checkout_attempts AS candidate
              WHERE candidate.id::TEXT = event.retry_payload ->> 'checkoutAttemptId'
            )
          )
          OR (
            event.error_code = 'checkout_paid_after_closed'
            AND NOT EXISTS (
              SELECT 1
              FROM public.ordys_billing_checkout_attempts AS candidate
              WHERE candidate.provider_checkout_id = event.provider_object_id
            )
          )
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.ordys_billing_webhook_inbox AS inbox
        WHERE inbox.processing_status IN ('received', 'quarantined')
          AND (
            inbox.user_id = p_user_id
            OR inbox.user_id IS NULL
            -- A Checkout ID is provider-unique. Include an exact-ID event even
            -- when its supplied externalReference points at another attempt;
            -- that conflict must block this finalization rather than disappear
            -- merely because receipt associated the event with another owner.
            OR (
              p_allowed_provider_checkout_id IS NOT NULL
              AND inbox.event_type = 'CHECKOUT_CREATED'
              AND inbox.event_payload #>> '{checkout,id}' = p_allowed_provider_checkout_id
            )
          )
          AND NOT (
            inbox.processing_status = 'received'
            AND inbox.event_type = 'CHECKOUT_CREATED'
            AND p_allowed_provider_checkout_id IS NOT NULL
            AND inbox.event_payload #>> '{checkout,id}' = p_allowed_provider_checkout_id
            AND (
              -- The documented CHECKOUT_CREATED payload may omit this field.
              -- In that case, the exact provider Checkout ID is sufficient.
              inbox.event_payload #>> '{checkout,externalReference}' IS NULL
              OR (
                p_allowed_checkout_reference IS NOT NULL
                AND inbox.event_payload #>> '{checkout,externalReference}' = p_allowed_checkout_reference
              )
            )
          )
      )
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.ordys_has_unreconciled_billing_events_except(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_has_unreconciled_billing_events_except(UUID, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ordys_has_unreconciled_billing_events(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.ordys_has_unreconciled_billing_events_except(p_user_id, NULL, NULL);
$$;

REVOKE ALL ON FUNCTION public.ordys_has_unreconciled_billing_events(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_has_unreconciled_billing_events(UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ordys_finalize_billing_checkout_attempt(
  p_user_id UUID,
  p_attempt_id UUID,
  p_provider_checkout_id TEXT,
  p_checkout_url TEXT
)
RETURNS TEXT
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt public.ordys_billing_checkout_attempts%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_attempt_id IS NULL
    OR p_provider_checkout_id IS NULL
    OR p_provider_checkout_id !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p_checkout_url IS DISTINCT FROM
      ('https://asaas.com/checkoutSession/show?id=' || p_provider_checkout_id) THEN
    RAISE EXCEPTION 'Invalid ORDYS Checkout finalization parameters';
  END IF;

  -- Keep the same lock order as webhook receipt and Checkout admission.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:asaas-inbox-admission', 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:billing-lifecycle:' || p_user_id::TEXT, 0)
  );

  SELECT *
    INTO v_attempt
  FROM public.ordys_billing_checkout_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDYS Checkout attempt was not found for its owner';
  END IF;
  IF v_attempt.provider_checkout_id IS NOT NULL
    AND v_attempt.provider_checkout_id <> p_provider_checkout_id THEN
    RAISE EXCEPTION 'ORDYS Checkout provider identity does not match the reserved attempt';
  END IF;

  -- Persist provider identity for reconciliation, but keep the URL private
  -- until the post-webhook concurrency check has succeeded.
  UPDATE public.ordys_billing_checkout_attempts
    SET provider_checkout_id = p_provider_checkout_id,
        updated_at = now()
  WHERE id = p_attempt_id
    AND user_id = p_user_id;

  IF v_attempt.status IN ('cancelled', 'expired', 'failed') THEN
    RETURN 'terminal';
  END IF;
  IF v_attempt.status IN ('paid', 'linked') THEN
    RETURN 'reconciled';
  END IF;
  IF v_attempt.status NOT IN ('creating', 'pending') THEN
    RAISE EXCEPTION 'ORDYS Checkout attempt is not finalizable';
  END IF;

  -- A CHECKOUT_CREATED event for this exact attempt is harmless while it is
  -- being processed; every other received/quarantined event blocks exposure.
  IF public.ordys_has_unreconciled_billing_events_except(
    p_user_id,
    v_attempt.external_reference,
    p_provider_checkout_id
  ) THEN
    RETURN 'cancel_required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ordys_billing_subscriptions AS subscription
    WHERE subscription.user_id = p_user_id
      AND (
        subscription.status IN ('pending', 'active', 'past_due', 'suspended')
        OR (
          subscription.status = 'cancelled'
          AND (
            subscription.current_period_end > now()
            OR (
              subscription.provider_status IS DISTINCT FROM 'DELETED'
              AND subscription.cancellation_confirmed_at IS NULL
            )
          )
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.ordys_billing_checkout_attempts AS other_attempt
    WHERE other_attempt.user_id = p_user_id
      AND other_attempt.id <> p_attempt_id
      AND other_attempt.status IN ('creating', 'pending', 'paid', 'linked')
  ) THEN
    RETURN 'cancel_required';
  END IF;

  UPDATE public.ordys_billing_checkout_attempts
    SET status = 'pending',
        checkout_url = p_checkout_url,
        updated_at = now()
  WHERE id = p_attempt_id
    AND user_id = p_user_id
    AND status IN ('creating', 'pending');

  RETURN 'ready';
END;
$$;

REVOKE ALL ON FUNCTION public.ordys_finalize_billing_checkout_attempt(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_finalize_billing_checkout_attempt(UUID, UUID, TEXT, TEXT)
  TO service_role;

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

  -- Serialize receipt, processing, Checkout admission and finalization.
  -- Every path takes the global inbox lock before the per-user lifecycle lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ordys:asaas-inbox-admission', 0)
  );

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

  -- The billing events table can hold an Asaas subscription/payment event
  -- whose Checkout is locally terminal but whose remote identity is unresolved.
  -- Starting another recurring Checkout in that state can create a second
  -- chargeable subscription. The helper deliberately fails closed for both
  -- user-linked and owner-unknown provider events until operator reconciliation.
  IF public.ordys_has_unreconciled_billing_events(p_user_id) THEN
    RETURN 'billing_reconciliation_required';
  END IF;

  -- ORDYS unresolved provider subscription checkout guard.
  -- Keep the database RPC aligned with the Edge Function's subscription checks;
  -- a caller must not create a second recurrence while an older one is active,
  -- suspended, awaiting its first payment, or locally cancelled without proof
  -- that Asaas actually deleted it.
  IF EXISTS (
    SELECT 1
    FROM public.ordys_billing_subscriptions AS subscription
    WHERE subscription.user_id = p_user_id
      AND (
        subscription.status IN ('pending', 'active', 'past_due', 'suspended')
        OR (
          subscription.status = 'cancelled'
          AND (
            subscription.current_period_end > now()
            OR (
              subscription.provider_status IS DISTINCT FROM 'DELETED'
              AND subscription.cancellation_confirmed_at IS NULL
            )
          )
        )
      )
  ) THEN
    RETURN 'billing_reconciliation_required';
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
      AND to_regclass('public.ordys_billing_webhook_inbox') IS NULL
    THEN 'absent'
    WHEN to_regclass('public.ordys_billing_settings') IS NOT NULL
      AND to_regclass('public.ordys_billing_plans') IS NOT NULL
      AND to_regclass('public.ordys_billing_checkout_attempts') IS NOT NULL
      AND to_regclass('public.ordys_billing_subscriptions') IS NOT NULL
      AND to_regclass('public.ordys_billing_payments') IS NOT NULL
      AND to_regclass('public.ordys_billing_webhook_events') IS NOT NULL
      AND to_regclass('public.ordys_account_deletion_reservations') IS NOT NULL
      AND to_regclass('public.ordys_billing_webhook_inbox') IS NOT NULL
      AND to_regclass('public.ordys_billing_webhook_inbox_admission_idx') IS NOT NULL
      AND to_regclass('public.ordys_billing_payment_subscription_paid_at_idx') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts')
          AND attname = 'user_id' AND attnum > 0 AND NOT attisdropped AND NOT attnotnull
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'user_id' AND attnum > 0 AND NOT attisdropped AND NOT attnotnull
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_payments')
          AND attname = 'user_id' AND attnum > 0 AND NOT attisdropped AND NOT attnotnull
      )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint AS fk
        JOIN pg_attribute AS column_row
          ON column_row.attrelid = fk.conrelid
         AND column_row.attnum = ANY(fk.conkey)
        WHERE fk.conrelid = to_regclass('public.ordys_billing_checkout_attempts')
          AND fk.confrelid = to_regclass('auth.users')
          AND fk.contype = 'f'
          AND fk.confdeltype = 'n'
          AND column_row.attname = 'user_id'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint AS fk
        JOIN pg_attribute AS column_row
          ON column_row.attrelid = fk.conrelid
         AND column_row.attnum = ANY(fk.conkey)
        WHERE fk.conrelid = to_regclass('public.ordys_billing_subscriptions')
          AND fk.confrelid = to_regclass('auth.users')
          AND fk.contype = 'f'
          AND fk.confdeltype = 'n'
          AND column_row.attname = 'user_id'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint AS fk
        JOIN pg_attribute AS column_row
          ON column_row.attrelid = fk.conrelid
         AND column_row.attnum = ANY(fk.conkey)
        WHERE fk.conrelid = to_regclass('public.ordys_billing_payments')
          AND fk.confrelid = to_regclass('auth.users')
          AND fk.contype = 'f'
          AND fk.confdeltype = 'n'
          AND column_row.attname = 'user_id'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS fk
        JOIN pg_attribute AS column_row
          ON column_row.attrelid = fk.conrelid
         AND column_row.attnum = ANY(fk.conkey)
        WHERE fk.conrelid IN (
          to_regclass('public.ordys_billing_checkout_attempts'),
          to_regclass('public.ordys_billing_subscriptions'),
          to_regclass('public.ordys_billing_payments')
        )
          AND fk.confrelid = to_regclass('auth.users')
          AND fk.contype = 'f'
          AND fk.confdeltype <> 'n'
          AND column_row.attname = 'user_id'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.delete_own_data()')
          AND prosrc LIKE '%UPDATE public.ordys_billing_webhook_inbox%'
          AND prosrc LIKE '%SET user_id = NULL%'
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_payments')
          AND attname = 'paid_at' AND attnum > 0 AND NOT attisdropped AND attnotnull
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_inbox')
          AND attname = 'user_id' AND attnum > 0 AND NOT attisdropped AND NOT attnotnull
      )
      AND EXISTS (
        SELECT 1
        FROM pg_class
        WHERE oid = to_regclass('public.ordys_billing_webhook_inbox')
          AND relrowsecurity
      )
      AND NOT has_table_privilege('anon', 'public.ordys_billing_webhook_inbox', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.ordys_billing_webhook_inbox', 'INSERT')
      AND NOT has_table_privilege('anon', 'public.ordys_billing_webhook_inbox', 'UPDATE')
      AND NOT has_table_privilege('anon', 'public.ordys_billing_webhook_inbox', 'DELETE')
      AND NOT has_table_privilege('anon', 'public.ordys_billing_webhook_inbox', 'TRUNCATE')
      AND NOT has_table_privilege('anon', 'public.ordys_billing_webhook_inbox', 'REFERENCES')
      AND NOT has_table_privilege('anon', 'public.ordys_billing_webhook_inbox', 'TRIGGER')
      AND NOT has_table_privilege('authenticated', 'public.ordys_billing_webhook_inbox', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.ordys_billing_webhook_inbox', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.ordys_billing_webhook_inbox', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.ordys_billing_webhook_inbox', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.ordys_billing_webhook_inbox', 'TRUNCATE')
      AND NOT has_table_privilege('authenticated', 'public.ordys_billing_webhook_inbox', 'REFERENCES')
      AND NOT has_table_privilege('authenticated', 'public.ordys_billing_webhook_inbox', 'TRIGGER')
      AND has_table_privilege('service_role', 'public.ordys_billing_webhook_inbox', 'SELECT')
      AND has_table_privilege('service_role', 'public.ordys_billing_webhook_inbox', 'INSERT')
      AND has_table_privilege('service_role', 'public.ordys_billing_webhook_inbox', 'UPDATE')
      AND has_table_privilege('service_role', 'public.ordys_billing_webhook_inbox', 'DELETE')
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_inbox')
          AND attname = 'provider_event_id' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_inbox')
          AND attname = 'event_payload' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_inbox')
          AND attname = 'processing_status' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = to_regclass('public.ordys_billing_webhook_events')
          AND tgname = 'ordys_sync_billing_webhook_inbox_status'
          AND NOT tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_sync_billing_webhook_inbox_status()')
          AND prosrc LIKE '%UPDATE public.ordys_billing_webhook_inbox%'
      )
      AND to_regprocedure('public.ordys_receive_asaas_billing_webhook(jsonb)') IS NOT NULL
      AND to_regprocedure('public.ordys_process_asaas_billing_webhook(text)') IS NOT NULL
      AND to_regprocedure('public.ordys_finalize_billing_checkout_attempt(uuid,uuid,text,text)') IS NOT NULL
      AND to_regprocedure('public.ordys_begin_billing_checkout_attempt(uuid,uuid,text,text,bigint,timestamp with time zone)') IS NOT NULL
      AND to_regprocedure('public.ordys_reserve_account_deletion(uuid)') IS NOT NULL
      AND to_regprocedure('public.ordys_release_account_deletion_reservation(uuid,boolean)') IS NOT NULL
      AND to_regprocedure('public.ordys_claim_account_deletion_processing(uuid,uuid)') IS NOT NULL
      AND to_regprocedure('public.ordys_release_account_deletion_processing(uuid,uuid)') IS NOT NULL
      AND to_regprocedure('public.ordys_confirm_subscription_cancellation(uuid,uuid,timestamp with time zone)') IS NOT NULL
      AND to_regprocedure('public.ordys_apply_asaas_billing_event(jsonb)') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_begin_billing_checkout_attempt(uuid,uuid,text,text,bigint,timestamp with time zone)')
          AND prosrc LIKE '%ordys_has_unreconciled_billing_events%'
          AND prosrc LIKE '%ordys:asaas-inbox-admission%'
          AND prosrc LIKE '%ORDYS unresolved provider subscription checkout guard%'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_apply_asaas_billing_event(jsonb)')
          AND prosrc LIKE '%error_code = ''confirmed_payment_unmatched''%'
          AND prosrc LIKE '%provider_customer_id = v_customer_id%'
          AND prosrc LIKE '%retry_payload = jsonb_build_object%'
          AND prosrc LIKE '%''dateCreated''%'
          AND prosrc LIKE '%invalid_text_representation OR numeric_value_out_of_range OR feature_not_supported%'
          AND prosrc LIKE '%v_value_numeric * 100 <> trunc(v_value_numeric * 100)%'
          AND prosrc LIKE '%invalid_datetime_format OR datetime_field_overflow%'
          AND prosrc LIKE '%v_paid_at := LEAST(COALESCE(v_paid_at, now()), now())%'
          AND prosrc LIKE '%ORDER BY payment.paid_at, payment.provider_payment_id%'
          AND prosrc LIKE '%current_period_end = v_period_end%'
          AND prosrc LIKE '%v_provider_subscription_id IS NULL%'
          AND prosrc LIKE '%payment.provider_payment_id = v_payment_id%'
          AND prosrc LIKE '%IF v_paid_at IS NULL THEN%'
          AND prosrc LIKE '%Count every historical attempt for this provider customer, including%'
      )
      AND to_regclass('public.ordys_billing_webhook_unmatched_payment_retry_idx') IS NOT NULL
      AND to_regclass('public.ordys_billing_webhook_subscription_delete_id_retry_idx') IS NOT NULL
      AND to_regclass('public.ordys_billing_webhook_confirmed_payment_subscription_retry_idx') IS NOT NULL
      AND to_regclass('public.ordys_billing_webhook_negative_payment_identity_retry_idx') IS NOT NULL
      AND to_regprocedure('public.ordys_has_unreconciled_billing_events(uuid)') IS NOT NULL
      AND to_regprocedure('public.ordys_has_unreconciled_billing_events_except(uuid,text,text)') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_has_unreconciled_billing_events_except(uuid,text,text)')
          AND prosrc LIKE '%payment_subscription_unmatched%'
          AND prosrc LIKE '%subscription_delete_unmatched%'
          AND prosrc LIKE '%ambiguous_customer_association%'
          AND prosrc LIKE '%subscription_checkout_mismatch%'
          AND prosrc LIKE '%subscription_customer_mismatch%'
          AND prosrc LIKE '%subscription_identity_mismatch%'
          AND prosrc LIKE '%subscription_amount_mismatch%'
          AND prosrc LIKE '%payment_customer_mismatch%'
          AND prosrc LIKE '%payment_identity_mismatch%'
          AND prosrc LIKE '%amount_mismatch%'
          AND prosrc LIKE '%checkout_customer_mismatch%'
          AND prosrc LIKE '%checkout_paid_after_closed%'
          AND prosrc LIKE '%checkout_reference_mismatch%'
          AND prosrc LIKE '%confirmed_payment_unmatched%'
          AND prosrc LIKE '%negative_payment_unmatched%'
          AND prosrc LIKE '%subscription_checkout_unmatched%'
          AND prosrc LIKE '%inbox.event_payload #>> ''{checkout,id}'' = p_allowed_provider_checkout_id%'
          AND prosrc LIKE '%inbox.event_payload #>> ''{checkout,externalReference}'' IS NULL%'
          AND prosrc LIKE '%inbox.user_id IS NULL%'
          AND prosrc LIKE '%ordys_billing_webhook_inbox%'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_release_account_deletion_reservation(uuid,boolean)')
          AND prosrc LIKE '%ordys_has_unreconciled_billing_events%'
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations')
          AND attname = 'processing_token' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations')
          AND attname = 'processing_until' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts')
          AND attname = 'cancellation_requested_at' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts')
          AND attname = 'cancellation_claim_id' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_requested_at' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_claim_id' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_confirmed_at' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_events')
          AND attname = 'provider_customer_id' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_events')
          AND attname = 'retry_payload' AND attnum > 0 AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_receive_asaas_billing_webhook(jsonb)')
          AND prosrc LIKE '%event_payload%'
          AND prosrc LIKE '%ordys:asaas-inbox-admission%'
          AND prosrc LIKE '%v_null_candidate_count > 0%'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_process_asaas_billing_webhook(text)')
          AND prosrc LIKE '%ordys_apply_asaas_billing_event%'
          AND prosrc LIKE '%ordys:asaas-inbox-admission%'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.process_ordys_asaas_billing_event(jsonb)')
          AND prosrc LIKE '%ordys_receive_asaas_billing_webhook%'
          AND prosrc LIKE '%ordys_process_asaas_billing_webhook%'
          AND prosrc LIKE '%IF v_status = ''received'' THEN%'
          AND prosrc LIKE '%ordys_process_asaas_billing_webhook(v_event_id)%'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.ordys_finalize_billing_checkout_attempt(uuid,uuid,text,text)')
          AND prosrc LIKE '%ordys_has_unreconciled_billing_events_except%'
          AND prosrc LIKE '%cancel_required%'
          AND prosrc LIKE '%ordys:asaas-inbox-admission%'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = to_regprocedure('public.delete_own_data()')
          AND prosrc LIKE '%ordys_account_deletion_reservations%'
          AND prosrc LIKE '%processing_token%'
          AND prosrc LIKE '%pg_advisory_xact_lock%'
          AND prosrc LIKE '%cancellation_confirmed_at IS NULL%'
          AND prosrc LIKE '%negative_payment_unmatched%'
          AND prosrc LIKE '%ordys_has_unreconciled_billing_events%'
          AND prosrc LIKE '%billing-aware account deletion is required%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid IN (
          to_regprocedure('public.ordys_reserve_account_deletion(uuid)'),
          to_regprocedure('public.ordys_claim_account_deletion_processing(uuid,uuid)'),
          to_regprocedure('public.ordys_release_account_deletion_processing(uuid,uuid)'),
          to_regprocedure('public.ordys_release_account_deletion_reservation(uuid,boolean)'),
          to_regprocedure('public.ordys_confirm_subscription_cancellation(uuid,uuid,timestamp with time zone)'),
          to_regprocedure('public.delete_own_data()')
        )
          AND (
            strpos(prosrc, 'ordys:asaas-inbox-admission') = 0
            OR strpos(prosrc, 'ordys:billing-lifecycle:') = 0
            OR strpos(prosrc, 'ordys:asaas-inbox-admission') > strpos(prosrc, 'ordys:billing-lifecycle:')
          )
      )
    THEN 'ready'
    ELSE 'partial'
  END;
$$;

REVOKE ALL ON FUNCTION public.ordys_apply_asaas_billing_event(JSONB)

  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ordys_apply_asaas_billing_event(JSONB)

  TO service_role;

REVOKE ALL ON FUNCTION public.ordys_billing_schema_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_billing_schema_status()
  TO service_role;
