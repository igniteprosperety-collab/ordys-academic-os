-- Preserve provider-confirmed deletion when a chargeback-suspended subscription keeps its local status.
-- SUBSCRIPTION_DELETED is definitive provider confirmation even when the local status remains suspended.
-- Retain only the minimal fields needed to reconcile subscription, confirmed
-- payment, or negative payment events delivered before their prerequisite event.
-- Never store the complete Asaas webhook payload.
ALTER TABLE public.ordys_billing_webhook_events
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS retry_payload JSONB;

CREATE INDEX IF NOT EXISTS ordys_billing_webhook_retry_customer_idx
  ON public.ordys_billing_webhook_events(provider_customer_id, received_at)
  WHERE processing_status = 'failed'
    AND error_code = 'subscription_checkout_unmatched';

CREATE INDEX IF NOT EXISTS ordys_billing_webhook_retry_subscription_idx
  ON public.ordys_billing_webhook_events(
    (retry_payload -> 'payment' ->> 'subscription'),
    received_at
  )
  WHERE processing_status = 'failed'
    AND error_code = 'confirmed_payment_unmatched'
    AND retry_payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS ordys_billing_webhook_retry_negative_payment_idx
  ON public.ordys_billing_webhook_events(
    (retry_payload -> 'payment' ->> 'subscription'),
    received_at
  )
  WHERE processing_status = 'failed'
    AND error_code = 'negative_payment_unmatched'
    AND retry_payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS ordys_billing_webhook_checkout_mismatch_idx
  ON public.ordys_billing_webhook_events(
    (retry_payload ->> 'checkoutAttemptId'),
    received_at
  )
  WHERE processing_status = 'failed'
    AND error_code IN ('checkout_customer_mismatch', 'checkout_reference_mismatch')
    AND retry_payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS ordys_billing_webhook_retry_subscription_delete_idx
  ON public.ordys_billing_webhook_events(
    (retry_payload -> 'subscription' ->> 'id'),
    received_at
  )
  WHERE processing_status = 'failed'
    AND error_code = 'subscription_delete_unmatched'
    AND retry_payload IS NOT NULL;

