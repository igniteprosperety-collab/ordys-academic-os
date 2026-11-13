# ORDYS billing lifecycle and account deletion

This document describes the database serialization used by Asaas checkout creation and account deletion. It is an operational reference, not an instruction to enable billing or deploy migrations.

## Release state

Ordys Plus billing remains disabled by default. Plans remain unavailable until the account owner configures prices, provider credentials and webhooks, and the production/legal release gates are completed.

The following eleven migrations must all be applied before deploying the updated `ordys-billing-checkout`, `ordys-billing-manage`, `ordys-billing-webhook` or `ordys-delete-account` Edge Functions:

**Important — these eleven files are only the billing-lifecycle layer, not a standalone migration batch.** They depend on the earlier billing foundation and schema-status RPC, including `20261029232950_ordys_billing_schema_status.sql` and `20261031010000_ordys_plus_billing_foundation.sql`, as well as the prior integrity, recovery, and privilege migrations required by the complete application schema. The deployment workflow separately checks the schema-status RPC, billing foundation, and these eleven lifecycle versions before deploying the corresponding Edge Functions.

The last documented read-only Cloud snapshot (04/11/2026; see `docs/LOVABLE-CLOUD-RELEASE-RUNBOOK.md`) reported 18 ledger versions through `20260927013000` and 17 source migrations absent from that ledger, including both prerequisites above. That snapshot is historical, not a fresh confirmation of the database today. **An absent ledger version is not proof that its DDL is absent**: the same snapshot recorded schema drift and objects whose migration history did not match the source tree.

Before rollout, reconcile the full chronological migration chain against the actual Lovable Cloud catalog and ledger, not just these eleven files. Preserve the separate email-confirmation gate for `20261029233000_remove_untracked_auto_confirm_email.sql`. Obtain an independent backup/export and rollback/recovery plan, then use only the supported Lovable Cloud migration process. Never paste the eleven lifecycle files alone, blindly apply all pending files, manually insert migration-history rows, or deploy the updated Edge Functions while any prerequisite is missing.


1. `20261103010000_ordys_billing_deletion_serialization.sql` creates the shared deletion reservation and cancellation-claim state only when the billing Checkout schema already exists, preserving the `absent` state for the free release.
2. `20261103020000_ordys_suspended_subscription_deletion_confirmation.sql` records provider-confirmed subscription deletion while preserving `suspended` access state after a refund or chargeback.
3. `20261103030000_guard_delete_own_data_billing_reconciliation.sql` hardens the authenticated `delete_own_data()` RPC itself, sharing the lifecycle lock and refusing cleanup while a Checkout remains open or a subscription lacks explicit provider confirmation, including rows locally marked `cancelled`.
4. `20261105010000_ordys_guard_delete_own_data_unmatched_webhooks.sql` applies the unmatched-provider-webhook guard to the account-deletion Edge Function, direct RPC and manual reservation-release path.
5. `20261105020000_ordys_replay_unmatched_payment_created_webhooks.sql` preserves minimal `PAYMENT_CREATED` identity for replay after subscription linking and includes held subscription-deletion events in reconciliation.
6. `20261105030000_ordys_guard_ambiguous_customer_webhooks.sql` blocks deletion globally while a provider-customer association remains ambiguous.
7. `20261105040000_ordys_guard_permanent_billing_mismatches.sql` blocks deletion for permanent identity/amount mismatches and verifies the reconciliation guards.
8. `20261105050000_ordys_preserve_unmatched_confirmed_payment.sql` preserves the minimum identity and financial fields for `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` events received before subscription linking, adds the exact subscription/payment retry index, counts terminal as well as non-terminal historical Checkouts when a new subscription must be associated by customer ID without `externalReference`, and makes the final schema-readiness check verify these safeguards. It also catches invalid numeric text, PostgreSQL special values such as `NaN`/`Infinity`, and `BIGINT` overflow in subscription/payment values, converting them into the existing amount-mismatch quarantine codes instead of aborting the SQL transaction and causing repeated provider retries. Amounts must resolve to an exact integer number of centavos; sub-cent values are rejected instead of rounded into a matching plan price. A malformed optional payment `dueDate` is stored as `NULL`; it cannot invalidate an otherwise verified payment amount or payment identity. For period calculation, malformed `paymentDate`/`confirmedDate` values fall through to the next valid timestamp, then to the webhook's `dateCreated`, and finally to database processing time; future provider timestamps are capped at processing time so they cannot move the paid-period origin into the future.
9. `20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql` blocks database-level Checkout creation while any Asaas event remains quarantined for reconciliation, including a subscription-created event tied to a locally terminal Checkout; it also blocks while a local subscription is pending, active, past due, suspended, cancelled without explicit provider-deletion confirmation, or cancelled with a `current_period_end` that is still in the future. It detaches billing ledger ownership with `ON DELETE SET NULL` instead of cascading away Checkout, subscription and payment records, clears the deleted user ID from the durable inbox, and requires those constraints/updates in the schema-readiness gate. The current helper intentionally blocks all accounts while an owner-unknown, ambiguous-customer or permanent identity/amount mismatch event remains quarantined. This can pause all new sales until an operator reconciles the affected provider record; it is a documented fail-closed tradeoff, not an indication that every account has a billing problem.
10. `20261111010000_ordys_bound_asaas_webhook_replay.sql` adds the partial `ordys_billing_webhook_retry_ready_idx` index for ordered retry candidate scans, removes six nested replay loops from `ordys_apply_asaas_billing_event()` and adds service-role-only `ordys_requeue_asaas_billing_webhook_retries(p_limit)`. It reopens at most five inbox rows whose exact prerequisite now exists, locks candidate event/inbox rows with `FOR UPDATE ... SKIP LOCKED`, uses exact Checkout reference/customer uniqueness, exact subscription IDs, and for negative settlement events exact payment ID plus subscription/owner identity. It updates only the durable inbox to `received`; the legacy event remains `failed` until normal processing commits, preserving Checkout-admission and account-deletion guards during retry. The migration wraps the previous schema-readiness function so readiness cannot be `ready` without this bounded replay RPC.
11. `20261112010000_ordys_asaas_cron_worker.sql` installs the available `pg_cron` extension, creates a service-role/administrator-only dispatcher that processes exactly one durable receipt per transaction, requires the extension, dispatcher and a recent successful active `cron.job` registered as `postgres` in the operational schema-readiness RPC, and exposes `ordys_billing_core_schema_status()` for account deletion to verify the base financial schema without requiring worker liveness. It deliberately does **not** create or activate a scheduled job; the SQL-only Job is configured separately after source synchronization, migration reconciliation, backup and CI gates pass, before the dependent Edge Functions are deployed.


No local status, including `cancelled` or `suspended`, is accepted as proof by itself. Provider confirmation must be explicit and reconciled with the local subscription and Checkout records.

The prior `ordys_billing_schema_status()` definition verifies the direct-deletion guard, quarantined webhook error codes, safe exception handling for malformed/overflowing financial values, retry-data retention plus the exact subscription/payment index, and the database-level gate that blocks new Checkouts during webhook reconciliation. Migration `20261111010000` wraps that definition and requires the bounded replay RPC and its lock/limit/exact-payment guards. Migration `20261112010000` wraps it again and refuses `ready` unless `pg_cron`, the protected one-receipt SQL dispatcher, and an active `cron.job` named `ordys-asaas-webhook-worker` calling that dispatcher as role `postgres` are present. It also requires the latest `cron.job_run_details` record for that job to have status `succeeded` and an `end_time` less than two minutes old. A stale/missing history row, a failed latest run or a disabled Job keeps readiness `partial`. `ordys-billing-checkout`, `ordys-billing-webhook`, `ordys-billing-status` and the server-side Plus entitlement helper use this operational status. The account-deletion Edge Function deliberately uses `ordys_billing_core_schema_status()` instead: if the structural schema is healthy but the cron worker is stopped, account deletion for a user with no unresolved billing records may proceed. Its existing database reservation and unreconciled-event guard still block deletion for pending Checkout/subscription cancellation, unmatched payment/refund/chargeback, or any account-owned reconciliation blocker. If the core billing schema itself is `partial` or `absent`, the existing safe behavior remains. The production workflow requires all eleven lifecycle migrations in the remote ledger before deploying billing lifecycle functions and account deletion.

