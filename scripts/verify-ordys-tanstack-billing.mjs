import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  findUnsafePublicDefaultPrivileges,
  findUnsafePublicTableGrants,
} from "./lib/migration-grant-audit.mjs";

const failures = [];
const read = (path) => {
  if (!existsSync(path)) {
    failures.push(`Required file is missing: ${path}`);
    return "";
  }
  return readFileSync(path, "utf8");
};
const requireIncludes = (path, source, fragments) => {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      failures.push(`${path} does not contain required contract: ${fragment}`);
    }
  }
};
const requireAbsent = (path, source, fragments) => {
  for (const fragment of fragments) {
    if (source.includes(fragment)) {
      failures.push(`${path} contains a forbidden contract: ${fragment}`);
    }
  }
};

// Audit the current public/Lovable TanStack runtime, not the private Android
// release workflow. The latter belongs to the separate private repository.
const routes = [
  ["src/routes/api/asaas/checkout.ts", 'createFileRoute("/api/asaas/checkout")', "handleCheckout(request)"],
  ["src/routes/api/asaas/status.ts", 'createFileRoute("/api/asaas/status")', "handleStatus(request)"],
  ["src/routes/api/asaas/manage.ts", 'createFileRoute("/api/asaas/manage")', "handleManage(request)"],
  ["src/routes/api/asaas/delete-account.ts", 'createFileRoute("/api/asaas/delete-account")', "handleDeleteAccount(request)"],
  ["src/routes/api/public/asaas/webhook.ts", 'createFileRoute("/api/public/asaas/webhook")', "handleWebhook(request)"],
];
for (const [path, ...fragments] of routes) {
  requireIncludes(path, read(path), fragments);
}

const profilePath = "src/routes/perfil.tsx";
const profile = read(profilePath);
requireIncludes(profilePath, profile, [
  'requestOrdysAsaasApi<BillingOverview>("/api/asaas/status"',
  '}>("/api/asaas/checkout"',
  '}>("/api/asaas/manage"',
  "billingOverview?.enabled && billingOverview.plans.length",
  'billingOverview?.enabled === false',
]);
requireAbsent(profilePath, profile, [
  'supabase.functions.invoke("ordys-billing-status"',
  'supabase.functions.invoke("ordys-billing-checkout"',
  'supabase.functions.invoke("ordys-billing-manage"',
]);

const accountPagePath = "src/routes/excluir-conta.tsx";
const accountPage = read(accountPagePath);
requireIncludes(accountPagePath, accountPage, [
  'requestOrdysAsaasApi<{ deleted?: boolean }>("/api/asaas/delete-account"',
]);
requireAbsent(accountPagePath, accountPage, [
  'supabase.functions.invoke("ordys-delete-account"',
]);

const billingSharedPath = "src/lib/asaas/ordys-billing.server.ts";
const billingShared = read(billingSharedPath);
requireIncludes(billingSharedPath, billingShared, [
  'serviceRest("rpc/ordys_billing_schema_status"',
  'serviceRest("rpc/ordys_billing_core_schema_status"',
  "export async function assertBillingEnabled(): Promise<void>",
  "age assurance #323 pendente",
  "export async function isOrdysPlusEligible(_userId: string): Promise<boolean>",
  "return false;",
]);

const checkoutPath = "src/lib/asaas/checkout.server.ts";
const checkout = read(checkoutPath);
requireIncludes(checkoutPath, checkout, [
  "authenticateBillingRequest",
  "await assertBillingEnabled();",
  "assertAsaasConfigured();",
  "ordys_billing_checkout_attempts",
  "ordys_billing_plans",
  "billingResponse",
]);

const statusPath = "src/lib/asaas/status.server.ts";
const status = read(statusPath);
requireIncludes(statusPath, status, [
  "getBillingSchemaStatus",
  'const billingEnabled = false;',
  "hasAccess: false",
  "ordys_billing_subscriptions",
  "ordys_billing_payments",
]);

const managePath = "src/lib/asaas/manage.server.ts";
const manage = read(managePath);
requireIncludes(managePath, manage, [
  "claimOrdysSubscriptionCancellation",
  "rpc/ordys_confirm_subscription_cancellation",
  "cancellation_requested_at",
  "assertAsaasConfigured();",
]);

const deletePath = "src/lib/asaas/delete-account.server.ts";
const deleteAccount = read(deletePath);
requireIncludes(deletePath, deleteAccount, [
  "getBillingCoreSchemaStatus",
  "cancelOrdysBillingBeforeAccountDeletion",
  "releaseOrdysAccountDeletionProcessing",
  "ordys_claim_account_deletion_processing",
  "account_data_deletion_unconfirmed",
]);

