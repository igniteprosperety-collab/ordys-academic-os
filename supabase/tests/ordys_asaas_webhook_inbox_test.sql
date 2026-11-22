BEGIN;

SELECT plan(17);

-- Run against a fresh disposable Supabase database after the complete
-- migration chain. No provider network calls or production records are used.
SELECT is(
  public.ordys_billing_core_schema_status(),
  'ready',
  'the structural billing schema and durable inbox are ready after migrations'
);

SELECT is(
  public.ordys_billing_schema_status(),
  'partial',
  'operational billing stays closed until the SQL worker job has a healthy heartbeat'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron'),
  'pg_cron is installed by the worker migration'
);

SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'ordys-asaas-webhook-worker'),
  0,
  'the migration deliberately does not schedule the production worker job'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.ordys_receive_asaas_billing_webhook(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.ordys_receive_asaas_billing_webhook(jsonb)',
    'EXECUTE'
  ),
  'anonymous and authenticated clients cannot write durable Asaas receipts'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.ordys_receive_asaas_billing_webhook(jsonb)',
    'EXECUTE'
  ),
  'the trusted server role can persist Asaas receipts'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.ordys_process_next_asaas_billing_webhook(text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.ordys_process_next_asaas_billing_webhook(text)',
    'EXECUTE'
  ),
  'anonymous and authenticated clients cannot invoke the SQL worker'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.ordys_process_next_asaas_billing_webhook(text)',
    'EXECUTE'
  ),
  'the trusted server role can invoke the protected worker for reconciliation'
);

SELECT throws_ok(
  $$SELECT public.ordys_receive_asaas_billing_webhook('{"event":"CHECKOUT_CREATED"}'::jsonb)$$,
  'P0001',
  'Invalid Asaas webhook envelope',
  'the receipt RPC rejects an event without a provider event ID'
);

SELECT is(
  public.ordys_receive_asaas_billing_webhook(
    jsonb_build_object(
      'id', 'evt_ordys_pgtap_receipt_001',
      'event', 'CHECKOUT_CREATED',
      'provider_secret', 'must-not-be-persisted',
      'checkout', jsonb_build_object(
        'id', 'chk_ordys_pgtap_receipt_001',
        'sensitive_blob', 'must-not-be-persisted'
      )
    )
  ) ->> 'processing_status',
  'received',
  'a valid Asaas event is durably admitted as received while the worker is offline'
);

SELECT is(
  (
    SELECT processing_status
    FROM public.ordys_billing_webhook_inbox
    WHERE provider_event_id = 'evt_ordys_pgtap_receipt_001'
  ),
  'received',
  'the durable inbox row commits independently of worker liveness'
);

SELECT ok(
  NOT (
    SELECT event_payload ? 'provider_secret'
      OR event_payload #> '{checkout}' ? 'sensitive_blob'
    FROM public.ordys_billing_webhook_inbox
    WHERE provider_event_id = 'evt_ordys_pgtap_receipt_001'
  ),
  'the receipt stores only allowlisted provider fields, not arbitrary payload data'
);

WITH duplicate_receipt AS (
  SELECT public.ordys_receive_asaas_billing_webhook(
    jsonb_build_object(
      'id', 'evt_ordys_pgtap_receipt_001',
      'event', 'CHECKOUT_CREATED',
      'provider_secret', 'must-not-be-persisted',
      'checkout', jsonb_build_object(
        'id', 'chk_ordys_pgtap_receipt_001',
        'sensitive_blob', 'must-not-be-persisted'
      )
    )
  ) AS result
)
SELECT ok(
  (result ->> 'duplicate')::boolean
  AND result ->> 'processing_status' = 'received',
  'a repeated identical provider event is idempotent and remains queued'
)
FROM duplicate_receipt;

SELECT ok(
  (
    public.ordys_process_next_asaas_billing_webhook(
      'evt_ordys_pgtap_receipt_001'
    ) #>> '{result,processed}'
  )::boolean,
  'the SQL worker processes the exact durable receipt without an HTTP request'
);

SELECT is(
  (
    SELECT processing_status
    FROM public.ordys_billing_webhook_inbox
    WHERE provider_event_id = 'evt_ordys_pgtap_receipt_001'
  ),
  'ignored',
  'the worker records the terminal result back into the durable inbox'
);

SELECT is(
  public.ordys_receive_asaas_billing_webhook(
    jsonb_build_object(
      'id', 'evt_ordys_pgtap_conflict_001',
      'event', 'CHECKOUT_CREATED',
      'checkout', jsonb_build_object('id', 'chk_ordys_pgtap_conflict_a')
    )
  ) ->> 'processing_status',
  'received',
  'a second provider event ID begins with its own durable receipt'
);

SELECT ok(
  (
    public.ordys_receive_asaas_billing_webhook(
      jsonb_build_object(
        'id', 'evt_ordys_pgtap_conflict_001',
        'event', 'CHECKOUT_CREATED',
        'checkout', jsonb_build_object('id', 'chk_ordys_pgtap_conflict_b')
      )
    ) ->> 'event_id_conflict'
  )::boolean,
  'reusing an event ID with a different payload is explicitly reported as a conflict'
);

SELECT ok(
  (
    SELECT processing_status = 'quarantined'
      AND error_code = 'event_id_payload_mismatch'
    FROM public.ordys_billing_webhook_inbox
    WHERE provider_event_id = 'evt_ordys_pgtap_conflict_001'
  ),
  'a provider event ID payload mismatch is quarantined and cannot be silently reopened'
);

SELECT * FROM finish();
ROLLBACK;