Do not apply these migrations directly to the managed Lovable Cloud database through an unsupported Supabase CLI route. Follow the approved Lovable Cloud migration procedure, after an independently verified off-platform backup and the existing email-confirmation gate.

## Bounded webhook replay and database-native worker

Migration `20261111010000_ordys_bound_asaas_webhook_replay.sql` separates dependency recovery from the financial processor transaction. The processor no longer loops through every failed event for a customer, subscription or payment.

The replay RPC accepts only limits from 1 to 5, acquires the global `ordys:asaas-inbox-admission` advisory lock, orders candidates by `received_at` and event ID, and locks both the legacy event and durable inbox row with `FOR UPDATE ... SKIP LOCKED`. It reopens only the inbox row; the legacy event remains `failed` and continues to block Checkout admission/account deletion until normal processing succeeds. A transient processing failure therefore rolls back the financial transaction without losing the retry candidate.

Retryable prerequisites are deliberately specific:
- `subscription_checkout_unmatched`: exact `externalReference` to a live local Checkout, or (only if the provider omitted the reference) exactly one historical attempt for that customer ID and that attempt is paid.
- `subscription_delete_unmatched`, `payment_subscription_unmatched` and `confirmed_payment_unmatched`: exact provider subscription ID exists locally, with the appropriate event and payment ID.
- `negative_payment_unmatched`: exact subscription exists; unpaid status notices need no settled-payment row, but refund/chargeback/reversal events also require exact provider payment ID, the same provider subscription ID and matching owner identity in the payment ledger.

Permanent amount/identity mismatches and ambiguous customer associations are never requeued automatically.

Migration `20261112010000_ordys_asaas_cron_worker.sql` adds the database-native execution path. It installs the `pg_cron` extension and creates `ordys_process_next_asaas_billing_webhook(text DEFAULT NULL)`, a restricted `SECURITY DEFINER` RPC. The scheduled no-argument call:
1. reopens at most one retryable event using the bounded replay RPC;
2. otherwise selects the oldest new `received` inbox row, ordered by arrival and provider event ID;
3. runs the normal financial processor for that single event;
4. returns, committing or rolling back exactly one event transaction.

One event per transaction is intentional. The processor and receipt admission share the global advisory lock; processing a five-event batch inside one SQL transaction would hold that lock across the entire batch and could delay Asaas acknowledgements. The one-event dispatcher releases the lock between scheduled runs. The optional exact event-ID parameter exists for controlled service-role integration tests; it has the same lock order and uses `FOR UPDATE SKIP LOCKED` to avoid duplicate processing. Public, anonymous and authenticated execution are revoked.

**No HTTP worker route or `LOVABLE_CRON_SECRET` is used.** Lovable Jobs that invoke API routes are cancelled after a few seconds; this design therefore uses a SQL-only PostgreSQL Job. The database-only job may run below one-minute intervals. The current Lovable Cloud database reports PostgreSQL **17.6**, which supports the documented `5 seconds` interval. After the complete migration chain and source synchronization are reconciled, create the job with:

```sql
SELECT cron.schedule(
  'ordys-asaas-webhook-worker',
  '5 seconds',
  'SELECT public.ordys_process_next_asaas_billing_webhook();'
);
```

Do not create or enable it from a migration. Run it as database role `postgres`; the schema-readiness RPC returns `partial` for a Job registered under any other role or a missing/inactive job. A supported deployment process must require `ordys_billing_schema_status() = 'ready'` before publishing the dependent billing Edge Functions. The existing CLI deployment workflow checks the remote migration ledger but does not query the schema-status RPC, and it explicitly refuses the built-in Lovable Cloud project; do not treat it as the deployment path or as proof of worker readiness. Confirm the job's run history in the Supabase/Lovable database Jobs view. The migration installs the extension and function but deliberately creates no active schedule. Supabase does not automatically clean `cron.job_run_details`; define a bounded retention/cleanup policy and preserve enough recent history for support/audit. Lovable also charges Cloud usage for scheduled executions, so review usage and queue latency before adjusting the 30-second interval.

Runtime remains fail-closed until that same status reports `ready`: Checkout requires it in addition to `billing_enabled`; the Asaas webhook returns HTTP 503 before storing/acknowledging a receipt so Asaas retries instead of leaving an event unprocessed; the subscription-status API hides sale plans and reports no active Plus access while preserving the local subscription summary for cancellation; and the server-side `isOrdysPlusEligible()` helper denies Plus until the worker is ready. This application-layer gate is separate from the raw SQL eligibility function so financial-state integration tests can continue validating the ledger independent of the operational scheduler.

The integration suite includes a backlog of 12 dependent events dispatched through three concurrent requeue calls and a refund eligibility check. The database-worker suite verifies that one exact receipt is processed per invocation, the following receipt remains queued, and concurrent calls cannot process the same receipt twice. Security tests deny the worker RPC to both `anon` and `authenticated`. These tests remain unexecuted until a real CI runner and disposable PostgreSQL environment are available. No Lovable SQL Job is configured and no remote migration has been applied.

## Out-of-order webhook reconciliation

Asaas supports non-sequential webhook delivery, so an older subscription lifecycle event can be processed after a terminal removal event. For each provider subscription ID, `SUBSCRIPTION_DELETED` is monotonic: subsequent `SUBSCRIPTION_INACTIVATED`, `SUBSCRIPTION_UPDATED` or duplicate `SUBSCRIPTION_CREATED` data must not replace `provider_status = 'DELETED'`. The provider-confirmation timestamp is retained as an independent proof of removal. When reconciling a legacy row with no cancellation-intent timestamp, the confirmation RPC accepts either the terminal provider status or the already-persisted confirmation marker, but still requires the local subscription to be `cancelled` or `suspended`. The account-deletion helper replays that RPC idempotently to close any linked Checkout in the same transaction; it does not send another provider DELETE.

