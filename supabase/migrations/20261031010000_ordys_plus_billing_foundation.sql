-- ORDYS Plus billing foundation.
-- Billing starts disabled and both plans are inactive until the owner sets prices,
-- configures Asaas credentials/webhooks, and completes the legal review.
CREATE TABLE IF NOT EXISTS public.ordys_billing_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  billing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.ordys_billing_settings (id, billing_enabled)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ordys_billing_plans (
  plan_code TEXT PRIMARY KEY CHECK (plan_code IN ('plus_monthly', 'plus_yearly')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('MONTHLY', 'YEARLY')),
  price_cents BIGINT CHECK (price_cents IS NULL OR price_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.ordys_billing_plans
  (plan_code, title, description, billing_cycle, price_cents, currency, enabled, sort_order)
VALUES
  ('plus_monthly', 'Ordys Plus Mensal', 'Recursos avançados e inteligência artificial do Ordys.', 'MONTHLY', NULL, 'BRL', FALSE, 1),
  ('plus_yearly', 'Ordys Plus Anual', 'Recursos avançados e inteligência artificial do Ordys com cobrança anual.', 'YEARLY', NULL, 'BRL', FALSE, 2)
ON CONFLICT (plan_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ordys_billing_checkout_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES public.ordys_billing_plans(plan_code),
  external_reference TEXT NOT NULL UNIQUE,
  provider_checkout_id TEXT UNIQUE,
  provider_customer_id TEXT,
  checkout_url TEXT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'pending', 'linked', 'paid', 'cancelled', 'expired', 'failed')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '2 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ordys_billing_checkout_user_idx
  ON public.ordys_billing_checkout_attempts(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ordys_billing_one_open_checkout_per_user_idx
  ON public.ordys_billing_checkout_attempts(user_id)
  WHERE status IN ('creating', 'pending', 'paid');

CREATE TABLE IF NOT EXISTS public.ordys_billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES public.ordys_billing_plans(plan_code),
  checkout_attempt_id UUID REFERENCES public.ordys_billing_checkout_attempts(id) ON DELETE SET NULL,
  provider_subscription_id TEXT NOT NULL UNIQUE,
  provider_checkout_id TEXT,
  provider_customer_id TEXT,
  provider_status TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'past_due', 'cancelled', 'suspended')),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('MONTHLY', 'YEARLY')),
  billing_type TEXT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  current_period_end TIMESTAMPTZ,
  grace_until TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ordys_billing_subscription_user_idx
  ON public.ordys_billing_subscriptions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ordys_billing_subscription_status_idx
  ON public.ordys_billing_subscriptions(status, current_period_end);

CREATE UNIQUE INDEX IF NOT EXISTS ordys_billing_one_live_subscription_per_user_idx
  ON public.ordys_billing_subscriptions(user_id)
  WHERE status IN ('pending', 'active', 'past_due');

