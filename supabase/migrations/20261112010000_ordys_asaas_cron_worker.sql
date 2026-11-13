-- Install PostgreSQL-native scheduling for the Asaas inbox worker.
-- This migration deliberately does NOT create or enable a scheduled job.
-- The job is configured separately only after the source/schema rollout gates pass.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Process a single durable receipt per database transaction. The scheduled
-- SQL-only job calls this function directly, so it does not depend on an HTTP
-- route or Lovable's short API-route job request deadline.
CREATE OR REPLACE FUNCTION public.ordys_process_next_asaas_billing_webhook(
  p_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_id TEXT;
  v_requeue_result JSONB;
  v_requeued_count INTEGER := 0;
  v_result JSONB;
BEGIN
  IF p_event_id IS NOT NULL THEN
    IF p_event_id = ''
      OR p_event_id <> btrim(p_event_id)
      OR length(p_event_id) > 255 THEN
      RAISE EXCEPTION 'Invalid Asaas billing webhook event ID';
    END IF;

    -- Preserve the global-before-inbox lock order used by receipt admission.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ordys:asaas-inbox-admission', 0)
    );

    SELECT inbox.provider_event_id
      INTO v_event_id
    FROM public.ordys_billing_webhook_inbox AS inbox
    WHERE inbox.provider_event_id = p_event_id
      AND inbox.processing_status = 'received'
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_event_id IS NULL THEN
      RETURN jsonb_build_object(
        'event_id', p_event_id,
        'processed', FALSE,
        'duplicate', TRUE
      );
    END IF;
  ELSE
    -- This RPC takes the same global admission lock, reopens at most one
    -- replayable dependency, and leaves permanent quarantines untouched.
    v_requeue_result :=
      public.ordys_requeue_asaas_billing_webhook_retries(1);

    IF jsonb_typeof(v_requeue_result) <> 'object'
      OR jsonb_typeof(v_requeue_result -> 'requeued') <> 'number'
      OR jsonb_typeof(v_requeue_result -> 'event_ids') <> 'array' THEN
      RAISE EXCEPTION 'Invalid Asaas webhook requeue response';
    END IF;

    v_requeued_count := (v_requeue_result ->> 'requeued')::INTEGER;
    IF v_requeued_count < 0
      OR v_requeued_count > 1
      OR jsonb_array_length(v_requeue_result -> 'event_ids') <> v_requeued_count THEN
      RAISE EXCEPTION 'Asaas webhook requeue response exceeded its one-event bound';
    END IF;

    IF v_requeued_count = 1 THEN
      v_event_id := v_requeue_result -> 'event_ids' ->> 0;
      IF v_event_id IS NULL OR v_event_id = '' OR length(v_event_id) > 255 THEN
        RAISE EXCEPTION 'Invalid Asaas webhook event ID returned by requeue';
      END IF;
    ELSE
      -- Retryable events take priority. If none is eligible, process the oldest
      -- newly received durable receipt. SKIP LOCKED keeps concurrent callers safe.
      SELECT inbox.provider_event_id
        INTO v_event_id
      FROM public.ordys_billing_webhook_inbox AS inbox
      WHERE inbox.processing_status = 'received'
      ORDER BY inbox.received_at, inbox.provider_event_id
      LIMIT 1
      FOR UPDATE SKIP LOCKED;
    END IF;

    IF v_event_id IS NULL THEN
      RETURN jsonb_build_object(
        'processed', FALSE,
        'queue_empty', TRUE,
        'requeued', v_requeued_count
      );
    END IF;
  END IF;

  -- Exactly one event is applied per invocation/transaction. This releases
  -- the shared admission lock between scheduled runs rather than holding it
  -- across a multi-event batch and delaying incoming provider acknowledgements.
  v_result := public.ordys_process_asaas_billing_webhook(v_event_id);

  IF jsonb_typeof(v_result) <> 'object'
    OR jsonb_typeof(v_result -> 'processed') <> 'boolean' THEN
    RAISE EXCEPTION 'Asaas webhook processor returned an invalid result';
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'requeued', v_requeued_count,
    'result', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ordys_process_next_asaas_billing_webhook(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_process_next_asaas_billing_webhook(TEXT)
  TO service_role, postgres;

COMMENT ON FUNCTION public.ordys_process_next_asaas_billing_webhook(TEXT) IS
  'Processes at most one durable Asaas webhook receipt per transaction. Schedule as a PostgreSQL-native SQL job (not an HTTP/API-route job) after the billing rollout gates pass.';

-- Keep billing schema readiness closed until pg_cron, the one-receipt SQL
-- worker and its active scheduled job exist. A function without a scheduler
-- cannot drain durable receipts after the Asaas endpoint acknowledges them.
ALTER FUNCTION public.ordys_billing_schema_status()
  RENAME TO ordys_billing_schema_status_before_asaas_cron_worker;

CREATE OR REPLACE FUNCTION public.ordys_billing_schema_status()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH previous_status AS (
    SELECT public.ordys_billing_schema_status_before_asaas_cron_worker() AS status
  )
  SELECT CASE
    WHEN previous_status.status = 'absent' THEN 'absent'
    WHEN previous_status.status = 'ready'
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_extension AS extension_row
        WHERE extension_row.extname = 'pg_cron'
      )
      AND to_regprocedure('public.ordys_process_next_asaas_billing_webhook(text)') IS NOT NULL
      AND to_regclass('cron.job') IS NOT NULL
      AND to_regclass('cron.job_run_details') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM cron.job AS scheduled_job
        WHERE scheduled_job.jobname = 'ordys-asaas-webhook-worker'
          AND scheduled_job.active IS TRUE
          AND scheduled_job.username = 'postgres'
          AND position(
            'public.ordys_process_next_asaas_billing_webhook'
            IN scheduled_job.command
          ) > 0
          AND EXISTS (
            SELECT 1
            FROM (
              SELECT job_run.status, job_run.end_time
              FROM cron.job_run_details AS job_run
              WHERE job_run.jobid = scheduled_job.jobid
              ORDER BY job_run.start_time DESC
              LIMIT 1
            ) AS latest_run
            WHERE latest_run.status = 'succeeded'
              AND latest_run.end_time > now() - INTERVAL '2 minutes'
          )
      )
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS function_row
        WHERE function_row.oid =
          to_regprocedure('public.ordys_process_next_asaas_billing_webhook(text)')
          AND function_row.prosecdef
          AND function_row.prosrc LIKE '%ordys_requeue_asaas_billing_webhook_retries(1)%'
          AND function_row.prosrc LIKE '%ordys_process_asaas_billing_webhook%'
          AND function_row.prosrc LIKE '%FOR UPDATE SKIP LOCKED%'
      )
    THEN 'ready'
    ELSE 'partial'
  END
  FROM previous_status;