Asaas events can be delivered more than once and may arrive before the local prerequisite record. The webhook state machine therefore retains only the minimum fields needed for the following recoverable orderings: `SUBSCRIPTION_CREATED` before `CHECKOUT_PAID`, `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` before `SUBSCRIPTION_CREATED`, unpaid status notifications (overdue, card refusal and risk rejection) before `SUBSCRIPTION_CREATED`, settlement-negative events (refunds, chargebacks and reversals) before `SUBSCRIPTION_CREATED` or before the corresponding payment-ledger row exists, and `SUBSCRIPTION_DELETED` before either `CHECKOUT_PAID` or `SUBSCRIPTION_CREATED`. Unpaid status notifications need the exact provider subscription ID: after that subscription is linked, they are processed directly and do not wait for a settled-payment row that may never exist. Refund, chargeback and reversal events require both the exact provider subscription ID and exact payment-ledger identity before their financial state is reconciled. Positive duplicate events are monotonic: `PAYMENT_RECEIVED` may refine `PAYMENT_CONFIRMED`, but cannot overwrite a refund, partial refund, refund-in-progress, cash reversal, or unresolved chargeback already stored for that payment. Asaas has one specific chargeback-resolution path: `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` is followed by `PAYMENT_CONFIRMED` or `PAYMENT_RECEIVED` when the dispute is reversed in the merchant's favor. In that case, Ordys updates the financial ledger to the provider's final positive state while retaining the subscription's `suspended` state until manual review; Plus access is not restored automatically. A conflicting `provider_payment_id` is accepted as a duplicate only when its stored user and provider subscription match the current subscription; otherwise the event fails as `payment_identity_mismatch` without mutating the existing ledger row. This identity check runs before the immediate negative-entitlement transition as well, so a refund or chargeback that reuses another account's payment ID is rejected without suspending the unrelated subscription or leaving a false `negative_payment_unmatched` retry. If an unpaid status event arrives after subscription linking, it moves the subscription to the corresponding past-due state immediately and is marked processed without waiting for a payment row. If it arrives before `SUBSCRIPTION_CREATED`, it is held and replayed after the exact subscription is linked. A refund, chargeback or reversal received before the exact payment row exists remains retryable, suspends access immediately and blocks account deletion until the financial ledger is reconciled. The linked customer is checked before any financial update; this keeps a refund or chargeback as the final ledger and entitlement state. This preserves a real refund/chargeback as the final state while the existing confirmed-payment guard still rejects stale overdue/refusal events. A terminal deletion event without `externalReference` is retained while the customer maps to exactly one non-terminal Checkout attempt, including a locally pending attempt; the payload remains minimal and does not create a local subscription or grant access. After Checkout payment and subscription linking, the event is replayed by exact provider subscription ID. Unrelated, ambiguous, or supplied-but-unmatched customer references are never attached to an account. `CHECKOUT_PAID`, `SUBSCRIPTION_CREATED` and `SUBSCRIPTION_DELETED` acquire the same customer-scoped transaction lock before the subscription-scoped lock, so payment/linking events cannot change the candidate set while a terminal deletion event is being reconciled.

The known provider subscription ID is resolved before customer fallback. For subscription events other than `SUBSCRIPTION_CREATED`, the webhook first resolves the exact, unique `provider_subscription_id` already stored locally. A known subscription is therefore not made ambiguous merely because its Asaas customer ID also appears on another Ordys account's Checkout. When the event includes an `externalReference` that resolves to a local Checkout, that Checkout must belong to the same user and, when a link exists, must be the Checkout already attached to the subscription; a reference belonging to another account is rejected as `subscription_checkout_mismatch`. When both the event and local row provide a customer ID, they must also match; a mismatch is stored as `subscription_customer_mismatch` and does not change the subscription. Customer fallback remains restricted to associating a new subscription when no exact local subscription row exists, and it counts every historical Checkout for that customer, including terminal attempts. A later paid Checkout cannot become the sole candidate for a subscription webhook that may belong to an older cancelled/expired Checkout; two or more historical candidates remain `ambiguous_customer_association` until reconciled. For a repeated `SUBSCRIPTION_CREATED` provider ID, the stored user and `checkout_attempt_id` must match the current attempt. Otherwise the event fails as `subscription_identity_mismatch` before the upsert, leaving the existing subscription/customer untouched and the new Checkout unlinked.

A replay is not an entitlement shortcut. It passes through the same provider-customer, CREDIT_CARD, amount, and payment-ID idempotency checks as the original event. Only a confirmed payment can extend `current_period_end` and make the user eligible for Plus. Ambiguous or mismatched events remain failed for investigation; never release access manually based on a callback URL or a Checkout redirect. If `CHECKOUT_PAID` identifies a different Asaas customer from the Checkout attempt or its linked subscription, the attempt is quarantined, any existing linked subscription is suspended, and a later `SUBSCRIPTION_CREATED` event for that attempt is also rejected. The same rule applies when Asaas supplies an `externalReference` that conflicts with the attempt resolved by the known provider Checkout ID: the event is quarantined, any linked subscription is suspended, the trusted local reference is not overwritten, and later subscription creation is rejected. A later payment cannot reactivate the suspended subscription. Resolve the identity conflict through an auditable operator procedure after checking the actual Checkout and subscription records in Asaas.


The confirmed-payment ledger stores `paid_at` separately from `confirmed_at`: `paid_at` uses the Asaas `paymentDate`, then `confirmedDate`, then the webhook `dateCreated`, with malformed values falling back to processing time and future values capped at processing time. Every newly confirmed payment recalculates `current_period_end` from all still-positive payment rows in ascending `paid_at` order. This preserves legitimate prepayment accumulation while ensuring that a delayed webhook for an older settlement cannot grant an extra month or year merely because it arrived later. A payment webhook that omits `payment.subscription` can still be attached to a subscription only when its exact `payment.id` already exists in the local ledger; the processor resolves the stored `provider_subscription_id` before taking the subscription lock. It never guesses an owner from the customer ID alone.
## Chargeback dispute reversal

`PAYMENT_AWAITING_CHARGEBACK_REVERSAL` is retained as a distinct payment state. It keeps the subscription suspended while the acquirer transfer is pending. When the provider later reports `PAYMENT_CONFIRMED` or `PAYMENT_RECEIVED`, the exact payment ledger row may move to that positive state only from this explicit reversal-waiting state. A late positive event cannot clear an ordinary refund, partial refund, refund-in-progress, cash reversal or unresolved chargeback. Even after the ledger is positive, the subscription remains suspended pending manual review.

## Operator review after a chargeback dispute reversal

The processor intentionally accepts `PAYMENT_CONFIRMED` or `PAYMENT_RECEIVED` after `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` only for the exact existing payment row. It updates the financial ledger to the provider's positive settlement state, but deliberately leaves the subscription `suspended`; this is not an entitlement restoration.

**Operational release gate:** the billing functions and migrations reviewed in this branch do not expose a dedicated, auditable operator action to complete this review and restore Plus. Until such a restricted process exists and is tested, support must not promise automatic reactivation after a successful chargeback reversal. The account remains suspended. Do not reactivate by editing rows directly or by replaying a positive webhook.

A future operator workflow must independently verify the exact Asaas customer, subscription and payment IDs; the provider's final positive payment state; amount, currency, payment method and plan cycle; the absence of any other refund, chargeback, identity or amount mismatch; and the affected Ordys account. It must record the operator identity, approval/reason, evidence reference and timestamp, then perform one atomic, service-role-only transition with audit history. It must not accept a user-supplied callback, email, amount or customer name as proof. Add integration tests for authorized and unauthorized actors, wrong-owner IDs, outstanding negative events, duplicate approvals and audit-record immutability before enabling this path.

## Account deletion with unmatched provider webhooks

A local Checkout can become `cancelled` or `expired` while a previously received `SUBSCRIPTION_CREATED` or confirmed-payment webhook is still held because Asaas omitted `externalReference` or the matching subscription row has not yet been created. A terminal Checkout status alone does not prove that the remote recurring resource was never created. Before account deletion, `ordys_has_unreconciled_billing_events(user_id)` correlates failed webhook records to the user's known Checkout/customer/subscription identifiers. It blocks deletion for a held subscription-creation event, an unmatched confirmed/negative payment, a Checkout identity quarantine, or a late `CHECKOUT_PAID` received after the local attempt was terminal. The correlation includes terminal local Checkout attempts so the evidence is not lost after a cancellation webhook. The RPC is service-role-only; the same guard is enforced again inside `delete_own_data()` and the operator reservation-release RPC so neither the user-facing nor manual path can bypass it. If a `subscription_checkout_unmatched` event cannot be tied to any local Checkout by customer ID or exact external reference, its owner is unknowable; account deletion is therefore blocked globally until an operator reconciles that orphaned event against Asaas. The same global block applies to `confirmed_payment_unmatched` and `negative_payment_unmatched` events when neither the exact provider subscription ID nor the provider customer ID maps to a local subscription or Checkout attempt. When either identifier does map to local data, the guard blocks the associated account instead of blocking every account. This prevents an out-of-order payment, refund or chargeback from disappearing from the deletion decision merely because its subscription-creation event has not yet been linked. Resolve the event against the exact Asaas Checkout/subscription records before retrying deletion; never clear the event or infer ownership from email, amount or name.

