import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const requireFile = (path) => {
  if (!existsSync(resolve(process.cwd(), path))) {
    throw new Error(`Missing required Asaas billing file: ${path}`);
  }
  return read(path);
};
const requireIncludes = (path, source, fragments) => {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      throw new Error(`Asaas billing invariant missing in ${path}: ${fragment}`);
    }
  }
};

const migrationPaths = [
  "supabase/migrations/20261029232950_ordys_billing_schema_status.sql",
  "supabase/migrations/20261031010000_ordys_plus_billing_foundation.sql",
  "supabase/migrations/20261103010000_ordys_billing_deletion_serialization.sql",
  "supabase/migrations/20261103020000_ordys_suspended_subscription_deletion_confirmation.sql",
  "supabase/migrations/20261103030000_guard_delete_own_data_billing_reconciliation.sql",
  "supabase/migrations/20261105010000_ordys_guard_delete_own_data_unmatched_webhooks.sql",
  "supabase/migrations/20261105020000_ordys_replay_unmatched_payment_created_webhooks.sql",
  "supabase/migrations/20261105030000_ordys_guard_ambiguous_customer_webhooks.sql",
  "supabase/migrations/20261105040000_ordys_guard_permanent_billing_mismatches.sql",
  "supabase/migrations/20261105050000_ordys_preserve_unmatched_confirmed_payment.sql",
  "supabase/migrations/20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql",
  "supabase/migrations/20261111010000_ordys_bound_asaas_webhook_replay.sql",
  "supabase/migrations/20261112010000_ordys_asaas_cron_worker.sql",
];
const migrations = new Map(migrationPaths.map((path) => [path, requireFile(path)]));

requireIncludes(migrationPaths[2], migrations.get(migrationPaths[2]), [
  "pg_advisory_xact_lock",
  "ordys_begin_billing_checkout_attempt",
  "ordys_reserve_account_deletion",
]);
requireIncludes(migrationPaths[10], migrations.get(migrationPaths[10]), [
  "CREATE TABLE IF NOT EXISTS public.ordys_billing_webhook_inbox",
  "ON DELETE SET NULL",
  "ordys_receive_asaas_billing_webhook",
  "ordys_process_asaas_billing_webhook",
  "ordys_billing_schema_status",
]);

requireIncludes(migrationPaths[10], migrations.get(migrationPaths[10]), [
  "ignored_unlinked_payment",
  "v_payment ->> 'externalReference'",
  "'externalReference', NULLIF(v_payment ->> 'externalReference', '')",
  "error_code = 'payment_subscription_unmatched'",
]);
requireIncludes(migrationPaths[11], migrations.get(migrationPaths[11]), [
  "CREATE OR REPLACE FUNCTION public.ordys_apply_asaas_billing_event",
  "ignored_unlinked_payment",
  "v_payment ->> 'externalReference'",
  "error_code = 'payment_subscription_unmatched'",
]);

requireIncludes(migrationPaths[11], migrations.get(migrationPaths[11]), [
  "CREATE OR REPLACE FUNCTION public.ordys_requeue_asaas_billing_webhook_retries(",
  "FOR UPDATE OF event, inbox SKIP LOCKED",
  "p_limit > 5",
  "ordys_billing_webhook_retry_ready_idx",
  "ordys_billing_webhook_inbox_worker_pending_idx",
  "REVOKE ALL ON FUNCTION public.ordys_requeue_asaas_billing_webhook_retries(INTEGER)",
  "GRANT EXECUTE ON FUNCTION public.ordys_requeue_asaas_billing_webhook_retries(INTEGER)",
]);