$$;

REVOKE ALL ON FUNCTION public.ordys_billing_schema_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_billing_schema_status()
  TO service_role;

-- Account deletion needs a complete, trustworthy billing schema so it can
-- reconcile and cancel any account-owned provider resources. It must not be
-- tied to worker liveness: a stopped webhook worker blocks new Checkout and
-- Plus access, but must not prevent a customer with no unresolved billing
-- records from exercising account deletion.
CREATE OR REPLACE FUNCTION public.ordys_billing_core_schema_status()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $core$
  SELECT public.ordys_billing_schema_status_before_asaas_cron_worker();
$core$;

REVOKE ALL ON FUNCTION public.ordys_billing_core_schema_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_billing_core_schema_status()
  TO service_role;

-- Direct authenticated deletion must use structural schema readiness too.
-- Keep its per-user reservation, processing lease, Checkout/subscription
-- reconciliation, unmatched-event and payment-ledger guards unchanged. The
-- operational cron heartbeat must not block deletion for an account with no
-- unresolved provider state.
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
    IF to_regprocedure('public.ordys_billing_core_schema_status()') IS NULL THEN
      RAISE EXCEPTION 'billing schema is incomplete; account data was not deleted';
    END IF;

    SELECT public.ordys_billing_core_schema_status()
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
