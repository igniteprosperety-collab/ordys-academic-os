# ORDYS Academy — first-release blocker manifest

**Snapshot:** 13 November 2026 (BRT)  
**Scope:** student core + Asaas Sandbox homologation. Teacher/professor workflows are explicitly out of scope for this release. Do not delete existing teacher-related data, columns, or tables as part of this scope reduction.

## 1. Verified current state

The connected Lovable Cloud database for project `39199358-13e3-4271-8e84-5e658f272186` was inspected read-only:

- PostgreSQL 17.6.
- Migration ledger: 18 rows, latest `20260927013000 academic_data_integrity`.
- Main-branch source tree: 35 SQL migration files.
- Main migrations absent from the current database ledger: 17 (listed below).
- PR #320 adds 11 more billing-lifecycle migrations. If PR #320 is approved and included, the total migration backlog relative to the current Cloud ledger is **28**.
- Core billing tables and RPCs do not exist yet: `ordys_billing_settings`, `ordys_billing_plans`, `ordys_billing_subscriptions`, `ordys_billing_webhook_inbox`, `ordys_billing_schema_status()`, and `ordys_process_next_asaas_billing_webhook(text)`.
- `pg_cron` is available at default version 1.6.4 but is not installed. `cron.job` and `cron.job_run_details` do not exist.
- The Auth trigger `auth.users.ordys_auto_confirm_email_trigger` is enabled (`tgenabled = O`) and calls `public.ordys_auto_confirm_email()`.
- No database migration, extension, scheduled job, secret, Edge Function, or Asaas API call was changed or run during this inspection.

The active auto-confirm trigger is significant: migration `20261029233000_remove_untracked_auto_confirm_email.sql` removes it. That migration explicitly requires a successful test of normal Gmail confirmation delivery with Auto-confirm disabled before it is applied. That delivery test is not yet evidenced.

## 2. Exact unapplied migrations from `main`

These 17 migration versions are in the official private repository's `main` tree but absent from the connected Cloud migration ledger:

1. `20260927014000_focus_plan_reference_integrity.sql`
2. `20260927014500_focus_plan_ownership.sql`
3. `20260927020000_goal_integrity.sql`
4. `20260927023000_profile_full_name_limit.sql`
5. `20260927024000_harden_new_user_profile_name.sql`
6. `20260927110000_fix_profile_stage_constraint.sql`
7. `20260927120000_validate_profile_academic_ranges.sql`
8. `20260927130000_validate_grade_integrity_constraints.sql`
9. `20261029232900_delete_recovery_hash_on_account_deletion.sql`
10. `20261029232950_ordys_billing_schema_status.sql`
11. `20261029233000_remove_untracked_auto_confirm_email.sql`
12. `20261031010000_ordys_plus_billing_foundation.sql`
13. `20261031020000_fix_quiz_difficulty_default.sql`
14. `20261031030000_ai_content_reports.sql`
15. `20261031040000_harden_public_default_privileges.sql`
16. `20261031050000_revoke_public_trigger_function_execution.sql`
17. `20261102010000_revoke_excess_client_table_privileges.sql`

PR #320 adds these 11 migrations:

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
11. `20261112010000_ordys_asaas_cron_worker.sql`

**Do not apply only the 11 PR migrations in isolation.** The Cloud migration ledger, existing database objects, SQL constraints, RPCs and triggers must first be reconciled against all 17 unapplied main migrations and then the 11 PR migrations. Do not assume the ledger alone proves there is no manual/partial schema drift.

## 3. Release gates and execution order

### Gate A — source and validation

1. Keep PR #320 in Draft until an actual runner executes the steps and all required checks pass.
2. Resolve GitHub Actions runner allocation under Issue #318. The latest runs `43363627319` (Verify ORDYS Web) and `43363627299` (workflow validation) on commit `5ad3cb06da940f2ed936c72dcc0ad3fb2364be92` failed before any step: raw job records show `runner_id = 0`, empty runner name, and `steps = []`. No build, typecheck, lint, actionlint, or test command ran. Earlier commits show the same pre-runner failure.
3. Keep the deterministic Vitest file-serialization change on the PR branch until the full suite can execute and its result is known.
4. Resolve the Lovable/GitHub source handoff under Issue #322. The current Lovable project is connected to a legacy public repository, while billing code is held in the official private repository. Current Lovable Git Sync documentation states that it creates a new repository rather than connecting an existing repository; adding migration files to Git does not apply them to Cloud. Preserve preview/Auth wiring and the existing database while selecting the supported code handoff.
5. Before any DDL, take and verify a recoverable Cloud backup/export; record migration versions, relevant schema objects, constraints, triggers, functions, and privileges. Compare manual/partial objects with the intended migration chain. Stop on unexplained drift.

### Gate B — authentication and core schema

6. Verify normal signup confirmation delivery to an ordinary Gmail address while Auto-confirm is disabled, using a controlled test account. Confirm the actual message, link and successful first sign-in. Do not remove `ordys_auto_confirm_email_trigger` before this proof.
7. Apply the missing main migrations in the listed order through the supported Lovable Cloud mechanism, with a verification after each controlled batch. Preserve the database's existing 18 ledger entries; never reset or recreate the database.
8. Apply the 11 PR #320 billing lifecycle migrations in version order only after the main chain and schema preflight are complete.
9. Deploy the billing Edge Functions and dependent account-deletion integration only after the required schema is present and CI/SQL integration tests pass.