const cronMigration = migrations.get(migrationPaths[12]);
const deletionFunctionStart = cronMigration.indexOf("CREATE OR REPLACE FUNCTION public.delete_own_data()");
const deletionFunctionEnd = cronMigration.indexOf(
  "GRANT EXECUTE ON FUNCTION public.delete_own_data() TO authenticated;",
  deletionFunctionStart,
);
if (deletionFunctionStart < 0 || deletionFunctionEnd < 0) {
  throw new Error("The final delete_own_data definition must be versioned with the core schema status.");
}
const guardedDeletionFunction = cronMigration.slice(deletionFunctionStart, deletionFunctionEnd);
requireIncludes(migrationPaths[12], guardedDeletionFunction, [
  "public.ordys_billing_core_schema_status()",
  "ordys_has_unreconciled_billing_events(uid)",
  "ordys_account_deletion_reservations",
  "processing_until > now()",
]);
if (guardedDeletionFunction.includes("public.ordys_billing_schema_status()")) {
  throw new Error("delete_own_data must not depend on the operational cron worker heartbeat");
}

requireIncludes(migrationPaths[12], migrations.get(migrationPaths[12]), [
  "CREATE OR REPLACE FUNCTION public.ordys_billing_core_schema_status()",
  "ordys_billing_schema_status_before_asaas_cron_worker()",
  "REVOKE ALL ON FUNCTION public.ordys_billing_core_schema_status()",
  "GRANT EXECUTE ON FUNCTION public.ordys_billing_core_schema_status()",
]);

const cronMigrationForDeletion = migrations.get(migrationPaths[12]);
const finalDeleteDefinitionStart = cronMigrationForDeletion.indexOf("CREATE OR REPLACE FUNCTION public.delete_own_data()");
const finalDeleteDefinitionEnd = cronMigrationForDeletion.indexOf(
  "GRANT EXECUTE ON FUNCTION public.delete_own_data() TO authenticated;",
  finalDeleteDefinitionStart,
);
if (finalDeleteDefinitionStart < 0 || finalDeleteDefinitionEnd < 0) {
  throw new Error("The final SQL delete_own_data definition is missing from the cron worker migration");
}
const finalDeleteDefinition = cronMigrationForDeletion.slice(finalDeleteDefinitionStart, finalDeleteDefinitionEnd);
requireIncludes(migrationPaths[12], finalDeleteDefinition, [
  "public.ordys_billing_core_schema_status()",
  "ordys_has_unreconciled_billing_events(uid)",
  "processing_until > now()",
]);
if (finalDeleteDefinition.includes("public.ordys_billing_schema_status()")) {
  throw new Error("Direct data deletion must not depend on cron worker liveness");
}
requireIncludes(migrationPaths[12], migrations.get(migrationPaths[12]), [
  "CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog",
  "CREATE OR REPLACE FUNCTION public.ordys_process_next_asaas_billing_webhook(",
  "ordys_requeue_asaas_billing_webhook_retries(1)",
  "FOR UPDATE SKIP LOCKED",
  "ordys_process_asaas_billing_webhook",
  "to_regclass('cron.job') IS NOT NULL",
  "to_regclass('cron.job_run_details') IS NOT NULL",
  "ordys-asaas-webhook-worker",
  "scheduled_job.active IS TRUE",
  "scheduled_job.username = 'postgres'",
  "cron.job_run_details AS job_run",
  "latest_run.status = 'succeeded'",
  "latest_run.end_time > now() - INTERVAL '2 minutes'",
  "REVOKE ALL ON FUNCTION public.ordys_process_next_asaas_billing_webhook(TEXT)",
  "GRANT EXECUTE ON FUNCTION public.ordys_process_next_asaas_billing_webhook(TEXT)",
  "ordys_billing_schema_status_before_asaas_cron_worker",
]);

const billingSecurityTestsPath = "tests/ordys-billing-security.test.ts";
const billingSecurityTests = requireFile(billingSecurityTestsPath);
requireIncludes(billingSecurityTestsPath, billingSecurityTests, [
  '"ordys_requeue_asaas_billing_webhook_retries"',
  '"ordys_process_next_asaas_billing_webhook"',
  '"ordys_billing_core_schema_status"',
  "{ p_limit: 0 }",
  "{ p_event_id: internalProbeEventId }",
  'expect(await response.json()).toBe("partial")',
]);

