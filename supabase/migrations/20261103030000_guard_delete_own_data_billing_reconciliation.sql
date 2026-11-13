-- Prevent direct authenticated calls to delete_own_data() from bypassing
-- the billing-aware account-deletion Edge Function.
--
-- When the optional billing schema is absent, the free core product keeps the
-- existing owner-scoped deletion behavior. Once any billing object exists, the
-- complete lifecycle schema must be ready. If the account has any billing
-- history, unresolved provider state must be reconciled before academic data
-- can be erased. The same per-user advisory lock used by Checkout creation and
-- deletion reservation makes the preflight atomic against a new Checkout row.
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
    OR to_regclass('public.ordys_account_deletion_reservations') IS NOT NULL;
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

    -- Match Checkout creation and deletion reservation. Whichever operation
    -- obtains the lock first is the only one whose preflight may proceed.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ordys:billing-lifecycle:' || uid::TEXT, 0)
    );

    SELECT
      EXISTS (
        SELECT 1
        FROM public.ordys_billing_checkout_attempts AS attempt
        WHERE attempt.user_id = uid
      )
      OR EXISTS (
        SELECT 1
        FROM public.ordys_billing_subscriptions AS subscription
        WHERE subscription.user_id = uid
      )
      OR EXISTS (
        SELECT 1
        FROM public.ordys_billing_payments AS payment
        WHERE payment.user_id = uid
      )
    INTO has_billing_history;

    IF has_billing_history THEN
      -- Payments retain the provider subscription ID as text rather than a
      -- foreign key. An orphan payment is therefore evidence of unreconciled
      -- billing, not proof that the account has no active provider resource.
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

    -- Every authenticated call must hold an active processing lease once the
    -- billing schema exists, even when the user has no billing history. This
    -- prevents a direct RPC call from racing a new Checkout after this
    -- transaction releases the shared advisory lock.
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

    -- A provider-deletion confirmation does not settle a refund/chargeback
    -- event whose payment row is still missing. Keep the account until the
    -- exact subscription/payment pair has been reconciled into the ledger.
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
-- This is deliberately the final definition of ordys_billing_schema_status().
-- Earlier lifecycle migrations define intermediate readiness checks; this
-- definition runs after delete_own_data() has received its direct-RPC guard,
-- so "ready" also proves that destructive cleanup cannot bypass the lifecycle
-- reservation, processing lease, or provider cancellation confirmation.
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
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations')
          AND attname = 'processing_token'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations')
          AND attname = 'processing_until'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts')
          AND attname = 'cancellation_requested_at'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts')
          AND attname = 'cancellation_claim_id'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_requested_at'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_claim_id'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_subscriptions')
          AND attname = 'cancellation_confirmed_at'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_events')
          AND attname = 'provider_customer_id'
          AND attnum > 0
          AND NOT attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.ordys_billing_webhook_events')
          AND attname = 'retry_payload'
          AND attnum > 0
          AND NOT attisdropped
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
          AND prosrc LIKE '%billing-aware account deletion is required%'
      )
    THEN 'ready'
    ELSE 'partial'
  END;
$$;

REVOKE ALL ON FUNCTION public.ordys_billing_schema_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_billing_schema_status()
  TO service_role;

