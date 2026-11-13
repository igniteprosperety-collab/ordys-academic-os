-- Keep account deletion blocked when a provider identity or amount conflict is quarantined.

-- These events intentionally have no replay payload; operator reconciliation is required.

CREATE INDEX IF NOT EXISTS ordys_billing_webhook_permanent_mismatch_idx

  ON public.ordys_billing_webhook_events(error_code, received_at)

  WHERE processing_status = 'failed'

    AND error_code IN ('subscription_checkout_mismatch', 'subscription_customer_mismatch', 'subscription_identity_mismatch', 'subscription_amount_mismatch', 'payment_customer_mismatch', 'payment_identity_mismatch', 'amount_mismatch');



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
  END;
$$;

REVOKE ALL ON FUNCTION public.ordys_has_unreconciled_billing_events(UUID)

  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ordys_has_unreconciled_billing_events(UUID)

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

REVOKE ALL ON FUNCTION public.ordys_billing_schema_status()

  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ordys_billing_schema_status()

  TO service_role;