CREATE TABLE IF NOT EXISTS public.ordys_billing_payments (
  provider_payment_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_subscription_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  billing_type TEXT,
  status TEXT NOT NULL,
  due_date DATE,
  confirmed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ordys_billing_payment_user_idx
  ON public.ordys_billing_payments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ordys_billing_webhook_events (
  provider_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  provider_object_id TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error_code TEXT
);

-- No provider IDs, webhook payloads, or payment records are readable/writable
-- through the client Data API. Edge Functions use service_role only.
ALTER TABLE public.ordys_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordys_billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordys_billing_checkout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordys_billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordys_billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordys_billing_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ordys_billing_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ordys_billing_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ordys_billing_checkout_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ordys_billing_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ordys_billing_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ordys_billing_webhook_events FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.ordys_billing_settings TO service_role;
GRANT ALL ON public.ordys_billing_plans TO service_role;
GRANT ALL ON public.ordys_billing_checkout_attempts TO service_role;
GRANT ALL ON public.ordys_billing_subscriptions TO service_role;
GRANT ALL ON public.ordys_billing_payments TO service_role;
GRANT ALL ON public.ordys_billing_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION public.get_ordys_billing_plans()
RETURNS TABLE (
  plan_code TEXT,
  title TEXT,
  description TEXT,
  billing_cycle TEXT,
  price_cents BIGINT,
  currency TEXT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT plan.plan_code, plan.title, plan.description, plan.billing_cycle,
         plan.price_cents, plan.currency
  FROM public.ordys_billing_plans AS plan
  WHERE plan.enabled = TRUE
    AND plan.price_cents IS NOT NULL
    AND plan.price_cents > 0
    AND COALESCE(
      (SELECT settings.billing_enabled FROM public.ordys_billing_settings AS settings WHERE settings.id = 1),
      FALSE
    )
  ORDER BY plan.sort_order, plan.plan_code;
$$;

REVOKE ALL ON FUNCTION public.get_ordys_billing_plans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ordys_billing_plans() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_ordys_billing_status()
RETURNS TABLE (
  plan_code TEXT,
  status TEXT,
  amount_cents BIGINT,
  currency TEXT,
  current_period_end TIMESTAMPTZ,
  grace_until TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  has_access BOOLEAN
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT
    subscription.plan_code,
    subscription.status,
    subscription.amount_cents,
    subscription.currency,
    subscription.current_period_end,
    subscription.grace_until,
    subscription.cancelled_at,
    (
      (subscription.status IN ('active', 'cancelled') AND subscription.current_period_end > now())
      OR (subscription.status = 'past_due' AND subscription.current_period_end IS NOT NULL AND subscription.grace_until > now())
    ) AS has_access
  FROM public.ordys_billing_subscriptions AS subscription
  WHERE subscription.user_id = auth.uid()
  ORDER BY subscription.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_ordys_billing_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ordys_billing_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_ordys_plus_eligible(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- New-sales availability must not revoke an already paid entitlement.
  RETURN EXISTS (
    SELECT 1
    FROM public.ordys_billing_subscriptions AS subscription
    WHERE subscription.user_id = p_user_id
      AND (
        (subscription.status IN ('active', 'cancelled') AND subscription.current_period_end > now())
        OR (subscription.status = 'past_due' AND subscription.current_period_end IS NOT NULL AND subscription.grace_until > now())
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_ordys_plus_eligible(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_ordys_plus_eligible(UUID) TO service_role;

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
  v_existing_payment_status TEXT;
  v_period_interval INTERVAL;
BEGIN
  IF v_event_id IS NULL OR v_event_type IS NULL THEN
    RAISE EXCEPTION 'Invalid Asaas event envelope';
  END IF;

  INSERT INTO public.ordys_billing_webhook_events
    (provider_event_id, event_type, provider_object_id, processing_status)
  VALUES
    (v_event_id, v_event_type, COALESCE(v_payment_id, v_provider_subscription_id, v_checkout_id), 'received')
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING provider_event_id INTO v_event_inserted;

  IF v_event_inserted IS NULL THEN
    RETURN jsonb_build_object('processed', FALSE, 'duplicate', TRUE);
  END IF;

  IF v_event_type LIKE 'CHECKOUT_%' THEN
    IF v_checkout_id IS NOT NULL THEN
      SELECT *
        INTO v_attempt
      FROM public.ordys_billing_checkout_attempts AS attempt
      WHERE attempt.provider_checkout_id = v_checkout_id
      LIMIT 1;
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
              provider_customer_id = COALESCE(v_customer_id, provider_customer_id),
              status = CASE WHEN status IN ('linked', 'paid') THEN status ELSE 'pending' END,
              updated_at = now()
        WHERE id = v_attempt.id
        RETURNING * INTO v_attempt;
      END IF;
    END IF;

    IF v_event_type = 'CHECKOUT_PAID' AND NOT v_has_attempt THEN
      RAISE EXCEPTION 'Unable to associate paid Asaas Checkout with an ORDYS attempt';
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
      LIMIT 1;
      v_has_attempt := FOUND;
    END IF;

    -- Fallback only when Asaas omits externalReference. A supplied but unmatched
    -- reference must never be silently associated with another Ordys account.
    -- Customer IDs may be reused across multiple Ordys accounts. Never guess:
    -- associate only when exactly one paid Checkout can match the Asaas customer.
    IF NOT v_has_attempt AND v_external_reference IS NULL AND v_customer_id IS NOT NULL THEN
      SELECT count(*)::INTEGER
        INTO v_customer_candidate_count
      FROM public.ordys_billing_checkout_attempts AS attempt
      WHERE attempt.provider_customer_id = v_customer_id
        AND attempt.status = 'paid';

      IF v_customer_candidate_count = 1 THEN
        SELECT *
          INTO v_attempt
        FROM public.ordys_billing_checkout_attempts AS attempt
        WHERE attempt.provider_customer_id = v_customer_id
          AND attempt.status = 'paid'
        LIMIT 1;
        v_has_attempt := FOUND;
      ELSIF v_customer_candidate_count > 1 THEN
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'ambiguous_customer_association',
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'ambiguous_customer_association');
      END IF;
    END IF;


    IF v_event_type = 'SUBSCRIPTION_CREATED' THEN
      IF v_has_attempt AND v_provider_subscription_id IS NOT NULL THEN
        IF v_customer_id IS NOT NULL
          AND v_attempt.provider_customer_id IS NOT NULL
          AND v_customer_id <> v_attempt.provider_customer_id THEN
          UPDATE public.ordys_billing_webhook_events
            SET processing_status = 'failed',
                error_code = 'subscription_customer_mismatch',
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
          v_attempt.provider_checkout_id, v_customer_id,
          NULLIF(v_subscription ->> 'status', ''), 'pending',
          (SELECT plan.billing_cycle FROM public.ordys_billing_plans AS plan WHERE plan.plan_code = v_attempt.plan_code),
          NULLIF(v_subscription ->> 'billingType', ''), v_attempt.amount_cents, 'BRL'
        )
        ON CONFLICT (provider_subscription_id) DO UPDATE
          SET provider_checkout_id = COALESCE(EXCLUDED.provider_checkout_id, ordys_billing_subscriptions.provider_checkout_id),
              provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, ordys_billing_subscriptions.provider_customer_id),
              provider_status = EXCLUDED.provider_status,
              updated_at = now();

        UPDATE public.ordys_billing_checkout_attempts
          SET status = 'linked',
              provider_customer_id = COALESCE(v_customer_id, provider_customer_id),
              updated_at = now()
        WHERE id = v_attempt.id;
      ELSE
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed',
              error_code = 'subscription_checkout_unmatched',
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'subscription_checkout_unmatched');
      END IF;
    ELSE
      SELECT *
        INTO v_billing_subscription
      FROM public.ordys_billing_subscriptions AS subscription
      WHERE subscription.provider_subscription_id = v_provider_subscription_id
      LIMIT 1;
      v_has_subscription := FOUND;

      IF v_has_subscription AND v_event_type = 'SUBSCRIPTION_DELETED' THEN
        UPDATE public.ordys_billing_subscriptions
          SET status = CASE WHEN status = 'suspended' THEN 'suspended' ELSE 'cancelled' END,
              provider_status = 'DELETED',
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
              provider_status = 'INACTIVE',
              updated_at = now()
        WHERE provider_subscription_id = v_provider_subscription_id;
      ELSIF v_has_subscription THEN
        UPDATE public.ordys_billing_subscriptions
          SET provider_status = NULLIF(v_subscription ->> 'status', ''),
              updated_at = now()
        WHERE provider_subscription_id = v_provider_subscription_id;
      END IF;
    END IF;

    UPDATE public.ordys_billing_webhook_events
      SET processing_status = CASE WHEN v_has_attempt OR v_has_subscription THEN 'processed' ELSE 'ignored' END,
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
              processed_at = now()
        WHERE provider_event_id = v_event_id;
        RETURN jsonb_build_object('processed', FALSE, 'error', 'payment_customer_mismatch');
      END IF;

      v_value_cents := round((v_payment ->> 'value')::NUMERIC * 100)::BIGINT;
      IF NULLIF(v_payment ->> 'billingType', '') IS DISTINCT FROM 'CREDIT_CARD'
        OR v_value_cents IS NULL
        OR v_value_cents <> v_billing_subscription.amount_cents THEN
        UPDATE public.ordys_billing_webhook_events
          SET processing_status = 'failed', error_code = 'amount_mismatch', processed_at = now()
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
        WHERE id = v_billing_subscription.checkout_attempt_id;
      ELSE
        UPDATE public.ordys_billing_payments
          SET status = CASE WHEN v_event_type = 'PAYMENT_RECEIVED' THEN 'PAYMENT_RECEIVED' ELSE status END,
              updated_at = now()
        WHERE provider_payment_id = v_payment_id;
      END IF;

      UPDATE public.ordys_billing_webhook_events
        SET processing_status = 'processed', processed_at = now()
      WHERE provider_event_id = v_event_id;

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
          SET processing_status = 'processed', processed_at = now()
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
            provider_status = 'OVERDUE',
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
        SET status = v_event_type, refunded_at = now(), updated_at = now()
      WHERE provider_payment_id = v_payment_id;
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
          WHEN processing_status = 'received' THEN 'ignored'
          ELSE processing_status
        END,
        processed_at = now()
  WHERE provider_event_id = v_event_id;

  RETURN jsonb_build_object('processed', TRUE, 'event', v_event_type);
END;
$$;

REVOKE ALL ON FUNCTION public.process_ordys_asaas_billing_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_ordys_asaas_billing_event(JSONB) TO service_role;