## Financial ledger after account deletion

The final lifecycle migration preserves the minimum Asaas financial ledger after the Auth identity is removed. The local `user_id` foreign keys on Checkout attempts, subscriptions and payments use `ON DELETE SET NULL`; they no longer cascade-delete provider identifiers or financial status. Before Auth deletion, `delete_own_data()` also nulls the deleted owner on durable inbox rows. This is necessary because Asaas may send a refund, chargeback or other unique event after the recurring subscription was already cancelled. The webhook processor compares nullable owners with `IS [NOT] DISTINCT FROM` and continues to reconcile by exact provider subscription/payment IDs; an anonymized row cannot restore account access, but it can prevent an old event from becoming an owner-unknown global sales blocker.

This is technical minimization, not a legal conclusion. The retained provider IDs, amount, cycle, timestamps and payment/refund status remain financial/potentially personal data. Before public release, the controller must approve and publish the lawful basis, retention period, access controls and deletion/privacy disclosure for this residual ledger. The schema-readiness RPC refuses to report `ready` unless the three foreign keys are nullable with `ON DELETE SET NULL` and the deletion function anonymizes inbox ownership.

## Serialization contract

The RPCs `ordys_begin_billing_checkout_attempt`, `ordys_reserve_account_deletion`, `ordys_claim_account_deletion_processing` and `ordys_release_account_deletion_processing` acquire the same transaction-scoped PostgreSQL advisory lock, derived from the authenticated user's UUID. After the durable reservation exists, a separate ten-minute processing lease allows only one deletion request to perform provider calls and destructive cleanup at a time.

- Checkout first: the RPC inserts a `creating` attempt while holding the lock. A concurrent deletion request returns `checkout_creation_in_progress` and does not reserve the account. The checkout flow must reach a terminal or reconciled state before deletion is retried.
- Deletion first: the RPC writes a durable row to `ordys_account_deletion_reservations`. Future checkout attempts return `deletion_reserved` before any request is sent to Asaas.
- Concurrent deletion requests: only one request can claim the processing lease. Others receive `account_deletion_in_progress` (HTTP 409) and do not call Asaas or clear account data. The lease is held through Auth deletion and is released in `finally`; it expires after ten minutes if an Edge Function process is terminated before cleanup.
- Existing pending/paid/linked checkout attempts are not ignored. Once deletion is reserved, the Edge Function performs provider cancellation and waits for webhook reconciliation where required.
- Reservations do not expire automatically. A timeout or missing webhook is not proof that Asaas did not create or charge a checkout.

The durable reservation is retained across HTTP 409 responses for pending provider cancellation and across ambiguous provider/database failures. The temporary processing lease is released when an attempt finishes or fails, while an interrupted Edge Function can be recovered after the ten-minute lease expires. The reservation itself is removed automatically only when the Auth identity is actually deleted, through the table's `ON DELETE CASCADE` foreign key.

A `SUBSCRIPTION_DELETED` webhook is definitive provider confirmation. It records `cancellation_confirmed_at` while preserving its local `suspended` status for subscriptions locked after a refund or chargeback. That distinction prevents the account-deletion flow from waiting indefinitely while retaining the fraud/chargeback access restriction. Manual reservation recovery ignores a subscription only when this explicit provider-confirmation marker exists; no local status, including `cancelled` or `suspended`, is accepted as proof by itself.

## Runtime bound for deletion processing lease

The temporary processing lease is ten minutes. The hosted gateway also documents a 150-second request idle timeout, and Edge workers have a maximum wall-clock duration of 150 seconds on Free and 400 seconds on paid plans. The destructive phase therefore has a 100-second deadline after Auth validation (8 seconds for the Auth request and 3 seconds for its response body), leaving up to 8 seconds to release the processing lease and additional room for the HTTP response before the gateway idle timeout. The ten-minute database lease still outlasts the worker execution window: if the function is terminated before releasing the lease, another deletion worker cannot overlap the old provider operation and may claim only after the lease expires. The durable deletion reservation remains in place, and unresolved Asaas state still requires webhook/operator reconciliation. Recheck the published limits if the project plan or runtime policy changes: https://supabase.com/docs/guides/functions/limits.

The lease does not make an ambiguous provider result safe to retry. `creating` Checkout rows and cancellation intent markers remain durable until reconciliation; never mark them terminal solely because the Edge Function timed out.

## Support procedure

When account deletion returns `checkout_creation_in_progress`, do not clear the reservation table or update the checkout row manually. The reservation was deliberately not created because a checkout-creation request may still be in flight. Inspect the checkout attempt and reconcile its `external_reference` with Asaas. If the remote result is ambiguous, keep the account blocked until the provider state is confirmed.

When account deletion returns `billing_cancellation_processing`, wait for the Asaas `CHECKOUT_CANCELED` or `SUBSCRIPTION_DELETED` webhook to update the local billing record. The account deletion endpoint can then be retried. Do not mark the attempt `cancelled` merely because the cancellation API request returned successfully.

If account deletion has already reserved the user but the owner decides not to delete the account, release is an operator-only recovery:
1. Independently inspect Asaas and confirm that no live Checkout, recurring subscription or pending provider action remains for the user.
2. Confirm that the local account has no checkout attempt in `creating`, `pending`, `paid` or `linked`, and no subscription row without the explicit `cancellation_confirmed_at` provider-confirmation marker, regardless of its local status.
3. Using the protected `service_role` credential from an approved operational environment, call `rpc/ordys_release_account_deletion_reservation` with the user UUID and `p_provider_state_verified: true`.
4. Proceed only when the RPC returns `released`. `provider_verification_required` means the explicit confirmation was not supplied; `billing_reconciliation_required` means unresolved local billing state remains; `deletion_processing` means an active deletion request still owns the lease. Do not bypass any of these results.

The release RPC is not exposed to `anon` or `authenticated`. Never put service-role credentials in the app, browser, client logs or chat.



Before any new Checkout creation or one-shot provider cancellation claim, the Edge Functions validate that `ASAAS_API_KEY` is present and `ASAAS_ENVIRONMENT` is explicitly set to `sandbox` or `production`. The environment is never inferred as Sandbox for an operation that may target a real provider resource. Missing credentials or an invalid/missing environment must fail before writing `cancellation_requested_at` or creating a durable `creating` attempt. Once the outbound request may have started, a timeout, network failure or ambiguous provider response still preserves the claim; do not clear it or repeat the non-idempotent request without independent provider reconciliation.

For a pending checkout, the cancellation request is persisted in `ordys_billing_checkout_attempts.cancellation_requested_at` before the Asaas POST. Further deletion retries do not send that POST again while the attempt remains non-terminal; they wait for webhook reconciliation. If the provider response or webhook is ambiguous, inspect the Checkout by its `externalReference` in Asaas before any operator clears this marker. The same atomic PATCH also stores `cancellation_claim_id` (UUID). If the write commits but the HTTP response is lost, only the invocation whose UUID is read back may continue to the single provider POST; a concurrent invocation with a different UUID remains blocked. This token proves claim ownership, not provider cancellation. `CHECKOUT_CANCELED`/`CHECKOUT_EXPIRED` remains the source of terminal confirmation.

