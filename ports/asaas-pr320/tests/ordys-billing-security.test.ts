import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"] ?? "";
const KEY =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  "";
const SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const testRunId = crypto.randomUUID().replaceAll("-", "");
const internalProbeEventId = `evt_ordys_internal_acl_${testRunId}`;

const TABLES = [
  "ordys_billing_settings",
  "ordys_billing_plans",
  "ordys_billing_checkout_attempts",
  "ordys_billing_subscriptions",
  "ordys_billing_payments",
  "ordys_billing_webhook_events",
  "ordys_account_deletion_reservations",
  "ordys_billing_webhook_inbox",
];

const INTERNAL_RPCS = [
  ["get_ordys_billing_plans", {}],
  ["get_my_ordys_billing_status", {}],
  ["consume_usage_limit", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_kind: "direct-client-attempt",
    p_hourly_limit: 2,
    p_daily_limit: 4,
  }],
  ["is_ordys_plus_eligible", { p_user_id: "00000000-0000-0000-0000-000000000001" }],
  ["ordys_billing_schema_status", {}],
  ["ordys_billing_core_schema_status", {}],
  ["ordys_has_unreconciled_billing_events", { p_user_id: "00000000-0000-0000-0000-000000000001" }],
  ["ordys_finalize_billing_checkout_attempt", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_attempt_id: "00000000-0000-0000-0000-000000000002",
    p_provider_checkout_id: "chk_ordys_security_anon",
    p_checkout_url: "https://asaas.com/checkoutSession/show?id=chk_ordys_security_anon",
  }],
  ["ordys_has_unreconciled_billing_events_except", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_allowed_checkout_reference: "ordys_security_anon",
    p_allowed_provider_checkout_id: "chk_ordys_security_anon",
  }],
  ["ordys_begin_billing_checkout_attempt", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_attempt_id: "00000000-0000-0000-0000-000000000002",
    p_plan_code: "plus_monthly",
    p_external_reference: "ordys_test_internal",
    p_amount_cents: 5990,
    p_expires_at: "2026-11-03T12:00:00.000Z",
  }],
  ["ordys_reserve_account_deletion", { p_user_id: "00000000-0000-0000-0000-000000000001" }],
  ["ordys_release_account_deletion_reservation", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_provider_state_verified: true,
  }],
  ["ordys_claim_account_deletion_processing", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_processing_token: "00000000-0000-0000-0000-000000000003",
  }],
  ["ordys_release_account_deletion_processing", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_processing_token: "00000000-0000-0000-0000-000000000003",
  }],
  ["ordys_confirm_subscription_cancellation", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_subscription_id: "00000000-0000-0000-0000-000000000004",
    p_cancellation_requested_at: "2026-11-03T12:00:00.000Z",
  }],
  ["ordys_process_next_asaas_billing_webhook", {}],
] as const;

const AUTHENTICATED_INTERNAL_RPCS = [
  ["process_ordys_asaas_billing_event", {
    p_event: { id: internalProbeEventId, event: "PAYMENT_CREATED" },
  }],
  ["ordys_billing_schema_status", {}],
  ["ordys_billing_core_schema_status", {}],
  ["ordys_has_unreconciled_billing_events", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
  }],
  ["ordys_begin_billing_checkout_attempt", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_attempt_id: "00000000-0000-0000-0000-000000000002",
    p_plan_code: "plus_monthly",
    p_external_reference: "ordys_security_auth",
    p_amount_cents: 5990,
    p_expires_at: "2026-11-03T12:00:00.000Z",
  }],
  ["ordys_reserve_account_deletion", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
  }],
  ["ordys_release_account_deletion_reservation", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_provider_state_verified: true,
  }],
  ["ordys_claim_account_deletion_processing", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_processing_token: "00000000-0000-0000-0000-000000000003",
  }],
  ["ordys_release_account_deletion_processing", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_processing_token: "00000000-0000-0000-0000-000000000003",
  }],
  ["ordys_confirm_subscription_cancellation", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_subscription_id: "00000000-0000-0000-0000-000000000004",
    p_cancellation_requested_at: "2026-11-03T12:00:00.000Z",
  }],
  ["ordys_receive_asaas_billing_webhook", {
    p_event: { id: internalProbeEventId, event: "PAYMENT_CREATED" },
  }],
  ["ordys_process_asaas_billing_webhook", {
    p_event_id: internalProbeEventId,
  }],
  ["ordys_apply_asaas_billing_event", {
    p_event: { id: internalProbeEventId, event: "PAYMENT_CREATED" },
  }],
  // Use an invalid batch size so a permission regression cannot requeue real events.
  ["ordys_requeue_asaas_billing_webhook_retries", { p_limit: 0 }],
  ["ordys_process_next_asaas_billing_webhook", { p_event_id: internalProbeEventId }],
  ["ordys_finalize_billing_checkout_attempt", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_attempt_id: "00000000-0000-0000-0000-000000000002",
    p_provider_checkout_id: "chk_ordys_security_auth",
    p_checkout_url: "https://asaas.com/checkoutSession/show?id=chk_ordys_security_auth",
  }],
  ["ordys_has_unreconciled_billing_events_except", {
    p_user_id: "00000000-0000-0000-0000-000000000001",
    p_allowed_checkout_reference: "ordys_security_auth",
    p_allowed_provider_checkout_id: "chk_ordys_security_auth",
  }],
] as const;