const cronRunbookPaths = [
  "docs/BILLING-ASAS.md",
  "docs/ORDYS-FIRST-RELEASE-BLOCKER-MANIFEST.md",
];
for (const path of cronRunbookPaths) {
  const runbook = requireFile(path);
  requireIncludes(path, runbook, [
    "'DELETE FROM cron.job_run_details WHERE end_time < now() - INTERVAL ''7 days'';'",
  ]);
  if (runbook.includes("$DELETE FROM cron.job_run_details")) {
    throw new Error(`Invalid dollar-quoted cron cleanup command in ${path}`);
  }
}

const webhookPath = "supabase/functions/ordys-billing-webhook/index.ts";
const webhook = requireFile(webhookPath);
requireIncludes(webhookPath, webhook, [
  "rpc/ordys_billing_schema_status",
  "rpc/ordys_receive_asaas_billing_webhook",
  'if (schemaStatus !== "ready")',
  'return billingResponse({ error: "O processamento financeiro ainda não está disponível." }, 503)',
  "serviceRestWithDeadline",
]);
const schemaReadinessCheckPosition = webhook.indexOf("rpc/ordys_billing_schema_status");
const durableReceiptPosition = webhook.indexOf("rpc/ordys_receive_asaas_billing_webhook");
if (schemaReadinessCheckPosition < 0 || durableReceiptPosition < 0 || schemaReadinessCheckPosition > durableReceiptPosition) {
  throw new Error("Asaas worker readiness must be checked before committing/acknowledging a webhook receipt");
}
if (webhook.includes("rpc/ordys_process_asaas_billing_webhook")) {
  throw new Error("HTTP webhook handler must persist the receipt, not process the financial event inline");
}

for (const obsoleteWorkerPath of [
  "src/lib/server/asaas-webhook-worker.ts",
  "src/routes/api/ordys-asaas-webhook-worker.ts",
]) {
  if (existsSync(resolve(process.cwd(), obsoleteWorkerPath))) {
    throw new Error(`HTTP worker path must not be used for the SQL-only Asaas queue: ${obsoleteWorkerPath}`);
  }
}

const sharedBillingPath = "supabase/functions/_shared/ordys-billing.ts";
const sharedBilling = requireFile(sharedBillingPath);
requireIncludes(sharedBillingPath, sharedBilling, [
  "export async function getBillingSchemaStatus()",
  "const schemaStatus = await getBillingSchemaStatus()",
  'if (schemaStatus !== "ready")',
  "if (await getBillingSchemaStatus() !== \"ready\") return false",
]);

const plusEligibilityTestPath = "tests/ordys-billing-eligibility.test.ts";
const plusEligibilityTests = requireFile(plusEligibilityTestPath);
requireIncludes(plusEligibilityTestPath, plusEligibilityTests, [
  "fails closed and does not query subscription eligibility while the worker is partial",
  "checks the payment ledger only after the webhook worker reports ready",
]);

const sharedBillingTestsPath = "tests/ordys-billing-shared.test.ts";
const sharedBillingTests = requireFile(sharedBillingTestsPath);
requireIncludes(sharedBillingTestsPath, sharedBillingTests, [
  "checks worker readiness before returning the explicit subscription eligibility result",
  "aborts a stalled subscription entitlement request after worker readiness succeeds",
  "/rpc/ordys_billing_schema_status",
  "expect(fetchMock).toHaveBeenCalledTimes(2)",
]);

const billingStatusPath = "supabase/functions/ordys-billing-status/index.ts";
const billingStatus = requireFile(billingStatusPath);
requireIncludes(billingStatusPath, billingStatus, [
  "getBillingSchemaStatus",
  "const schemaReady = await getBillingSchemaStatus() === \"ready\"",
  "const billingEnabled = schemaReady &&",
  "hasAccess: schemaReady && hasAccess",
]);

const accountDeleteEdgeTestPath = "tests/ordys-delete-account-edge.test.ts";
const accountDeleteEdgeTests = requireFile(accountDeleteEdgeTestPath);
requireIncludes(accountDeleteEdgeTestPath, accountDeleteEdgeTests, [
  "does not depend on the cron worker heartbeat when the core billing schema is ready",
  "rpc/ordys_billing_core_schema_status",
  "rpc/ordys_billing_schema_status",
]);