For a recurring subscription, both account deletion and user-initiated cancellation from the profile use `ordys_billing_subscriptions.cancellation_requested_at` and `cancellation_claim_id` (UUID) in the same compare-and-set PATCH before the Asaas DELETE. A legacy row locally marked `cancelled` without `cancellation_confirmed_at` is not treated as provider-confirmed. Both profile cancellation and account deletion may make one newly claimed DELETE attempt for that exact stored provider subscription ID, provided no earlier cancellation marker exists. The account-deletion path uses the same claim helper and fails closed on any ambiguous provider response. The claim filter includes this legacy local status but still requires all three cancellation markers to be null; concurrent calls therefore cannot take over or repeat an existing request. If PostgREST commits the PATCH but its response is lost, the current invocation reads back the UUID it generated; only an exact match proves ownership and permits that invocation to send the one DELETE. A different UUID remains owned by another invocation and is never taken over. This closes the lost-database-response gap without allowing concurrent requests to duplicate the provider DELETE. If the provider response itself is ambiguous, the marker and claim remain durable; subsequent attempts wait for `SUBSCRIPTION_DELETED` instead of sending a second DELETE. A successful synchronous response is recorded through `rpc/ordys_confirm_subscription_cancellation`, which evaluates the current row, preserves `suspended` if a refund or chargeback arrived concurrently, and changes a linked/paid Checkout attempt to `cancelled` in the same database transaction. The profile-cancellation route also re-runs this idempotent RPC when `cancellation_confirmed_at` already exists but a legacy row has no `cancellation_requested_at`; that null-intent recovery is accepted only when Asaas is already recorded as `DELETED`, so it repairs a linked Checkout without issuing another provider DELETE. The billing management Edge Function is not deployed until migration `20261103020000` is present. Asaas webhook events are delivered at least once; process their event ID idempotently. Never clear a marker or resend a cancellation based only on a timeout.

A provider `404` on `DELETE /subscriptions/{id}` is also inconclusive and must **not** be mapped to `alreadyDeleted`. Asaas documents that a subscription lookup may return 404 when the ID is not accessible to the authenticated account. A changed `ASAAS_ENVIRONMENT`, API key or account can therefore hide a subscription that is still active under the account that created it. In this case, `cancellation_requested_at` remains set, `cancellation_confirmed_at` remains null, account deletion stays reserved, and user-initiated cancellation returns an error without reporting success. An operator must independently verify the original Asaas account and resource state before using the protected reconciliation procedure. Do not call `ordys_confirm_subscription_cancellation`, remove the reservation or delete local billing records solely because the current credential received 404. Provider documentation: https://docs.asaas.com/reference/remover-assinatura and https://docs.asaas.com/reference/recuperar-uma-unica-assinatura.

## Required validation before production

- Run the local Supabase integration suite against a disposable database.
- Verify both linearizable outcomes of concurrent checkout/deletion RPC calls.
- Verify the checkout-first path refuses deletion while the attempt is `creating`, then permits reservation after a terminal webhook.
- Verify the deletion-first path rejects all new checkout attempts before Asaas is called.
- Verify the manual release is refused without provider confirmation and while any checkout/subscription is non-terminal.
- Verify RLS and function grants deny all direct table access and lifecycle RPC access to `anon` and `authenticated`.
- Verify an authenticated caller cannot invoke `delete_own_data()` directly to erase data while any Checkout is creating/pending/paid/linked or any subscription row lacks `cancellation_confirmed_at`, including a row locally marked `cancelled`; also verify that a held `SUBSCRIPTION_CREATED`/confirmed-payment event blocks deletion after its Checkout becomes locally terminal.
- Verify deployment skips the checkout and deletion Edge Functions until the migration appears in the remote ledger.

A GitHub Actions result with no assigned runner and `steps=[]` is not a test result. Keep the PR in draft until CI executes the checks and they pass.


## Events received before the subscription link

`PAYMENT_CREATED` can arrive before `SUBSCRIPTION_CREATED`. The webhook processor stores only the payment ID, provider subscription ID and provider customer ID needed for replay; it does not retain the full provider payload. Once the exact subscription is linked to its Checkout, the held event is replayed and marked processed. Its unresolved state is scoped to the mapped user when the customer or subscription maps locally; otherwise it blocks account deletion globally until an operator reconciles it.

A held `SUBSCRIPTION_DELETED` event is also included in the direct deletion guard. It is scoped to the local subscription or Checkout customer when a mapping exists and blocks globally when its owner cannot be established. This prevents an unresolved terminal webhook from being overlooked after the related Checkout row becomes locally terminal.


## Ambiguous provider-customer associations

A webhook marked `ambiguous_customer_association` is deliberately quarantined without a retry payload because more than one local Checkout could match the same Asaas customer ID. No automatic owner inference is safe. While any such failed event remains, account deletion and manual reservation release are blocked globally. An operator must reconcile the provider customer and subscription against Asaas and the local Checkout records before clearing the event; do not delete or relink records based only on a customer-ID guess.


## Permanent billing identity and amount mismatches

`subscription_checkout_mismatch`, `subscription_customer_mismatch`, `subscription_identity_mismatch`, `subscription_amount_mismatch`, `payment_customer_mismatch`, `payment_identity_mismatch` and `amount_mismatch` are permanent quarantine states; they are not automatically replayed. They indicate that provider identity, local ownership, plan terms or payment value disagree. Until an operator reconciles the Asaas record against the local Checkout/payment ledger, these unresolved events block account deletion globally. This is intentionally fail-closed: deleting one account must not erase the only local evidence of a provider-side resource or disputed charge.

Checkout customer/reference mismatches remain scoped to their exact local attempt while it exists; if that attempt is missing, the event also blocks deletion globally. A `checkout_paid_after_closed` event follows the same rule using its provider Checkout ID.

## In-flight webhook and new Checkout concurrency — code guard added, validation still blocks activation

The previous implementation had a real transaction-visibility race: the webhook handler called `process_ordys_asaas_billing_event()` directly, so its initial `received` row and final quarantine were committed in the same transaction. A concurrent Checkout could not observe that event before the processing transaction committed.

Migration `20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql` now adds a separate `ordys_billing_webhook_inbox` and two service-role-only RPC stages:

1. `ordys_receive_asaas_billing_webhook()` commits the event identity, ownership mapping and an allowlisted payload before business processing. The provider's raw JSON is not stored. Repeated delivery with the same event ID and same allowlisted content is idempotent; reuse of an event ID with different content is quarantined and treated as owner-unknown.
2. `ordys_process_asaas_billing_webhook()` reads only the committed inbox record, applies the existing state machine in a second transaction and synchronizes its terminal/failed state back to the inbox. If processing rolls back or times out, the receipt remains `received` for a provider retry.
3. Receipt, processing, database Checkout admission and Checkout finalization take the same global advisory lock before the per-user lifecycle lock. A relevant `received` or `quarantined` event blocks new subscription admission and account deletion. If ownership cannot be uniquely established, `user_id` remains null and the event blocks admission globally until reconciliation.
4. `ordys_finalize_billing_checkout_attempt()` stores the provider Checkout identity and rechecks unresolved billing state after the external Asaas request. It releases the URL only when safe. A conflicting event arriving during provider creation keeps the attempt in `creating`, does not expose the link and leads to a single claimed cancellation request. The only pending event excluded from that finalization check is `CHECKOUT_CREATED` with the exact provider Checkout ID being finalized and either no `externalReference` (as in the documented payload example) or the exact expected reference. If the event supplies a different reference, it blocks finalization even when receipt associated it with another local owner.

The migration also updates the final schema-readiness gate. The gate will not report `ready` without the inbox table, the three RPCs, the inbox-aware reconciliation helper and the global lock in Checkout admission. The trigger that mirrors legacy event-state transitions also updates inbox rows when the existing replay migrations reconcile a quarantined event.

## Asaas webhook worker — database-native queue execution

The HTTP webhook handler stops after a valid, durable receipt and responds HTTP 200 only after the inbox write commits. It does not call the financial processor inline. This keeps provider acknowledgement separate from entitlement changes.