function api(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

const enabled = Boolean(URL && KEY);

describe.runIf(enabled)("proteção das tabelas e funções financeiras do Ordys", () => {
  it.each(TABLES)("não permite leitura anônima de public.%s", async (table) => {
    const result = await api(`${table}?select=*&limit=1`);
    if (result.ok) {
      expect((await result.json()) as unknown[]).toHaveLength(0);
    } else {
      expect([401, 403, 404]).toContain(result.status);
    }
  });

  it.each(TABLES)("não permite escrita anônima em public.%s", async (table) => {
    const result = await api(table, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(result.ok).toBe(false);
  });

  it.each(INTERNAL_RPCS)("não expõe o RPC interno %s para anon", async (name, body) => {
    const result = await api(`rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(result.ok).toBe(false);
  });
});


type BillingTestUser = { id: string; accessToken: string };
type TestAuthResponse = { id?: string; access_token?: string; message?: string; msg?: string; error?: string };

const authenticatedTestsEnabled = Boolean(URL && KEY && SERVICE_ROLE_KEY);
let billingUserA: BillingTestUser | null = null;
let billingUserB: BillingTestUser | null = null;
let billingUserC: BillingTestUser | null = null;
let billingUserD: BillingTestUser | null = null;
let billingUserE: BillingTestUser | null = null;

function serviceHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function serviceApi(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...(init.headers ?? {}) },
  });
}

async function cleanupUserBillingRows(userId: string) {
  for (const table of [
    "ordys_billing_payments",
    "ordys_billing_subscriptions",
    "ordys_billing_checkout_attempts",
  ]) {
    await serviceApi(
      `${table}?user_id=eq.${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ).catch(() => undefined);
  }
}

async function cleanupWebhookProbeEvent(eventId: string) {
  for (const table of ["ordys_billing_webhook_inbox", "ordys_billing_webhook_events"]) {
    const response = await serviceApi(
      `${table}?provider_event_id=eq.${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(`Falha ao limpar o evento de teste em public.${table}: ${await response.text()}`);
    }
  }
}

async function createBillingTestUser(label: string): Promise<BillingTestUser> {
  const email = `ordys-billing-security-${label}-${testRunId}@example.invalid`;
  const password = `Ordys-Security-${label}-${testRunId}-A9!`;
  const created = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `ORDYS billing security ${label}` },
    }),
  });
  const createdBody = (await created.json().catch(() => ({}))) as TestAuthResponse;
  if (!created.ok || !createdBody.id) {
    throw new Error(
      `Falha ao criar usuário de segurança ${label}: HTTP ${created.status} ${createdBody.message ?? createdBody.msg ?? createdBody.error ?? ""}`,
    );
  }

  const signedIn = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = (await signedIn.json().catch(() => ({}))) as TestAuthResponse;
  if (!signedIn.ok || !session.access_token) {
    await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(createdBody.id)}`, {
      method: "DELETE",
      headers: serviceHeaders(),
    });
    throw new Error(
      `Falha ao autenticar usuário de segurança ${label}: HTTP ${signedIn.status} ${session.message ?? session.msg ?? session.error ?? ""}`,
    );
  }
  return { id: createdBody.id, accessToken: session.access_token };
}

function authenticatedApi(user: BillingTestUser, path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${user.accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe.runIf(authenticatedTestsEnabled)("isolamento de cobrança para usuários autenticados", () => {
  beforeAll(async () => {
    billingUserA = await createBillingTestUser("a");
    billingUserB = await createBillingTestUser("b");
    billingUserC = await createBillingTestUser("c");
    billingUserD = await createBillingTestUser("d");
    billingUserE = await createBillingTestUser("e");

    const seeded = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: billingUserB.id,
        plan_code: "plus_monthly",
        provider_subscription_id: `sub_ordys_billing_security_${testRunId}`,
        provider_customer_id: `cus_ordys_billing_security_${testRunId}`,
        status: "active",
        billing_cycle: "MONTHLY",
        billing_type: "CREDIT_CARD",
        amount_cents: 5_990,
        currency: "BRL",
        current_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
    const seededBody = await seeded.text();
    expect(seeded.ok, seededBody).toBe(true);
  }, 30_000);

  afterAll(async () => {
    for (const user of [billingUserA, billingUserB, billingUserC, billingUserD, billingUserE]) {
      if (!user) continue;
      await cleanupUserBillingRows(user.id);
      await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: serviceHeaders(),
      }).catch(() => undefined);
    }
  }, 30_000);

  it.each(TABLES)("não permite SELECT autenticado direto em public.%s", async (table) => {
    const response = await authenticatedApi(billingUserA!, `${table}?select=*&limit=1`);
    expect(response.ok).toBe(false);
  });

  it.each(TABLES)("não permite INSERT autenticado direto em public.%s", async (table) => {
    const response = await authenticatedApi(billingUserA!, table, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.ok).toBe(false);
  });

  it("bloqueia INSERT válido direto na inbox de webhooks", async () => {
    const eventId = `evt_ordys_acl_probe_${testRunId}`;
    try {
      const response = await authenticatedApi(billingUserA!, "ordys_billing_webhook_inbox", {
        method: "POST",
        body: JSON.stringify({
          provider_event_id: eventId,
          event_type: "PAYMENT_CREATED",
          user_id: billingUserA!.id,
          event_payload: { id: eventId, event: "PAYMENT_CREATED" },
        }),
      });
      expect(response.ok, await response.clone().text()).toBe(false);
    } finally {
      const cleanup = await serviceApi(
        `ordys_billing_webhook_inbox?provider_event_id=eq.${encodeURIComponent(eventId)}`,
        { method: "DELETE" },
      );
      expect(cleanup.ok, await cleanup.clone().text()).toBe(true);
    }
  });

  it.each(AUTHENTICATED_INTERNAL_RPCS)(
    "não expõe o RPC interno %s para anon nem para usuários autenticados",
    async (name, body) => {
      const eventId = internalProbeEventId;
      try {
        const anonymousResponse = await api(`rpc/${name}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        expect([401, 403, 404]).toContain(anonymousResponse.status);

        const authenticatedResponse = await authenticatedApi(billingUserA!, `rpc/${name}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        expect([401, 403, 404]).toContain(authenticatedResponse.status);
      } finally {
        await cleanupWebhookProbeEvent(eventId);
      }
    },
  );

  it("mantém o billing em partial até existir um Job SQL ativo do worker", async () => {
    const response = await serviceApi("rpc/ordys_billing_schema_status", {
      method: "POST",
      body: "{}",
    });
    expect(response.ok, await response.clone().text()).toBe(true);
    // Database reset applies migrations but must not create an active schedule.
    // The deployment gate stays closed until the operator creates the pg_cron job.
    expect(await response.json()).toBe("partial");
  });

  it("rejeita chaves e limites inválidos e serializa o limite de uso por chave exata", async () => {
    const user = await createBillingTestUser("usage-limit");
    const exactKind = "x".repeat(60);
    const overlongKind = "x".repeat(61);

    const callUsageLimit = (kind: string, hourly: number | null, daily: number | null) =>
      serviceApi("rpc/consume_usage_limit", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_kind: kind,
          p_hourly_limit: hourly,
          p_daily_limit: daily,
        }),
      });

    try {
      const overlong = await callUsageLimit(overlongKind, 2, 4);
      expect(overlong.ok, await overlong.clone().text()).toBe(true);
      expect(await overlong.json()).toEqual({
        allowed: false,
        reason: "invalid_kind",
      });

      const nullHourly = await callUsageLimit("usage-null-hourly", null, 4);
      expect(nullHourly.ok, await nullHourly.clone().text()).toBe(true);
      expect(await nullHourly.json()).toEqual({
        allowed: false,
        reason: "invalid_limit",
      });

      const nullDaily = await callUsageLimit("usage-null-daily", 2, null);
      expect(nullDaily.ok, await nullDaily.clone().text()).toBe(true);
      expect(await nullDaily.json()).toEqual({
        allowed: false,
        reason: "invalid_limit",
      });

      const afterInvalidRequests = await serviceApi(
        `usage_events?select=id,kind&user_id=eq.${encodeURIComponent(user.id)}&limit=10`,
      );
      expect(afterInvalidRequests.ok, await afterInvalidRequests.clone().text()).toBe(true);
      expect(await afterInvalidRequests.json()).toEqual([]);

      const concurrent = await Promise.all(
        Array.from({ length: 6 }, () => callUsageLimit(exactKind, 2, 4)),
      );
      for (const response of concurrent) {
        expect(response.ok, await response.clone().text()).toBe(true);
      }
      const results = await Promise.all(concurrent.map((response) => response.json()));
      expect(results.filter((result) => result.allowed === true)).toHaveLength(2);
      expect(results.filter(
        (result) => result.allowed === false && result.reason === "hourly_limit",
      )).toHaveLength(4);

      const stored = await serviceApi(
        `usage_events?select=id,kind&user_id=eq.${encodeURIComponent(user.id)}&kind=eq.${exactKind}&limit=10`,
      );
      expect(stored.ok, await stored.clone().text()).toBe(true);
      const rows = await stored.json() as Array<{ id: string; kind: string }>;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.kind === exactKind)).toBe(true);
    } finally {
      await serviceApi(
        `usage_events?user_id=eq.${encodeURIComponent(user.id)}`,
        { method: "DELETE" },
      ).catch(() => undefined);
      await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: serviceHeaders(),
      }).catch(() => undefined);
    }
  }, 30_000);

  it("bloqueia a exclusão direta quando há SUBSCRIPTION_CREATED sem vínculo local mesmo após o Checkout ficar terminal", async () => {
    const user = await createBillingTestUser("unmatched-subscription-webhook");
    const attemptId = crypto.randomUUID();
    const externalReference = `ordys_unmatched_subscription_${testRunId}`;
    const checkoutId = `chk_ordys_unmatched_subscription_${testRunId}`;
    const customerId = `cus_ordys_unmatched_subscription_${testRunId}`;
    const subscriptionId = `sub_ordys_unmatched_subscription_${testRunId}`;
    const eventId = `evt_ordys_unmatched_subscription_${testRunId}`;
    const processingToken = crypto.randomUUID();

    try {
      const attempt = await serviceApi("ordys_billing_checkout_attempts", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id: attemptId,
          user_id: user.id,
          plan_code: "plus_monthly",
          external_reference: externalReference,
          provider_checkout_id: checkoutId,
          provider_customer_id: null,
          amount_cents: 5_990,
          status: "cancelled",
          expires_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      });
      expect(attempt.ok, await attempt.clone().text()).toBe(true);

      const event = await serviceApi("ordys_billing_webhook_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          provider_event_id: eventId,
          event_type: "SUBSCRIPTION_CREATED",
          provider_object_id: subscriptionId,
          processing_status: "failed",
          error_code: "subscription_checkout_unmatched",
          provider_customer_id: customerId,
          retry_payload: {
            id: eventId,
            event: "SUBSCRIPTION_CREATED",
            subscription: {
              id: subscriptionId,
              customer: customerId,
              externalReference: null,
            },
          },
          processed_at: new Date().toISOString(),
        }),
      });
      expect(event.ok, await event.clone().text()).toBe(true);

      const reservation = await serviceApi("rpc/ordys_reserve_account_deletion", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id }),
      });
      expect(reservation.ok, await reservation.clone().text()).toBe(true);
      expect(await reservation.json()).toBe("reserved");

      const lease = await serviceApi("rpc/ordys_claim_account_deletion_processing", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_processing_token: processingToken,
        }),
      });
      expect(lease.ok, await lease.clone().text()).toBe(true);
      expect(await lease.json()).toBe("claimed");

      const deletion = await authenticatedApi(user, "rpc/delete_own_data", {
        method: "POST",
        body: "{}",
      });
      expect(deletion.ok).toBe(false);
      expect(await deletion.text()).toContain("unmatched provider billing webhook events require reconciliation");

      const stillPresent = await serviceApi(
        `ordys_billing_checkout_attempts?select=id,status&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
      );
      expect(stillPresent.ok, await stillPresent.clone().text()).toBe(true);
      expect(await stillPresent.json()).toEqual([{ id: attemptId, status: "cancelled" }]);
      const stillPresentEvent = await serviceApi(
        `ordys_billing_webhook_events?select=provider_event_id,error_code&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
      );
      expect(stillPresentEvent.ok, await stillPresentEvent.clone().text()).toBe(true);
      expect(await stillPresentEvent.json()).toEqual([{
        provider_event_id: eventId,
        error_code: "subscription_checkout_unmatched",
      }]);

      const manualRelease = await serviceApi("rpc/ordys_release_account_deletion_reservation", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id, p_provider_state_verified: true }),
      });
      expect(manualRelease.ok, await manualRelease.clone().text()).toBe(true);
      expect(await manualRelease.json()).toBe("billing_reconciliation_required");
    } finally {
      // Delete the seeded unresolved event before operator release. The release
      // RPC uses the same guard, so a real unresolved event must keep it blocked.
      await serviceApi(`ordys_billing_webhook_events?provider_event_id=eq.${encodeURIComponent(eventId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      await serviceApi("rpc/ordys_release_account_deletion_processing", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id, p_processing_token: processingToken }),
      }).catch(() => undefined);
      await serviceApi("rpc/ordys_release_account_deletion_reservation", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id, p_provider_state_verified: true }),
      }).catch(() => undefined);
      await serviceApi(`ordys_billing_checkout_attempts?id=eq.${encodeURIComponent(attemptId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      await cleanupUserBillingRows(user.id);
      await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: serviceHeaders(),
      }).catch(() => undefined);
    }
  }, 30_000);

  it("bloqueia globalmente a exclusão enquanto webhooks financeiros sem titular seguem sem conciliação", async () => {
    const user = await createBillingTestUser("orphan-payment-webhook");
    const unknownCustomerId = `cus_ordys_orphan_payment_${testRunId}`;
    const processingToken = crypto.randomUUID();
    const events = [
      {
        provider_event_id: `evt_ordys_orphan_confirmed_${testRunId}`,
        event_type: "PAYMENT_RECEIVED",
        provider_object_id: `pay_ordys_orphan_confirmed_${testRunId}`,
        error_code: "confirmed_payment_unmatched",
        retry_payload: {
          id: `evt_ordys_orphan_confirmed_${testRunId}`,
          event: "PAYMENT_RECEIVED",
          payment: {
            id: `pay_ordys_orphan_confirmed_${testRunId}`,
            subscription: `sub_ordys_orphan_confirmed_${testRunId}`,
            customer: unknownCustomerId,
            value: "59.90",
            billingType: "CREDIT_CARD",
          },
        },
      },
      {
        provider_event_id: `evt_ordys_orphan_negative_${testRunId}`,
        event_type: "PAYMENT_REFUNDED",
        provider_object_id: `pay_ordys_orphan_negative_${testRunId}`,
        error_code: "negative_payment_unmatched",
        retry_payload: {
          id: `evt_ordys_orphan_negative_${testRunId}`,
          event: "PAYMENT_REFUNDED",
          payment: {
            id: `pay_ordys_orphan_negative_${testRunId}`,
            subscription: `sub_ordys_orphan_negative_${testRunId}`,
            customer: unknownCustomerId,
            value: "59.90",
            billingType: "CREDIT_CARD",
          },
        },
      },
      {
        provider_event_id: `evt_ordys_orphan_created_${testRunId}`,
        event_type: "PAYMENT_CREATED",
        provider_object_id: `pay_ordys_orphan_created_${testRunId}`,
        error_code: "payment_subscription_unmatched",
        retry_payload: {
          id: `evt_ordys_orphan_created_${testRunId}`,
          event: "PAYMENT_CREATED",
          payment: {
            id: `pay_ordys_orphan_created_${testRunId}`,
            subscription: `sub_ordys_orphan_created_${testRunId}`,
            customer: unknownCustomerId,
          },
        },
      },
      {
        provider_event_id: `evt_ordys_orphan_deleted_${testRunId}`,
        event_type: "SUBSCRIPTION_DELETED",
        provider_object_id: `sub_ordys_orphan_deleted_${testRunId}`,
        error_code: "subscription_delete_unmatched",
        retry_payload: {
          id: `evt_ordys_orphan_deleted_${testRunId}`,
          event: "SUBSCRIPTION_DELETED",
          subscription: {
            id: `sub_ordys_orphan_deleted_${testRunId}`,
            customer: unknownCustomerId,
          },
        },
      },
      {
        provider_event_id: `evt_ordys_orphan_ambiguous_${testRunId}`,
        event_type: "SUBSCRIPTION_CREATED",
        provider_object_id: `sub_ordys_orphan_ambiguous_${testRunId}`,
        error_code: "ambiguous_customer_association",
        retry_payload: null,
      },
      {
        provider_event_id: `evt_ordys_orphan_subscription_checkout_mismatch_${testRunId}`,
        event_type: "SUBSCRIPTION_CREATED",
        provider_object_id: `sub_ordys_orphan_subscription_checkout_mismatch_${testRunId}`,
        error_code: "subscription_checkout_mismatch",
        retry_payload: null,
      },
      {
        provider_event_id: `evt_ordys_orphan_subscription_customer_mismatch_${testRunId}`,
        event_type: "SUBSCRIPTION_CREATED",
        provider_object_id: `sub_ordys_orphan_subscription_customer_mismatch_${testRunId}`,
        error_code: "subscription_customer_mismatch",
        retry_payload: null,
      },
      {
        provider_event_id: `evt_ordys_orphan_subscription_identity_mismatch_${testRunId}`,
        event_type: "SUBSCRIPTION_CREATED",
        provider_object_id: `sub_ordys_orphan_subscription_identity_mismatch_${testRunId}`,
        error_code: "subscription_identity_mismatch",
        retry_payload: null,
      },
      {
        provider_event_id: `evt_ordys_orphan_subscription_amount_mismatch_${testRunId}`,
        event_type: "SUBSCRIPTION_CREATED",
        provider_object_id: `sub_ordys_orphan_subscription_amount_mismatch_${testRunId}`,
        error_code: "subscription_amount_mismatch",
        retry_payload: null,
      },
      {
        provider_event_id: `evt_ordys_orphan_payment_customer_mismatch_${testRunId}`,
        event_type: "PAYMENT_RECEIVED",
        provider_object_id: `pay_ordys_orphan_payment_customer_mismatch_${testRunId}`,
        error_code: "payment_customer_mismatch",
        retry_payload: null,
      },
      {
        provider_event_id: `evt_ordys_orphan_payment_identity_mismatch_${testRunId}`,
        event_type: "PAYMENT_RECEIVED",
        provider_object_id: `pay_ordys_orphan_payment_identity_mismatch_${testRunId}`,
        error_code: "payment_identity_mismatch",
        retry_payload: null,
      },
      {
        provider_event_id: `evt_ordys_orphan_amount_mismatch_${testRunId}`,
        event_type: "PAYMENT_RECEIVED",
        provider_object_id: `pay_ordys_orphan_amount_mismatch_${testRunId}`,
        error_code: "amount_mismatch",
        retry_payload: null,
      },
      {
        provider_event_id: `evt_ordys_orphan_subscription_checkout_${testRunId}`,
        event_type: "SUBSCRIPTION_CREATED",
        provider_object_id: `sub_ordys_orphan_subscription_checkout_${testRunId}`,
        error_code: "subscription_checkout_unmatched",
        retry_payload: {
          id: `evt_ordys_orphan_subscription_checkout_${testRunId}`,
          event: "SUBSCRIPTION_CREATED",
          subscription: {
            id: `sub_ordys_orphan_subscription_checkout_${testRunId}`,
            customer: unknownCustomerId,
            externalReference: `ordys_orphan_external_${testRunId}`,
          },
        },
      },
      {
        provider_event_id: `evt_ordys_orphan_checkout_customer_mismatch_${testRunId}`,
        event_type: "CHECKOUT_PAID",
        provider_object_id: `chk_ordys_orphan_customer_${testRunId}`,
        error_code: "checkout_customer_mismatch",
        retry_payload: {
          id: `evt_ordys_orphan_checkout_customer_mismatch_${testRunId}`,
          event: "CHECKOUT_PAID",
          checkoutAttemptId: `attempt_ordys_missing_customer_${testRunId}`,
          checkout: {
            id: `chk_ordys_orphan_customer_${testRunId}`,
            customer: unknownCustomerId,
          },
        },
      },
      {
        provider_event_id: `evt_ordys_orphan_checkout_reference_mismatch_${testRunId}`,
        event_type: "CHECKOUT_PAID",
        provider_object_id: `chk_ordys_orphan_reference_${testRunId}`,
        error_code: "checkout_reference_mismatch",
        retry_payload: {
          id: `evt_ordys_orphan_checkout_reference_mismatch_${testRunId}`,
          event: "CHECKOUT_PAID",
          checkoutAttemptId: `attempt_ordys_missing_reference_${testRunId}`,
          checkout: {
            id: `chk_ordys_orphan_reference_${testRunId}`,
            customer: unknownCustomerId,
            externalReference: `ordys_orphan_wrong_reference_${testRunId}`,
          },
        },
      },
      {
        provider_event_id: `evt_ordys_orphan_checkout_paid_after_closed_${testRunId}`,
        event_type: "CHECKOUT_PAID",
        provider_object_id: `chk_ordys_orphan_closed_${testRunId}`,
        error_code: "checkout_paid_after_closed",
        retry_payload: null,
      },
    ];

    try {
      for (const event of events) {
        const inserted = await serviceApi("ordys_billing_webhook_events", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            provider_event_id: event.provider_event_id,
            event_type: event.event_type,
            provider_object_id: event.provider_object_id,
            processing_status: "failed",
            error_code: event.error_code,
            provider_customer_id: event.retry_payload === null ? null : unknownCustomerId,
            retry_payload: event.retry_payload,
            processed_at: new Date().toISOString(),
          }),
        });
        expect(inserted.ok, await inserted.clone().text()).toBe(true);
      }

      const globalGuard = await serviceApi("rpc/ordys_has_unreconciled_billing_events", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id }),
      });
      expect(globalGuard.ok, await globalGuard.clone().text()).toBe(true);
      expect(await globalGuard.json()).toBe(true);

      // The orphan cannot safely be attributed to this account or any other
      // account. Prove the guard is global, not just a false positive for owner.
      const unrelatedAccountGuard = await serviceApi("rpc/ordys_has_unreconciled_billing_events", {
        method: "POST",
        body: JSON.stringify({ p_user_id: billingUserA!.id }),
      });
      expect(unrelatedAccountGuard.ok, await unrelatedAccountGuard.clone().text()).toBe(true);
      expect(await unrelatedAccountGuard.json()).toBe(true);

      const reservation = await serviceApi("rpc/ordys_reserve_account_deletion", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id }),
      });
      expect(reservation.ok, await reservation.clone().text()).toBe(true);
      expect(await reservation.json()).toBe("reserved");

      const lease = await serviceApi("rpc/ordys_claim_account_deletion_processing", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id, p_processing_token: processingToken }),
      });
      expect(lease.ok, await lease.clone().text()).toBe(true);
      expect(await lease.json()).toBe("claimed");

      const deletion = await authenticatedApi(user, "rpc/delete_own_data", {
        method: "POST",
        body: "{}",
      });
      expect(deletion.ok).toBe(false);
      expect(await deletion.text()).toContain("unmatched provider billing webhook events require reconciliation");

      const manualRelease = await serviceApi("rpc/ordys_release_account_deletion_reservation", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id, p_provider_state_verified: true }),
      });
      expect(manualRelease.ok, await manualRelease.clone().text()).toBe(true);
      expect(await manualRelease.json()).toBe("billing_reconciliation_required");
    } finally {
      for (const event of events) {
        await serviceApi(
          `ordys_billing_webhook_events?provider_event_id=eq.${encodeURIComponent(event.provider_event_id)}`,
          { method: "DELETE" },
        ).catch(() => undefined);
      }
      await serviceApi("rpc/ordys_release_account_deletion_processing", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id, p_processing_token: processingToken }),
      }).catch(() => undefined);
      await serviceApi("rpc/ordys_release_account_deletion_reservation", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id, p_provider_state_verified: true }),
      }).catch(() => undefined);
      await cleanupUserBillingRows(user.id);
      await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: serviceHeaders(),
      }).catch(() => undefined);
    }
  }, 30_000);

  it("bloqueia chamada direta a delete_own_data sem lease ativo da exclusão", async () => {
    const response = await authenticatedApi(billingUserA!, "rpc/delete_own_data", {
      method: "POST",
      body: "{}",
    });

    expect(response.ok).toBe(false);
    expect(await response.text()).toContain("billing-aware account deletion is required");
  });

  it("deixa a criação em andamento terminar antes de reservar a exclusão", async () => {
    const user = billingUserC!;
    const attemptId = crypto.randomUUID();
    const externalReference = `ordys_creation_first_${testRunId}`;
    const checkoutId = `chk_ordys_creation_first_${testRunId}`;
    const eventId = `evt_ordys_creation_first_cancel_${testRunId}`;

    const settingsResponse = await serviceApi("ordys_billing_settings?select=billing_enabled&id=eq.1");
    expect(settingsResponse.ok, await settingsResponse.clone().text()).toBe(true);
    const settingsRows = await settingsResponse.json() as Array<{ billing_enabled: boolean }>;
    const planResponse = await serviceApi("ordys_billing_plans?select=enabled,price_cents&plan_code=eq.plus_monthly");
    expect(planResponse.ok, await planResponse.clone().text()).toBe(true);
    const planRows = await planResponse.json() as Array<{ enabled: boolean; price_cents: number | null }>;

    try {
      const enableSettings = await serviceApi("ordys_billing_settings?id=eq.1", {
      method: "PATCH",
      body: JSON.stringify({ billing_enabled: true }),
    });
    expect(enableSettings.ok, await enableSettings.text()).toBe(true);
    const enablePlan = await serviceApi("ordys_billing_plans?plan_code=eq.plus_monthly", {
      method: "PATCH",
      body: JSON.stringify({ enabled: true, price_cents: 5990 }),
    });
    expect(enablePlan.ok, await enablePlan.text()).toBe(true);

      const begin = await serviceApi("rpc/ordys_begin_billing_checkout_attempt", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_attempt_id: attemptId,
          p_plan_code: "plus_monthly",
          p_external_reference: externalReference,
          p_amount_cents: 5990,
          p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(begin.ok, await begin.clone().text()).toBe(true);
      expect(await begin.json()).toBe("created");

      const blockedReservation = await serviceApi("rpc/ordys_reserve_account_deletion", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id }),
      });
      expect(blockedReservation.ok, await blockedReservation.clone().text()).toBe(true);
      expect(await blockedReservation.json()).toBe("checkout_creation_in_progress");

      const reservationBeforeReconciliation = await serviceApi(
        `ordys_account_deletion_reservations?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`,
      );
      expect(reservationBeforeReconciliation.ok, await reservationBeforeReconciliation.clone().text()).toBe(true);
      expect(await reservationBeforeReconciliation.json()).toEqual([]);

      const cancelledWebhook = await serviceApi("rpc/process_ordys_asaas_billing_event", {
        method: "POST",
        body: JSON.stringify({
          p_event: {
            id: eventId,
            event: "CHECKOUT_CANCELED",
            checkout: { id: checkoutId, externalReference },
          },
        }),
      });
      expect(cancelledWebhook.ok, await cancelledWebhook.clone().text()).toBe(true);
      expect(await cancelledWebhook.json()).toMatchObject({ processed: true, event: "CHECKOUT_CANCELED" });

      const reserved = await serviceApi("rpc/ordys_reserve_account_deletion", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id }),
      });
      expect(reserved.ok, await reserved.clone().text()).toBe(true);
      expect(await reserved.json()).toBe("reserved");

      const blockedCheckout = await serviceApi("rpc/ordys_begin_billing_checkout_attempt", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_attempt_id: crypto.randomUUID(),
          p_plan_code: "plus_monthly",
          p_external_reference: `ordys_after_reservation_${testRunId}`,
          p_amount_cents: 5990,
          p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(blockedCheckout.ok, await blockedCheckout.clone().text()).toBe(true);
      expect(await blockedCheckout.json()).toBe("deletion_reserved");

      const refusedRelease = await serviceApi("rpc/ordys_release_account_deletion_reservation", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_provider_state_verified: false,
        }),
      });
      expect(refusedRelease.ok, await refusedRelease.clone().text()).toBe(true);
      expect(await refusedRelease.json()).toBe("provider_verification_required");

      const released = await serviceApi("rpc/ordys_release_account_deletion_reservation", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_provider_state_verified: true,
        }),
      });
      expect(released.ok, await released.clone().text()).toBe(true);
      expect(await released.json()).toBe("released");

      const retryAfterRelease = await serviceApi("rpc/ordys_begin_billing_checkout_attempt", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_attempt_id: crypto.randomUUID(),
          p_plan_code: "plus_monthly",
          p_external_reference: `ordys_after_manual_release_${testRunId}`,
          p_amount_cents: 5990,
          p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(retryAfterRelease.ok, await retryAfterRelease.clone().text()).toBe(true);
      expect(await retryAfterRelease.json()).toBe("created");

    } finally {
      await serviceApi(`ordys_billing_webhook_events?provider_event_id=eq.${encodeURIComponent(eventId)}`, {
        method: "DELETE",
      });
      await serviceApi("ordys_billing_plans?plan_code=eq.plus_monthly", {
        method: "PATCH",
        body: JSON.stringify(planRows[0]),
      });
      await serviceApi("ordys_billing_settings?id=eq.1", {
        method: "PATCH",
        body: JSON.stringify(settingsRows[0]),
      });
    }
  }, 30_000);

  it("serializa checkout e reserva de exclusão quando ambos chegam simultaneamente", async () => {
    const user = billingUserE!;
    const attemptId = crypto.randomUUID();
    const externalReference = `ordys_serialization_race_${testRunId}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const settingsResponse = await serviceApi("ordys_billing_settings?select=billing_enabled&id=eq.1");
    expect(settingsResponse.ok, await settingsResponse.clone().text()).toBe(true);
    const settingsRows = await settingsResponse.json() as Array<{ billing_enabled: boolean }>;
    const planResponse = await serviceApi("ordys_billing_plans?select=enabled,price_cents&plan_code=eq.plus_monthly");
    expect(planResponse.ok, await planResponse.clone().text()).toBe(true);
    const planRows = await planResponse.json() as Array<{ enabled: boolean; price_cents: number | null }>;
    expect(settingsRows).toHaveLength(1);
    expect(planRows).toHaveLength(1);

    try {
      const enableSettings = await serviceApi("ordys_billing_settings?id=eq.1", {
      method: "PATCH",
      body: JSON.stringify({ billing_enabled: true }),
    });
    expect(enableSettings.ok, await enableSettings.text()).toBe(true);
    const enablePlan = await serviceApi("ordys_billing_plans?plan_code=eq.plus_monthly", {
      method: "PATCH",
      body: JSON.stringify({ enabled: true, price_cents: 5990 }),
    });
    expect(enablePlan.ok, await enablePlan.text()).toBe(true);

      const [checkoutResponse, deletionResponse] = await Promise.all([
        serviceApi("rpc/ordys_begin_billing_checkout_attempt", {
          method: "POST",
          body: JSON.stringify({
            p_user_id: user.id,
            p_attempt_id: attemptId,
            p_plan_code: "plus_monthly",
            p_external_reference: externalReference,
            p_amount_cents: 5990,
            p_expires_at: expiresAt,
          }),
        }),
        serviceApi("rpc/ordys_reserve_account_deletion", {
          method: "POST",
          body: JSON.stringify({ p_user_id: user.id }),
        }),
      ]);

      expect(checkoutResponse.ok, await checkoutResponse.clone().text()).toBe(true);
      expect(deletionResponse.ok, await deletionResponse.clone().text()).toBe(true);
      const checkoutState = await checkoutResponse.json() as string;
      const deletionState = await deletionResponse.json() as string;

      expect(
        [
          ["created", "checkout_creation_in_progress"],
          ["deletion_reserved", "reserved"],
        ],
      ).toContainEqual([checkoutState, deletionState]);

      const attemptsResponse = await serviceApi(
        `ordys_billing_checkout_attempts?select=id,status&user_id=eq.${encodeURIComponent(user.id)}`,
      );
      expect(attemptsResponse.ok, await attemptsResponse.clone().text()).toBe(true);
      const attempts = await attemptsResponse.json() as Array<{ id: string; status: string }>;

      const reservationsResponse = await serviceApi(
        `ordys_account_deletion_reservations?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`,
      );
      expect(reservationsResponse.ok, await reservationsResponse.clone().text()).toBe(true);
      const reservations = await reservationsResponse.json() as Array<{ user_id: string }>;

      if (checkoutState === "created") {
        expect(attempts).toEqual([{ id: attemptId, status: "creating" }]);
        expect(reservations).toEqual([]);
      } else {
        expect(attempts).toEqual([]);
        expect(reservations).toEqual([{ user_id: user.id }]);
      }
    } finally {
      await serviceApi("ordys_billing_plans?plan_code=eq.plus_monthly", {
        method: "PATCH",
        body: JSON.stringify(planRows[0]),
      });
      await serviceApi("ordys_billing_settings?id=eq.1", {
        method: "PATCH",
        body: JSON.stringify(settingsRows[0]),
      });
    }
  }, 30_000);

  it("não libera a reserva enquanto ainda existe assinatura ativa", async () => {
    const user = billingUserB!;
    const reserve = await serviceApi("rpc/ordys_reserve_account_deletion", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user.id }),
    });
    expect(reserve.ok, await reserve.clone().text()).toBe(true);
    expect(await reserve.json()).toBe("reserved");

    const release = await serviceApi("rpc/ordys_release_account_deletion_reservation", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: user.id,
        p_provider_state_verified: true,
      }),
    });
    expect(release.ok, await release.clone().text()).toBe(true);
    expect(await release.json()).toBe("billing_reconciliation_required");

    const reservation = await serviceApi(
      `ordys_account_deletion_reservations?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`,
    );
    expect(reservation.ok, await reservation.clone().text()).toBe(true);
    expect(await reservation.json()).toEqual([{ user_id: user.id }]);
  });

  it("does not start checkout after account deletion has reserved the user", async () => {
    const user = billingUserD!;
    const reserve = await serviceApi("rpc/ordys_reserve_account_deletion", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user.id }),
    });
    expect(reserve.ok, await reserve.clone().text()).toBe(true);
    expect(await reserve.json()).toBe("reserved");

    const attemptResponse = await serviceApi("rpc/ordys_begin_billing_checkout_attempt", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: user.id,
        p_attempt_id: crypto.randomUUID(),
        p_plan_code: "plus_monthly",
        p_external_reference: `ordys_after_deletion_${testRunId}`,
        p_amount_cents: 5990,
        p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attemptResponse.ok, await attemptResponse.clone().text()).toBe(true);
    expect(await attemptResponse.json()).toBe("deletion_reserved");

    const attemptsResponse = await serviceApi(
      `ordys_billing_checkout_attempts?select=id&user_id=eq.${encodeURIComponent(user.id)}`,
    );
    expect(attemptsResponse.ok, await attemptsResponse.clone().text()).toBe(true);
    expect(await attemptsResponse.json()).toEqual([]);
  });

  it("blocks a new recurring Checkout while an old Asaas subscription webhook is unresolved", async () => {
    const user = await createBillingTestUser("unreconciled-checkout");
    const priorAttemptId = crypto.randomUUID();
    const requestedAttemptId = crypto.randomUUID();
    const priorExternalReference = `ordys_unreconciled_checkout_${testRunId}`;
    const customerId = `cus_ordys_unreconciled_checkout_${testRunId}`;
    const checkoutId = `chk_ordys_unreconciled_checkout_${testRunId}`;
    const subscriptionId = `sub_ordys_unreconciled_checkout_${testRunId}`;
    const eventId = `evt_ordys_unreconciled_checkout_${testRunId}`;

    try {
      const priorAttempt = await serviceApi("ordys_billing_checkout_attempts", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id: priorAttemptId,
          user_id: user.id,
          plan_code: "plus_monthly",
          external_reference: priorExternalReference,
          provider_checkout_id: checkoutId,
          provider_customer_id: customerId,
          amount_cents: 5_990,
          status: "cancelled",
          expires_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      });
      expect(priorAttempt.ok, await priorAttempt.clone().text()).toBe(true);

      const heldEvent = await serviceApi("ordys_billing_webhook_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          provider_event_id: eventId,
          event_type: "SUBSCRIPTION_CREATED",
          provider_object_id: subscriptionId,
          processing_status: "failed",
          error_code: "subscription_checkout_unmatched",
          provider_customer_id: customerId,
          retry_payload: {
            id: eventId,
            event: "SUBSCRIPTION_CREATED",
            subscription: {
              id: subscriptionId,
              customer: customerId,
              externalReference: null,
            },
          },
          processed_at: new Date().toISOString(),
        }),
      });
      expect(heldEvent.ok, await heldEvent.clone().text()).toBe(true);

      const blockedAttempt = await serviceApi("rpc/ordys_begin_billing_checkout_attempt", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_attempt_id: requestedAttemptId,
          p_plan_code: "plus_monthly",
          p_external_reference: `ordys_new_attempt_${testRunId}`,
          p_amount_cents: 5_990,
          p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(blockedAttempt.ok, await blockedAttempt.clone().text()).toBe(true);
      expect(await blockedAttempt.json()).toBe("billing_reconciliation_required");

      const absentAttempt = await serviceApi(
        `ordys_billing_checkout_attempts?select=id&id=eq.${encodeURIComponent(requestedAttemptId)}&limit=1`,
      );
      expect(absentAttempt.ok, await absentAttempt.clone().text()).toBe(true);
      expect(await absentAttempt.json()).toEqual([]);
    } finally {
      await serviceApi(`ordys_billing_webhook_events?provider_event_id=eq.${encodeURIComponent(eventId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      await serviceApi(`ordys_billing_checkout_attempts?id=eq.${encodeURIComponent(priorAttemptId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      await cleanupUserBillingRows(user.id);
      await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: serviceHeaders(),
      }).catch(() => undefined);
    }
  }, 30_000);

  it("blocks direct Checkout RPC while a provider subscription is still active", async () => {
    const user = billingUserB!;
    const attemptId = crypto.randomUUID();
    const response = await serviceApi("rpc/ordys_begin_billing_checkout_attempt", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: user.id,
        p_attempt_id: attemptId,
        p_plan_code: "plus_monthly",
        p_external_reference: `ordys_active_subscription_guard_${testRunId}`,
        p_amount_cents: 5_990,
        p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(response.ok, await response.clone().text()).toBe(true);
    expect(await response.json()).toBe("billing_reconciliation_required");

    const absentAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=id&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(absentAttempt.ok, await absentAttempt.clone().text()).toBe(true);
    expect(await absentAttempt.json()).toEqual([]);
  });

  it("blocks direct Checkout RPC while cancelled subscription access is still paid through", async () => {
    const user = await createBillingTestUser("cancelled-paid-through");
    const attemptId = crypto.randomUUID();
    const subscriptionId = `sub_ordys_cancelled_paid_through_${testRunId}`;

    try {
      const subscription = await serviceApi("ordys_billing_subscriptions", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          user_id: user.id,
          plan_code: "plus_monthly",
          provider_subscription_id: subscriptionId,
          provider_customer_id: `cus_ordys_cancelled_paid_through_${testRunId}`,
          provider_status: "DELETED",
          status: "cancelled",
          billing_cycle: "MONTHLY",
          billing_type: "CREDIT_CARD",
          amount_cents: 5_990,
          currency: "BRL",
          current_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          cancellation_confirmed_at: new Date().toISOString(),
        }),
      });
      expect(subscription.ok, await subscription.clone().text()).toBe(true);

      const response = await serviceApi("rpc/ordys_begin_billing_checkout_attempt", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_attempt_id: attemptId,
          p_plan_code: "plus_monthly",
          p_external_reference: `ordys_cancelled_paid_through_guard_${testRunId}`,
          p_amount_cents: 5_990,
          p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(response.ok, await response.clone().text()).toBe(true);
      expect(await response.json()).toBe("billing_reconciliation_required");

      const absentAttempt = await serviceApi(
        `ordys_billing_checkout_attempts?select=id&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
      );
      expect(absentAttempt.ok, await absentAttempt.clone().text()).toBe(true);
      expect(await absentAttempt.json()).toEqual([]);
    } finally {
      await cleanupUserBillingRows(user.id);
      await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: serviceHeaders(),
      }).catch(() => undefined);
    }
  }, 30_000);

  it("does not allow two concurrent delete processors to claim the same account", async () => {
    const user = billingUserA!;
    const reserve = await serviceApi("rpc/ordys_reserve_account_deletion", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user.id }),
    });
    expect(reserve.ok, await reserve.clone().text()).toBe(true);
    expect(await reserve.json()).toBe("reserved");

    const tokenA = crypto.randomUUID();
    const tokenB = crypto.randomUUID();
    const [claimA, claimB] = await Promise.all([
      serviceApi("rpc/ordys_claim_account_deletion_processing", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id, p_processing_token: tokenA }),
      }),
      serviceApi("rpc/ordys_claim_account_deletion_processing", {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id, p_processing_token: tokenB }),
      }),
    ]);
    expect(claimA.ok, await claimA.clone().text()).toBe(true);
    expect(claimB.ok, await claimB.clone().text()).toBe(true);
    const stateA = await claimA.json();
    const stateB = await claimB.json();
    expect([stateA, stateB].sort()).toEqual(["claimed", "deletion_processing"]);

    const ownerToken = stateA === "claimed" ? tokenA : tokenB;
    const release = await serviceApi("rpc/ordys_release_account_deletion_processing", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user.id, p_processing_token: ownerToken }),
    });
    expect(release.ok, await release.clone().text()).toBe(true);
    expect(await release.json()).toBe("released");

    const removeReservation = await serviceApi("rpc/ordys_release_account_deletion_reservation", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user.id, p_provider_state_verified: true }),
    });
    expect(removeReservation.ok, await removeReservation.clone().text()).toBe(true);
    expect(await removeReservation.json()).toBe("released");
  });

  it("mantém somente os RPCs de consulta segura disponíveis ao titular", async () => {
    const plans = await authenticatedApi(billingUserA!, "rpc/get_ordys_billing_plans", {
      method: "POST",
      body: "{}",
    });
    expect(plans.ok).toBe(true);
    expect(await plans.json()).toEqual([]);

    const ownStatus = await authenticatedApi(billingUserA!, "rpc/get_my_ordys_billing_status", {
      method: "POST",
      body: "{}",
    });
    expect(ownStatus.ok).toBe(true);
    expect(await ownStatus.json()).toEqual([]);

    const secondUserStatus = await authenticatedApi(billingUserB!, "rpc/get_my_ordys_billing_status", {
      method: "POST",
      body: "{}",
    });
    expect(secondUserStatus.ok).toBe(true);
    const rows = await secondUserStatus.json() as Array<{ status: string; amount_cents: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", amount_cents: 5_990 });
  });

  it.each([
    ["consume_usage_limit", {
      p_user_id: "00000000-0000-0000-0000-000000000001",
      p_kind: "direct-client-attempt",
      p_hourly_limit: 2,
      p_daily_limit: 4,
    }],
    ["is_ordys_plus_eligible", { p_user_id: "00000000-0000-0000-0000-000000000001" }],
    ["process_ordys_asaas_billing_event", { p_event: { id: "evt_authenticated_test", event: "PAYMENT_CREATED" } }],
    ["ordys_billing_schema_status", {}],
    ["ordys_has_unreconciled_billing_events", { p_user_id: "00000000-0000-0000-0000-000000000001" }],
    ["ordys_begin_billing_checkout_attempt", {
      p_user_id: "00000000-0000-0000-0000-000000000001",
      p_attempt_id: "00000000-0000-0000-0000-000000000002",
      p_plan_code: "plus_monthly",
      p_external_reference: "ordys_test_internal",
      p_amount_cents: 5990,
      p_expires_at: "2026-11-03T12:00:00.000Z",
    }],
    ["ordys_reserve_account_deletion", { p_user_id: "00000000-0000-0000-0000-000000000001" }],
    ["ordys_release_account_deletion_reservation", {
      p_user_id: "00000000-0000-0000-0000-000000000001",
      p_provider_state_verified: true,
    }],
    ["ordys_claim_account_deletion_processing", {
      p_user_id: "00000000-0000-0000-0000-000000000001",
      p_processing_token: "00000000-0000-0000-0000-000000000003",
    }],
    ["ordys_release_account_deletion_processing", {
      p_user_id: "00000000-0000-0000-0000-000000000001",
      p_processing_token: "00000000-0000-0000-0000-000000000003",
    }],
    ["ordys_confirm_subscription_cancellation", {
      p_user_id: "00000000-0000-0000-0000-000000000001",
      p_subscription_id: "00000000-0000-0000-0000-000000000004",
      p_cancellation_requested_at: "2026-11-03T12:00:00.000Z",
    }],
  ])("não expõe o RPC privilegiado %s para authenticated", async (name, body) => {
    const response = await authenticatedApi(billingUserA!, `rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(response.ok).toBe(false);
  });
});
