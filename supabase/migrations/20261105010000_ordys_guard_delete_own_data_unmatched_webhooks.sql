-- Keep account deletion blocked while provider events are held without a trusted local link.
-- A local terminal Checkout status does not prove Asaas never created a recurring resource.
CREATE INDEX IF NOT EXISTS ordys_billing_webhook_unmatched_customer_idx
  ON public.ordys_billing_webhook_events(provider_customer_id, error_code, received_at)
  WHERE processing_status = 'failed'
    AND error_code IN (
      'subscription_checkout_unmatched',
      'confirmed_payment_unmatched',
      'negative_payment_unmatched'
    );

CREATE INDEX IF NOT EXISTS ordys_billing_webhook_closed_checkout_idx
  ON public.ordys_billing_webhook_events(provider_object_id, received_at)
  WHERE processing_status = 'failed'
    AND error_code = 'checkout_paid_after_closed';

CREATE OR REPLACE FUNCTION public.ordys_has_unreconciled_billing_events(
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN TRUE
    ELSE EXISTS (
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
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.ordys_has_unreconciled_billing_events(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_has_unreconciled_billing_events(UUID)
  TO service_role;

-- Manual recovery must not clear a reservation with unresolved provider events.
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

REVOKE ALL ON FUNCTION public.ordys_release_account_deletion_reservation(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_release_account_deletion_reservation(UUID, BOOLEAN)
  TO service_role;

-- The direct authenticated RPC must enforce the same unmatched-webhook guard
-- as the billing-aware Edge Function. Do not rely only on the caller path.
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
      )
    THEN 'ready'
    ELSE 'partial'
  END;
$$;

REVOKE ALL ON FUNCTION public.ordys_billing_schema_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_billing_schema_status()
  TO service_role;