The previous TanStack Start HTTP worker route was removed. Lovable documents that Jobs invoking an API route are cancelled after a few seconds; a longer handler cannot safely process multiple database requests in that request. The current branch instead adds migration `20261112010000_ordys_asaas_cron_worker.sql`, which installs the available `pg_cron` extension and creates the restricted SQL dispatcher `ordys_process_next_asaas_billing_webhook(text DEFAULT NULL)`. It deliberately does not register or enable a schedule.

A no-argument SQL Job invocation:
1. asks the bounded requeue RPC to reopen at most one exact-prerequisite retry candidate;
2. if no retry is eligible, locks the oldest new `received` inbox record with `FOR UPDATE SKIP LOCKED`;
3. calls the normal `ordys_process_asaas_billing_webhook(p_event_id)` processor;
4. completes one event in one transaction and releases the shared admission lock before the next Job run.

This one-receipt boundary is deliberate: the webhook receiver, checkout admission and financial processor share the global advisory lock. Processing a multi-event batch in a single SQL transaction would keep that lock for the entire batch and could delay Asaas acknowledgements. A failed processor call rolls back the selected event and its retry transition; the next SQL Job run can safely pick it up. Permanent identity, amount and ambiguity quarantines remain excluded from automatic replay.

**No SQL Job is configured yet.** After the official source is synchronized, all required migrations are applied through the approved Lovable Cloud process, the schema-readiness RPC returns `ready`, and CI/Sandbox gates pass, configure a **database-only SQL Job** with this command:

```sql
SELECT public.ordys_process_next_asaas_billing_webhook();
```

Use an initial interval of **5 seconds** and run the Job as `postgres` (or another explicitly granted role). Confirm the Job and its run history appear in Lovable's Database Jobs/Cron view. Do not configure an HTTP/API-route job, do not add `LOVABLE_CRON_SECRET`, and do not create or enable this Job from the migration. The extension and dispatcher are versioned in source; scheduling remains a separate, intentionally gated operation. Review Cloud usage and queue latency before changing the cadence.

The new database integration suite verifies that one exact receipt is processed per invocation, the next receipt stays queued, and simultaneous calls cannot process the same receipt twice. Security tests check that `anon` and `authenticated` cannot execute the dispatcher. Existing integration tests retain the larger dependent-event backlog, concurrent requeue and refund/chargeback identity cases. These tests remain unexecuted until a real CI runner and disposable PostgreSQL environment are available.

**Validation is still a production blocker.** These changes are committed only to the Draft PR branch; they have not been merged, applied to Lovable Cloud, deployed or exercised against an Asaas account. Before billing activation:

- CI must execute, not merely create a workflow run: the integration, handler, security and static-verifier tests must pass.
- Apply the complete migration chain only through the approved Lovable Cloud procedure after backup, then verify `ordys_billing_schema_status() = 'ready'`.
- Confirm the source is synchronized to the correct private repository before creating the SQL Job.
- Create the SQL-only Job, inspect at least two successful run-history entries and verify both new receipts and one retryable dependency are processed without duplicate ledger entries.
- Exercise the actual Asaas Sandbox for duplicates, same-ID/different-payload quarantine, out-of-order events, receipt-first admission, webhook arrival during provider Checkout creation, cancellation retries and payment reconciliation.
- Confirm the provider callback delivers the required identifiers; events without a unique local owner intentionally fail closed and may pause all new sales until manually reconciled.

Do not enable `billing_enabled`, publish billing functions or start paid campaigns that promise recurring billing until all of those checks have passed. The presence of the migration in GitHub is not evidence that the remote database or Asaas flow is ready.


## Sobreposição com a PR #300 — cancelamento idempotente de Checkout

**Comparação consolidada em 12/11/2026:** a proteção central da #300 foi incorporada à cadeia #297 → #309 → #311.

- A migration `20261103010000_ordys_billing_deletion_serialization.sql` adiciona `cancellation_requested_at` e `cancellation_claim_id` ao ledger de Checkout e assinatura; a migration isolada `20261104102000_ordys_checkout_cancel_claim.sql` da #300 repete os campos do Checkout e não deve ser aplicada junto com a migration maior.
- `supabase/functions/_shared/ordys-checkout-cancellation.ts` faz PATCH condicional por Checkout e titular, exige status `creating/pending`, marcador `cancellation_requested_at IS NULL`, grava UUID de propriedade e só autoriza o POST quando a execução comprova que detém o token.
- O helper é reutilizado por `ordys-billing-checkout` e `ordys-delete-account-billing`; a exclusão também mantém timeouts e AbortSignal para banco e Asaas.
- A cobertura dos cinco cenários que estavam pendentes na auditoria de 06/11 foi localizada na suíte atual:
  1. `blocks deletion when a timed-out Checkout claim commits after its read-back`;
  2. `continues cancelling independent Checkouts after another claim becomes inconclusive`;
  3. `continues cancelling identified Checkouts when another Checkout has no provider ID yet`;
  4. `attempts every known subscription cancellation when one provider response is uncertain`;
  5. `continues known subscription cancellations when Checkout records need reconciliation`.
- Os cenários estão em `tests/ordys-delete-account-edge.test.ts`; os contratos de propriedade do token permanecem em `tests/ordys-checkout-cancellation-claim.test.ts` e `tests/ordys-subscription-cancellation-claim.test.ts`.

**Decisão atualizada:** não é necessário portar os cinco cenários da #300; todos estão presentes na cadeia consolidada. A migration isolada da #300 continua redundante. A PR #300 permanece como referência histórica separada até revisão final do diff completo, mas não é base da #309/#311. Não integrar as duas branches em sequência nem aplicar migrations redundantes.

A existência dos testes nos arquivos não significa que foram executados. CI, integração PostgreSQL, homologação Asaas Sandbox e aplicação de migrations continuam pendentes.

## Reconciliação somente leitura do Lovable Cloud — 12/11/2026

Esta seção registra uma nova inspeção do catálogo e do ledger do projeto Lovable `39199358-13e3-4271-8e84-5e658f272186`. Foram executados somente `SELECT` e leituras do repositório; nenhuma migration, DDL/DML, alteração de Auth, secret, Edge Function, Job ou publicação foi realizada.

### Ledger e divergência de fonte