CREATE OR REPLACE FUNCTION public.process_ordys_asaas_billing_event(p_event JSONB)
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
  v_external_reference TEXT := COALESCE(NULLIF(v_checkout ->> 'externalReference', ''), NULLIF(v_subscription ->> 'externalReference', ''));
  v_attempt public.ordys_billing_checkout_attempts%ROWTYPE;
  v_billing_subscription public.ordys_billing_subscriptions%ROWTYPE;
  v_has_attempt BOOLEAN := FALSE;
  v_has_subscription BOOLEAN := FALSE;
  v_customer_candidate_count INTEGER := 0;
  v_value_cents BIGINT;
  v_paid_at TIMESTAMPTZ;
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
        'negative_payment_unmatched'
      ) THEN
      RETURN jsonb_build_object('processed', FALSE, 'duplicate', TRUE);
    END IF;

    UPDATE public.ordys_billing_webhook_events
      SET processing_status = 'received', error_code = NULL, processed_at = NULL
    WHERE provider_event_id = v_event_id;
    v_event_inserted := v_event_id;
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
          PERFORM public.process_ordys_asaas_billing_event(v_pending_event.retry_payload);
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
          v_attempt.user_id <> v_billing_subscription.user_id
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
      -- Count every non-terminal attempt for this provider customer, not
      -- only paid rows. A previously linked Checkout from another Ordys
      -- account is still a competing identity candidate when Asaas omits
      -- externalReference; never let one new paid row hide that ambiguity.
      SELECT count(*)::INTEGER
        INTO v_customer_candidate_count
      FROM public.ordys_billing_checkout_attempts AS attempt
      WHERE attempt.provider_customer_id = v_customer_id
        AND attempt.status IN ('creating', 'pending', 'paid', 'linked');

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
              existing.user_id <> v_attempt.user_id
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

        v_value_cents := round((v_subscription ->> 'value')::NUMERIC * 100)::BIGINT;
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
          PERFORM public.process_ordys_asaas_billing_event(v_pending_event.retry_payload);
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
          PERFORM public.process_ordys_asaas_billing_event(v_pending_event.retry_payload);
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
          PERFORM public.process_ordys_asaas_billing_event(v_pending_event.retry_payload);
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
            existing_payment.user_id <> v_billing_subscription.user_id
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
                AND existing_payment.user_id = v_billing_subscription.user_id
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
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'payment_subscription_unmatched',
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
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'confirmed_payment_unmatched',
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

      v_value_cents := round((v_payment ->> 'value')::NUMERIC * 100)::BIGINT;
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

      INSERT INTO public.ordys_billing_payments (
        provider_payment_id, user_id, provider_subscription_id,
        amount_cents, billing_type, status, due_date, confirmed_at
      )
      VALUES (
        v_payment_id, v_billing_subscription.user_id, v_provider_subscription_id,
        v_value_cents, NULLIF(v_payment ->> 'billingType', ''),
        v_event_type, NULLIF(v_payment ->> 'dueDate', '')::DATE, now()
      )
      ON CONFLICT (provider_payment_id) DO NOTHING
      RETURNING provider_payment_id INTO v_event_inserted;

      IF v_event_inserted IS NOT NULL THEN
        BEGIN
          v_paid_at := COALESCE(
            NULLIF(v_payment ->> 'paymentDate', '')::TIMESTAMPTZ,
            NULLIF(v_payment ->> 'confirmedDate', '')::TIMESTAMPTZ,
            NULLIF(p_event ->> 'dateCreated', '')::TIMESTAMPTZ,
            now()
          );
        EXCEPTION WHEN OTHERS THEN
          v_paid_at := now();
        END;

        v_period_interval := CASE v_billing_subscription.billing_cycle
          WHEN 'YEARLY' THEN INTERVAL '1 year'
          ELSE INTERVAL '1 month'
        END;

        UPDATE public.ordys_billing_subscriptions
          SET status = CASE WHEN status IN ('cancelled', 'suspended') THEN status ELSE 'active' END,
              provider_status = CASE WHEN status IN ('cancelled', 'suspended') THEN provider_status ELSE 'ACTIVE' END,
              billing_type = COALESCE(NULLIF(v_payment ->> 'billingType', ''), billing_type),
              current_period_end = GREATEST(COALESCE(current_period_end, v_paid_at), v_paid_at) + v_period_interval,
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
            AND existing_payment.user_id = v_billing_subscription.user_id
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
          AND user_id = v_billing_subscription.user_id
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
        PERFORM public.process_ordys_asaas_billing_event(v_pending_event.retry_payload);
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
        AND user_id = v_billing_subscription.user_id
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
        AND user_id = v_billing_subscription.user_id
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
REVOKE ALL ON FUNCTION public.process_ordys_asaas_billing_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_ordys_asaas_billing_event(JSONB) TO service_role;

-- A confirmed provider deletion is not a live subscription for manual reservation recovery.
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
REVOKE ALL ON FUNCTION public.ordys_release_account_deletion_reservation(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_release_account_deletion_reservation(UUID, BOOLEAN) TO service_role;


-- A user-initiated cancellation uses the same persisted intent as account deletion.
-- The final status transition reads the current row, preserving chargeback suspension.
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

REVOKE ALL ON FUNCTION public.ordys_confirm_subscription_cancellation(UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_confirm_subscription_cancellation(UUID, UUID, TIMESTAMPTZ)
  TO service_role;

-- The schema gate includes every RPC required by checkout, deletion and manual cancellation.
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
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations') AND attname = 'processing_token' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_account_deletion_reservations') AND attname = 'processing_until' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_checkout_attempts') AND attname = 'cancellation_requested_at' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_subscriptions') AND attname = 'cancellation_requested_at' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_subscriptions') AND attname = 'cancellation_claim_id' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_subscriptions') AND attname = 'cancellation_confirmed_at' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_webhook_events') AND attname = 'provider_customer_id' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.ordys_billing_webhook_events') AND attname = 'retry_payload' AND NOT attisdropped)
    THEN 'ready'
    ELSE 'partial'
  END;
$$;

REVOKE ALL ON FUNCTION public.ordys_billing_schema_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ordys_billing_schema_status()
  TO service_role;