const accountDeleteIntegrationPath = "tests/ordys-billing-webhook.integration.test.ts";
const accountDeleteIntegration = requireFile(accountDeleteIntegrationPath);
requireIncludes(accountDeleteIntegrationPath, accountDeleteIntegration, [
  "allows direct deletion when cron is offline but the core billing schema is ready and the account has no billing history",
  "rpc/ordys_billing_core_schema_status",
  "rpc/ordys_billing_schema_status",
  "ignora %s avulso sem vínculo com contas ou Checkouts do Ordys",
  "quarentena pagamento sem subscription quando externalReference aponta para um Checkout Ordys",
]);

const webhookTestPath = "tests/ordys-billing-webhook-handler.test.ts";
const webhookTests = requireFile(webhookTestPath);
requireIncludes(webhookTestPath, webhookTests, [
  "does not acknowledge a webhook while the SQL worker is not ready",
  "does not acknowledge a webhook when schema readiness cannot be checked",
  "schemaStatus: \"partial\"",
]);

const checkoutPath = "supabase/functions/ordys-billing-checkout/index.ts";
const checkout = requireFile(checkoutPath);
requireIncludes(checkoutPath, checkout, [
  "assertBillingEnabled",
  "rpc/ordys_begin_billing_checkout_attempt",
  "checkout_reconciliation_required",
  "providerOutcomeUnknown",
]);

const managePath = "supabase/functions/ordys-billing-manage/index.ts";
const manage = requireFile(managePath);
requireIncludes(managePath, manage, [
  "rpc/ordys_confirm_subscription_cancellation",
  "claimOrdysSubscriptionCancellation",
]);

const deletionPath = "supabase/functions/ordys-delete-account/index.ts";
const deletion = requireFile(deletionPath);
requireIncludes(deletionPath, deletion, [
  "cancelOrdysBillingBeforeAccountDeletion",
  "ordys_billing_core_schema_status",
]);

const deletionBillingPath = "supabase/functions/_shared/ordys-delete-account-billing.ts";
const deletionBilling = requireFile(deletionBillingPath);
requireIncludes(deletionBillingPath, deletionBilling, [
  "rpc/ordys_reserve_account_deletion",
  "rpc/ordys_claim_account_deletion_processing",
  "rpc/ordys_release_account_deletion_processing",
]);

const accountPagePath = "src/routes/excluir-conta.tsx";
const accountPage = requireFile(accountPagePath);
requireIncludes(accountPagePath, accountPage, [
  "isConfirmedAccountDeletionResponse",
  "checkoutCreationInProgress",
  "accountDeletionPartial",
]);

const workflowPath = ".github/workflows/deploy-ordys-assistant.yml";
const workflow = requireFile(workflowPath);
requireIncludes(workflowPath, workflow, [
  "required_lifecycle_migrations=",
  "20261103010000",
  "20261105060000",
  "20261111010000",
  "20261112010000",
  "billing_lifecycle_lock.outputs.ready == 'true'",
  "Supabase migration list columns are LOCAL | REMOTE | TIME; field $2 is REMOTE.",
  "awk -F '│' -v version=\"$migration_version\" '$2 ~ version",
]);

for (const path of [
  "tests/ordys-billing-checkout-handler.test.ts",
  "tests/ordys-billing-manage.test.ts",
  "tests/ordys-billing-webhook-handler.test.ts",
  "tests/ordys-billing-eligibility.test.ts",
  "tests/ordys-billing-shared.test.ts",
  "tests/ordys-billing-webhook.integration.test.ts",
  "tests/ordys-checkout-cancellation-claim.test.ts",
  "tests/ordys-subscription-cancellation-claim.test.ts",
  "tests/ordys-delete-account-edge.test.ts",
  "tests/ordys-asaas-db-worker.integration.test.ts",
]) requireFile(path);

console.log("Ordys Asaas billing static checks passed.");