- O ledger `supabase_migrations.schema_migrations` contém **18 versões**, exatamente as primeiras 18 migrations da `main`, e termina em `20260927013000`.
- A `main` privada contém **35 migrations SQL**. Portanto, **17 versões da fonte oficial não aparecem no ledger remoto**: `20260927014000`, `20260927014500`, `20260927020000`, `20260927023000`, `20260927024000`, `20260927110000`, `20260927120000`, `20260927130000`, `20261029232900`, `20261029232950`, `20261029233000`, `20261031010000`, `20261031020000`, `20261031030000`, `20261031040000`, `20261031050000` e `20261102010000`. Algumas estruturas equivalentes já existem fora do histórico; ausência de registro não autoriza replay automático.
- A PR #320, branch `refactor/asaas-minimal-lifecycle-2026-11-12`, parte do SHA oficial `13d353269103411fad213890c449ef5a4578569e` e acrescenta **onze migrations novas**: `20261103010000`, `20261103020000`, `20261103030000`, `20261105010000`, `20261105020000`, `20261105030000`, `20261105040000`, `20261105050000`, `20261105060000`, `20261111010000` e `20261112010000`. A cadeia atual tem, portanto, 28 versões sem registro remoto a reconciliar: 17 da `main` + 11 da PR #320.
- As migrações `20261104010000`, `20261104020000`, `20261104030000` e `20261105070000` pertenciam à cadeia empilhada anterior e **não existem na `main` atual nem na PR #320**. Referências antigas a esses arquivos foram retiradas do roteiro operacional; não os aplicar nem tentar reconstruí-los a partir de descrições.
- O projeto Lovable `39199358-13e3-4271-8e84-5e658f272186` continua unpublished, com snapshot `d9ab06252c749e55afac9b3d3ed5e060e18b22d2`, sincronizado ao repositório público legado `igniteprosperety-collab/ordys-academic-os`, não ao privado oficial `igniteprosperety-collab/ordys-academy.app`. O Git Sync atual não publica as migrations nem as Edge Functions da PR.
- PR #320 permanece Draft, head `4cda3d8d05bdedcc2f6abd669ff587da2370c1f6`; PR #321 permanece Draft e contém a recuperação seletiva das correções de interface. Em 13/11/2026, os workflows mais recentes de #320 foram `43334528023` (Verify ORDYS Web; jobs `131587241871` e `131587242255`) e `43334527963` (Validate GitHub Actions; job `131587241467`). Todos terminaram sem etapas registradas (`steps=[]`). Isso é falha pré-execução do runner, não reprovação de testes. As alterações recentes também alinham a transcrição de áudio de vídeos ao fuso IANA do perfil e atualizam o verificador estático para exigir essa proteção; esses testes ainda não foram executados.
- Nenhuma migration foi aplicada, nenhum secret ou configuração de Auth foi alterado, nenhuma Edge Function ou Job foi publicado, e nenhuma chamada Sandbox/produção ao Asaas foi executada. A Issue #323 registra que a idade do perfil é autodeclarada/editável e precisa de age assurance antes de liberar IA ou assinatura 18+.
- **Perfil:** `profiles_full_name_len` e `profiles_stage_allowed` já existem e estão validadas. Falta `profiles_full_name_nonblank`; a contagem de nomes em branco foi zero e a de nomes acima de 120 caracteres também foi zero. `handle_new_user()` ainda copia `raw_user_meta_data.full_name` sem trim/limite, portanto `20260927024000_harden_new_user_profile_name.sql` continua necessária.
- **Defaults:** `goals.metric` e `goals.period` ainda usam `media_disciplina` e `semana`, incompatíveis com as CHECK constraints atuais. `quiz_attempts.difficulty` ainda tem default `medio`, enquanto o conjunto aceito é `facil/media/dificil`. Não foram encontrados valores existentes fora dos conjuntos permitidos. As correções de default em `20260927020000` e `20261031020000` continuam necessárias.
- **Validação de constraints:** as cinco constraints acadêmicas de `profiles` e as duas de `grades` continuam `NOT VALID`. As sete contagens de violação retornaram zero nesta leitura. A validação ainda deve ocorrer em janela controlada, após um novo preflight imediatamente antes da migration.
- **Exclusão e recuperação:** a tabela `password_recovery_attempts` existe. A definição atual de `delete_own_data()` não remove os hashes de recuperação do e-mail atual do titular; `20261029232900_delete_recovery_hash_on_account_deletion.sql` continua pendente.
- **Confirmação de e-mail:** `auth.users` ainda possui o trigger `ordys_auto_confirm_email_trigger` habilitado, executando `public.ordys_auto_confirm_email()`. A função ainda é executável por `anon` e `authenticated`. A migration `20261029233000_remove_untracked_auto_confirm_email.sql` permanece bloqueada até teste independente de confirmação Gmail e login normal após confirmação.
- **Privilégios:** RLS está habilitado em 25/25 tabelas públicas. O papel `authenticated` ainda possui `TRUNCATE`, `REFERENCES` e `TRIGGER` efetivos em 22 tabelas; `anon` não possui esses três privilégios em nenhuma tabela pública. A migration `20261102010000` continua necessária para remover esses privilégios estruturais existentes. Os default ACLs observados permanecem amplos tanto para objetos criados por `postgres` quanto por `supabase_admin`; a migration `20261031040000` altera os defaults do papel `postgres`, não os defaults administrados por `supabase_admin`. Esse residual requer revisão suportada da plataforma; não tentar alterar os defaults de outro proprietário por SQL improvisado.

### Backup e limite operacional

- A tentativa de pedir ao agente Lovable para conferir a tela de backups foi recusada porque o workspace estava sem créditos.
- A integração disponível não expõe uma API para consultar os pontos de restauração da tela Backups. Portanto, **a existência, a data do backup mais recente e uma exportação independente ainda não foram verificadas**.
- A documentação oficial descreve backups diários com aproximadamente 14 dias de retenção; a exportação do banco é separada e não inclui arquivos de Storage, secrets, código de Edge Functions ou configurações de login: https://docs.lovable.dev/features/database-backups.
- Não considerar o backup concluído até conferir a data/hora real em `More → Database → Manage → Backups`, gerar/exportar uma cópia independente e baixar também os arquivos do Storage necessários para recuperação.

### Sequência de reconciliação recomendada

1. Confirmar backup diário disponível, exportação independente baixada e cópia dos arquivos de Storage. Sem isso, não iniciar alterações.
2. Tratar primeiro o bloco acadêmico/perfil de `20260927014000` a `20260927130000`, em ordem: completar o FK/trigger de `focus_sessions.plan_session_id`; adicionar a regra de nome não vazio; normalizar/truncar o nome no trigger Auth; corrigir defaults de metas; corrigir o stage se o preflight indicar divergência; validar as sete constraints somente após repetir as contagens.
3. Aplicar `20261029232900_delete_recovery_hash_on_account_deletion.sql` e `20261029232950_ordys_billing_schema_status.sql` separadamente, após revisar as definições atuais, ownership, grants e pré-condições.
4. Resolver a migration de auto-confirm antes de avançar na linha do tempo. Se o teste independente de confirmação Gmail e login normal passar, aplicar `20261029233000_remove_untracked_auto_confirm_email.sql` isoladamente. Se ainda precisar ficar retida, não tentar executá-la depois de migrations com timestamp posterior: preparar uma migration substituta com timestamp posterior, revisá-la isoladamente e só liberá-la após o teste de Auth. Nunca editar o ledger manualmente.
5. Não aplicar `20261031010000_ordys_plus_billing_foundation.sql` isoladamente: a versão atual da fundação ainda depende das proteções de ciclo de vida da cadeia #297/#309/#311, inclusive preservação de ledger durante exclusão e inbox assíncrona. Primeiro concluir revisão/CI/merge das PRs; depois aplicar o conjunto restante em ordem cronológica: fundação de billing (sempre disabled), correção de quiz, AI reports opcional, hardening de default privileges, revoke de funções de trigger, privilégios de tabelas e, por fim, as migrations da cadeia de lifecycle/replay.
6. Antes de qualquer deploy de billing, verificar que toda a cadeia de migrations requerida está no ledger, que o schema-status retorna `ready`, e que o efeito residual dos default ACLs de `supabase_admin` recebeu revisão suportada da plataforma. O hardening de `postgres` não remove automaticamente defaults de outro proprietário.
7. Só depois publicar as Edge Functions pelo fluxo suportado do Lovable, configurar secrets e Job de worker, e executar testes end-to-end de Sandbox para Checkout, pagamento, renovação, cancelamento, estorno e chargeback. Manter `billing_enabled = false`, preços inativos e sem secrets/Jobs até a homologação completa.



### GitHub Actions runner diagnosis — 12/11/2026

- PRs #297, #309 and #311 were temporarily marked ready-for-review solely to trigger their existing CI workflows. They were returned to Draft after the resulting jobs again failed before the first step. All three remain unmerged and must not be merged on the strength of these checks.
- New runs:
  - PR #297: Verify `43302115480`; Actionlint `43302115591`.
  - PR #309: Verify `43302166232`.
  - PR #311: Verify `43302172150`; Actionlint `43302172109`.