const webhookPath = "src/lib/asaas/webhook.server.ts";
const webhook = read(webhookPath);
requireIncludes(webhookPath, webhook, [
  'request.headers.get("asaas-access-token")',
  "expectedToken.length < 32",
  "expectedToken.length > 255",
  "constantTimeEqual(expectedToken, receivedToken)",
  "WEBHOOK_RECEIPT_DATABASE_DEADLINE_MS",
  '"rpc/ordys_billing_core_schema_status"',
  '"rpc/ordys_receive_asaas_billing_webhook"',
  "queued: true",
  "processed: false",
]);
requireAbsent(webhookPath, webhook, [
  '"rpc/ordys_billing_schema_status"',
  '"rpc/ordys_process_asaas_billing_webhook"',
]);

const webhookTestsPath = "tests/asaas-webhook-handler.test.ts";
const webhookTests = read(webhookTestsPath);
requireIncludes(webhookTestsPath, webhookTests, [
  "acknowledges only after the durable inbox receipt commits",
  "does not couple receipt acknowledgement to cron worker liveness",
  "does not persist a receipt when the structural billing schema is partial",
  "does not persist a receipt when structural readiness cannot be checked",
  "returns HTTP 500 when the durable receipt cannot be committed",
  "rejects an invalid webhook token without querying the database",
]);

const routeTestsPath = "tests/asaas-route-wiring.test.ts";
const routeTests = read(routeTestsPath);
requireIncludes(routeTestsPath, routeTests, [
  "routes subscription status, checkout and cancellation through the server API",
  "publishes the provider webhook through the public TanStack server route",
  "routes account deletion through the billing-aware server endpoint",
]);