### Gate C — worker and Sandbox

10. Install `pg_cron` only after the full migration chain is reconciled and applied. Configure the SQL-only job under role `postgres` with exact name `ordys-asaas-webhook-worker` and schedule `5 seconds`:
    ```sql
    SELECT cron.schedule(
      'ordys-asaas-webhook-worker',
      '5 seconds',
      'SELECT public.ordys_process_next_asaas_billing_webhook();'
    );

    SELECT cron.schedule(
      'ordys-cron-history-cleanup',
      '0 3 * * *',
      'DELETE FROM cron.job_run_details WHERE end_time < now() - INTERVAL ''7 days'';'
    );
    ```
11. The worker processes one durable receipt per transaction. At `5 seconds`, its theoretical upper bound is 12 events/minute before database execution time; verify actual throughput, queue age, database load, and no overlapping runs. The separate daily cleanup retains seven days of `cron.job_run_details`. Prove `ordys_billing_schema_status() = 'ready'`, at least two fresh successful runs, oldest-first processing, bounded retry, permanent quarantine, and no duplicate payment/period changes.
12. Add Asaas Sandbox API key and webhook token only through the project's server-side Secrets UI. Never place credentials in `VITE_*`, source files, repository, issue comments, or chat.
13. Configure the Sandbox webhook with the exact callback URL and required event set; verify the token header and sequential delivery.
14. Test checkout creation, Checkout-paid, subscription creation, payment confirmation, renewal, overdue, cancellation, refund, partial refund, chargeback, duplicate/reordered delivery, delayed events, ambiguous provider responses, account deletion races, and the first due-date/time-zone result against `America/Sao_Paulo`.
15. Keep `billing_enabled = false`, both plan rows disabled/unpriced, Checkout unavailable, and Plus entitlement closed throughout technical homologation. Do not use live Asaas credentials or make live charges during this phase.

### Gate D — eligibility and commercial release

16. Resolve Issue #323: the current 18+ gate relies on user-editable `profiles.birth_date`, which is not trustworthy age assurance. Define and implement a server-controlled age-verification/parental-consent model appropriate to the product's actual audience before enabling restricted AI or commercial Plus.
17. Complete privacy, terms, retention, minors and support-channel release requirements under Issue #92.
18. Only after all gates are evidenced should the owner set prices, enable billing, approve commercial terms, and separately approve publication.

## 4. Scope exclusions

- No new teacher/professor functionality in this release.
- Do not implement teacher dashboards, teacher workflows, class-administration roles, or teacher-facing screens.
- Do not delete existing academic data, tables, columns, or relationships merely because teacher features are excluded.
- Student core, authentication, data integrity, account deletion, billing security, webhook reconciliation, and age/privacy safeguards remain in scope.

## 5. Evidence links

- PR #320 — Asaas lifecycle: https://github.com/igniteprosperety-collab/ordys-academy.app/pull/320
- PR #321 — frontend Edge Function error handling: https://github.com/igniteprosperety-collab/ordys-academy.app/pull/321
- Issue #318 — Actions runner allocation: https://github.com/igniteprosperety-collab/ordys-academy.app/issues/318
- Issue #322 — Lovable/Git source reconciliation: https://github.com/igniteprosperety-collab/ordys-academy.app/issues/322
- Issue #323 — age assurance release blocker: https://github.com/igniteprosperety-collab/ordys-academy.app/issues/323
- Issue #324 — SQL-only Asaas worker: https://github.com/igniteprosperety-collab/ordys-academy.app/issues/324
- Issue #92 — privacy, terms and minor safeguards: https://github.com/igniteprosperety-collab/ordys-academy.app/issues/92


## 6. Latest static-review addendum — 2026-11-13

- PR #320 now includes a fail-closed guard in `ordys-billing-status`: it does not query the subscription table while `ordys_billing_schema_status()` is `absent` or `partial`. New regression coverage is in `tests/ordys-billing-status-handler.test.ts`. When schema is ready but new sales are disabled, existing paid subscription state remains readable.
- The change is committed at `5ad3cb06da940f2ed936c72dcc0ad3fb2364be92`, but has no CI execution evidence because runner allocation remains broken. PR #320 remains Draft.
- Reviewed current official Asaas Checkout, Checkout-event, subscription-event and payment-event documentation. The implementation's intended sequence is consistent: Checkout completion, subscription creation and payment settlement are distinct events; callback redirects are not payment confirmation. Webhook authentication must use the `asaas-access-token` header and the webhook configuration must use `sendType = SEQUENTIALLY` for the customer/Checkout association fallback documented in `BILLING-ASAS.md`.
- The official recurring Checkout example currently formats `subscription.nextDueDate` as a date-time string, but does not define timezone interpretation. The code currently calculates the value from UTC and removes the UTC marker. Keep first-charge timing as an explicit Sandbox acceptance test against `America/Sao_Paulo`; do not infer the timezone or enable live billing before observing the resulting Asaas subscription and first payment due date.
- Asaas reference pages: https://docs.asaas.com/docs/checkout-with-subscription-recurring ; https://docs.asaas.com/docs/checkout-events ; https://docs.asaas.com/docs/subscription-events ; https://docs.asaas.com/docs/webhook-para-cobrancas .
- The Lovable Cloud database query allowance was exhausted on 2026-11-13. No query from that blocked attempt executed. Wait for the quota reset before performing the read-only schema/migration reconciliation again; do not try writes or use the production database as a test target.