- Jobs returned empty step arrays and no recoverable log URLs. No checkout, lint, typecheck, build, unit test, Deno check or disposable PostgreSQL integration step is evidenced as started. Treat these conclusions as infrastructure/job-dispatch failures, not code-test failures.
- The official GitHub Status page showed Actions operational and no active incident on 12/11/2026; the multi-product incident affecting Actions on 11/11 was marked resolved at 21:21 UTC. A global green status does not prove account/repository-specific runner availability: https://www.githubstatus.com/.
- A focused admin-only follow-up is recorded in [Issue #318](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/318): inspect repository Settings → Actions → General, organization policy inheritance, allowed actions and usage/minute limits. Do not upgrade or add payment solely to investigate. The connected GitHub integration cannot read those administrative settings.
- Do not repeat identical reruns until the admin checks produce new evidence. When the runner path is confirmed, execute one fresh Verify run first and require an assigned runner, real steps and logs before treating CI as available.


### Ledger retention cross-check — 12/11/2026

A focused review of migration `20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql` confirms that it already implements the required post-deletion financial ledger behavior:
- `user_id` is nullable on Checkout attempts, subscriptions and payments;
- every existing FK from those three `user_id` columns to `auth.users` is dropped before canonical `ON DELETE SET NULL` FKs are added, preventing a leftover CASCADE FK from deleting the rows;
- the final readiness RPC requires nullable owner columns and `confdeltype = 'n'` on all three FKs;
- account deletion anonymizes the webhook inbox owner link before deleting the Auth identity;
- `tests/ordys-billing-webhook.integration.test.ts` already verifies that the three financial rows survive and that a late refund is reconciled after deletion.

The same integration test now also calls `ordys_billing_schema_status()` and requires `ready` before running the deletion/late-refund scenario. No separate ledger-retention migration is needed; do not duplicate the DDL from `20261105060000`.


### Registro histórico — escopo da cadeia empilhada #297/#309/#311 — 12/11/2026 (superada pela PR #320)

Historical note: the stacked #297/#309/#311 delivery path was too broad to merge as an Asaas-only change. It has been superseded by the narrower, current Draft PR #320:

| PR | Commits | Changed files | Additions | Deletions |
|---|---:|---:|---:|---:|
| #297 — lifecycle/Checkout serialization | 1,076 | 143 | 33,992 | 1,429 |
| #309 — async webhook worker | 12 | 9 | 574 | 176 |
| #311 — bounded replay | 31 | 8 | 2,042 | 60 |

PR #297 is the base of #309; #309 is the base of #311. The #297 file list includes billing, auth/signup/password recovery, Android/native authentication, assistant, academic UI, release workflows, legal docs and other product areas. This is not a small, isolated billing diff.

**Decision:** keep #297, #309 and #311 frozen in Draft as historical audit/reference branches. PR #320 is the replacement branch built from current `main`; review and validate that branch independently. Do not merge the 1,076-commit history as a shortcut, and do not retarget the old dependent PRs.

The extraction outcome is [Draft PR #320](https://github.com/igniteprosperety-collab/ordys-academy.app/pull/320), tracked by [Issue #319](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/319). It contains the lifecycle dependencies, worker, bounded replay, targeted tests and the reviewed age-gate alignment. It remains unmerged because CI has not executed, disposable-PostgreSQL validation and Sandbox testing have not passed, and the Lovable Cloud migration/backup path remains unresolved.

No PR was merged, no existing branch was rewritten, and no production/Cloud migration, deploy, secret, Job or Asaas setting was changed by this scope decision.


### Extração mínima atual — PR #320 — 12/11/2026

A avaliação inicial abaixo foi substituída pela extração efetiva na PR #320. A branch atual parte do `main` oficial e incorpora somente onze migrations do ciclo de vida Asaas:

1. `20261103010000_ordys_billing_deletion_serialization.sql`
2. `20261103020000_ordys_suspended_subscription_deletion_confirmation.sql`
3. `20261103030000_guard_delete_own_data_billing_reconciliation.sql`
4. `20261105010000_ordys_guard_delete_own_data_unmatched_webhooks.sql`
5. `20261105020000_ordys_replay_unmatched_payment_created_webhooks.sql`
6. `20261105030000_ordys_guard_ambiguous_customer_webhooks.sql`
7. `20261105040000_ordys_guard_permanent_billing_mismatches.sql`
8. `20261105050000_ordys_preserve_unmatched_confirmed_payment.sql`
9. `20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql`
10. `20261111010000_ordys_bound_asaas_webhook_replay.sql`

As migrations de fundação `20261029232950_ordys_billing_schema_status.sql` e `20261031010000_ordys_plus_billing_foundation.sql` já fazem parte da `main`; elas também estão ausentes do ledger remoto e precisam ser reconciliadas no baseline antes das onze migrations novas.

As migrations da antiga cadeia `#297/#309/#311` que não aparecem na lista acima não devem ser aplicadas por inferência. Em particular, `20261104010000`, `20261104020000`, `20261104030000` e `20261105070000` não existem na `main` atual nem na PR #320. O hardening de uso da IA já tem uma migration na `main`, `20260926071000_atomic_usage_rate_limit.sql`; qualquer endurecimento adicional deve ser avaliado como mudança separada, com seu próprio arquivo e teste, e não presumido a partir do nome de uma migration antiga.

A PR #320 também alinha o cálculo da idade ao fuso IANA do perfil no Checkout, no Assistente server-side, na transcrição server-side de áudio de vídeos e na interface. As duas rotas server-side que enviam dados à OpenAI usam o mesmo helper fail-closed para perfil ausente/inválido. **Isso não comprova idade:** `birth_date` e `timezone` são editáveis pelo titular; a pessoa pode autodeclarar uma data que a faça parecer 18+. A Issue [#323 — self-editable birth date bypasses the 18+ age gate](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/323) é bloqueio independente para liberar cobrança/IA 18+ até existir age assurance confiável controlada no servidor. As mudanças não alteram prompts, modelos nem limites de uso.

A PR segue Draft. A extração foi revisada por leitura de código e de diffs; CI, typecheck, lint, testes Vitest/Deno, integração PostgreSQL descartável e Sandbox ainda não executaram com sucesso. Nenhuma migration, função, secret, Job ou configuração de billing foi publicada.

Ver [PR #320](https://github.com/igniteprosperety-collab/ordys-academy.app/pull/320), [PR #321](https://github.com/igniteprosperety-collab/ordys-academy.app/pull/321), [Issue #318 — GitHub Actions runner allocation](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/318) e [Issue #322 — Lovable Git Sync](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/322).


### CI runner diagnostic refinement — private repository scope — 12/11/2026

Historical read-only evidence narrows the runner issue beyond a generic Actions outage:

- Same owner account, public control repository `igniteprosperety-collab/ordys-academic-os`: run `42652452513` on 09/11/2026. Standard hosted jobs `ubuntu-latest` and `ubuntu-24.04` both succeeded with real runner IDs `1000008104` and `1000008105`, each with three steps.
- Official private repository `igniteprosperety-collab/ordys-academy.app`: minimal one-job hosted-runner probe `42941337215`, job `130263609643`, failed in about two seconds with `runner_id=0`, empty runner name, `steps=[]`, no logs. The probe performed no checkout, build, external request, secret access or deployment.
- Later billing-chain runs show the same pre-runner signature. Thus a global GitHub Actions outage or account-wide inability to use hosted runners is less likely; the remaining diagnostic scope is private-repository policy or private-repository usage entitlement/budget. The evidence does **not** prove quota exhaustion, payment trouble or a specific setting. Historical minute estimates are not proof of current usage.

The next owner-only, read-only checks are private repository → Settings → Actions → General, and account → Billing & Licensing → Usage / Budgets and alerts / Payment information. Do not enable overage, add a payment method, raise a budget, upgrade plans, make the repository public or change runner labels as a diagnostic shortcut. The connected GitHub tool cannot read these administrative pages. Do not repeat identical workflows until the owner checks provide new evidence. This is tracked in [Issue #318](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/318).