const webhookPgtapPath = "supabase/tests/ordys_asaas_webhook_inbox_test.sql";
const webhookPgtap = read(webhookPgtapPath);
const pgTapAssertions = (webhookPgtap.match(/^\s*SELECT\s+(?:is|ok|throws_ok)\s*\(/gim) ?? []).length;
if (!webhookPgtap.includes("SELECT plan(18);") || pgTapAssertions !== 18) {
  failures.push(
    `${webhookPgtapPath} must declare and contain exactly 18 pgTAP assertions (found ${pgTapAssertions})`,
  );
}
requireIncludes(webhookPgtapPath, webhookPgtap, [
  "public.ordys_billing_core_schema_status()",
  "public.ordys_billing_schema_status()",
  "public.ordys_receive_asaas_billing_webhook(jsonb)",
  "public.ordys_process_next_asaas_billing_webhook(text)",
  "evt_ordys_pgtap_receipt_001",
  "evt_ordys_pgtap_conflict_001",
  "event_id_payload_mismatch",
  "durably admitted as received while the worker is offline",
  "anonymous and authenticated clients cannot write durable Asaas receipts",
  "the SQL worker processes the exact durable receipt without an HTTP request",
]);

const migrationPaths = [
  "supabase/migrations/20261029232950_ordys_billing_schema_status.sql",
  "supabase/migrations/20261031010000_ordys_plus_billing_foundation.sql",
  "supabase/migrations/20261031040000_harden_public_default_privileges.sql",
  "supabase/migrations/20261102010000_revoke_excess_client_table_privileges.sql",
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
const migrationSources = new Map(
  migrationPaths.map((path) => [path, read(path)]),
);
const allMigrationSources = readdirSync("supabase/migrations")
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort()
  .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"));
const completeMigrationText = allMigrationSources.join("\n");

for (const [path, source] of migrationSources) {
  if (!source.trim()) failures.push(`Required migration is empty: ${path}`);
}
for (const source of allMigrationSources) {
  for (const finding of findUnsafePublicTableGrants(source)) {
    failures.push(`Unsafe public table grant found: ${finding.statement}`);
  }
  for (const finding of findUnsafePublicDefaultPrivileges(source)) {
    failures.push(
      `Unsafe public default ${finding.objectType} grant found: ${finding.statement}`,
    );
  }
}

const createdPublicTables = new Map();
for (const source of allMigrationSources) {
  for (const match of source.matchAll(
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)/gi,
  )) {
    if (!createdPublicTables.has(match[1])) {
      createdPublicTables.set(match[1], match[0]);
    }
  }
}
for (const table of createdPublicTables.keys()) {
  const tableTarget = `(?:TABLE\\s+)?public\\.${table}\\b`;
  const serviceRoleGrant = new RegExp(
    `\\bGRANT\\s+(?:ALL|[A-Z]+(?:\\s*,\\s*[A-Z]+)*)\\s+ON\\s+${tableTarget}\\s+TO\\s+service_role\\s*;`,
    "i",
  ).test(completeMigrationText);
  const anonymousGrant = new RegExp(
    `\\bGRANT\\b[^;]*\\bON\\s+${tableTarget}\\s+TO\\s+anon\\b`,
    "i",
  ).test(completeMigrationText);
  const clientRolesRevoked = new RegExp(
    `\\bREVOKE\\s+ALL\\s+ON\\s+${tableTarget}\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
    "i",
  ).test(completeMigrationText);
  const rlsEnabled = new RegExp(
    `\\bALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`,
    "i",
  ).test(completeMigrationText);
  if (!serviceRoleGrant) failures.push(`public.${table} lacks explicit service_role grant`);
  if (anonymousGrant) failures.push(`public.${table} grants direct access to anon`);
  if (!rlsEnabled) failures.push(`public.${table} does not enable RLS`);
  if (!clientRolesRevoked) {
    const authenticatedGrant = new RegExp(
      `\\bGRANT\\s+(?:ALL|SELECT\\s*,\\s*INSERT\\s*,\\s*UPDATE\\s*,\\s*DELETE)\\s+ON\\s+${tableTarget}\\s+TO\\s+authenticated\\s*;`,
      "i",
    ).test(completeMigrationText);
    const policy = new RegExp(
      `\\bCREATE\\s+POLICY\\b[^;]*\\bON\\s+public\\.${table}\\b[^;]*;`,
      "gi",
    );
    const ownerColumn = table === "profiles" ? "id" : "user_id";
    const ownerPolicy = [...completeMigrationText.matchAll(policy)].some(([statement]) => {
      const ownerPredicate = new RegExp(
        `\\bauth\\.uid\\s*\\(\\s*\\)\\s*=\\s*${ownerColumn}\\b`,
        "i",
      );
      const usingClause = statement.match(/\\bUSING\\s*\\([\\s\\S]*$/i)?.[0] ?? "";
      const checkClause = statement.match(/\\bWITH\\s+CHECK\\s*\\([\\s\\S]*$/i)?.[0] ?? "";
      return (
        /\\bTO\\s+authenticated\\b/i.test(statement) &&
        ownerPredicate.test(usingClause) &&
        ownerPredicate.test(checkClause)
      );
    });
    if (!authenticatedGrant) failures.push(`public.${table} lacks explicit authenticated CRUD grant`);
    if (!ownerPolicy) failures.push(`public.${table} lacks owner-scoped authenticated policy`);
  }
}

const cronMigrationPath = "supabase/migrations/20261112010000_ordys_asaas_cron_worker.sql";
const cronMigration = migrationSources.get(cronMigrationPath) ?? "";
requireIncludes(cronMigrationPath, cronMigration, [
  "CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog",
  "CREATE OR REPLACE FUNCTION public.ordys_process_next_asaas_billing_webhook",
  "ordys-asaas-webhook-worker",
  "scheduled_job.active IS TRUE",
  "scheduled_job.username = 'postgres'",
  "latest_run.status = 'succeeded'",
  "latest_run.end_time > now() - INTERVAL '2 minutes'",
  "CREATE OR REPLACE FUNCTION public.ordys_billing_core_schema_status()",
  "GRANT EXECUTE ON FUNCTION public.ordys_billing_schema_status()",
  "GRANT EXECUTE ON FUNCTION public.ordys_billing_core_schema_status()",
]);
requireAbsent(cronMigrationPath, cronMigration, ["cron.schedule("]);

const structuralAclPath = "supabase/migrations/20261102010000_revoke_excess_client_table_privileges.sql";
requireIncludes(structuralAclPath, migrationSources.get(structuralAclPath) ?? "", [
  "REVOKE TRUNCATE, REFERENCES, TRIGGER",
  "FROM PUBLIC, anon, authenticated",
]);

const defaultAclPath = "supabase/migrations/20261031040000_harden_public_default_privileges.sql";
requireIncludes(defaultAclPath, migrationSources.get(defaultAclPath) ?? "", [
  "ALTER DEFAULT PRIVILEGES FOR ROLE postgres",
  "REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
  "REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated",
  "REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated",
]);

const docsPath = "docs/BILLING-ASAS.md";
const billingDocs = read(docsPath);
requireIncludes(docsPath, billingDocs, [
  "src/lib/asaas/webhook.server.ts",
  "src/routes/api/public/asaas/webhook.ts",
  "ordys_billing_core_schema_status()",
  "não depende da saúde operacional do cron",
  "HTTP 200 somente depois que a transação de recepção confirmou o registro",
  "Asaas Sandbox",
  "CI verde em banco descartável não equivale a produção pronta",
]);

if (failures.length) {
  console.error("ORDYS TanStack billing static verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `ORDYS TanStack billing static verification passed: ${routes.length} routes, ${migrationPaths.length} required migrations, ${createdPublicTables.size} public tables and ${pgTapAssertions} Asaas inbox pgTAP assertions.`,
  );
}
