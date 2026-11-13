import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"] ?? "";
const ANON_KEY =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  "";
const SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

type AuthResponse = {
  id?: string;
  access_token?: string;
  message?: string;
  msg?: string;
  error?: string;
};

type TestUser = { id: string; accessToken: string };

type BillingSubscription = {
  status: string;
  current_period_end: string | null;
  provider_status: string | null;
  checkout_attempt_id: string | null;
};

const enabled = Boolean(URL && ANON_KEY && SERVICE_ROLE_KEY);
const unique = crypto.randomUUID().replaceAll("-", "");
const customerId = `cus_ordys_ci_${unique}`;
const externalReference = `ordys_ci_${unique}`;
const subscriptionId = `sub_ordys_ci_${unique}`;
const checkoutId = `chk_ordys_ci_${unique}`;
const checkoutAttemptId = crypto.randomUUID();
const paymentId = `pay_ordys_ci_${unique}`;
const checkoutCreatedEventId = `evt_ordys_ci_checkout_created_${unique}`;
const checkoutCreatedNoReferenceEventId = `evt_ordys_ci_checkout_created_no_ref_${unique}`;
const eventIds = [
  `evt_ordys_ci_subscription_${unique}`,
  `evt_ordys_ci_checkout_paid_${unique}`,
  `evt_ordys_ci_payment_${unique}`,
  `evt_ordys_ci_overdue_${unique}`,
  `evt_ordys_ci_deleted_${unique}`,
  `evt_ordys_ci_refund_${unique}`,
  `evt_ordys_ci_sequential_checkout_${unique}`,
  `evt_ordys_ci_sequential_subscription_${unique}`,
  `evt_ordys_ci_sequential_payment_${unique}`,
  `evt_ordys_ci_ambiguous_customer_${unique}`,
  `evt_ordys_ci_suspended_deleted_${unique}`,
  `evt_ordys_ci_subscription_retry_${unique}`,
  `evt_ordys_ci_retry_checkout_${unique}`,
  `evt_ordys_ci_shared_customer_linked_paid_${unique}`,
  `evt_ordys_ci_paid_before_subscription_checkout_${unique}`,
  `evt_ordys_ci_paid_before_subscription_payment_${unique}`,
  `evt_ordys_ci_paid_before_subscription_created_${unique}`,
  `evt_ordys_ci_checkout_customer_mismatch_subscription_first_${unique}`,
  `evt_ordys_ci_checkout_customer_mismatch_paid_${unique}`,
  `evt_ordys_ci_checkout_customer_mismatch_payment_${unique}`,
  `evt_ordys_ci_checkout_customer_mismatch_paid_first_${unique}`,
  `evt_ordys_ci_checkout_customer_mismatch_subscription_after_${unique}`,
  `evt_ordys_ci_late_payment_after_delete_${unique}`,
  `evt_ordys_ci_concurrent_payment_confirmed_${unique}`,
  `evt_ordys_ci_concurrent_payment_overdue_${unique}`,
  `evt_ordys_ci_delete_before_subscription_created_${unique}`,
  `evt_ordys_ci_subscription_after_delete_${unique}`,
  `evt_ordys_ci_checkout_paid_after_delete_${unique}`,
  `evt_ordys_ci_shared_customer_wrong_delete_${unique}`,
  `evt_ordys_ci_shared_customer_known_delete_${unique}`,
  `evt_ordys_ci_shared_customer_cross_account_ref_${unique}`,
  `evt_ordys_ci_subscription_id_owner_${unique}`,
  `evt_ordys_ci_subscription_id_reuse_${unique}`,
  checkoutCreatedEventId,
  checkoutCreatedNoReferenceEventId,
];

const paymentCreatedBeforeSubscriptionEventId = `evt_ordys_ci_payment_created_before_subscription_${unique}`;
eventIds.push(paymentCreatedBeforeSubscriptionEventId);
const negativePaymentCheckoutPaidEventId = `evt_ordys_ci_negative_payment_checkout_paid_${unique}`;
const negativePaymentConfirmedEventId = `evt_ordys_ci_negative_payment_confirmed_${unique}`;
const negativePaymentRefundedEventId = `evt_ordys_ci_negative_payment_refunded_${unique}`;
const negativePaymentSubscriptionCreatedEventId = `evt_ordys_ci_negative_payment_subscription_created_${unique}`;
eventIds.push(
  negativePaymentCheckoutPaidEventId,
  negativePaymentConfirmedEventId,
  negativePaymentRefundedEventId,
  negativePaymentSubscriptionCreatedEventId,
);
const checkoutReferenceMismatchEventIds = {
  subscriptionFirstCreated: `evt_ordys_ci_checkout_reference_mismatch_subscription_first_created_${unique}`,
  subscriptionFirstPaid: `evt_ordys_ci_checkout_reference_mismatch_subscription_first_paid_${unique}`,
  subscriptionFirstPayment: `evt_ordys_ci_checkout_reference_mismatch_subscription_first_payment_${unique}`,
  paidFirstPaid: `evt_ordys_ci_checkout_reference_mismatch_paid_first_paid_${unique}`,
  paidFirstCreated: `evt_ordys_ci_checkout_reference_mismatch_paid_first_created_${unique}`,
};
eventIds.push(...Object.values(checkoutReferenceMismatchEventIds));

let user: TestUser | null = null;
const extraUsers: TestUser[] = [];
const cleanupBillingAttemptIds: string[] = [];
const cleanupBillingSubscriptionIds: string[] = [];
const cleanupBillingPaymentIds: string[] = [];

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

async function createTestUser(label = "lifecycle"): Promise<TestUser> {
  const testEmail = `ordys-billing-ci-${label}-${unique}@example.invalid`;
  const testPassword = `Ordys-CI-${label}-${unique}-A9!`;
  const created = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: "ORDYS billing integration test" },
    }),
  });
  const createdBody = (await created.json().catch(() => ({}))) as AuthResponse;
  if (!created.ok || !createdBody.id) {
    throw new Error(
      `Falha ao criar usuário temporário de billing: HTTP ${created.status} ${createdBody.message ?? createdBody.msg ?? createdBody.error ?? ""}`,
    );
  }

  const signedIn = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  const session = (await signedIn.json().catch(() => ({}))) as AuthResponse;
  if (!signedIn.ok || !session.access_token) {
    await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(createdBody.id)}`, {
      method: "DELETE",
      headers: serviceHeaders(),
    });
    throw new Error(
      `Falha ao autenticar usuário temporário de billing: HTTP ${signedIn.status} ${session.message ?? session.msg ?? session.error ?? ""}`,
    );
  }
  return { id: createdBody.id, accessToken: session.access_token };
}

async function processEvent(event: Record<string, unknown>) {
  const receipt = await receiveEvent(event);
  let result: Record<string, unknown>;
  if (receipt.processing_status === "received") {
    result = await processReceivedEvent(String(event.id ?? ""));
  } else if (receipt.processing_status === "quarantined") {
    const row = await serviceApi(
      `ordys_billing_webhook_inbox?select=error_code&provider_event_id=eq.${encodeURIComponent(String(event.id ?? ""))}&limit=1`,
    );
    const values = await row.json().catch(() => []) as Array<{ error_code?: string | null }>;
    const error = values[0]?.error_code;
    result = typeof error === "string"
      ? { processed: false, error }
      : { processed: false, duplicate: true };
  } else {
    result = { processed: false, duplicate: true };
  }

  // The integration helper mimics successive scheduled worker passes so
  // dependent events can be tested without restoring nested SQL replay loops.
  await drainRetryableWebhookEvents();
  return result;
}

async function receiveEvent(event: Record<string, unknown>) {
  const result = await serviceApi("rpc/ordys_receive_asaas_billing_webhook", {
    method: "POST",
    body: JSON.stringify({ p_event: event }),
  });
  const body = await result.json().catch(() => ({})) as Record<string, unknown>;
  expect(result.ok, JSON.stringify(body)).toBe(true);
  return body;
}

async function processReceivedEvent(eventId: string) {
  const result = await serviceApi("rpc/ordys_process_asaas_billing_webhook", {
    method: "POST",
    body: JSON.stringify({ p_event_id: eventId }),
  });
  const body = await result.json().catch(() => ({})) as Record<string, unknown>;
  expect(result.ok, JSON.stringify(body)).toBe(true);
  return body;
}

async function requeueRetryableWebhookEvents(): Promise<string[]> {
  const response = await serviceApi("rpc/ordys_requeue_asaas_billing_webhook_retries", {
    method: "POST",
    body: JSON.stringify({ p_limit: 5 }),
  });
  const body = await response.json().catch(() => ({})) as {
    requeued?: number;
    event_ids?: unknown;
  };
  expect(response.ok, JSON.stringify(body)).toBe(true);
  expect(Array.isArray(body.event_ids)).toBe(true);
  const eventIds = body.event_ids as unknown[];
  expect(body.requeued).toBe(eventIds.length);
  expect(eventIds.length).toBeLessThanOrEqual(5);
  for (const eventId of eventIds) {
    expect(typeof eventId).toBe("string");
    expect(String(eventId).length).toBeGreaterThan(0);
  }
  return eventIds as string[];
}

async function drainRetryableWebhookEvents() {
  // A subscription-created retry can unlock held deletion/payment events, and a
  // settled payment can unlock an exact refund/chargeback. Keep the test helper
  // bounded just like the scheduled production worker.
  for (let round = 0; round < 25; round += 1) {
    const eventIds = await requeueRetryableWebhookEvents();
    if (eventIds.length === 0) return;
    for (const eventId of eventIds) {
      await processReceivedEvent(eventId);
    }
  }
  throw new Error("Asaas retry integration fixture exceeded 25 bounded replay rounds.");
}

async function readSubscription(): Promise<BillingSubscription> {
  const result = await serviceApi(
    `ordys_billing_subscriptions?select=status,current_period_end,provider_status,checkout_attempt_id&provider_subscription_id=eq.${encodeURIComponent(subscriptionId)}&limit=1`,
  );
  const rows = await result.json().catch(() => []) as BillingSubscription[];
  expect(result.ok).toBe(true);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function isEligible(): Promise<boolean> {
  const result = await serviceApi("rpc/is_ordys_plus_eligible", {
    method: "POST",
    body: JSON.stringify({ p_user_id: user!.id }),
  });
  expect(result.ok).toBe(true);
  return await result.json() === true;
}

describe.runIf(enabled)("máquina de estados dos webhooks Asaas do Ordys", () => {
  beforeAll(async () => {
    user = await createTestUser();

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: checkoutAttemptId,
        user_id: user.id,
        plan_code: "plus_monthly",
        external_reference: externalReference,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    const attemptBody = await attempt.text();
    expect(attempt.ok, attemptBody).toBe(true);
  }, 30_000);

  afterAll(async () => {
    if (eventIds.length) {
      await serviceApi(
        `ordys_billing_webhook_inbox?provider_event_id=in.(${eventIds.map(encodeURIComponent).join(",")})`,
        { method: "DELETE" },
      ).catch(() => undefined);
      await serviceApi(
        `ordys_billing_webhook_events?provider_event_id=in.(${eventIds.map(encodeURIComponent).join(",")})`,
        { method: "DELETE" },
      ).catch(() => undefined);
    }
    // This suite deletes Auth users after FK behavior is verified. Clean every
    // retained billing row explicitly so SET NULL does not leak test fixtures.
    for (const paymentId of cleanupBillingPaymentIds) {
      await serviceApi(
        `ordys_billing_payments?provider_payment_id=eq.${encodeURIComponent(paymentId)}`,
        { method: "DELETE" },
      ).catch(() => undefined);
    }
    for (const subscriptionId of cleanupBillingSubscriptionIds) {
      await serviceApi(
        `ordys_billing_subscriptions?provider_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
        { method: "DELETE" },
      ).catch(() => undefined);
    }
    for (const attemptId of cleanupBillingAttemptIds) {
      await serviceApi(
        `ordys_billing_checkout_attempts?id=eq.${encodeURIComponent(attemptId)}`,
        { method: "DELETE" },
      ).catch(() => undefined);
    }

    for (const testUser of [user, ...extraUsers]) {
      if (!testUser) continue;
      for (const table of [
        "ordys_billing_payments",
        "ordys_billing_subscriptions",
        "ordys_billing_checkout_attempts",
      ]) {
        await serviceApi(
          `${table}?user_id=eq.${encodeURIComponent(testUser.id)}`,
          { method: "DELETE" },
        ).catch(() => undefined);
      }
      await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(testUser.id)}`, {
        method: "DELETE",
        headers: serviceHeaders(),
      }).catch(() => undefined);
    }
  }, 30_000);

  it("reprocessa um backlog maior que dois lotes sem ultrapassar cinco eventos por chamada", async () => {
    const fixtures: Array<{
      userId: string;
      attemptId: string;
      subscriptionId: string;
      customerId: string;
      checkoutId: string;
      subscriptionEventId: string;
      checkoutPaidEventId: string;
    }> = [];

    for (let index = 0; index < 12; index += 1) {
      const retryUser = await createTestUser("bounded-replay-" + index);
      extraUsers.push(retryUser);

      const attemptId = crypto.randomUUID();
      const checkoutId = "chk_ordys_ci_bounded_" + unique + "_" + index;
      const customerId = "cus_ordys_ci_bounded_" + unique + "_" + index;
      const subscriptionId = "sub_ordys_ci_bounded_" + unique + "_" + index;
      const externalRef = "ordys_ci_bounded_" + unique + "_" + index;
      const subscriptionEventId = "evt_ordys_ci_bounded_subscription_" + unique + "_" + index;
      const checkoutPaidEventId = "evt_ordys_ci_bounded_checkout_paid_" + unique + "_" + index;
      eventIds.push(subscriptionEventId, checkoutPaidEventId);

      const attempt = await serviceApi("ordys_billing_checkout_attempts", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id: attemptId,
          user_id: retryUser.id,
          plan_code: "plus_monthly",
          external_reference: externalRef,
          provider_checkout_id: checkoutId,
          provider_customer_id: null,
          amount_cents: 5_990,
          status: "pending",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(attempt.ok, await attempt.clone().text()).toBe(true);

      // SUBSCRIPTION_CREATED arrives without externalReference before CHECKOUT_PAID.
      const subscriptionReceipt = await receiveEvent({
        id: subscriptionEventId,
        event: "SUBSCRIPTION_CREATED",
        subscription: {
          id: subscriptionId,
          customer: customerId,
          billingType: "CREDIT_CARD",
          cycle: "MONTHLY",
          value: 59.9,
          status: "ACTIVE",
        },
      });
      expect(subscriptionReceipt.processing_status).toBe("received");
      const held = await processReceivedEvent(subscriptionEventId);
      expect(held).toMatchObject({
        processed: false,
        error: "subscription_checkout_unmatched",
      });

      // CHECKOUT_PAID commits the exact customer-to-attempt link. The bounded
      // replay routine, rather than a nested SQL loop, now makes the held event eligible.
      const checkoutReceipt = await receiveEvent({
        id: checkoutPaidEventId,
        event: "CHECKOUT_PAID",
        checkout: { id: checkoutId, customer: customerId },
      });
      expect(checkoutReceipt.processing_status).toBe("received");
      const paid = await processReceivedEvent(checkoutPaidEventId);
      expect(paid).toMatchObject({ processed: true, event: "CHECKOUT_PAID" });

      fixtures.push({
        userId: retryUser.id,
        attemptId,
        subscriptionId,
        customerId,
        checkoutId,
        subscriptionEventId,
        checkoutPaidEventId,
      });
    }

    const replayCalls = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const result = await serviceApi("rpc/ordys_requeue_asaas_billing_webhook_retries", {
          method: "POST",
          body: JSON.stringify({ p_limit: 5 }),
        });
        const body = await result.json().catch(() => ({})) as {
          requeued?: number;
          event_ids?: unknown;
        };
        expect(result.ok, JSON.stringify(body)).toBe(true);
        expect(Array.isArray(body.event_ids)).toBe(true);
        const ids = body.event_ids as unknown[];
        expect(ids.length).toBeLessThanOrEqual(5);
        expect(body.requeued).toBe(ids.length);
        return ids as string[];
      }),
    );

    const allRequeuedIds = replayCalls.flat();
    expect(replayCalls.map((batch) => batch.length).sort()).toEqual([2, 5, 5]);
    expect(allRequeuedIds).toHaveLength(12);
    expect(new Set(allRequeuedIds).size).toBe(12);
    expect(new Set(allRequeuedIds)).toEqual(new Set(fixtures.map((fixture) => fixture.subscriptionEventId)));

    for (const eventId of allRequeuedIds) {
      const processed = await processReceivedEvent(eventId);
      expect(processed).toMatchObject({ processed: true, event: "SUBSCRIPTION_CREATED" });
    }

    for (const fixture of fixtures) {
      const subscription = await serviceApi(
        "ordys_billing_subscriptions?select=user_id,status,checkout_attempt_id&provider_subscription_id=eq."
          + encodeURIComponent(fixture.subscriptionId)
          + "&limit=1",
      );
      expect(subscription.ok, await subscription.clone().text()).toBe(true);
      expect(await subscription.json()).toEqual([{
        user_id: fixture.userId,
        status: "pending",
        checkout_attempt_id: fixture.attemptId,
      }]);

      const event = await serviceApi(
        "ordys_billing_webhook_events?select=processing_status,error_code&provider_event_id=eq."
          + encodeURIComponent(fixture.subscriptionEventId)
          + "&limit=1",
      );
      expect(event.ok, await event.clone().text()).toBe(true);
      expect(await event.json()).toEqual([{ processing_status: "processed", error_code: null }]);
    }

    const invalidLimit = await serviceApi("rpc/ordys_requeue_asaas_billing_webhook_retries", {
      method: "POST",
      body: JSON.stringify({ p_limit: 6 }),
    });
    expect(invalidLimit.ok).toBe(false);
  }, 60_000);

  it("recupera Checkout criado após perda da resposta usando externalReference", async () => {
    const recoveryUser = await createTestUser("checkout-created-recovery");
    extraUsers.push(recoveryUser);

    const attemptId = crypto.randomUUID();
    const recoveryExternalReference = "ordys_ci_checkout_created_" + crypto.randomUUID().replaceAll("-", "");
    const providerCheckoutId = "chk_ordys_ci_created_" + unique;
    const providerCustomerId = "cus_ordys_ci_created_" + unique;

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: recoveryUser.id,
        plan_code: "plus_monthly",
        external_reference: recoveryExternalReference,
        provider_checkout_id: null,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "creating",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const created = await processEvent({
      id: checkoutCreatedEventId,
      event: "CHECKOUT_CREATED",
      checkout: {
        id: providerCheckoutId,
        customer: providerCustomerId,
        externalReference: recoveryExternalReference,
        status: "ACTIVE",
      },
    });
    expect(created).toMatchObject({ processed: true, event: "CHECKOUT_CREATED" });

    const recovered = await serviceApi(
      "ordys_billing_checkout_attempts?select=status,provider_checkout_id,checkout_url,provider_customer_id&id=eq."
        + encodeURIComponent(attemptId)
        + "&limit=1",
    );
    expect(recovered.ok, await recovered.clone().text()).toBe(true);
    expect(await recovered.json()).toEqual([{
      status: "pending",
      provider_checkout_id: providerCheckoutId,
      checkout_url: "https://asaas.com/checkoutSession/show?id=" + providerCheckoutId,
      provider_customer_id: providerCustomerId,
    }]);

    const event = await serviceApi(
      "ordys_billing_webhook_events?select=processing_status,error_code&provider_event_id=eq."
        + encodeURIComponent(checkoutCreatedEventId)
        + "&limit=1",
    );
    expect(event.ok, await event.clone().text()).toBe(true);
    expect(await event.json()).toEqual([{ processing_status: "processed", error_code: null }]);
  }, 30_000);

  it("não associa CHECKOUT_CREATED pelo cliente quando o webhook omite externalReference", async () => {
    const noReferenceUser = await createTestUser("checkout-created-no-reference");
    extraUsers.push(noReferenceUser);

    const attemptId = crypto.randomUUID();
    const providerCheckoutId = "chk_ordys_ci_no_ref_" + unique;
    const providerCustomerId = "cus_ordys_ci_no_ref_" + unique;

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: noReferenceUser.id,
        plan_code: "plus_monthly",
        external_reference: "ordys_ci_checkout_no_ref_" + crypto.randomUUID().replaceAll("-", ""),
        provider_checkout_id: null,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "creating",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const created = await processEvent({
      id: checkoutCreatedNoReferenceEventId,
      event: "CHECKOUT_CREATED",
      checkout: {
        id: providerCheckoutId,
        customer: providerCustomerId,
        status: "ACTIVE",
      },
    });
    expect(created).toMatchObject({ event: "CHECKOUT_CREATED" });

    const unchanged = await serviceApi(
      "ordys_billing_checkout_attempts?select=status,provider_checkout_id,checkout_url&id=eq."
        + encodeURIComponent(attemptId)
        + "&limit=1",
    );
    expect(unchanged.ok, await unchanged.clone().text()).toBe(true);
    expect(await unchanged.json()).toEqual([{
      status: "creating",
      provider_checkout_id: null,
      checkout_url: null,
    }]);

    const event = await serviceApi(
      "ordys_billing_webhook_events?select=processing_status,error_code&provider_event_id=eq."
        + encodeURIComponent(checkoutCreatedNoReferenceEventId)
        + "&limit=1",
    );
    expect(event.ok, await event.clone().text()).toBe(true);
    expect(await event.json()).toEqual([{ processing_status: "ignored", error_code: null }]);
  }, 30_000);

  it("coloca valores financeiros inválidos em quarentena sem abortar o webhook", async () => {
    const malformedUser = await createTestUser("malformed-asaas-values");
    extraUsers.push(malformedUser);

    const attemptId = crypto.randomUUID();
    const malformedExternalReference =
      "ordys_ci_malformed_values_" + crypto.randomUUID().replaceAll("-", "");
    const malformedCustomerId = "cus_ordys_ci_malformed_" + unique;
    const malformedSubscriptionId = "sub_ordys_ci_malformed_" + unique;
    const malformedAttempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: malformedUser.id,
        plan_code: "plus_monthly",
        external_reference: malformedExternalReference,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(malformedAttempt.ok, await malformedAttempt.clone().text()).toBe(true);

    const invalidSubscriptionEventId =
      "evt_ordys_ci_invalid_subscription_value_" + unique;
    const subscriptionOverflowEventId =
      "evt_ordys_ci_subscription_value_overflow_" + unique;
    const subscriptionSpecialValueEventId =
      "evt_ordys_ci_subscription_special_value_" + unique;
    const subscriptionFractionalCentsEventId =
      "evt_ordys_ci_subscription_fractional_cents_" + unique;
    const validSubscriptionEventId =
      "evt_ordys_ci_valid_subscription_after_invalid_" + unique;
    const invalidPaymentEventId = "evt_ordys_ci_invalid_payment_value_" + unique;
    const overflowPaymentEventId = "evt_ordys_ci_payment_value_overflow_" + unique;
    const specialPaymentEventId = "evt_ordys_ci_payment_special_value_" + unique;
    const fractionalPaymentEventId = "evt_ordys_ci_payment_fractional_cents_" + unique;
    const invalidDueDateEventId = "evt_ordys_ci_invalid_due_date_" + unique;
    const invalidPaymentId = "pay_ordys_ci_invalid_value_" + unique;
    const overflowPaymentId = "pay_ordys_ci_overflow_value_" + unique;
    const specialPaymentId = "pay_ordys_ci_special_value_" + unique;
    const fractionalPaymentId = "pay_ordys_ci_fractional_cents_" + unique;
    const dueDatePaymentId = "pay_ordys_ci_invalid_due_date_" + unique;
    const earlyMalformedPaymentEventId =
      "evt_ordys_ci_early_malformed_payment_" + unique;
    const earlyMalformedSubscriptionEventId =
      "evt_ordys_ci_early_malformed_subscription_" + unique;
    const earlyMalformedPaymentId = "pay_ordys_ci_early_malformed_" + unique;
    const earlyMalformedSubscriptionId =
      "sub_ordys_ci_early_malformed_" + unique;
    const earlyMalformedExternalReference =
      "ordys_ci_early_malformed_" + unique;
    eventIds.push(
      invalidSubscriptionEventId,
      subscriptionOverflowEventId,
      subscriptionSpecialValueEventId,
      subscriptionFractionalCentsEventId,
      validSubscriptionEventId,
      invalidPaymentEventId,
      overflowPaymentEventId,
      specialPaymentEventId,
      fractionalPaymentEventId,
      invalidDueDateEventId,
      earlyMalformedPaymentEventId,
      earlyMalformedSubscriptionEventId,
    );

    const invalidSubscription = await processEvent({
      id: invalidSubscriptionEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: malformedSubscriptionId,
        customer: malformedCustomerId,
        externalReference: malformedExternalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: "not-a-number",
        status: "ACTIVE",
      },
    });
    expect(invalidSubscription).toMatchObject({
      processed: false,
      error: "subscription_amount_mismatch",
    });

    const overflowSubscription = await processEvent({
      id: subscriptionOverflowEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: malformedSubscriptionId,
        customer: malformedCustomerId,
        externalReference: malformedExternalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: "1e100",
        status: "ACTIVE",
      },
    });
    expect(overflowSubscription).toMatchObject({
      processed: false,
      error: "subscription_amount_mismatch",
    });

    const fractionalCentsSubscription = await processEvent({
      id: subscriptionFractionalCentsEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: malformedSubscriptionId,
        customer: malformedCustomerId,
        externalReference: malformedExternalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: "59.899",
        status: "ACTIVE",
      },
    });
    expect(fractionalCentsSubscription).toMatchObject({
      processed: false,
      error: "subscription_amount_mismatch",
    });

    const specialValueSubscription = await processEvent({
      id: subscriptionSpecialValueEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: malformedSubscriptionId,
        customer: malformedCustomerId,
        externalReference: malformedExternalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: "NaN",
        status: "ACTIVE",
      },
    });
    expect(specialValueSubscription).toMatchObject({
      processed: false,
      error: "subscription_amount_mismatch",
    });

    const validSubscription = await processEvent({
      id: validSubscriptionEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: malformedSubscriptionId,
        customer: malformedCustomerId,
        externalReference: malformedExternalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(validSubscription).toMatchObject({
      processed: true,
      event: "SUBSCRIPTION_CREATED",
    });

    const invalidPayment = await processEvent({
      id: invalidPaymentEventId,
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: invalidPaymentId,
        subscription: malformedSubscriptionId,
        customer: malformedCustomerId,
        value: "not-a-number",
        billingType: "CREDIT_CARD",
      },
    });
    expect(invalidPayment).toMatchObject({
      processed: false,
      error: "amount_mismatch",
    });

    const overflowPayment = await processEvent({
      id: overflowPaymentEventId,
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: overflowPaymentId,
        subscription: malformedSubscriptionId,
        customer: malformedCustomerId,
        value: "1e100",
        billingType: "CREDIT_CARD",
      },
    });
    expect(overflowPayment).toMatchObject({
      processed: false,
      error: "amount_mismatch",
    });

    const fractionalCentsPayment = await processEvent({
      id: fractionalPaymentEventId,
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: fractionalPaymentId,
        subscription: malformedSubscriptionId,
        customer: malformedCustomerId,
        value: "59.899",
        billingType: "CREDIT_CARD",
      },
    });
    expect(fractionalCentsPayment).toMatchObject({
      processed: false,
      error: "amount_mismatch",
    });

    const specialValuePayment = await processEvent({
      id: specialPaymentEventId,
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: specialPaymentId,
        subscription: malformedSubscriptionId,
        customer: malformedCustomerId,
        value: "Infinity",
        billingType: "CREDIT_CARD",
      },
    });
    expect(specialValuePayment).toMatchObject({
      processed: false,
      error: "amount_mismatch",
    });

    const validPaymentWithInvalidDueDate = await processEvent({
      id: invalidDueDateEventId,
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: dueDatePaymentId,
        subscription: malformedSubscriptionId,
        customer: malformedCustomerId,
        value: "59.9",
        billingType: "CREDIT_CARD",
        dueDate: "not-a-date",
      },
    });
    expect(validPaymentWithInvalidDueDate).toMatchObject({
      processed: true,
      event: "PAYMENT_CONFIRMED",
    });

    const earlyMalformedUser = await createTestUser("malformed-early-payment");
    extraUsers.push(earlyMalformedUser);
    const earlyMalformedAttempt = await serviceApi(
      "ordys_billing_checkout_attempts",
      {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          user_id: earlyMalformedUser.id,
          plan_code: "plus_monthly",
          external_reference: earlyMalformedExternalReference,
          provider_customer_id: null,
          amount_cents: 5_990,
          status: "pending",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      },
    );
    expect(earlyMalformedAttempt.ok, await earlyMalformedAttempt.clone().text()).toBe(true);

    const heldMalformedPayment = await processEvent({
      id: earlyMalformedPaymentEventId,
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: earlyMalformedPaymentId,
        subscription: earlyMalformedSubscriptionId,
        customer: malformedCustomerId,
        value: "59.899",
        billingType: "CREDIT_CARD",
      },
    });
    expect(heldMalformedPayment).toMatchObject({
      processed: false,
      error: "confirmed_payment_unmatched",
    });

    const replayMalformedSubscription = await processEvent({
      id: earlyMalformedSubscriptionEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: earlyMalformedSubscriptionId,
        customer: malformedCustomerId,
        externalReference: earlyMalformedExternalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(replayMalformedSubscription).toMatchObject({
      processed: true,
      event: "SUBSCRIPTION_CREATED",
    });

    const replayedMalformedEvent = await serviceApi(
      "ordys_billing_webhook_events?select=processing_status,error_code,retry_payload"
        + "&provider_event_id=eq."
        + encodeURIComponent(earlyMalformedPaymentEventId)
        + "&limit=1",
    );
    expect(replayedMalformedEvent.ok).toBe(true);
    expect(await replayedMalformedEvent.json()).toEqual([{
      processing_status: "failed",
      error_code: "amount_mismatch",
      retry_payload: null,
    }]);

    const earlyMalformedLedger = await serviceApi(
      "ordys_billing_payments?select=provider_payment_id&provider_payment_id=eq."
        + encodeURIComponent(earlyMalformedPaymentId)
        + "&limit=1",
    );
    expect(earlyMalformedLedger.ok).toBe(true);
    expect(await earlyMalformedLedger.json()).toEqual([]);

    const earlyMalformedEligibility = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: earlyMalformedUser.id }),
    });
    expect(earlyMalformedEligibility.ok).toBe(true);
    expect(await earlyMalformedEligibility.json()).toBe(false);

    const invalidSubscriptionRows = await serviceApi(
      "ordys_billing_subscriptions?select=id&provider_subscription_id=eq."
        + encodeURIComponent(malformedSubscriptionId)
        + "&limit=1",
    );
    expect(invalidSubscriptionRows.ok).toBe(true);
    expect(await invalidSubscriptionRows.json()).toHaveLength(1);

    const invalidAmountRows = await serviceApi(
      "ordys_billing_payments?select=provider_payment_id&provider_payment_id=in.("
        + [
          invalidPaymentId,
          overflowPaymentId,
          specialPaymentId,
          fractionalPaymentId,
        ]
          .map(encodeURIComponent)
          .join(",")
        + ")",
    );
    expect(invalidAmountRows.ok).toBe(true);
    expect(await invalidAmountRows.json()).toEqual([]);

    const validPaymentRows = await serviceApi(
      "ordys_billing_payments?select=provider_payment_id,due_date&provider_payment_id=eq."
        + encodeURIComponent(dueDatePaymentId)
        + "&limit=1",
    );
    expect(validPaymentRows.ok).toBe(true);
    expect(await validPaymentRows.json()).toEqual([{
      provider_payment_id: dueDatePaymentId,
      due_date: null,
    }]);

    const quarantinedEventIds = [
      invalidSubscriptionEventId,
      subscriptionOverflowEventId,
      subscriptionSpecialValueEventId,
      subscriptionFractionalCentsEventId,
      invalidPaymentEventId,
      overflowPaymentEventId,
      specialPaymentEventId,
      fractionalPaymentEventId,
    ].map(encodeURIComponent).join(",");
    const quarantinedEventsPath =
      "ordys_billing_webhook_events?select=provider_event_id,processing_status,error_code"
        + "&provider_event_id=in.("
        + quarantinedEventIds
        + ")";
    const quarantinedEvents = await serviceApi(quarantinedEventsPath);
    expect(quarantinedEvents.ok).toBe(true);
    const rows = await quarantinedEvents.json() as Array<{
      provider_event_id: string;
      processing_status: string;
      error_code: string | null;
    }>;
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.processing_status === "failed")).toBe(true);
    expect(rows.find((row) => row.provider_event_id === invalidSubscriptionEventId)?.error_code)
      .toBe("subscription_amount_mismatch");
    expect(rows.find((row) => row.provider_event_id === subscriptionOverflowEventId)?.error_code)
      .toBe("subscription_amount_mismatch");
    const specialSubscriptionRow = rows.find(
      (row) => row.provider_event_id === subscriptionSpecialValueEventId,
    );
    expect(specialSubscriptionRow?.error_code).toBe("subscription_amount_mismatch");
    const fractionalSubscriptionRow = rows.find(
      (row) => row.provider_event_id === subscriptionFractionalCentsEventId,
    );
    expect(fractionalSubscriptionRow?.error_code).toBe(
      "subscription_amount_mismatch",
    );
    expect(rows.find((row) => row.provider_event_id === invalidPaymentEventId)?.error_code)
      .toBe("amount_mismatch");
    expect(rows.find((row) => row.provider_event_id === overflowPaymentEventId)?.error_code)
      .toBe("amount_mismatch");
    expect(rows.find((row) => row.provider_event_id === specialPaymentEventId)?.error_code)
      .toBe("amount_mismatch");
    expect(rows.find((row) => row.provider_event_id === fractionalPaymentEventId)?.error_code)
      .toBe("amount_mismatch");
  }, 30_000);

  it("usa o próximo timestamp válido e limita datas de pagamento futuras", async () => {
    const fallbackUser = await createTestUser("payment-date-fallback");
    const futureUser = await createTestUser("payment-date-future-cap");
    extraUsers.push(fallbackUser, futureUser);

    const fallbackAttemptId = crypto.randomUUID();
    const futureAttemptId = crypto.randomUUID();
    const fallbackExternalReference =
      "ordys_ci_payment_date_fallback_" + crypto.randomUUID().replaceAll("-", "");
    const futureExternalReference =
      "ordys_ci_payment_date_future_" + crypto.randomUUID().replaceAll("-", "");
    const fallbackCustomerId = "cus_ordys_ci_payment_date_fallback_" + unique;
    const futureCustomerId = "cus_ordys_ci_payment_date_future_" + unique;
    const fallbackSubscriptionId = "sub_ordys_ci_payment_date_fallback_" + unique;
    const futureSubscriptionId = "sub_ordys_ci_payment_date_future_" + unique;
    const fallbackPaymentId = "pay_ordys_ci_payment_date_fallback_" + unique;
    const futurePaymentId = "pay_ordys_ci_payment_date_future_" + unique;
    const fallbackSubscriptionEventId = "evt_ordys_ci_payment_date_fallback_sub_" + unique;
    const futureSubscriptionEventId = "evt_ordys_ci_payment_date_future_sub_" + unique;
    const fallbackPaymentEventId = "evt_ordys_ci_payment_date_fallback_payment_" + unique;
    const futurePaymentEventId = "evt_ordys_ci_payment_date_future_payment_" + unique;
    eventIds.push(
      fallbackSubscriptionEventId,
      futureSubscriptionEventId,
      fallbackPaymentEventId,
      futurePaymentEventId,
    );

    for (const [attemptId, owner, externalReference] of [
      [fallbackAttemptId, fallbackUser, fallbackExternalReference],
      [futureAttemptId, futureUser, futureExternalReference],
    ] as const) {
      const attempt = await serviceApi("ordys_billing_checkout_attempts", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id: attemptId,
          user_id: owner.id,
          plan_code: "plus_monthly",
          external_reference: externalReference,
          provider_customer_id: null,
          amount_cents: 5_990,
          status: "pending",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(attempt.ok, await attempt.clone().text()).toBe(true);
    }

    const fallbackSubscription = await processEvent({
      id: fallbackSubscriptionEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: fallbackSubscriptionId,
        customer: fallbackCustomerId,
        externalReference: fallbackExternalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(fallbackSubscription).toMatchObject({
      processed: true,
      event: "SUBSCRIPTION_CREATED",
    });

    const futureSubscription = await processEvent({
      id: futureSubscriptionEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: futureSubscriptionId,
        customer: futureCustomerId,
        externalReference: futureExternalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(futureSubscription).toMatchObject({
      processed: true,
      event: "SUBSCRIPTION_CREATED",
    });

    const fallbackConfirmedDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const fallbackPayment = await processEvent({
      id: fallbackPaymentEventId,
      event: "PAYMENT_CONFIRMED",
      dateCreated: "not-a-date",
      payment: {
        id: fallbackPaymentId,
        subscription: fallbackSubscriptionId,
        customer: fallbackCustomerId,
        value: "59.9",
        billingType: "CREDIT_CARD",
        paymentDate: "not-a-date",
        confirmedDate: fallbackConfirmedDate,
      },
    });
    expect(fallbackPayment).toMatchObject({
      processed: true,
      event: "PAYMENT_CONFIRMED",
    });

    const futurePayment = await processEvent({
      id: futurePaymentEventId,
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: futurePaymentId,
        subscription: futureSubscriptionId,
        customer: futureCustomerId,
        value: "59.9",
        billingType: "CREDIT_CARD",
        paymentDate: "2099-01-01",
      },
    });
    expect(futurePayment).toMatchObject({
      processed: true,
      event: "PAYMENT_CONFIRMED",
    });

    const fallbackRows = await serviceApi(
      "ordys_billing_subscriptions?select=current_period_end&provider_subscription_id=eq."
        + encodeURIComponent(fallbackSubscriptionId)
        + "&limit=1",
    );
    expect(fallbackRows.ok).toBe(true);
    const fallbackSubscriptions = await fallbackRows.json() as Array<{
      current_period_end: string | null;
    }>;
    expect(fallbackSubscriptions).toHaveLength(1);
    const expectedFallbackEnd = new Date(
      fallbackConfirmedDate + "T00:00:00.000Z",
    );
    expectedFallbackEnd.setUTCMonth(expectedFallbackEnd.getUTCMonth() + 1);
    expect(Date.parse(fallbackSubscriptions[0]!.current_period_end ?? "")).toBe(
      expectedFallbackEnd.getTime(),
    );

    const futureRows = await serviceApi(
      "ordys_billing_subscriptions?select=current_period_end&provider_subscription_id=eq."
        + encodeURIComponent(futureSubscriptionId)
        + "&limit=1",
    );
    expect(futureRows.ok).toBe(true);
    const futureSubscriptions = await futureRows.json() as Array<{
      current_period_end: string | null;
    }>;
    expect(futureSubscriptions).toHaveLength(1);
    const futurePeriodEnd = Date.parse(futureSubscriptions[0]!.current_period_end ?? "");
    expect(futurePeriodEnd).toBeGreaterThan(Date.now() + 27 * 24 * 60 * 60 * 1000);
    expect(futurePeriodEnd).toBeLessThan(Date.now() + 32 * 24 * 60 * 60 * 1000);
  }, 30_000);

  it("associa a assinatura à conta correta e aplica pagamento, idempotência, eventos atrasados, cancelamento e estorno", async () => {
    const subscriptionEvent = {
      id: eventIds[0],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: subscriptionId,
        customer: customerId,
        externalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    };
    const subscriptionResult = await processEvent(subscriptionEvent);
    expect(subscriptionResult).toMatchObject({ processed: true, event: "SUBSCRIPTION_CREATED" });

    // Simulate non-sequential delivery: the subscription event arrives while
    // the Checkout attempt is still pending, before CHECKOUT_PAID.
    const linkedAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_customer_id,provider_checkout_id&id=eq.${checkoutAttemptId}&limit=1`,
    );
    const linkedRows = await linkedAttempt.json() as Array<{
      status: string;
      provider_customer_id: string | null;
      provider_checkout_id: string | null;
    }>;
    expect(linkedRows[0]).toMatchObject({ status: "linked", provider_customer_id: customerId, provider_checkout_id: null });

    // The checkout's payment event arrives before the API response has stored
    // checkout.id locally. externalReference must recover the same attempt.
    const checkoutPaid = await processEvent({
      id: eventIds[1],
      event: "CHECKOUT_PAID",
      checkout: {
        id: checkoutId,
        externalReference,
        customer: customerId,
      },
    });
    expect(checkoutPaid).toMatchObject({ processed: true, event: "CHECKOUT_PAID" });
    const recoveredAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_checkout_id&id=eq.${checkoutAttemptId}&limit=1`,
    );
    const recoveredRows = await recoveredAttempt.json() as Array<{ status: string; provider_checkout_id: string | null }>;
    expect(recoveredRows[0]).toMatchObject({ status: "linked", provider_checkout_id: checkoutId });

    const pending = await readSubscription();
    expect(pending).toMatchObject({
      status: "pending",
      provider_status: "ACTIVE",
      checkout_attempt_id: checkoutAttemptId,
    });
    expect(await isEligible()).toBe(false);

    const paidAt = new Date();
    const paymentEvent = {
      id: eventIds[2],
      event: "PAYMENT_CONFIRMED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: paymentId,
        subscription: subscriptionId,
        customer: customerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    };
    const paymentResult = await processEvent(paymentEvent);
    expect(paymentResult).toMatchObject({ processed: true, event: "PAYMENT_CONFIRMED" });

    let active = await readSubscription();
    expect(active.status).toBe("active");
    expect(active.current_period_end).toBeTruthy();
    expect(Date.parse(active.current_period_end!)).toBeGreaterThan(paidAt.getTime());
    expect(await isEligible()).toBe(true);

    const duplicateResult = await processEvent(paymentEvent);
    expect(duplicateResult).toMatchObject({ processed: false, duplicate: true });
    const afterDuplicate = await readSubscription();
    expect(afterDuplicate.current_period_end).toBe(active.current_period_end);

    const staleOverdue = await processEvent({
      id: eventIds[3],
      event: "PAYMENT_OVERDUE",
      payment: {
        id: paymentId,
        subscription: subscriptionId,
        customer: customerId,
      },
    });
    expect(staleOverdue).toMatchObject({
      processed: true,
      ignored_stale_payment_event: true,
    });
    expect((await readSubscription()).status).toBe("active");

    // Confirmed payment and overdue webhooks for the same subscription may
    // arrive concurrently. The shared subscription lock makes the final state
    // deterministic regardless of which request acquires it first.
    const concurrentPaymentId = `pay_ordys_ci_concurrent_${unique}`;
    const concurrentPaidAt = new Date();
    const [concurrentPayment, concurrentOverdue] = await Promise.all([
      processEvent({
        id: eventIds[23],
        event: "PAYMENT_CONFIRMED",
        dateCreated: concurrentPaidAt.toISOString(),
        payment: {
          id: concurrentPaymentId,
          subscription: subscriptionId,
          customer: customerId,
          billingType: "CREDIT_CARD",
          value: 59.9,
          dueDate: concurrentPaidAt.toISOString().slice(0, 10),
          paymentDate: concurrentPaidAt.toISOString(),
        },
      }),
      processEvent({
        id: eventIds[24],
        event: "PAYMENT_OVERDUE",
        payment: {
          id: concurrentPaymentId,
          subscription: subscriptionId,
          customer: customerId,
        },
      }),
    ]);
    expect(concurrentPayment).toMatchObject({ processed: true, event: "PAYMENT_CONFIRMED" });
    expect(concurrentOverdue).toMatchObject({ processed: true, event: "PAYMENT_OVERDUE" });
    active = await readSubscription();
    expect(active.status).toBe("active");

    const deleted = await processEvent({
      id: eventIds[4],
      event: "SUBSCRIPTION_DELETED",
      subscription: { id: subscriptionId, customer: customerId },
    });
    expect(deleted).toMatchObject({ processed: true, event: "SUBSCRIPTION_DELETED" });
    const cancelled = await readSubscription();
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.current_period_end).toBe(active.current_period_end);
    expect(await isEligible()).toBe(true);

    const attempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status&id=eq.${checkoutAttemptId}&limit=1`,
    );
    const attemptRows = await attempt.json() as Array<{ status: string }>;
    expect(attemptRows[0]?.status).toBe("cancelled");

    // A later confirmed payment may extend the already-paid access period,
    // but must never reopen a Checkout attempt after provider deletion.
    const latePaymentDate = new Date();
    const latePayment = await processEvent({
      id: eventIds[22],
      event: "PAYMENT_CONFIRMED",
      dateCreated: latePaymentDate.toISOString(),
      payment: {
        id: `pay_ordys_ci_late_${unique}`,
        subscription: subscriptionId,
        customer: customerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: latePaymentDate.toISOString().slice(0, 10),
        paymentDate: latePaymentDate.toISOString(),
      },
    });
    expect(latePayment).toMatchObject({ processed: true, event: "PAYMENT_CONFIRMED" });
    const afterLatePayment = await readSubscription();
    expect(afterLatePayment.status).toBe("cancelled");
    expect(afterLatePayment.provider_status).toBe("DELETED");
    const attemptAfterLatePayment = await serviceApi(
      `ordys_billing_checkout_attempts?select=status&id=eq.${checkoutAttemptId}&limit=1`,
    );
    const attemptAfterLatePaymentRows = await attemptAfterLatePayment.json() as Array<{ status: string }>;
    expect(attemptAfterLatePaymentRows[0]?.status).toBe("cancelled");

    const refunded = await processEvent({
      id: eventIds[5],
      event: "PAYMENT_REFUNDED",
      payment: {
        id: paymentId,
        subscription: subscriptionId,
        customer: customerId,
      },
    });
    expect(refunded).toMatchObject({ processed: true, event: "PAYMENT_REFUNDED" });
    expect((await readSubscription()).status).toBe("suspended");
    expect(await isEligible()).toBe(false);

    // Recreate the legacy state from before SUBSCRIPTION_DELETED persisted its
    // confirmation marker: the refund/chargeback lock remains suspended, but
    // a previously requested cancellation has no local confirmation yet.
    const legacyMarkerReset = await serviceApi(
      `ordys_billing_subscriptions?id=eq.${encodeURIComponent(subscriptionId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          cancellation_requested_at: new Date().toISOString(),
          cancellation_confirmed_at: null,
        }),
      },
    );
    expect(legacyMarkerReset.ok, await legacyMarkerReset.clone().text()).toBe(true);

    const reserve = await serviceApi("rpc/ordys_reserve_account_deletion", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user!.id }),
    });
    expect(reserve.ok, await reserve.clone().text()).toBe(true);
    expect(await reserve.json()).toBe("reserved");

    const deletedSuspended = await processEvent({
      id: eventIds[10],
      event: "SUBSCRIPTION_DELETED",
      subscription: { id: subscriptionId, customer: customerId },
    });
    expect(deletedSuspended).toMatchObject({ processed: true, event: "SUBSCRIPTION_DELETED" });

    const confirmedSuspended = await serviceApi(
      `ordys_billing_subscriptions?select=status,cancellation_confirmed_at&provider_subscription_id=eq.${encodeURIComponent(subscriptionId)}&limit=1`,
    );
    expect(confirmedSuspended.ok, await confirmedSuspended.clone().text()).toBe(true);
    const confirmedRows = await confirmedSuspended.json() as Array<{
      status: string;
      cancellation_confirmed_at: string | null;
    }>;
    expect(confirmedRows).toHaveLength(1);
    expect(confirmedRows[0]?.status).toBe("suspended");
    expect(confirmedRows[0]?.cancellation_confirmed_at).toBeTruthy();

    const release = await serviceApi("rpc/ordys_release_account_deletion_reservation", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user!.id, p_provider_state_verified: true }),
    });
    expect(release.ok, await release.clone().text()).toBe(true);
    expect(await release.json()).toBe("released");

    // Exercise the privileged confirmation RPC used by profile cancellation.
    // It must preserve the current chargeback-suspended state at write time.
    const checkoutRestored = await serviceApi(
      `ordys_billing_checkout_attempts?id=eq.${encodeURIComponent(checkoutAttemptId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "linked" }),
      },
    );
    expect(checkoutRestored.ok, await checkoutRestored.clone().text()).toBe(true);

    const manualRequestedAt = new Date().toISOString();
    const manualIntent = await serviceApi(
      `ordys_billing_subscriptions?provider_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          provider_status: "ACTIVE",
          cancellation_requested_at: manualRequestedAt,
          cancellation_confirmed_at: null,
        }),
      },
    );
    expect(manualIntent.ok, await manualIntent.clone().text()).toBe(true);

    const localSubscriptionResult = await serviceApi(
      `ordys_billing_subscriptions?select=id&provider_subscription_id=eq.${encodeURIComponent(subscriptionId)}&limit=1`,
    );
    expect(localSubscriptionResult.ok, await localSubscriptionResult.clone().text()).toBe(true);
    const localSubscriptionRows = await localSubscriptionResult.json() as Array<{ id: string }>;
    expect(localSubscriptionRows).toHaveLength(1);

    const manualConfirmation = await serviceApi("rpc/ordys_confirm_subscription_cancellation", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: user!.id,
        p_subscription_id: localSubscriptionRows[0]!.id,
        p_cancellation_requested_at: manualRequestedAt,
      }),
    });
    expect(manualConfirmation.ok, await manualConfirmation.clone().text()).toBe(true);
    expect(await manualConfirmation.json()).toBe("confirmed");

    const manuallyCancelled = await readSubscription();
    expect(manuallyCancelled.status).toBe("suspended");
    const checkoutAfterManualConfirmation = await serviceApi(
      `ordys_billing_checkout_attempts?select=status&id=eq.${encodeURIComponent(checkoutAttemptId)}&limit=1`,
    );
    expect(checkoutAfterManualConfirmation.ok, await checkoutAfterManualConfirmation.clone().text()).toBe(true);
    const checkoutAfterManualRows = await checkoutAfterManualConfirmation.json() as Array<{ status: string }>;
    expect(checkoutAfterManualRows[0]?.status).toBe("cancelled");

    const manualMarker = await serviceApi(
      `ordys_billing_subscriptions?select=cancellation_confirmed_at&provider_subscription_id=eq.${encodeURIComponent(subscriptionId)}&limit=1`,
    );
    expect(manualMarker.ok, await manualMarker.clone().text()).toBe(true);
    const manualMarkerRows = await manualMarker.json() as Array<{ cancellation_confirmed_at: string | null }>;
    expect(manualMarkerRows[0]?.cancellation_confirmed_at).toBeTruthy();

    // Legacy profile cancellation could persist provider_status=DELETED but
    // fail before the separate Checkout PATCH. The new RPC must reconcile this
    // confirmed provider state without requiring a newer intent marker.
    const legacyCheckoutRestored = await serviceApi(
      `ordys_billing_checkout_attempts?id=eq.${encodeURIComponent(checkoutAttemptId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "linked" }),
      },
    );
    expect(legacyCheckoutRestored.ok, await legacyCheckoutRestored.clone().text()).toBe(true);

    const legacySubscriptionState = await serviceApi(
      `ordys_billing_subscriptions?provider_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "suspended",
          provider_status: "DELETED",
          cancellation_requested_at: null,
          cancellation_confirmed_at: null,
        }),
      },
    );
    expect(legacySubscriptionState.ok, await legacySubscriptionState.clone().text()).toBe(true);

    const legacyConfirmation = await serviceApi("rpc/ordys_confirm_subscription_cancellation", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: user!.id,
        p_subscription_id: localSubscriptionRows[0]!.id,
        p_cancellation_requested_at: null,
      }),
    });
    expect(legacyConfirmation.ok, await legacyConfirmation.clone().text()).toBe(true);
    expect(await legacyConfirmation.json()).toBe("confirmed");

    const legacyReconciled = await readSubscription();
    expect(legacyReconciled.status).toBe("suspended");
    const legacyCheckout = await serviceApi(
      `ordys_billing_checkout_attempts?select=status&id=eq.${encodeURIComponent(checkoutAttemptId)}&limit=1`,
    );
    expect(legacyCheckout.ok, await legacyCheckout.clone().text()).toBe(true);
    const legacyCheckoutRows = await legacyCheckout.json() as Array<{ status: string }>;
    expect(legacyCheckoutRows[0]?.status).toBe("cancelled");
  }, 30_000);

  it("associa assinatura sem externalReference quando CHECKOUT_PAID é entregue sequencialmente", async () => {
    const sequentialCustomerId = `cus_ordys_ci_seq_${unique}`;
    const sequentialCheckoutId = `chk_ordys_ci_seq_${unique}`;
    const sequentialSubscriptionId = `sub_ordys_ci_seq_${unique}`;
    const sequentialAttemptId = crypto.randomUUID();
    const sequentialReference = `ordys_ci_seq_${unique}`;
    const sequentialPaymentId = `pay_ordys_ci_seq_${unique}`;

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: sequentialAttemptId,
        user_id: user!.id,
        plan_code: "plus_monthly",
        external_reference: sequentialReference,
        provider_checkout_id: sequentialCheckoutId,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    const attemptBody = await attempt.text();
    expect(attempt.ok, attemptBody).toBe(true);

    const checkoutPaid = await processEvent({
      id: eventIds[6],
      event: "CHECKOUT_PAID",
      checkout: {
        id: sequentialCheckoutId,
        customer: sequentialCustomerId,
      },
    });
    expect(checkoutPaid).toMatchObject({ processed: true, event: "CHECKOUT_PAID" });

    const linked = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_customer_id&id=eq.${sequentialAttemptId}&limit=1`,
    );
    const linkedRows = await linked.json() as Array<{ status: string; provider_customer_id: string | null }>;
    expect(linkedRows[0]).toMatchObject({
      status: "paid",
      provider_customer_id: sequentialCustomerId,
    });

    const subscriptionCreated = await processEvent({
      id: eventIds[7],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: sequentialSubscriptionId,
        customer: sequentialCustomerId,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(subscriptionCreated).toMatchObject({
      processed: true,
      event: "SUBSCRIPTION_CREATED",
    });

    const subscription = await serviceApi(
      `ordys_billing_subscriptions?select=status,checkout_attempt_id&provider_subscription_id=eq.${sequentialSubscriptionId}&limit=1`,
    );
    const subscriptionRows = await subscription.json() as Array<{ status: string; checkout_attempt_id: string }>;
    expect(subscriptionRows[0]).toMatchObject({
      status: "pending",
      checkout_attempt_id: sequentialAttemptId,
    });

    const paidAt = new Date();
    const payment = await processEvent({
      id: eventIds[8],
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: sequentialPaymentId,
        subscription: sequentialSubscriptionId,
        customer: sequentialCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(payment).toMatchObject({ processed: true, event: "PAYMENT_RECEIVED" });

    const eligible = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: user!.id }),
    });
    expect(eligible.ok).toBe(true);
    expect(await eligible.json()).toBe(true);
  }, 30_000);

  it("reconcilia SUBSCRIPTION_CREATED sem externalReference depois que CHECKOUT_PAID informa o cliente", async () => {
    const retryUser = await createTestUser("subscription-webhook-retry");
    extraUsers.push(retryUser);

    const retryAttemptId = crypto.randomUUID();
    const retryCheckoutId = `chk_ordys_ci_retry_${unique}`;
    const retryCustomerId = `cus_ordys_ci_retry_${unique}`;
    const retrySubscriptionId = `sub_ordys_ci_retry_${unique}`;
    const retryExternalReference = `ordys_ci_retry_${unique}`;

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: retryAttemptId,
        user_id: retryUser.id,
        plan_code: "plus_monthly",
        external_reference: retryExternalReference,
        provider_checkout_id: retryCheckoutId,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    // Asaas documents that subscription.externalReference may be null.
    // If SUBSCRIPTION_CREATED arrives before CHECKOUT_PAID, it cannot yet
    // safely associate the provider customer with the pending attempt.
    const subscriptionFirst = await processEvent({
      id: eventIds[11],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: retrySubscriptionId,
        customer: retryCustomerId,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
        externalReference: null,
      },
    });
    expect(subscriptionFirst).toMatchObject({
      processed: false,
      error: "subscription_checkout_unmatched",
    });

    const heldEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,provider_customer_id,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[11]!)}&limit=1`,
    );
    expect(heldEvent.ok, await heldEvent.clone().text()).toBe(true);
    const heldRows = await heldEvent.json() as Array<{
      processing_status: string;
      error_code: string | null;
      provider_customer_id: string | null;
      retry_payload: Record<string, unknown> | null;
    }>;
    expect(heldRows[0]).toMatchObject({
      processing_status: "failed",
      error_code: "subscription_checkout_unmatched",
      provider_customer_id: retryCustomerId,
    });
    expect(heldRows[0]?.retry_payload).toMatchObject({
      id: eventIds[11],
      event: "SUBSCRIPTION_CREATED",
      subscription: { id: retrySubscriptionId, customer: retryCustomerId },
    });

    // CHECKOUT_PAID establishes the unique customer-to-attempt relationship.
    // The SQL transaction replays only that customer's held subscription event.
    const checkoutPaid = await processEvent({
      id: eventIds[12],
      event: "CHECKOUT_PAID",
      checkout: { id: retryCheckoutId, customer: retryCustomerId },
    });
    expect(checkoutPaid).toMatchObject({ processed: true, event: "CHECKOUT_PAID" });

    const linkedAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_customer_id&id=eq.${encodeURIComponent(retryAttemptId)}&limit=1`,
    );
    expect(linkedAttempt.ok, await linkedAttempt.clone().text()).toBe(true);
    expect(await linkedAttempt.json()).toEqual([{
      status: "linked",
      provider_customer_id: retryCustomerId,
    }]);

    const linkedSubscription = await serviceApi(
      `ordys_billing_subscriptions?select=user_id,status,checkout_attempt_id&provider_subscription_id=eq.${encodeURIComponent(retrySubscriptionId)}&limit=1`,
    );
    expect(linkedSubscription.ok, await linkedSubscription.clone().text()).toBe(true);
    expect(await linkedSubscription.json()).toEqual([{
      user_id: retryUser.id,
      status: "pending",
      checkout_attempt_id: retryAttemptId,
    }]);

    const reconciledEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[11]!)}&limit=1`,
    );
    expect(reconciledEvent.ok, await reconciledEvent.clone().text()).toBe(true);
    expect(await reconciledEvent.json()).toEqual([{
      processing_status: "processed",
      error_code: null,
      retry_payload: null,
    }]);
  }, 30_000);


  it("reconcilia SUBSCRIPTION_DELETED antes do pagamento do Checkout e da criação local", async () => {
    const deletionFirstUser = await createTestUser("delete-before-subscription");
    extraUsers.push(deletionFirstUser);

    const attemptId = crypto.randomUUID();
    const providerCheckoutId = `chk_ordys_ci_delete_first_${unique}`;
    const providerCustomerId = `cus_ordys_ci_delete_first_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_delete_first_${unique}`;
    const externalRef = `ordys_ci_delete_first_${unique}`;

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: deletionFirstUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: providerCheckoutId,
        provider_customer_id: providerCustomerId,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    // Asaas omits externalReference. The only exact customer candidate is
    // still pending locally, so retain the terminal event without linking it.
    const deletionFirst = await processEvent({
      id: eventIds[25],
      event: "SUBSCRIPTION_DELETED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
      },
    });
    expect(deletionFirst).toMatchObject({
      processed: false,
      error: "subscription_delete_unmatched",
    });

    const heldDeletion = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[25]!)}&limit=1`,
    );
    expect(heldDeletion.ok, await heldDeletion.clone().text()).toBe(true);
    expect(await heldDeletion.json()).toEqual([{
      processing_status: "failed",
      error_code: "subscription_delete_unmatched",
      retry_payload: {
        id: eventIds[25],
        event: "SUBSCRIPTION_DELETED",
        subscription: { id: providerSubscriptionId, customer: providerCustomerId },
      },
    }]);

    // The subscription-created event also arrives before CHECKOUT_PAID and
    // is held. No Plus access is granted until the payment event is accepted.
    const createdFirst = await processEvent({
      id: eventIds[26],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(createdFirst).toMatchObject({
      processed: false,
      error: "subscription_checkout_unmatched",
    });

    const heldCreation = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[26]!)}&limit=1`,
    );
    expect(heldCreation.ok, await heldCreation.clone().text()).toBe(true);
    expect(await heldCreation.json()).toEqual([{
      processing_status: "failed",
      error_code: "subscription_checkout_unmatched",
      retry_payload: {
        id: eventIds[26],
        event: "SUBSCRIPTION_CREATED",
        subscription: {
          id: providerSubscriptionId,
          customer: providerCustomerId,
          externalReference: null,
          value: "59.9",
          billingType: "CREDIT_CARD",
          cycle: "MONTHLY",
          status: "ACTIVE",
        },
      },
    }]);

    // CHECKOUT_PAID establishes the customer/attempt association and replays
    // SUBSCRIPTION_CREATED, which then replays the exact held deletion by ID.
    const checkoutPaid = await processEvent({
      id: eventIds[27],
      event: "CHECKOUT_PAID",
      checkout: {
        id: providerCheckoutId,
        customer: providerCustomerId,
        externalReference: externalRef,
      },
    });
    expect(checkoutPaid).toMatchObject({
      processed: true,
      event: "CHECKOUT_PAID",
    });

    const reconciled = await serviceApi(
      `ordys_billing_subscriptions?select=status,provider_status,cancellation_confirmed_at&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(reconciled.ok, await reconciled.clone().text()).toBe(true);
    const rows = await reconciled.json() as Array<{
      status: string;
      provider_status: string;
      cancellation_confirmed_at: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("cancelled");
    expect(rows[0]?.provider_status).toBe("DELETED");
    expect(rows[0]?.cancellation_confirmed_at).toBeTruthy();

    const checkout = await serviceApi(
      `ordys_billing_checkout_attempts?select=status&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(checkout.ok, await checkout.clone().text()).toBe(true);
    expect(await checkout.json()).toEqual([{ status: "cancelled" }]);

    for (const eventId of [eventIds[25]!, eventIds[26]!]) {
      const event = await serviceApi(
        `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
      );
      expect(event.ok, await event.clone().text()).toBe(true);
      expect(await event.json()).toEqual([{
        processing_status: "processed",
        error_code: null,
        retry_payload: null,
      }]);
    }
  }, 30_000);

    it("reconcilia pagamento confirmado recebido antes de SUBSCRIPTION_CREATED", async () => {
    const paymentFirstUser = await createTestUser("payment-before-subscription");
    extraUsers.push(paymentFirstUser);

    const attemptId = crypto.randomUUID();
    const checkoutProviderId = `chk_ordys_ci_paid_before_subscription_${unique}`;
    const providerCustomerId = `cus_ordys_ci_paid_before_subscription_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_paid_before_subscription_${unique}`;
    const providerPaymentId = `pay_ordys_ci_paid_before_subscription_${unique}`;
    const externalRef = `ordys_ci_paid_before_subscription_${unique}`;
    const paidAt = new Date();

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: paymentFirstUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: checkoutProviderId,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const checkoutPaid = await processEvent({
      id: eventIds[14],
      event: "CHECKOUT_PAID",
      checkout: { id: checkoutProviderId, customer: providerCustomerId },
    });
    expect(checkoutPaid).toMatchObject({ processed: true, event: "CHECKOUT_PAID" });

    const paymentCreatedFirst = await processEvent({
      id: paymentCreatedBeforeSubscriptionEventId,
      event: "PAYMENT_CREATED",
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
      },
    });
    expect(paymentCreatedFirst).toMatchObject({
      processed: false,
      error: "payment_subscription_unmatched",
    });

    const heldCreatedPayment = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,provider_customer_id,retry_payload&provider_event_id=eq.${encodeURIComponent(paymentCreatedBeforeSubscriptionEventId)}&limit=1`,
    );
    expect(heldCreatedPayment.ok, await heldCreatedPayment.clone().text()).toBe(true);
    expect(await heldCreatedPayment.json()).toMatchObject([{
      processing_status: "failed",
      error_code: "payment_subscription_unmatched",
      provider_customer_id: providerCustomerId,
      retry_payload: {
        id: paymentCreatedBeforeSubscriptionEventId,
        event: "PAYMENT_CREATED",
        payment: { id: providerPaymentId, subscription: providerSubscriptionId, customer: providerCustomerId },
      },
    }]);
    const paymentFirst = await processEvent({
      id: eventIds[15],
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(paymentFirst).toMatchObject({
      processed: false,
      error: "confirmed_payment_unmatched",
    });

    const heldPayment = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,provider_customer_id,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[15]!)}&limit=1`,
    );
    expect(heldPayment.ok, await heldPayment.clone().text()).toBe(true);
    expect(await heldPayment.json()).toEqual([{
      processing_status: "failed",
      error_code: "confirmed_payment_unmatched",
      provider_customer_id: providerCustomerId,
      retry_payload: {
        id: eventIds[15],
        event: "PAYMENT_RECEIVED",
        dateCreated: paidAt.toISOString(),
        payment: {
          id: providerPaymentId,
          subscription: providerSubscriptionId,
          customer: providerCustomerId,
          value: "59.9",
          billingType: "CREDIT_CARD",
          dueDate: paidAt.toISOString().slice(0, 10),
          paymentDate: paidAt.toISOString(),
          confirmedDate: null,
        },
      },
    }]);

    // The subscription has no externalReference, so CHECKOUT_PAID's customer ID
    // is the only safe association. Creation replays the held payment atomically.
    const subscriptionCreated = await processEvent({
      id: eventIds[16],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        externalReference: null,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(subscriptionCreated).toMatchObject({
      processed: true,
      event: "SUBSCRIPTION_CREATED",
    });
    const replayedCreatedPayment = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(paymentCreatedBeforeSubscriptionEventId)}&limit=1`,
    );
    expect(replayedCreatedPayment.ok, await replayedCreatedPayment.clone().text()).toBe(true);
    expect(await replayedCreatedPayment.json()).toEqual([{
      processing_status: "processed",
      error_code: null,
      retry_payload: null,
    }]);

    const subscription = await serviceApi(
      `ordys_billing_subscriptions?select=user_id,status,provider_customer_id,current_period_end,checkout_attempt_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(subscription.ok, await subscription.clone().text()).toBe(true);
    const subscriptionRows = await subscription.json() as Array<{
      user_id: string;
      status: string;
      provider_customer_id: string | null;
      current_period_end: string | null;
      checkout_attempt_id: string;
    }>;
    expect(subscriptionRows).toHaveLength(1);
    expect(subscriptionRows[0]).toMatchObject({
      user_id: paymentFirstUser.id,
      status: "active",
      provider_customer_id: providerCustomerId,
      checkout_attempt_id: attemptId,
    });
    expect(subscriptionRows[0]?.current_period_end).toBeTruthy();

    const payment = await serviceApi(
      `ordys_billing_payments?select=user_id,provider_subscription_id,status&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&limit=1`,
    );
    expect(payment.ok, await payment.clone().text()).toBe(true);
    expect(await payment.json()).toEqual([{
      user_id: paymentFirstUser.id,
      provider_subscription_id: providerSubscriptionId,
      status: "PAYMENT_RECEIVED",
    }]);

    const reconciledEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[15]!)}&limit=1`,
    );
    expect(reconciledEvent.ok, await reconciledEvent.clone().text()).toBe(true);
    expect(await reconciledEvent.json()).toEqual([{
      processing_status: "processed",
      error_code: null,
      retry_payload: null,
    }]);

    const eligible = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: paymentFirstUser.id }),
    });
    expect(eligible.ok).toBe(true);
    expect(await eligible.json()).toBe(true);
  }, 30_000);

  it("reconcilia estorno recebido antes do vínculo da assinatura e não libera Plus", async () => {
    const refundUser = await createTestUser("refund-before-subscription");
    extraUsers.push(refundUser);

    const attemptId = crypto.randomUUID();
    const providerCheckoutId = `chk_ordys_ci_refund_before_subscription_${unique}`;
    const providerCustomerId = `cus_ordys_ci_refund_before_subscription_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_refund_before_subscription_${unique}`;
    const providerPaymentId = `pay_ordys_ci_refund_before_subscription_${unique}`;
    const externalRef = `ordys_ci_refund_before_subscription_${unique}`;
    const paidAt = new Date();

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: refundUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: null,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const checkoutPaid = await processEvent({
      id: negativePaymentCheckoutPaidEventId,
      event: "CHECKOUT_PAID",
      checkout: {
        id: providerCheckoutId,
        customer: providerCustomerId,
        externalReference: externalRef,
      },
    });
    expect(checkoutPaid).toMatchObject({ processed: true, event: "CHECKOUT_PAID" });

    const confirmedPayment = await processEvent({
      id: negativePaymentConfirmedEventId,
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(confirmedPayment).toMatchObject({
      processed: false,
      error: "confirmed_payment_unmatched",
    });

    const refundedPayment = await processEvent({
      id: negativePaymentRefundedEventId,
      event: "PAYMENT_REFUNDED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(refundedPayment).toMatchObject({
      processed: false,
      error: "negative_payment_unmatched",
    });

    const heldRefund = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,provider_customer_id,retry_payload&provider_event_id=eq.${encodeURIComponent(negativePaymentRefundedEventId)}&limit=1`,
    );
    expect(heldRefund.ok, await heldRefund.clone().text()).toBe(true);
    expect(await heldRefund.json()).toMatchObject([{
      processing_status: "failed",
      error_code: "negative_payment_unmatched",
      provider_customer_id: providerCustomerId,
      retry_payload: {
        id: negativePaymentRefundedEventId,
        event: "PAYMENT_REFUNDED",
        payment: {
          id: providerPaymentId,
          subscription: providerSubscriptionId,
          customer: providerCustomerId,
        },
      },
    }]);

    // Link the exact subscription without the integration helper's automatic
    // queue drain so we can prove the refund is NOT retryable until its exact
    // payment ledger row has been committed.
    const subscriptionReceipt = await receiveEvent({
      id: negativePaymentSubscriptionCreatedEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        externalReference: externalRef,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(subscriptionReceipt.processing_status).toBe("received");
    const subscriptionCreated = await processReceivedEvent(negativePaymentSubscriptionCreatedEventId);
    expect(subscriptionCreated).toMatchObject({
      processed: true,
      event: "SUBSCRIPTION_CREATED",
    });

    const firstReplayBatch = await requeueRetryableWebhookEvents();
    expect(firstReplayBatch).toEqual([negativePaymentConfirmedEventId]);

    // The exact refund remains quarantined while its payment row is absent.
    // Only the confirmed payment can be replayed at this point.
    const confirmedReplay = await processReceivedEvent(negativePaymentConfirmedEventId);
    expect(confirmedReplay).toMatchObject({
      processed: true,
      event: "PAYMENT_RECEIVED",
    });

    const secondReplayBatch = await requeueRetryableWebhookEvents();
    expect(secondReplayBatch).toEqual([negativePaymentRefundedEventId]);

    const refundReplay = await processReceivedEvent(negativePaymentRefundedEventId);
    expect(refundReplay).toMatchObject({
      processed: true,
      event: "PAYMENT_REFUNDED",
    });

    const subscription = await serviceApi(
      `ordys_billing_subscriptions?select=user_id,status,provider_customer_id,checkout_attempt_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(subscription.ok, await subscription.clone().text()).toBe(true);
    expect(await subscription.json()).toEqual([{
      user_id: refundUser.id,
      status: "suspended",
      provider_customer_id: providerCustomerId,
      checkout_attempt_id: attemptId,
    }]);

    const payment = await serviceApi(
      `ordys_billing_payments?select=user_id,provider_subscription_id,status&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&limit=1`,
    );
    expect(payment.ok, await payment.clone().text()).toBe(true);
    expect(await payment.json()).toEqual([{
      user_id: refundUser.id,
      provider_subscription_id: providerSubscriptionId,
      status: "PAYMENT_REFUNDED",
    }]);

    for (const eventId of [
      negativePaymentConfirmedEventId,
      negativePaymentRefundedEventId,
    ]) {
      const event = await serviceApi(
        `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
      );
      expect(event.ok, await event.clone().text()).toBe(true);
      expect(await event.json()).toEqual([{
        processing_status: "processed",
        error_code: null,
        retry_payload: null,
      }]);
    }

    const eligible = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: refundUser.id }),
    });
    expect(eligible.ok).toBe(true);
    expect(await eligible.json()).toBe(false);
  }, 30_000);


  it("reconcilia estorno recebido após vínculo da assinatura, mas antes do pagamento confirmado", async () => {
    const refundUser = await createTestUser("refund-after-subscription-before-payment");
    extraUsers.push(refundUser);

    const attemptId = crypto.randomUUID();
    const providerCustomerId = `cus_ordys_ci_refund_after_subscription_before_payment_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_refund_after_subscription_before_payment_${unique}`;
    const initialPaymentId = `pay_ordys_ci_refund_initial_payment_${unique}`;
    const providerPaymentId = `pay_ordys_ci_refund_after_subscription_before_payment_${unique}`;
    const externalRef = `ordys_ci_refund_after_subscription_before_payment_${unique}`;
    const subscriptionCreatedEventId = `evt_ordys_ci_refund_after_subscription_created_${unique}`;
    const initialPaymentEventId = `evt_ordys_ci_refund_initial_payment_${unique}`;
    const refundEventId = `evt_ordys_ci_refund_after_subscription_refund_${unique}`;
    const paymentEventId = `evt_ordys_ci_refund_after_subscription_payment_${unique}`;
    const latePositiveEventId = `evt_ordys_ci_refund_after_subscription_late_received_${unique}`;
    eventIds.push(subscriptionCreatedEventId, initialPaymentEventId, refundEventId, paymentEventId, latePositiveEventId);
    const paidAt = new Date();

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: refundUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: null,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const subscriptionCreated = await processEvent({
      id: subscriptionCreatedEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        externalReference: externalRef,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(subscriptionCreated).toMatchObject({
      processed: true,
      event: "SUBSCRIPTION_CREATED",
    });

    const initialPayment = await processEvent({
      id: initialPaymentEventId,
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: initialPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(initialPayment).toMatchObject({
      processed: true,
      event: "PAYMENT_RECEIVED",
    });

    const eligibleBeforeRefund = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: refundUser.id }),
    });
    expect(eligibleBeforeRefund.ok, await eligibleBeforeRefund.clone().text()).toBe(true);
    expect(await eligibleBeforeRefund.json()).toBe(true);

    const refundedPayment = await processEvent({
      id: refundEventId,
      event: "PAYMENT_REFUNDED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(refundedPayment).toMatchObject({
      processed: false,
      error: "negative_payment_unmatched",
    });

    const suspendedBeforePayment = await serviceApi(
      `ordys_billing_subscriptions?select=status&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(suspendedBeforePayment.ok, await suspendedBeforePayment.clone().text()).toBe(true);
    expect(await suspendedBeforePayment.json()).toEqual([{ status: "suspended" }]);

    const eligibleAfterRefund = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: refundUser.id }),
    });
    expect(eligibleAfterRefund.ok, await eligibleAfterRefund.clone().text()).toBe(true);
    expect(await eligibleAfterRefund.json()).toBe(false);

    const heldRefund = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(refundEventId)}&limit=1`,
    );
    expect(heldRefund.ok, await heldRefund.clone().text()).toBe(true);
    expect(await heldRefund.json()).toMatchObject([{
      processing_status: "failed",
      error_code: "negative_payment_unmatched",
      retry_payload: {
        id: refundEventId,
        event: "PAYMENT_REFUNDED",
        payment: {
          id: providerPaymentId,
          subscription: providerSubscriptionId,
          customer: providerCustomerId,
        },
      },
    }]);

    const confirmedPayment = await processEvent({
      id: paymentEventId,
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(confirmedPayment).toMatchObject({
      processed: true,
      event: "PAYMENT_RECEIVED",
    });

    const subscription = await serviceApi(
      `ordys_billing_subscriptions?select=user_id,status,provider_customer_id,checkout_attempt_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(subscription.ok, await subscription.clone().text()).toBe(true);
    expect(await subscription.json()).toEqual([{
      user_id: refundUser.id,
      status: "suspended",
      provider_customer_id: providerCustomerId,
      checkout_attempt_id: attemptId,
    }]);

    const payment = await serviceApi(
      `ordys_billing_payments?select=user_id,provider_subscription_id,status&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&limit=1`,
    );
    expect(payment.ok, await payment.clone().text()).toBe(true);
    expect(await payment.json()).toEqual([{
      user_id: refundUser.id,
      provider_subscription_id: providerSubscriptionId,
      status: "PAYMENT_REFUNDED",
    }]);

    // A delayed duplicate positive event must not overwrite the refund ledger.
    const latePositive = await processEvent({
      id: latePositiveEventId,
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(latePositive).toMatchObject({
      processed: true,
      event: "PAYMENT_RECEIVED",
    });

    const paymentAfterLatePositive = await serviceApi(
      `ordys_billing_payments?select=user_id,provider_subscription_id,status&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&limit=1`,
    );
    expect(paymentAfterLatePositive.ok, await paymentAfterLatePositive.clone().text()).toBe(true);
    expect(await paymentAfterLatePositive.json()).toEqual([{
      user_id: refundUser.id,
      provider_subscription_id: providerSubscriptionId,
      status: "PAYMENT_REFUNDED",
    }]);

    const reconciledRefund = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(refundEventId)}&limit=1`,
    );
    expect(reconciledRefund.ok, await reconciledRefund.clone().text()).toBe(true);
    expect(await reconciledRefund.json()).toEqual([{
      processing_status: "processed",
      error_code: null,
      retry_payload: null,
    }]);

    const eligible = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: refundUser.id }),
    });
    expect(eligible.ok, await eligible.clone().text()).toBe(true);
    expect(await eligible.json()).toBe(false);
  }, 30_000);

  it("registra reversão de chargeback sem reativar Plus automaticamente", async () => {
    const reversalUser = await createTestUser("chargeback-reversal");
    extraUsers.push(reversalUser);

    const attemptId = crypto.randomUUID();
    const externalRef = `ordys_ci_chargeback_reversal_${unique}`;
    const providerCustomerId = `cus_ordys_ci_chargeback_reversal_${unique}`;
    const providerCheckoutId = `chk_ordys_ci_chargeback_reversal_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_chargeback_reversal_${unique}`;
    const providerPaymentId = `pay_ordys_ci_chargeback_reversal_${unique}`;
    const checkoutEventId = `evt_ordys_ci_chargeback_reversal_checkout_${unique}`;
    const subscriptionEventId = `evt_ordys_ci_chargeback_reversal_subscription_${unique}`;
    const initialPaymentEventId = `evt_ordys_ci_chargeback_reversal_initial_payment_${unique}`;
    const chargebackRequestedEventId = `evt_ordys_ci_chargeback_reversal_requested_${unique}`;
    const chargebackDisputeEventId = `evt_ordys_ci_chargeback_reversal_dispute_${unique}`;
    const awaitingReversalEventId = `evt_ordys_ci_chargeback_reversal_awaiting_${unique}`;
    const finalPaymentEventId = `evt_ordys_ci_chargeback_reversal_final_payment_${unique}`;
    eventIds.push(
      checkoutEventId,
      subscriptionEventId,
      initialPaymentEventId,
      chargebackRequestedEventId,
      chargebackDisputeEventId,
      awaitingReversalEventId,
      finalPaymentEventId,
    );
    const paidAt = new Date();

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: reversalUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: null,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const checkoutPaid = await processEvent({
      id: checkoutEventId,
      event: "CHECKOUT_PAID",
      checkout: { id: providerCheckoutId, customer: providerCustomerId, externalReference: externalRef },
    });
    expect(checkoutPaid).toMatchObject({ processed: true, event: "CHECKOUT_PAID" });

    const subscriptionCreated = await processEvent({
      id: subscriptionEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        externalReference: externalRef,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(subscriptionCreated).toMatchObject({ processed: true, event: "SUBSCRIPTION_CREATED" });

    const initialPayment = await processEvent({
      id: initialPaymentEventId,
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(initialPayment).toMatchObject({ processed: true, event: "PAYMENT_RECEIVED" });

    const chargebackRequested = await processEvent({
      id: chargebackRequestedEventId,
      event: "PAYMENT_CHARGEBACK_REQUESTED",
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
      },
    });
    expect(chargebackRequested).toMatchObject({ processed: true, event: "PAYMENT_CHARGEBACK_REQUESTED" });

    const chargebackDispute = await processEvent({
      id: chargebackDisputeEventId,
      event: "PAYMENT_CHARGEBACK_DISPUTE",
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
      },
    });
    expect(chargebackDispute).toMatchObject({ processed: true, event: "PAYMENT_CHARGEBACK_DISPUTE" });

    const awaitingReversal = await processEvent({
      id: awaitingReversalEventId,
      event: "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
      },
    });
    expect(awaitingReversal).toMatchObject({
      processed: true,
      event: "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
    });

    const paymentAwaitingReversal = await serviceApi(
      `ordys_billing_payments?select=status,refunded_at&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&limit=1`,
    );
    expect(paymentAwaitingReversal.ok, await paymentAwaitingReversal.clone().text()).toBe(true);
    expect(await paymentAwaitingReversal.json()).toEqual([{
      status: "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
      refunded_at: null,
    }]);

    const subscriptionSuspended = await serviceApi(
      `ordys_billing_subscriptions?select=status&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(subscriptionSuspended.ok, await subscriptionSuspended.clone().text()).toBe(true);
    expect(await subscriptionSuspended.json()).toEqual([{ status: "suspended" }]);

    const finalPayment = await processEvent({
      id: finalPaymentEventId,
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(finalPayment).toMatchObject({ processed: true, event: "PAYMENT_RECEIVED" });

    const paymentAfterReversal = await serviceApi(
      `ordys_billing_payments?select=status,refunded_at&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&limit=1`,
    );
    expect(paymentAfterReversal.ok, await paymentAfterReversal.clone().text()).toBe(true);
    expect(await paymentAfterReversal.json()).toEqual([{
      status: "PAYMENT_RECEIVED",
      refunded_at: null,
    }]);

    const subscriptionAfterReversal = await serviceApi(
      `ordys_billing_subscriptions?select=status&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(subscriptionAfterReversal.ok, await subscriptionAfterReversal.clone().text()).toBe(true);
    expect(await subscriptionAfterReversal.json()).toEqual([{ status: "suspended" }]);

    const eligible = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: reversalUser.id }),
    });
    expect(eligible.ok, await eligible.clone().text()).toBe(true);
    expect(await eligible.json()).toBe(false);
  }, 30_000);

  it("rejeita provider_payment_id já vinculado a outra conta sem alterar o ledger original", async () => {
    const firstUser = await createTestUser("payment-id-owner");
    const secondUser = await createTestUser("payment-id-conflict");
    extraUsers.push(firstUser, secondUser);

    const firstAttemptId = crypto.randomUUID();
    const secondAttemptId = crypto.randomUUID();
    const firstCustomerId = `cus_ordys_ci_payment_id_owner_${unique}`;
    const secondCustomerId = `cus_ordys_ci_payment_id_conflict_${unique}`;
    const firstCheckoutId = `chk_ordys_ci_payment_id_owner_${unique}`;
    const secondCheckoutId = `chk_ordys_ci_payment_id_conflict_${unique}`;
    const firstSubscriptionId = `sub_ordys_ci_payment_id_owner_${unique}`;
    const secondSubscriptionId = `sub_ordys_ci_payment_id_conflict_${unique}`;
    const sharedPaymentId = `pay_ordys_ci_payment_id_shared_${unique}`;
    const firstReference = `ordys_ci_payment_id_owner_${unique}`;
    const secondReference = `ordys_ci_payment_id_conflict_${unique}`;
    const checkoutFirstEventId = `evt_ordys_ci_payment_id_owner_checkout_${unique}`;
    const subscriptionFirstEventId = `evt_ordys_ci_payment_id_owner_subscription_${unique}`;
    const paymentFirstEventId = `evt_ordys_ci_payment_id_owner_payment_${unique}`;
    const checkoutSecondEventId = `evt_ordys_ci_payment_id_conflict_checkout_${unique}`;
    const subscriptionSecondEventId = `evt_ordys_ci_payment_id_conflict_subscription_${unique}`;
    const conflictingPaymentEventId = `evt_ordys_ci_payment_id_conflict_payment_${unique}`;
    eventIds.push(
      checkoutFirstEventId,
      subscriptionFirstEventId,
      paymentFirstEventId,
      checkoutSecondEventId,
      subscriptionSecondEventId,
      conflictingPaymentEventId,
    );

    const createAttempt = async (
      attemptId: string,
      userId: string,
      externalReference: string,
    ) => serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: userId,
        plan_code: "plus_monthly",
        external_reference: externalReference,
        provider_checkout_id: null,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });

    const firstAttempt = await createAttempt(firstAttemptId, firstUser.id, firstReference);
    expect(firstAttempt.ok, await firstAttempt.clone().text()).toBe(true);
    const firstCheckout = await processEvent({
      id: checkoutFirstEventId,
      event: "CHECKOUT_PAID",
      checkout: { id: firstCheckoutId, customer: firstCustomerId, externalReference: firstReference },
    });
    expect(firstCheckout).toMatchObject({ processed: true, event: "CHECKOUT_PAID" });
    const firstSubscription = await processEvent({
      id: subscriptionFirstEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: firstSubscriptionId,
        customer: firstCustomerId,
        externalReference: firstReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(firstSubscription).toMatchObject({ processed: true, event: "SUBSCRIPTION_CREATED" });

    const paidAt = new Date();
    const firstPayment = await processEvent({
      id: paymentFirstEventId,
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: sharedPaymentId,
        subscription: firstSubscriptionId,
        customer: firstCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(firstPayment).toMatchObject({ processed: true, event: "PAYMENT_RECEIVED" });

    const secondAttempt = await createAttempt(secondAttemptId, secondUser.id, secondReference);
    expect(secondAttempt.ok, await secondAttempt.clone().text()).toBe(true);
    const secondCheckout = await processEvent({
      id: checkoutSecondEventId,
      event: "CHECKOUT_PAID",
      checkout: { id: secondCheckoutId, customer: secondCustomerId, externalReference: secondReference },
    });
    expect(secondCheckout).toMatchObject({ processed: true, event: "CHECKOUT_PAID" });
    const secondSubscription = await processEvent({
      id: subscriptionSecondEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: secondSubscriptionId,
        customer: secondCustomerId,
        externalReference: secondReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(secondSubscription).toMatchObject({ processed: true, event: "SUBSCRIPTION_CREATED" });

    const conflictingPayment = await processEvent({
      id: conflictingPaymentEventId,
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: sharedPaymentId,
        subscription: secondSubscriptionId,
        customer: secondCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(conflictingPayment).toMatchObject({
      processed: false,
      error: "payment_identity_mismatch",
    });

    const originalPayment = await serviceApi(
      `ordys_billing_payments?select=user_id,provider_subscription_id,status&provider_payment_id=eq.${encodeURIComponent(sharedPaymentId)}&limit=1`,
    );
    expect(originalPayment.ok, await originalPayment.clone().text()).toBe(true);
    expect(await originalPayment.json()).toEqual([{
      user_id: firstUser.id,
      provider_subscription_id: firstSubscriptionId,
      status: "PAYMENT_RECEIVED",
    }]);

    const secondSubscriptionRow = await serviceApi(
      `ordys_billing_subscriptions?select=user_id,status&provider_subscription_id=eq.${encodeURIComponent(secondSubscriptionId)}&limit=1`,
    );
    expect(secondSubscriptionRow.ok, await secondSubscriptionRow.clone().text()).toBe(true);
    expect(await secondSubscriptionRow.json()).toEqual([{
      user_id: secondUser.id,
      status: "pending",
    }]);

    const event = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code&provider_event_id=eq.${encodeURIComponent(conflictingPaymentEventId)}&limit=1`,
    );
    expect(event.ok, await event.clone().text()).toBe(true);
    expect(await event.json()).toEqual([{
      processing_status: "failed",
      error_code: "payment_identity_mismatch",
    }]);

    const secondEligibility = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: secondUser.id }),
    });
    expect(secondEligibility.ok, await secondEligibility.clone().text()).toBe(true);
    expect(await secondEligibility.json()).toBe(false);
  }, 30_000);

  it("não suspende outra assinatura quando PAYMENT_REFUNDED reutiliza o ID de pagamento de outra conta", async () => {
    const paymentOwner = await createTestUser("negative-payment-id-owner");
    const unrelatedOwner = await createTestUser("negative-payment-id-other-subscription");
    extraUsers.push(paymentOwner, unrelatedOwner);

    const paymentOwnerCustomer = `cus_ordys_ci_negative_id_owner_${unique}`;
    const unrelatedCustomer = `cus_ordys_ci_negative_id_unrelated_${unique}`;
    const paymentOwnerSubscription = `sub_ordys_ci_negative_id_owner_${unique}`;
    const unrelatedSubscription = `sub_ordys_ci_negative_id_unrelated_${unique}`;
    const sharedPaymentId = `pay_ordys_ci_negative_id_shared_${unique}`;
    const refundEventId = `evt_ordys_ci_negative_payment_id_cross_account_${unique}`;
    eventIds.push(refundEventId);
    const paidAt = new Date();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const firstSubscription = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: paymentOwner.id,
        plan_code: "plus_monthly",
        checkout_attempt_id: null,
        provider_subscription_id: paymentOwnerSubscription,
        provider_customer_id: paymentOwnerCustomer,
        provider_status: "ACTIVE",
        status: "active",
        billing_cycle: "MONTHLY",
        billing_type: "CREDIT_CARD",
        amount_cents: 5_990,
        current_period_end: periodEnd,
      }),
    });
    expect(firstSubscription.ok, await firstSubscription.clone().text()).toBe(true);

    const secondSubscription = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: unrelatedOwner.id,
        plan_code: "plus_monthly",
        checkout_attempt_id: null,
        provider_subscription_id: unrelatedSubscription,
        provider_customer_id: unrelatedCustomer,
        provider_status: "ACTIVE",
        status: "active",
        billing_cycle: "MONTHLY",
        billing_type: "CREDIT_CARD",
        amount_cents: 5_990,
        current_period_end: periodEnd,
      }),
    });
    expect(secondSubscription.ok, await secondSubscription.clone().text()).toBe(true);

    const originalPayment = await serviceApi("ordys_billing_payments", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        provider_payment_id: sharedPaymentId,
        user_id: paymentOwner.id,
        provider_subscription_id: paymentOwnerSubscription,
        amount_cents: 5_990,
        billing_type: "CREDIT_CARD",
        status: "PAYMENT_RECEIVED",
        due_date: paidAt.toISOString().slice(0, 10),
        confirmed_at: paidAt.toISOString(),
      }),
    });
    expect(originalPayment.ok, await originalPayment.clone().text()).toBe(true);

    const refund = await processEvent({
      id: refundEventId,
      event: "PAYMENT_REFUNDED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: sharedPaymentId,
        subscription: unrelatedSubscription,
        customer: unrelatedCustomer,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(refund).toMatchObject({
      processed: false,
      error: "payment_identity_mismatch",
    });

    const unrelatedSubscriptionAfter = await serviceApi(
      `ordys_billing_subscriptions?select=status&provider_subscription_id=eq.${encodeURIComponent(unrelatedSubscription)}&limit=1`,
    );
    expect(unrelatedSubscriptionAfter.ok, await unrelatedSubscriptionAfter.clone().text()).toBe(true);
    expect(await unrelatedSubscriptionAfter.json()).toEqual([{ status: "active" }]);

    const originalPaymentAfter = await serviceApi(
      `ordys_billing_payments?select=user_id,provider_subscription_id,status&provider_payment_id=eq.${encodeURIComponent(sharedPaymentId)}&limit=1`,
    );
    expect(originalPaymentAfter.ok, await originalPaymentAfter.clone().text()).toBe(true);
    expect(await originalPaymentAfter.json()).toEqual([{
      user_id: paymentOwner.id,
      provider_subscription_id: paymentOwnerSubscription,
      status: "PAYMENT_RECEIVED",
    }]);

    const event = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(refundEventId)}&limit=1`,
    );
    expect(event.ok, await event.clone().text()).toBe(true);
    expect(await event.json()).toEqual([{
      processing_status: "failed",
      error_code: "payment_identity_mismatch",
      retry_payload: null,
    }]);

    const unrelatedEligibility = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: unrelatedOwner.id }),
    });
    expect(unrelatedEligibility.ok, await unrelatedEligibility.clone().text()).toBe(true);
    expect(await unrelatedEligibility.json()).toBe(true);

    const ownerEligibility = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: paymentOwner.id }),
    });
    expect(ownerEligibility.ok, await ownerEligibility.clone().text()).toBe(true);
    expect(await ownerEligibility.json()).toBe(true);
  }, 30_000);

  it("suspende Plus e preserva o cliente original quando CHECKOUT_PAID diverge da assinatura já vinculada", async () => {
    const mismatchUser = await createTestUser("checkout-customer-mismatch-subscription-first");
    extraUsers.push(mismatchUser);

    const attemptId = crypto.randomUUID();
    const externalRef = `ordys_ci_checkout_customer_mismatch_sub_first_${unique}`;
    const checkoutProviderId = `chk_ordys_ci_checkout_customer_mismatch_sub_first_${unique}`;
    const originalCustomerId = `cus_ordys_ci_checkout_customer_original_${unique}`;
    const conflictingCustomerId = `cus_ordys_ci_checkout_customer_conflict_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_checkout_customer_mismatch_sub_first_${unique}`;
    const providerPaymentId = `pay_ordys_ci_checkout_customer_mismatch_sub_first_${unique}`;
    const paidAt = new Date();

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: mismatchUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: null,
        provider_customer_id: originalCustomerId,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const subscriptionCreated = await processEvent({
      id: eventIds[17],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: originalCustomerId,
        externalReference: externalRef,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(subscriptionCreated).toMatchObject({ processed: true, event: "SUBSCRIPTION_CREATED" });

    const checkoutPaid = await processEvent({
      id: eventIds[18],
      event: "CHECKOUT_PAID",
      checkout: {
        id: checkoutProviderId,
        customer: conflictingCustomerId,
        externalReference: externalRef,
      },
    });
    expect(checkoutPaid).toMatchObject({
      processed: false,
      error: "checkout_customer_mismatch",
    });

    const attemptAfterMismatch = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_customer_id,provider_checkout_id&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(attemptAfterMismatch.ok, await attemptAfterMismatch.clone().text()).toBe(true);
    expect(await attemptAfterMismatch.json()).toEqual([{
      status: "linked",
      provider_customer_id: originalCustomerId,
      provider_checkout_id: checkoutProviderId,
    }]);

    const subscriptionAfterMismatch = await serviceApi(
      `ordys_billing_subscriptions?select=status,provider_customer_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(subscriptionAfterMismatch.ok, await subscriptionAfterMismatch.clone().text()).toBe(true);
    expect(await subscriptionAfterMismatch.json()).toEqual([{
      status: "suspended",
      provider_customer_id: originalCustomerId,
    }]);

    // Even a later genuine-looking payment from the original ID cannot
    // reactivate an identity-conflicted subscription.
    const payment = await processEvent({
      id: eventIds[19],
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: originalCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(payment).toMatchObject({ processed: true, event: "PAYMENT_RECEIVED" });

    const stillSuspended = await serviceApi(
      `ordys_billing_subscriptions?select=status,provider_customer_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(stillSuspended.ok, await stillSuspended.clone().text()).toBe(true);
    expect(await stillSuspended.json()).toEqual([{
      status: "suspended",
      provider_customer_id: originalCustomerId,
    }]);

    const eligible = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: mismatchUser.id }),
    });
    expect(eligible.ok).toBe(true);
    expect(await eligible.json()).toBe(false);

    const mismatchEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,provider_customer_id,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[18]!)}&limit=1`,
    );
    expect(mismatchEvent.ok, await mismatchEvent.clone().text()).toBe(true);
    expect(await mismatchEvent.json()).toMatchObject([{
      processing_status: "failed",
      error_code: "checkout_customer_mismatch",
      provider_customer_id: conflictingCustomerId,
      retry_payload: {
        checkoutAttemptId: attemptId,
        checkout: { id: checkoutProviderId, customer: conflictingCustomerId },
      },
    }]);
  }, 30_000);

  it("quarentena CHECKOUT_PAID conflitante antes de SUBSCRIPTION_CREATED", async () => {
    const mismatchUser = await createTestUser("checkout-customer-mismatch-paid-first");
    extraUsers.push(mismatchUser);

    const attemptId = crypto.randomUUID();
    const externalRef = `ordys_ci_checkout_customer_mismatch_paid_first_${unique}`;
    const checkoutProviderId = `chk_ordys_ci_checkout_customer_mismatch_paid_first_${unique}`;
    const originalCustomerId = `cus_ordys_ci_checkout_customer_paid_first_original_${unique}`;
    const conflictingCustomerId = `cus_ordys_ci_checkout_customer_paid_first_conflict_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_checkout_customer_mismatch_paid_first_${unique}`;

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: mismatchUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: null,
        provider_customer_id: originalCustomerId,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const checkoutPaid = await processEvent({
      id: eventIds[20],
      event: "CHECKOUT_PAID",
      checkout: {
        id: checkoutProviderId,
        customer: conflictingCustomerId,
        externalReference: externalRef,
      },
    });
    expect(checkoutPaid).toMatchObject({
      processed: false,
      error: "checkout_customer_mismatch",
    });

    const subscriptionCreated = await processEvent({
      id: eventIds[21],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: originalCustomerId,
        externalReference: externalRef,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(subscriptionCreated).toMatchObject({
      processed: false,
      error: "checkout_customer_mismatch",
    });

    const noSubscription = await serviceApi(
      `ordys_billing_subscriptions?select=provider_subscription_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(noSubscription.ok, await noSubscription.clone().text()).toBe(true);
    expect(await noSubscription.json()).toHaveLength(0);

    const attemptAfterMismatch = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_customer_id,provider_checkout_id&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(attemptAfterMismatch.ok, await attemptAfterMismatch.clone().text()).toBe(true);
    expect(await attemptAfterMismatch.json()).toEqual([{
      status: "pending",
      provider_customer_id: originalCustomerId,
      provider_checkout_id: checkoutProviderId,
    }]);

    const quarantinedSubscriptionEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[21]!)}&limit=1`,
    );
    expect(quarantinedSubscriptionEvent.ok, await quarantinedSubscriptionEvent.clone().text()).toBe(true);
    expect(await quarantinedSubscriptionEvent.json()).toEqual([{
      processing_status: "failed",
      error_code: "checkout_customer_mismatch",
      retry_payload: null,
    }]);

    const eligible = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: mismatchUser.id }),
    });
    expect(eligible.ok).toBe(true);
    expect(await eligible.json()).toBe(false);
  }, 30_000);

  it("quarentena CHECKOUT_PAID quando o ID conhecido traz externalReference conflitante após SUBSCRIPTION_CREATED", async () => {
    const mismatchUser = await createTestUser("checkout-reference-mismatch-subscription-first");
    extraUsers.push(mismatchUser);

    const attemptId = crypto.randomUUID();
    const externalRef = `ordys_ci_checkout_reference_mismatch_sub_first_${unique}`;
    const conflictingExternalRef = `ordys_ci_checkout_reference_conflict_sub_first_${unique}`;
    const checkoutProviderId = `chk_ordys_ci_checkout_reference_mismatch_sub_first_${unique}`;
    const providerCustomerId = `cus_ordys_ci_checkout_reference_mismatch_sub_first_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_checkout_reference_mismatch_sub_first_${unique}`;
    const providerPaymentId = `pay_ordys_ci_checkout_reference_mismatch_sub_first_${unique}`;
    const paidAt = new Date();

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: mismatchUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: checkoutProviderId,
        provider_customer_id: providerCustomerId,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const subscriptionCreated = await processEvent({
      id: checkoutReferenceMismatchEventIds.subscriptionFirstCreated,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        externalReference: externalRef,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(subscriptionCreated).toMatchObject({ processed: true, event: "SUBSCRIPTION_CREATED" });

    const conflictingCheckoutPaid = await processEvent({
      id: checkoutReferenceMismatchEventIds.subscriptionFirstPaid,
      event: "CHECKOUT_PAID",
      checkout: {
        id: checkoutProviderId,
        customer: providerCustomerId,
        externalReference: conflictingExternalRef,
      },
    });
    expect(conflictingCheckoutPaid).toMatchObject({
      processed: false,
      error: "checkout_reference_mismatch",
    });

    const stillLinkedAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_customer_id,provider_checkout_id,external_reference&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(stillLinkedAttempt.ok, await stillLinkedAttempt.clone().text()).toBe(true);
    expect(await stillLinkedAttempt.json()).toEqual([{
      status: "linked",
      provider_customer_id: providerCustomerId,
      provider_checkout_id: checkoutProviderId,
      external_reference: externalRef,
    }]);

    const suspendedSubscription = await serviceApi(
      `ordys_billing_subscriptions?select=status,provider_customer_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(suspendedSubscription.ok, await suspendedSubscription.clone().text()).toBe(true);
    expect(await suspendedSubscription.json()).toEqual([{
      status: "suspended",
      provider_customer_id: providerCustomerId,
    }]);

    const payment = await processEvent({
      id: checkoutReferenceMismatchEventIds.subscriptionFirstPayment,
      event: "PAYMENT_RECEIVED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(payment).toMatchObject({ processed: true, event: "PAYMENT_RECEIVED" });

    const remainsSuspended = await serviceApi(
      `ordys_billing_subscriptions?select=status,provider_customer_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(remainsSuspended.ok, await remainsSuspended.clone().text()).toBe(true);
    expect(await remainsSuspended.json()).toEqual([{
      status: "suspended",
      provider_customer_id: providerCustomerId,
    }]);

    const eligible = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: mismatchUser.id }),
    });
    expect(eligible.ok).toBe(true);
    expect(await eligible.json()).toBe(false);

    const mismatchEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(checkoutReferenceMismatchEventIds.subscriptionFirstPaid)}&limit=1`,
    );
    expect(mismatchEvent.ok, await mismatchEvent.clone().text()).toBe(true);
    expect(await mismatchEvent.json()).toEqual([{
      processing_status: "failed",
      error_code: "checkout_reference_mismatch",
      retry_payload: {
        checkoutAttemptId: attemptId,
        checkout: {
          id: checkoutProviderId,
          customer: providerCustomerId,
          externalReference: conflictingExternalRef,
        },
      },
    }]);
  }, 30_000);

  it("bloqueia SUBSCRIPTION_CREATED após CHECKOUT_PAID com externalReference conflitante", async () => {
    const mismatchUser = await createTestUser("checkout-reference-mismatch-paid-first");
    extraUsers.push(mismatchUser);

    const attemptId = crypto.randomUUID();
    const externalRef = `ordys_ci_checkout_reference_mismatch_paid_first_${unique}`;
    const conflictingExternalRef = `ordys_ci_checkout_reference_conflict_paid_first_${unique}`;
    const checkoutProviderId = `chk_ordys_ci_checkout_reference_mismatch_paid_first_${unique}`;
    const providerCustomerId = `cus_ordys_ci_checkout_reference_mismatch_paid_first_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_checkout_reference_mismatch_paid_first_${unique}`;

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: mismatchUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: checkoutProviderId,
        provider_customer_id: providerCustomerId,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const conflictingCheckoutPaid = await processEvent({
      id: checkoutReferenceMismatchEventIds.paidFirstPaid,
      event: "CHECKOUT_PAID",
      checkout: {
        id: checkoutProviderId,
        customer: providerCustomerId,
        externalReference: conflictingExternalRef,
      },
    });
    expect(conflictingCheckoutPaid).toMatchObject({
      processed: false,
      error: "checkout_reference_mismatch",
    });

    const subscriptionCreated = await processEvent({
      id: checkoutReferenceMismatchEventIds.paidFirstCreated,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        externalReference: externalRef,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(subscriptionCreated).toMatchObject({
      processed: false,
      error: "checkout_reference_mismatch",
    });

    const noSubscription = await serviceApi(
      `ordys_billing_subscriptions?select=provider_subscription_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(noSubscription.ok, await noSubscription.clone().text()).toBe(true);
    expect(await noSubscription.json()).toHaveLength(0);

    const unchangedAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_customer_id,provider_checkout_id,external_reference&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(unchangedAttempt.ok, await unchangedAttempt.clone().text()).toBe(true);
    expect(await unchangedAttempt.json()).toEqual([{
      status: "pending",
      provider_customer_id: providerCustomerId,
      provider_checkout_id: checkoutProviderId,
      external_reference: externalRef,
    }]);

    const mismatchEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(checkoutReferenceMismatchEventIds.paidFirstPaid)}&limit=1`,
    );
    expect(mismatchEvent.ok, await mismatchEvent.clone().text()).toBe(true);
    expect(await mismatchEvent.json()).toEqual([{
      processing_status: "failed",
      error_code: "checkout_reference_mismatch",
      retry_payload: {
        checkoutAttemptId: attemptId,
        checkout: {
          id: checkoutProviderId,
          customer: providerCustomerId,
          externalReference: conflictingExternalRef,
        },
      },
    }]);

    const eligible = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: mismatchUser.id }),
    });
    expect(eligible.ok).toBe(true);
    expect(await eligible.json()).toBe(false);
  }, 30_000);

  it("recusa conciliar assinatura quando o mesmo cliente corresponde a dois Checkouts pagos", async () => {
    const secondUser = await createTestUser("ambiguous");
    extraUsers.push(secondUser);
    const ambiguousCustomerId = `cus_ordys_ci_ambiguous_${unique}`;
    const ambiguousSubscriptionId = `sub_ordys_ci_ambiguous_${unique}`;
    const ambiguousAttempts = [
      {
        id: crypto.randomUUID(),
        user_id: user!.id,
        plan_code: "plus_monthly",
        external_reference: `ordys_ci_ambiguous_a_${unique}`,
        provider_customer_id: ambiguousCustomerId,
        amount_cents: 5_990,
        status: "paid",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      {
        id: crypto.randomUUID(),
        user_id: secondUser.id,
        plan_code: "plus_monthly",
        external_reference: `ordys_ci_ambiguous_b_${unique}`,
        provider_customer_id: ambiguousCustomerId,
        amount_cents: 5_990,
        status: "paid",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    ];

    const created = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(ambiguousAttempts),
    });
    const createdBody = await created.text();
    expect(created.ok, createdBody).toBe(true);

    const result = await processEvent({
      id: eventIds[9],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: ambiguousSubscriptionId,
        customer: ambiguousCustomerId,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(result).toMatchObject({
      processed: false,
      error: "ambiguous_customer_association",
    });

    const subscription = await serviceApi(
      `ordys_billing_subscriptions?select=provider_subscription_id&provider_subscription_id=eq.${encodeURIComponent(ambiguousSubscriptionId)}&limit=1`,
    );
    const subscriptions = await subscription.json() as Array<{ provider_subscription_id: string }>;
    expect(subscriptions).toHaveLength(0);

    const failedEventId = eventIds[9];
    if (!failedEventId) throw new Error("O identificador do evento de falha não foi gerado.");
    const event = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code&provider_event_id=eq.${encodeURIComponent(failedEventId)}&limit=1`,
    );
    const eventRows = await event.json() as Array<{ processing_status: string; error_code: string }>;
    expect(eventRows[0]).toMatchObject({
      processing_status: "failed",
      error_code: "ambiguous_customer_association",
    });
  }, 30_000);
  it("não associa assinatura antiga a Checkout pago mais recente quando externalReference é omitida", async () => {
    const previousOwner = await createTestUser("terminal-customer-previous-owner");
    const currentOwner = await createTestUser("terminal-customer-current-owner");
    extraUsers.push(previousOwner, currentOwner);

    const sharedCustomerId = `cus_ordys_ci_terminal_shared_customer_${unique}`;
    const previousAttemptId = crypto.randomUUID();
    const currentAttemptId = crypto.randomUUID();
    const previousCheckoutId = `chk_ordys_ci_terminal_previous_${unique}`;
    const currentCheckoutId = `chk_ordys_ci_terminal_current_${unique}`;
    const previousExternalReference = `ordys_ci_terminal_previous_${unique}`;
    const currentExternalReference = `ordys_ci_terminal_current_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_terminal_customer_replay_${unique}`;
    const subscriptionEventId = `evt_ordys_ci_terminal_customer_replay_${unique}`;
    const checkoutPaidEventId = `evt_ordys_ci_terminal_customer_checkout_paid_${unique}`;
    eventIds.push(subscriptionEventId, checkoutPaidEventId);

    const previousAttempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: previousAttemptId,
        user_id: previousOwner.id,
        plan_code: "plus_monthly",
        external_reference: previousExternalReference,
        provider_checkout_id: previousCheckoutId,
        provider_customer_id: sharedCustomerId,
        amount_cents: 5_990,
        status: "cancelled",
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    });
    expect(previousAttempt.ok, await previousAttempt.clone().text()).toBe(true);

    // The old remote subscription event arrives after its local Checkout closed.
    // With no newer paid attempt yet, it is retained for exact customer replay.
    const heldSubscription = await processEvent({
      id: subscriptionEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: sharedCustomerId,
        externalReference: null,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(heldSubscription).toMatchObject({
      processed: false,
      error: "subscription_checkout_unmatched",
    });

    const currentAttempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: currentAttemptId,
        user_id: currentOwner.id,
        plan_code: "plus_monthly",
        external_reference: currentExternalReference,
        provider_checkout_id: currentCheckoutId,
        provider_customer_id: sharedCustomerId,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(currentAttempt.ok, await currentAttempt.clone().text()).toBe(true);

    // CHECKOUT_PAID replays the earlier event. The terminal Checkout remains a
    // historical customer candidate, so the old subscription cannot be attached
    // to the newer Checkout or to a different Ordys account.
    const checkoutPaid = await processEvent({
      id: checkoutPaidEventId,
      event: "CHECKOUT_PAID",
      checkout: {
        id: currentCheckoutId,
        customer: sharedCustomerId,
        externalReference: currentExternalReference,
      },
    });
    expect(checkoutPaid).toMatchObject({
      processed: true,
      event: "CHECKOUT_PAID",
    });

    const noMisattribution = await serviceApi(
      `ordys_billing_subscriptions?select=user_id,checkout_attempt_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(noMisattribution.ok, await noMisattribution.clone().text()).toBe(true);
    expect(await noMisattribution.json()).toEqual([]);

    const event = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(subscriptionEventId)}&limit=1`,
    );
    expect(event.ok, await event.clone().text()).toBe(true);
    expect(await event.json()).toEqual([{
      processing_status: "failed",
      error_code: "ambiguous_customer_association",
      retry_payload: null,
    }]);
  }, 30_000);

  it("preserva a assinatura existente quando SUBSCRIPTION_CREATED reutiliza o ID em outro Checkout", async () => {
    const originalOwner = await createTestUser("subscription-id-original-owner");
    const conflictingOwner = await createTestUser("subscription-id-conflicting-owner");
    extraUsers.push(originalOwner, conflictingOwner);

    const originalAttemptId = crypto.randomUUID();
    const conflictingAttemptId = crypto.randomUUID();
    const providerSubscriptionId = `sub_ordys_ci_subscription_id_reuse_${unique}`;
    const originalCustomerId = `cus_ordys_ci_subscription_id_original_${unique}`;
    const conflictingCustomerId = `cus_ordys_ci_subscription_id_conflict_${unique}`;
    const originalExternalReference = `ordys_ci_subscription_id_original_${unique}`;
    const conflictingExternalReference = `ordys_ci_subscription_id_conflict_${unique}`;

    const attempts = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([
        {
          id: originalAttemptId,
          user_id: originalOwner.id,
          plan_code: "plus_monthly",
          external_reference: originalExternalReference,
          provider_customer_id: originalCustomerId,
          amount_cents: 5_990,
          status: "paid",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        {
          id: conflictingAttemptId,
          user_id: conflictingOwner.id,
          plan_code: "plus_monthly",
          external_reference: conflictingExternalReference,
          provider_customer_id: conflictingCustomerId,
          amount_cents: 5_990,
          status: "paid",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      ]),
    });
    expect(attempts.ok, await attempts.clone().text()).toBe(true);

    const originalCreation = await processEvent({
      id: eventIds[31],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: originalCustomerId,
        externalReference: originalExternalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(originalCreation).toMatchObject({
      processed: true,
      event: "SUBSCRIPTION_CREATED",
    });

    // A second Checkout must not take over the same globally unique provider ID.
    const conflictingCreation = await processEvent({
      id: eventIds[32],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: conflictingCustomerId,
        externalReference: conflictingExternalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(conflictingCreation).toMatchObject({
      processed: false,
      error: "subscription_identity_mismatch",
    });

    const preservedSubscription = await serviceApi(
      `ordys_billing_subscriptions?select=user_id,checkout_attempt_id,provider_customer_id,status&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(preservedSubscription.ok, await preservedSubscription.clone().text()).toBe(true);
    expect(await preservedSubscription.json()).toEqual([{
      user_id: originalOwner.id,
      checkout_attempt_id: originalAttemptId,
      provider_customer_id: originalCustomerId,
      status: "pending",
    }]);

    const conflictingAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_customer_id&id=eq.${encodeURIComponent(conflictingAttemptId)}&limit=1`,
    );
    expect(conflictingAttempt.ok, await conflictingAttempt.clone().text()).toBe(true);
    expect(await conflictingAttempt.json()).toEqual([{
      status: "paid",
      provider_customer_id: conflictingCustomerId,
    }]);

    const failedEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[32]!)}&limit=1`,
    );
    expect(failedEvent.ok, await failedEvent.clone().text()).toBe(true);
    expect(await failedEvent.json()).toEqual([{
      processing_status: "failed",
      error_code: "subscription_identity_mismatch",
      retry_payload: null,
    }]);
  }, 30_000);

  it("recusa novo vínculo por cliente compartilhado e reconcilia SUBSCRIPTION_DELETED pelo ID exato", async () => {
    const previousOwner = await createTestUser("shared-customer-linked-owner");
    const currentOwner = await createTestUser("shared-customer-paid-owner");
    extraUsers.push(previousOwner, currentOwner);

    const sharedCustomerId = `cus_ordys_ci_shared_linked_paid_${unique}`;
    const linkedAttemptId = crypto.randomUUID();
    const paidAttemptId = crypto.randomUUID();
    const linkedSubscriptionId = `sub_ordys_ci_shared_linked_${unique}`;
    const newSubscriptionId = `sub_ordys_ci_shared_paid_new_${unique}`;

    const attempts = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([
        {
          id: linkedAttemptId,
          user_id: previousOwner.id,
          plan_code: "plus_monthly",
          external_reference: `ordys_ci_shared_linked_${unique}`,
          provider_checkout_id: `chk_ordys_ci_shared_linked_${unique}`,
          provider_customer_id: sharedCustomerId,
          amount_cents: 5_990,
          status: "linked",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        {
          id: paidAttemptId,
          user_id: currentOwner.id,
          plan_code: "plus_monthly",
          external_reference: `ordys_ci_shared_paid_${unique}`,
          provider_checkout_id: `chk_ordys_ci_shared_paid_${unique}`,
          provider_customer_id: sharedCustomerId,
          amount_cents: 5_990,
          status: "paid",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      ]),
    });
    expect(attempts.ok, await attempts.clone().text()).toBe(true);

    const previousSubscription = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: previousOwner.id,
        plan_code: "plus_monthly",
        checkout_attempt_id: linkedAttemptId,
        provider_subscription_id: linkedSubscriptionId,
        provider_customer_id: sharedCustomerId,
        provider_status: "ACTIVE",
        status: "active",
        billing_cycle: "MONTHLY",
        billing_type: "CREDIT_CARD",
        amount_cents: 5_990,
        currency: "BRL",
      }),
    });
    expect(previousSubscription.ok, await previousSubscription.clone().text()).toBe(true);

    const result = await processEvent({
      id: eventIds[13],
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: newSubscriptionId,
        customer: sharedCustomerId,
        externalReference: null,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(result).toMatchObject({
      processed: false,
      error: "ambiguous_customer_association",
    });

    const noMisattribution = await serviceApi(
      `ordys_billing_subscriptions?select=user_id,checkout_attempt_id&provider_subscription_id=eq.${encodeURIComponent(newSubscriptionId)}&limit=1`,
    );
    expect(noMisattribution.ok, await noMisattribution.clone().text()).toBe(true);
    expect(await noMisattribution.json()).toHaveLength(0);

    const failedEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[13]!)}&limit=1`,
    );
    expect(failedEvent.ok, await failedEvent.clone().text()).toBe(true);
    expect(await failedEvent.json()).toEqual([{
      processing_status: "failed",
      error_code: "ambiguous_customer_association",
      retry_payload: null,
    }]);

    // A shared customer still blocks creating a new subscription by fallback,
    // but it must not block a terminal event for a subscription already linked
    // by its unique provider_subscription_id.
    const wrongCustomerDeletion = await processEvent({
      id: eventIds[28],
      event: "SUBSCRIPTION_DELETED",
      subscription: {
        id: linkedSubscriptionId,
        customer: `cus_ordys_ci_wrong_customer_${unique}`,
      },
    });
    expect(wrongCustomerDeletion).toMatchObject({
      processed: false,
      error: "subscription_customer_mismatch",
    });

    const unchangedKnownSubscription = await serviceApi(
      `ordys_billing_subscriptions?select=status,provider_status,cancellation_confirmed_at&provider_subscription_id=eq.${encodeURIComponent(linkedSubscriptionId)}&limit=1`,
    );
    expect(unchangedKnownSubscription.ok, await unchangedKnownSubscription.clone().text()).toBe(true);
    const unchangedRows = await unchangedKnownSubscription.json() as Array<{
      status: string;
      provider_status: string;
      cancellation_confirmed_at: string | null;
    }>;
    expect(unchangedRows).toHaveLength(1);
    expect(unchangedRows[0]?.status).toBe("active");
    expect(unchangedRows[0]?.provider_status).toBe("ACTIVE");
    expect(unchangedRows[0]?.cancellation_confirmed_at).toBeNull();

    // An externalReference resolving to the other user's paid Checkout must
    // not override the exact provider subscription's existing owner.
    const crossAccountReferenceDeletion = await processEvent({
      id: eventIds[30],
      event: "SUBSCRIPTION_DELETED",
      subscription: {
        id: linkedSubscriptionId,
        customer: sharedCustomerId,
        externalReference: `ordys_ci_shared_paid_${unique}`,
      },
    });
    expect(crossAccountReferenceDeletion).toMatchObject({
      processed: false,
      error: "subscription_checkout_mismatch",
    });

    const afterCrossAccountReference = await serviceApi(
      `ordys_billing_subscriptions?select=status,provider_status,cancellation_confirmed_at&provider_subscription_id=eq.${encodeURIComponent(linkedSubscriptionId)}&limit=1`,
    );
    expect(afterCrossAccountReference.ok, await afterCrossAccountReference.clone().text()).toBe(true);
    const afterCrossAccountRows = await afterCrossAccountReference.json() as Array<{
      status: string;
      provider_status: string;
      cancellation_confirmed_at: string | null;
    }>;
    expect(afterCrossAccountRows).toHaveLength(1);
    expect(afterCrossAccountRows[0]?.status).toBe("active");
    expect(afterCrossAccountRows[0]?.provider_status).toBe("ACTIVE");
    expect(afterCrossAccountRows[0]?.cancellation_confirmed_at).toBeNull();

    const knownDeletion = await processEvent({
      id: eventIds[29],
      event: "SUBSCRIPTION_DELETED",
      subscription: {
        id: linkedSubscriptionId,
        customer: sharedCustomerId,
      },
    });
    expect(knownDeletion).toMatchObject({
      processed: true,
      event: "SUBSCRIPTION_DELETED",
    });

    const deletedKnownSubscription = await serviceApi(
      `ordys_billing_subscriptions?select=status,provider_status,cancellation_confirmed_at&provider_subscription_id=eq.${encodeURIComponent(linkedSubscriptionId)}&limit=1`,
    );
    expect(deletedKnownSubscription.ok, await deletedKnownSubscription.clone().text()).toBe(true);
    const deletedRows = await deletedKnownSubscription.json() as Array<{
      status: string;
      provider_status: string;
      cancellation_confirmed_at: string | null;
    }>;
    expect(deletedRows).toHaveLength(1);
    expect(deletedRows[0]?.status).toBe("cancelled");
    expect(deletedRows[0]?.provider_status).toBe("DELETED");
    expect(deletedRows[0]?.cancellation_confirmed_at).toBeTruthy();

    const closedLinkedCheckout = await serviceApi(
      `ordys_billing_checkout_attempts?select=status&id=eq.${encodeURIComponent(linkedAttemptId)}&limit=1`,
    );
    expect(closedLinkedCheckout.ok, await closedLinkedCheckout.clone().text()).toBe(true);
    expect(await closedLinkedCheckout.json()).toEqual([{ status: "cancelled" }]);

    const reconciledDeletionEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(eventIds[29]!)}&limit=1`,
    );
    expect(reconciledDeletionEvent.ok, await reconciledDeletionEvent.clone().text()).toBe(true);
    expect(await reconciledDeletionEvent.json()).toEqual([{
      processing_status: "processed",
      error_code: null,
      retry_payload: null,
    }]);
  }, 30_000);

  it("allows direct deletion when cron is offline but the core billing schema is ready and the account has no billing history", async () => {
    const deletionUser = await createTestUser("delete-worker-offline");
    extraUsers.push(deletionUser);

    const operationalStatus = await serviceApi("rpc/ordys_billing_schema_status", {
      method: "POST",
      body: "{}",
    });
    expect(operationalStatus.ok, await operationalStatus.clone().text()).toBe(true);
    expect(await operationalStatus.json()).toBe("partial");

    const coreStatus = await serviceApi("rpc/ordys_billing_core_schema_status", {
      method: "POST",
      body: "{}",
    });
    expect(coreStatus.ok, await coreStatus.clone().text()).toBe(true);
    expect(await coreStatus.json()).toBe("ready");

    const reservation = await serviceApi("rpc/ordys_reserve_account_deletion", {
      method: "POST",
      body: JSON.stringify({ p_user_id: deletionUser.id }),
    });
    expect(reservation.ok, await reservation.clone().text()).toBe(true);
    expect(await reservation.json()).toBe("reserved");

    const processingToken = crypto.randomUUID();
    const claim = await serviceApi("rpc/ordys_claim_account_deletion_processing", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: deletionUser.id,
        p_processing_token: processingToken,
      }),
    });
    expect(claim.ok, await claim.clone().text()).toBe(true);
    expect(await claim.json()).toBe("claimed");

    const deletion = await fetch(`${URL}/rest/v1/rpc/delete_own_data`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${deletionUser.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(deletion.ok, await deletion.clone().text()).toBe(true);

    const profile = await serviceApi(
      `profiles?select=id&id=eq.${encodeURIComponent(deletionUser.id)}&limit=1`,
    );
    expect(profile.ok, await profile.clone().text()).toBe(true);
    expect(await profile.json()).toHaveLength(0);
  }, 30_000);

  it("blocks direct authenticated data deletion while Checkout or subscription state is unresolved", async () => {
    const guardedUser = await createTestUser("direct-delete-guard");
    extraUsers.push(guardedUser);

    const attemptId = crypto.randomUUID();
    const providerSubscriptionId = `sub_ordys_ci_delete_guard_${unique}`;
    const externalRef = `ordys_ci_delete_guard_${unique}`;
    const checkout = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(checkout.ok, await checkout.clone().text()).toBe(true);

    const subscription = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        checkout_attempt_id: attemptId,
        provider_subscription_id: providerSubscriptionId,
        status: "active",
        billing_cycle: "MONTHLY",
        amount_cents: 5_990,
      }),
    });
    expect(subscription.ok, await subscription.clone().text()).toBe(true);

    const profileBefore = await serviceApi(
      `profiles?select=id&id=eq.${encodeURIComponent(guardedUser.id)}&limit=1`,
    );
    expect(profileBefore.ok, await profileBefore.clone().text()).toBe(true);
    expect(await profileBefore.json()).toHaveLength(1);

    const directDelete = async () => fetch(`${URL}/rest/v1/rpc/delete_own_data`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${guardedUser.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    // The RPC is granted to authenticated for the Edge Function's owner-scoped
    // call, so the database itself must enforce billing safety.
    const withoutReservation = await directDelete();
    expect(withoutReservation.ok).toBe(false);
    const profileAfterUnreservedAttempt = await serviceApi(
      `profiles?select=id&id=eq.${encodeURIComponent(guardedUser.id)}&limit=1`,
    );
    expect(profileAfterUnreservedAttempt.ok, await profileAfterUnreservedAttempt.clone().text()).toBe(true);
    expect(await profileAfterUnreservedAttempt.json()).toHaveLength(1);

    const reservation = await serviceApi("rpc/ordys_reserve_account_deletion", {
      method: "POST",
      body: JSON.stringify({ p_user_id: guardedUser.id }),
    });
    expect(reservation.ok, await reservation.clone().text()).toBe(true);
    expect(await reservation.json()).toBe("reserved");

    const processingToken = crypto.randomUUID();
    const claim = await serviceApi("rpc/ordys_claim_account_deletion_processing", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: guardedUser.id,
        p_processing_token: processingToken,
      }),
    });
    expect(claim.ok, await claim.clone().text()).toBe(true);
    expect(await claim.json()).toBe("claimed");

    // A live processing lease is not enough: open provider state still blocks cleanup.
    const whileUnresolved = await directDelete();
    expect(whileUnresolved.ok).toBe(false);

    const requestedAt = new Date().toISOString();
    const checkoutClosed = await serviceApi(
      `ordys_billing_checkout_attempts?id=eq.${encodeURIComponent(attemptId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "cancelled", updated_at: requestedAt }),
      },
    );
    expect(checkoutClosed.ok, await checkoutClosed.clone().text()).toBe(true);

    // A stale local terminal status is not provider confirmation. Even with a
    // valid deletion reservation and processing lease, it must not erase the
    // profile while Asaas still reports an active recurring subscription.
    const locallyCancelledWithoutProviderConfirmation = await serviceApi(
      `ordys_billing_subscriptions?provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "cancelled",
          provider_status: "ACTIVE",
          cancellation_requested_at: null,
          cancellation_confirmed_at: null,
          cancelled_at: requestedAt,
        }),
      },
    );
    expect(
      locallyCancelledWithoutProviderConfirmation.ok,
      await locallyCancelledWithoutProviderConfirmation.clone().text(),
    ).toBe(true);

    const staleLocalCancellation = await directDelete();
    expect(staleLocalCancellation.ok).toBe(false);
    const profileAfterStaleCancellation = await serviceApi(
      `profiles?select=id&id=eq.${encodeURIComponent(guardedUser.id)}&limit=1`,
    );
    expect(profileAfterStaleCancellation.ok, await profileAfterStaleCancellation.clone().text()).toBe(true);
    expect(await profileAfterStaleCancellation.json()).toHaveLength(1);

    const subscriptionClosed = await serviceApi(
      `ordys_billing_subscriptions?provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "suspended",
          provider_status: "DELETED",
          cancellation_requested_at: requestedAt,
          cancellation_confirmed_at: requestedAt,
          cancelled_at: requestedAt,
        }),
      },
    );
    expect(subscriptionClosed.ok, await subscriptionClosed.clone().text()).toBe(true);

    // Suspended access remains locked, but the explicit provider-deletion marker
    // makes the subscription terminal for destructive account cleanup.
    const afterProviderConfirmation = await directDelete();
    expect(afterProviderConfirmation.ok, await afterProviderConfirmation.clone().text()).toBe(true);

    const profileAfter = await serviceApi(
      `profiles?select=id&id=eq.${encodeURIComponent(guardedUser.id)}&limit=1`,
    );
    expect(profileAfter.ok, await profileAfter.clone().text()).toBe(true);
    expect(await profileAfter.json()).toHaveLength(0);

    // Payment history without its subscription row must fail closed. The
    // payment table stores provider_subscription_id as text, so this orphan
    // can exist without a relational constraint rejecting it.
    const orphanUser = await createTestUser("orphan-payment-delete-guard");
    extraUsers.push(orphanUser);
    const orphanProviderSubscriptionId = `sub_ordys_ci_orphan_${unique}`;
    const orphanPayment = await serviceApi("ordys_billing_payments", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        provider_payment_id: `pay_ordys_ci_orphan_${unique}`,
        user_id: orphanUser.id,
        provider_subscription_id: orphanProviderSubscriptionId,
        amount_cents: 5_990,
        billing_type: "CREDIT_CARD",
        status: "PAYMENT_RECEIVED",
        due_date: new Date().toISOString().slice(0, 10),
        confirmed_at: new Date().toISOString(),
      }),
    });
    expect(orphanPayment.ok, await orphanPayment.clone().text()).toBe(true);

    const orphanReservation = await serviceApi("rpc/ordys_reserve_account_deletion", {
      method: "POST",
      body: JSON.stringify({ p_user_id: orphanUser.id }),
    });
    expect(orphanReservation.ok, await orphanReservation.clone().text()).toBe(true);
    expect(await orphanReservation.json()).toBe("reserved");

    const orphanProcessingToken = crypto.randomUUID();
    const orphanClaim = await serviceApi("rpc/ordys_claim_account_deletion_processing", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: orphanUser.id,
        p_processing_token: orphanProcessingToken,
      }),
    });
    expect(orphanClaim.ok, await orphanClaim.clone().text()).toBe(true);
    expect(await orphanClaim.json()).toBe("claimed");

    const orphanDirectDelete = await fetch(`${URL}/rest/v1/rpc/delete_own_data`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${orphanUser.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(orphanDirectDelete.ok).toBe(false);

    const orphanProfile = await serviceApi(
      `profiles?select=id&id=eq.${encodeURIComponent(orphanUser.id)}&limit=1`,
    );
    expect(orphanProfile.ok, await orphanProfile.clone().text()).toBe(true);
    expect(await orphanProfile.json()).toHaveLength(1);
  }, 30_000);

  it("processa inadimplência e recusa sem linha de pagamento após vínculo e permite exclusão após cancelamento confirmado", async () => {
    const guardedUser = await createTestUser("unpaid-status-delete-flow");
    extraUsers.push(guardedUser);

    const providerSubscriptionId = `sub_ordys_ci_unpaid_status_delete_${unique}`;
    const providerCustomerId = `cus_ordys_ci_unpaid_status_delete_${unique}`;
    const requestedAt = new Date().toISOString();
    const eventCases = [
      { event: "PAYMENT_OVERDUE", id: `evt_ordys_ci_unpaid_overdue_${unique}`, paymentId: `pay_ordys_ci_unpaid_overdue_${unique}` },
      { event: "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", id: `evt_ordys_ci_unpaid_refused_${unique}`, paymentId: `pay_ordys_ci_unpaid_refused_${unique}` },
      { event: "PAYMENT_REPROVED_BY_RISK_ANALYSIS", id: `evt_ordys_ci_unpaid_risk_rejected_${unique}`, paymentId: `pay_ordys_ci_unpaid_risk_rejected_${unique}` },
    ];
    const lateOverdueEventId = `evt_ordys_ci_unpaid_late_overdue_${unique}`;
    const deletedEventId = `evt_ordys_ci_unpaid_subscription_deleted_${unique}`;
    eventIds.push(...eventCases.map((item) => item.id), lateOverdueEventId, deletedEventId);

    const subscription = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        checkout_attempt_id: null,
        provider_subscription_id: providerSubscriptionId,
        provider_customer_id: providerCustomerId,
        provider_status: "ACTIVE",
        status: "active",
        billing_cycle: "MONTHLY",
        billing_type: "CREDIT_CARD",
        amount_cents: 5_990,
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(subscription.ok, await subscription.clone().text()).toBe(true);

    for (const item of eventCases) {
      const result = await processEvent({
        id: item.id,
        event: item.event,
        dateCreated: requestedAt,
        payment: {
          id: item.paymentId,
          subscription: providerSubscriptionId,
          customer: providerCustomerId,
          billingType: "CREDIT_CARD",
          value: 59.9,
          dueDate: requestedAt.slice(0, 10),
        },
      });
      expect(result).toMatchObject({ processed: true, event: item.event });

      const state = await serviceApi(
        `ordys_billing_subscriptions?select=status,provider_status&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
      );
      expect(state.ok, await state.clone().text()).toBe(true);
      expect(await state.json()).toEqual([{ status: "past_due", provider_status: "OVERDUE" }]);

      const webhook = await serviceApi(
        `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(item.id)}&limit=1`,
      );
      expect(webhook.ok, await webhook.clone().text()).toBe(true);
      expect(await webhook.json()).toEqual([{
        processing_status: "processed",
        error_code: null,
        retry_payload: null,
      }]);
    }

    const providerDeleted = await processEvent({
      id: deletedEventId,
      event: "SUBSCRIPTION_DELETED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        status: "DELETED",
      },
    });
    expect(providerDeleted).toMatchObject({ processed: true, event: "SUBSCRIPTION_DELETED" });

    const lateOverdue = await processEvent({
      id: lateOverdueEventId,
      event: "PAYMENT_OVERDUE",
      payment: {
        id: `pay_ordys_ci_unpaid_late_overdue_${unique}`,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: requestedAt.slice(0, 10),
      },
    });
    expect(lateOverdue).toMatchObject({ processed: true, event: "PAYMENT_OVERDUE" });

    const terminalState = await serviceApi(
      `ordys_billing_subscriptions?select=status,provider_status,cancellation_confirmed_at&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(terminalState.ok, await terminalState.clone().text()).toBe(true);
    const terminalRows = await terminalState.json() as Array<{
      status: string;
      provider_status: string;
      cancellation_confirmed_at: string | null;
    }>;
    expect(terminalRows).toHaveLength(1);
    expect(terminalRows[0]?.status).toBe("cancelled");
    expect(terminalRows[0]?.provider_status).toBe("DELETED");
    expect(terminalRows[0]?.cancellation_confirmed_at).toBeTruthy();

    const reservation = await serviceApi("rpc/ordys_reserve_account_deletion", {
      method: "POST",
      body: JSON.stringify({ p_user_id: guardedUser.id }),
    });
    expect(reservation.ok, await reservation.clone().text()).toBe(true);
    expect(await reservation.json()).toBe("reserved");

    const processing = await serviceApi("rpc/ordys_claim_account_deletion_processing", {
      method: "POST",
      body: JSON.stringify({ p_user_id: guardedUser.id, p_processing_token: crypto.randomUUID() }),
    });
    expect(processing.ok, await processing.clone().text()).toBe(true);
    expect(await processing.json()).toBe("claimed");

    const directDelete = await fetch(`${URL}/rest/v1/rpc/delete_own_data`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${guardedUser.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(directDelete.ok, await directDelete.clone().text()).toBe(true);

    const profile = await serviceApi(
      `profiles?select=id&id=eq.${encodeURIComponent(guardedUser.id)}&limit=1`,
    );
    expect(profile.ok, await profile.clone().text()).toBe(true);
    expect(await profile.json()).toHaveLength(0);
  }, 30_000);

  it("bloqueia exclusão enquanto evento negativo da assinatura aguarda conciliação do pagamento", async () => {
    const guardedUser = await createTestUser("pending-negative-payment-delete-guard");
    extraUsers.push(guardedUser);

    const providerSubscriptionId = `sub_ordys_ci_pending_negative_delete_guard_${unique}`;
    const providerCustomerId = `cus_ordys_ci_pending_negative_delete_guard_${unique}`;
    const providerPaymentId = `pay_ordys_ci_pending_negative_delete_guard_${unique}`;
    const refundEventId = `evt_ordys_ci_pending_negative_delete_guard_${unique}`;
    eventIds.push(refundEventId);
    const requestedAt = new Date().toISOString();

    const subscription = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        checkout_attempt_id: null,
        provider_subscription_id: providerSubscriptionId,
        provider_customer_id: providerCustomerId,
        provider_status: "DELETED",
        status: "suspended",
        billing_cycle: "MONTHLY",
        billing_type: "CREDIT_CARD",
        amount_cents: 5_990,
        cancellation_requested_at: requestedAt,
        cancellation_confirmed_at: requestedAt,
        cancelled_at: requestedAt,
      }),
    });
    expect(subscription.ok, await subscription.clone().text()).toBe(true);

    const pendingRefund = await serviceApi("ordys_billing_webhook_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        provider_event_id: refundEventId,
        event_type: "PAYMENT_REFUNDED",
        provider_object_id: providerPaymentId,
        processing_status: "failed",
        error_code: "negative_payment_unmatched",
        provider_customer_id: providerCustomerId,
        retry_payload: {
          id: refundEventId,
          event: "PAYMENT_REFUNDED",
          payment: {
            id: providerPaymentId,
            subscription: providerSubscriptionId,
            customer: providerCustomerId,
            billingType: "CREDIT_CARD",
            value: 59.9,
          },
        },
      }),
    });
    expect(pendingRefund.ok, await pendingRefund.clone().text()).toBe(true);

    const reservation = await serviceApi("rpc/ordys_reserve_account_deletion", {
      method: "POST",
      body: JSON.stringify({ p_user_id: guardedUser.id }),
    });
    expect(reservation.ok, await reservation.clone().text()).toBe(true);
    expect(await reservation.json()).toBe("reserved");

    const processingToken = crypto.randomUUID();
    const processing = await serviceApi("rpc/ordys_claim_account_deletion_processing", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: guardedUser.id,
        p_processing_token: processingToken,
      }),
    });
    expect(processing.ok, await processing.clone().text()).toBe(true);
    expect(await processing.json()).toBe("claimed");

    const directDelete = await fetch(`${URL}/rest/v1/rpc/delete_own_data`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${guardedUser.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(directDelete.ok).toBe(false);
    expect(await directDelete.text()).toContain("billing negative payment event is awaiting reconciliation");

    const profile = await serviceApi(
      `profiles?select=id&id=eq.${encodeURIComponent(guardedUser.id)}&limit=1`,
    );
    expect(profile.ok, await profile.clone().text()).toBe(true);
    expect(await profile.json()).toHaveLength(1);
  }, 30_000);


  it("preserves a confirmed subscription deletion when late lifecycle events arrive", async () => {
    const guardedUser = await createTestUser("late-subscription-state-after-delete");
    extraUsers.push(guardedUser);

    const attemptId = crypto.randomUUID();
    const providerSubscriptionId = `sub_ordys_ci_late_state_${unique}`;
    const providerCustomerId = `cus_ordys_ci_late_state_${unique}`;
    const externalReference = `ordys_ci_late_state_${unique}`;
    const createdEventId = `evt_ordys_ci_late_created_${unique}`;
    const deletedEventId = `evt_ordys_ci_late_deleted_${unique}`;
    const inactivatedEventId = `evt_ordys_ci_late_inactivated_${unique}`;
    const updatedEventId = `evt_ordys_ci_late_updated_${unique}`;
    eventIds.push(createdEventId, deletedEventId, inactivatedEventId, updatedEventId);

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        external_reference: externalReference,
        provider_checkout_id: `chk_ordys_ci_late_state_${unique}`,
        provider_customer_id: providerCustomerId,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const created = await processEvent({
      id: createdEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        externalReference,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(created).toMatchObject({ processed: true, event: "SUBSCRIPTION_CREATED" });

    const deleted = await processEvent({
      id: deletedEventId,
      event: "SUBSCRIPTION_DELETED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        status: "DELETED",
      },
    });
    expect(deleted).toMatchObject({ processed: true, event: "SUBSCRIPTION_DELETED" });

    // Asaas NON_SEQUENTIALLY delivery can cause earlier lifecycle states to be
    // handled after terminal deletion. Neither may regress the deleted state.
    const lateInactivated = await processEvent({
      id: inactivatedEventId,
      event: "SUBSCRIPTION_INACTIVATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        status: "INACTIVE",
      },
    });
    expect(lateInactivated).toMatchObject({ processed: true, event: "SUBSCRIPTION_INACTIVATED" });

    const lateUpdated = await processEvent({
      id: updatedEventId,
      event: "SUBSCRIPTION_UPDATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        status: "ACTIVE",
      },
    });
    expect(lateUpdated).toMatchObject({ processed: true, event: "SUBSCRIPTION_UPDATED" });

    const state = await serviceApi(
      `ordys_billing_subscriptions?select=status,provider_status,cancellation_confirmed_at&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(state.ok, await state.clone().text()).toBe(true);
    const rows = await state.json() as Array<{
      status: string;
      provider_status: string;
      cancellation_confirmed_at: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("cancelled");
    expect(rows[0]?.provider_status).toBe("DELETED");
    expect(rows[0]?.cancellation_confirmed_at).toBeTruthy();

    const closedAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(closedAttempt.ok, await closedAttempt.clone().text()).toBe(true);
    expect(await closedAttempt.json()).toEqual([{ status: "cancelled" }]);
  }, 30_000);

  it("reconcilia SUBSCRIPTION_DELETED antes de SUBSCRIPTION_CREATED quando externalReference identifica o Checkout", async () => {
    const guardedUser = await createTestUser("delete-before-subscription-created-with-reference");
    extraUsers.push(guardedUser);

    const attemptId = crypto.randomUUID();
    const providerCheckoutId = `chk_ordys_ci_delete_ref_${unique}`;
    const providerCustomerId = `cus_ordys_ci_delete_ref_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_delete_ref_${unique}`;
    const externalRef = `ordys_ci_delete_ref_${unique}`;
    const deletedEventId = `evt_ordys_ci_delete_ref_deleted_${unique}`;
    const createdEventId = `evt_ordys_ci_delete_ref_created_${unique}`;
    eventIds.push(deletedEventId, createdEventId);

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: providerCheckoutId,
        provider_customer_id: null,
        amount_cents: 5_990,
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    // The documented subscription payload can carry externalReference.
    // Resolve the known Checkout, but keep the terminal event until the exact
    // provider subscription exists locally and can be marked deleted.
    const deleted = await processEvent({
      id: deletedEventId,
      event: "SUBSCRIPTION_DELETED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        externalReference: externalRef,
      },
    });
    expect(deleted).toMatchObject({
      processed: false,
      error: "subscription_delete_unmatched",
    });

    const held = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(deletedEventId)}&limit=1`,
    );
    expect(held.ok, await held.clone().text()).toBe(true);
    expect(await held.json()).toMatchObject([{
      processing_status: "failed",
      error_code: "subscription_delete_unmatched",
      retry_payload: {
        id: deletedEventId,
        event: "SUBSCRIPTION_DELETED",
        subscription: { id: providerSubscriptionId, customer: providerCustomerId },
      },
    }]);

    const created = await processEvent({
      id: createdEventId,
      event: "SUBSCRIPTION_CREATED",
      subscription: {
        id: providerSubscriptionId,
        customer: providerCustomerId,
        externalReference: externalRef,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: 59.9,
        status: "ACTIVE",
      },
    });
    expect(created).toMatchObject({ processed: true, event: "SUBSCRIPTION_CREATED" });

    const state = await serviceApi(
      `ordys_billing_subscriptions?select=user_id,status,provider_status,cancellation_confirmed_at,checkout_attempt_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(state.ok, await state.clone().text()).toBe(true);
    expect(await state.json()).toMatchObject([{
      user_id: guardedUser.id,
      status: "cancelled",
      provider_status: "DELETED",
      cancellation_confirmed_at: expect.any(String),
      checkout_attempt_id: attemptId,
    }]);

    const closedAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(closedAttempt.ok, await closedAttempt.clone().text()).toBe(true);
    expect(await closedAttempt.json()).toEqual([{ status: "cancelled" }]);

    const reconciledEvent = await serviceApi(
      `ordys_billing_webhook_events?select=processing_status,error_code,retry_payload&provider_event_id=eq.${encodeURIComponent(deletedEventId)}&limit=1`,
    );
    expect(reconciledEvent.ok, await reconciledEvent.clone().text()).toBe(true);
    expect(await reconciledEvent.json()).toEqual([{
      processing_status: "processed",
      error_code: null,
      retry_payload: null,
    }]);

    const unreconciled = await serviceApi("rpc/ordys_has_unreconciled_billing_events", {
      method: "POST",
      body: JSON.stringify({ p_user_id: guardedUser.id }),
    });
    expect(unreconciled.ok, await unreconciled.clone().text()).toBe(true);
    expect(await unreconciled.json()).toBe(false);
  }, 30_000);

  it("commits the allowlisted webhook receipt before processing and blocks new Checkout admission", async () => {
    const guardedUser = await createTestUser("durable-inbox-admission");
    extraUsers.push(guardedUser);

    const attemptId = crypto.randomUUID();
    const customerId = `cus_ordys_ci_inbox_admission_${unique}`;
    const externalRef = `ordys_ci_inbox_admission_${unique}`;
    const eventId = `evt_ordys_ci_durable_receipt_${unique}`;
    const paymentSubscriptionId = `sub_ordys_ci_not_yet_linked_${unique}`;
    eventIds.push(eventId);

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_customer_id: customerId,
        amount_cents: 5_990,
        status: "failed",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const event = {
      id: eventId,
      event: "PAYMENT_CREATED",
      payment: {
        id: `pay_ordys_ci_inbox_admission_${unique}`,
        subscription: paymentSubscriptionId,
        customer: customerId,
        value: 59.9,
        billingType: "CREDIT_CARD",
      },
      customerName: "MUST_NOT_BE_PERSISTED",
      rawProviderMetadata: { internal: "MUST_NOT_BE_PERSISTED" },
    };
    const receipt = await receiveEvent(event);
    expect(receipt).toEqual({
      accepted: true,
      processing_status: "received",
      duplicate: false,
      event_id_conflict: false,
    });

    const blockedAdmission = await serviceApi("rpc/ordys_begin_billing_checkout_attempt", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: guardedUser.id,
        p_attempt_id: crypto.randomUUID(),
        p_plan_code: "plus_monthly",
        p_external_reference: `ordys_ci_inbox_blocked_${unique}`,
        p_amount_cents: 5_990,
        p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(blockedAdmission.ok, await blockedAdmission.clone().text()).toBe(true);
    expect(await blockedAdmission.json()).toBe("billing_reconciliation_required");

    const processed = await processReceivedEvent(eventId);
    expect(processed).toMatchObject({
      processed: false,
      error: "payment_subscription_unmatched",
    });

    const inbox = await serviceApi(
      `ordys_billing_webhook_inbox?select=processing_status,error_code,event_payload&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    );
    expect(inbox.ok, await inbox.clone().text()).toBe(true);
    const rows = await inbox.json() as Array<{
      processing_status: string;
      error_code: string;
      event_payload: Record<string, unknown>;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.processing_status).toBe("quarantined");
    expect(rows[0]?.error_code).toBe("payment_subscription_unmatched");
    expect(rows[0]?.event_payload).not.toHaveProperty("customerName");
    expect(rows[0]?.event_payload).not.toHaveProperty("rawProviderMetadata");

    const stillBlocked = await serviceApi("rpc/ordys_has_unreconciled_billing_events", {
      method: "POST",
      body: JSON.stringify({ p_user_id: guardedUser.id }),
    });
    expect(stillBlocked.ok, await stillBlocked.clone().text()).toBe(true);
    expect(await stillBlocked.json()).toBe(true);
  }, 30_000);

  it("does not assign a webhook to a current account when an anonymized ledger row shares its provider customer", async () => {
    const currentOwner = await createTestUser("anonymized-customer-overlap");
    const unrelatedOwner = await createTestUser("anonymized-customer-overlap-unrelated");
    extraUsers.push(currentOwner, unrelatedOwner);

    const customerId = `cus_ordys_ci_anonymized_overlap_${unique}`;
    const anonymizedAttemptId = crypto.randomUUID();
    const currentAttemptId = crypto.randomUUID();
    const eventId = `evt_ordys_ci_anonymized_overlap_${unique}`;
    eventIds.push(eventId);
    cleanupBillingAttemptIds.push(anonymizedAttemptId, currentAttemptId);

    for (const attempt of [
      {
        id: anonymizedAttemptId,
        user_id: null,
        external_reference: `ordys_ci_anonymized_overlap_old_${unique}`,
      },
      {
        id: currentAttemptId,
        user_id: currentOwner.id,
        external_reference: `ordys_ci_anonymized_overlap_new_${unique}`,
      },
    ]) {
      const inserted = await serviceApi("ordys_billing_checkout_attempts", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          ...attempt,
          plan_code: "plus_monthly",
          provider_customer_id: customerId,
          amount_cents: 5_990,
          status: "failed",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(inserted.ok, await inserted.clone().text()).toBe(true);
    }

    const event = {
      id: eventId,
      event: "PAYMENT_CREATED",
      payment: {
        id: `pay_ordys_ci_anonymized_overlap_${unique}`,
        subscription: `sub_ordys_ci_anonymized_overlap_${unique}`,
        customer: customerId,
      },
    };
    const receipt = await receiveEvent(event);
    expect(receipt).toEqual({
      accepted: true,
      processing_status: "received",
      duplicate: false,
      event_id_conflict: false,
    });

    const receivedInbox = await serviceApi(
      `ordys_billing_webhook_inbox?select=user_id,processing_status&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    );
    expect(receivedInbox.ok, await receivedInbox.clone().text()).toBe(true);
    expect(await receivedInbox.json()).toEqual([{
      user_id: null,
      processing_status: "received",
    }]);

    const processed = await processReceivedEvent(eventId);
    expect(processed).toMatchObject({
      processed: false,
      error: "payment_subscription_unmatched",
    });

    const quarantinedInbox = await serviceApi(
      `ordys_billing_webhook_inbox?select=user_id,processing_status,error_code&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    );
    expect(quarantinedInbox.ok, await quarantinedInbox.clone().text()).toBe(true);
    expect(await quarantinedInbox.json()).toEqual([{
      user_id: null,
      processing_status: "quarantined",
      error_code: "payment_subscription_unmatched",
    }]);

    const [currentOwnerBlocked, unrelatedOwnerBlocked] = await Promise.all([
      serviceApi("rpc/ordys_has_unreconciled_billing_events", {
        method: "POST",
        body: JSON.stringify({ p_user_id: currentOwner.id }),
      }),
      serviceApi("rpc/ordys_has_unreconciled_billing_events", {
        method: "POST",
        body: JSON.stringify({ p_user_id: unrelatedOwner.id }),
      }),
    ]);
    expect(currentOwnerBlocked.ok, await currentOwnerBlocked.clone().text()).toBe(true);
    expect(await currentOwnerBlocked.json()).toBe(true);
    expect(unrelatedOwnerBlocked.ok, await unrelatedOwnerBlocked.clone().text()).toBe(true);
    expect(await unrelatedOwnerBlocked.json()).toBe(true);
  }, 30_000);

  it("quarantines reuse of a provider event ID with different allowlisted content", async () => {
    const owner = await createTestUser("inbox-event-id-conflict-owner");
    extraUsers.push(owner);

    const attemptId = crypto.randomUUID();
    const customerId = `cus_ordys_ci_event_id_conflict_${unique}`;
    const externalRef = `ordys_ci_event_id_conflict_${unique}`;
    const eventId = `evt_ordys_ci_event_id_conflict_${unique}`;
    eventIds.push(eventId);

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: owner.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_customer_id: customerId,
        amount_cents: 5_990,
        status: "failed",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const originalEvent = {
      id: eventId,
      event: "PAYMENT_CREATED",
      payment: {
        id: `pay_ordys_ci_event_id_conflict_${unique}`,
        subscription: `sub_ordys_ci_event_id_conflict_${unique}`,
        customer: customerId,
        value: 59.9,
        billingType: "CREDIT_CARD",
      },
    };
    expect(await receiveEvent(originalEvent)).toEqual({
      accepted: true,
      processing_status: "received",
      duplicate: false,
      event_id_conflict: false,
    });
    expect(await receiveEvent(originalEvent)).toEqual({
      accepted: true,
      processing_status: "received",
      duplicate: true,
      event_id_conflict: false,
    });

    const conflictingEvent = {
      ...originalEvent,
      payment: { ...originalEvent.payment, value: 60.9 },
    };
    expect(await receiveEvent(conflictingEvent)).toEqual({
      accepted: true,
      processing_status: "quarantined",
      duplicate: true,
      event_id_conflict: true,
    });

    const storedInbox = await serviceApi(
      `ordys_billing_webhook_inbox?select=processing_status,error_code,user_id,event_payload&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    );
    expect(storedInbox.ok, await storedInbox.clone().text()).toBe(true);
    expect(await storedInbox.json()).toEqual([{
      processing_status: "quarantined",
      error_code: "event_id_payload_mismatch",
      user_id: null,
      event_payload: {
        id: eventId,
        event: "PAYMENT_CREATED",
        payment: {
          id: `pay_ordys_ci_event_id_conflict_${unique}`,
          subscription: `sub_ordys_ci_event_id_conflict_${unique}`,
          customer: customerId,
          value: 59.9,
          billingType: "CREDIT_CARD",
        },
      },
    }]);

    // The conflicting payload has no trustworthy owner. Its NULL owner must
    // block billing admission globally, not only for the account seen first.
    const unrelatedOwner = await createTestUser("inbox-event-id-conflict-unrelated-owner");
    extraUsers.push(unrelatedOwner);
    const [ownerBlocked, unrelatedOwnerBlocked] = await Promise.all([
      serviceApi("rpc/ordys_has_unreconciled_billing_events", {
        method: "POST",
        body: JSON.stringify({ p_user_id: owner.id }),
      }),
      serviceApi("rpc/ordys_has_unreconciled_billing_events", {
        method: "POST",
        body: JSON.stringify({ p_user_id: unrelatedOwner.id }),
      }),
    ]);
    expect(ownerBlocked.ok, await ownerBlocked.clone().text()).toBe(true);
    expect(await ownerBlocked.json()).toBe(true);
    expect(unrelatedOwnerBlocked.ok, await unrelatedOwnerBlocked.clone().text()).toBe(true);
    expect(await unrelatedOwnerBlocked.json()).toBe(true);

    const blockedCheckout = await serviceApi("rpc/ordys_begin_billing_checkout_attempt", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: unrelatedOwner.id,
        p_attempt_id: crypto.randomUUID(),
        p_plan_code: "plus_monthly",
        p_external_reference: `ordys_ci_event_id_conflict_blocked_${unique}`,
        p_amount_cents: 5_990,
        p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(blockedCheckout.ok, await blockedCheckout.clone().text()).toBe(true);
    expect(await blockedCheckout.json()).toBe("billing_reconciliation_required");

  }, 30_000);

  it("keeps a Checkout in creating state when an unresolved webhook arrives before finalization", async () => {
    const guardedUser = await createTestUser("finalize-inbox-race");
    extraUsers.push(guardedUser);

    const attemptId = crypto.randomUUID();
    const customerId = `cus_ordys_ci_finalize_race_${unique}`;
    const externalRef = `ordys_ci_finalize_race_${unique}`;
    const eventId = `evt_ordys_ci_finalize_race_${unique}`;
    const providerCheckoutId = `chk_ordys_ci_finalize_race_${unique}`;
    eventIds.push(eventId);

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_customer_id: customerId,
        amount_cents: 5_990,
        status: "creating",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const receipt = await receiveEvent({
      id: eventId,
      event: "PAYMENT_CREATED",
      payment: {
        id: `pay_ordys_ci_finalize_race_${unique}`,
        subscription: `sub_ordys_ci_finalize_race_${unique}`,
        customer: customerId,
        value: 59.9,
        billingType: "CREDIT_CARD",
      },
    });
    expect(receipt).toMatchObject({
      accepted: true,
      processing_status: "received",
      duplicate: false,
    });

    const finalized = await serviceApi("rpc/ordys_finalize_billing_checkout_attempt", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: guardedUser.id,
        p_attempt_id: attemptId,
        p_provider_checkout_id: providerCheckoutId,
        p_checkout_url: `https://asaas.com/checkoutSession/show?id=${providerCheckoutId}`,
      }),
    });
    expect(finalized.ok, await finalized.clone().text()).toBe(true);
    expect(await finalized.json()).toBe("cancel_required");

    const storedAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_checkout_id,checkout_url&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(storedAttempt.ok, await storedAttempt.clone().text()).toBe(true);
    expect(await storedAttempt.json()).toEqual([{
      status: "creating",
      provider_checkout_id: providerCheckoutId,
      checkout_url: null,
    }]);
  }, 30_000);

  it("allows finalization only for the exact CHECKOUT_CREATED event belonging to that Checkout", async () => {
    const guardedUser = await createTestUser("matching-checkout-created-receipt");
    extraUsers.push(guardedUser);

    const attemptId = crypto.randomUUID();
    const externalRef = `ordys_ci_matching_checkout_created_${unique}`;
    const providerCheckoutId = `chk_ordys_ci_matching_checkout_created_${unique}`;
    const providerCustomerId = `cus_ordys_ci_matching_checkout_created_${unique}`;
    const eventId = `evt_ordys_ci_matching_checkout_created_${unique}`;
    eventIds.push(eventId);

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        amount_cents: 5_990,
        status: "creating",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const receipt = await receiveEvent({
      id: eventId,
      event: "CHECKOUT_CREATED",
      checkout: {
        id: providerCheckoutId,
        customer: providerCustomerId,
        externalReference: externalRef,
      },
    });
    expect(receipt).toMatchObject({
      accepted: true,
      processing_status: "received",
      duplicate: false,
    });

    const finalized = await serviceApi("rpc/ordys_finalize_billing_checkout_attempt", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: guardedUser.id,
        p_attempt_id: attemptId,
        p_provider_checkout_id: providerCheckoutId,
        p_checkout_url: `https://asaas.com/checkoutSession/show?id=${providerCheckoutId}`,
      }),
    });
    expect(finalized.ok, await finalized.clone().text()).toBe(true);
    expect(await finalized.json()).toBe("ready");

    const processed = await processReceivedEvent(eventId);
    expect(processed).toMatchObject({ processed: true, event: "CHECKOUT_CREATED" });

    const storedAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_checkout_id,checkout_url,provider_customer_id&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(storedAttempt.ok, await storedAttempt.clone().text()).toBe(true);
    expect(await storedAttempt.json()).toEqual([{
      status: "pending",
      provider_checkout_id: providerCheckoutId,
      checkout_url: `https://asaas.com/checkoutSession/show?id=${providerCheckoutId}`,
      provider_customer_id: providerCustomerId,
    }]);
  }, 30_000);


  it("allows finalization by exact provider Checkout ID when CHECKOUT_CREATED omits externalReference", async () => {
    const guardedUser = await createTestUser("matching-checkout-created-no-reference");
    extraUsers.push(guardedUser);

    const attemptId = crypto.randomUUID();
    const externalRef = `ordys_ci_matching_checkout_created_no_ref_${unique}`;
    const providerCheckoutId = `chk_ordys_ci_matching_checkout_created_no_ref_${unique}`;
    const providerCustomerId = `cus_ordys_ci_matching_checkout_created_no_ref_${unique}`;
    const eventId = `evt_ordys_ci_matching_checkout_created_no_ref_${unique}`;
    eventIds.push(eventId);

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        amount_cents: 5_990,
        status: "creating",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    // The official Asaas CHECKOUT_CREATED example includes checkout.id but
    // omits externalReference. Before finalization, no local row knows this ID.
    const receipt = await receiveEvent({
      id: eventId,
      event: "CHECKOUT_CREATED",
      checkout: {
        id: providerCheckoutId,
        customer: providerCustomerId,
        status: "ACTIVE",
      },
    });
    expect(receipt).toMatchObject({
      accepted: true,
      processing_status: "received",
      duplicate: false,
    });

    const inbox = await serviceApi(
      `ordys_billing_webhook_inbox?select=user_id,processing_status&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    );
    expect(inbox.ok, await inbox.clone().text()).toBe(true);
    expect(await inbox.json()).toEqual([{
      user_id: null,
      processing_status: "received",
    }]);

    const finalized = await serviceApi("rpc/ordys_finalize_billing_checkout_attempt", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: guardedUser.id,
        p_attempt_id: attemptId,
        p_provider_checkout_id: providerCheckoutId,
        p_checkout_url: `https://asaas.com/checkoutSession/show?id=${providerCheckoutId}`,
      }),
    });
    expect(finalized.ok, await finalized.clone().text()).toBe(true);
    expect(await finalized.json()).toBe("ready");

    const processed = await processReceivedEvent(eventId);
    expect(processed).toMatchObject({ processed: true, event: "CHECKOUT_CREATED" });

    const storedAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_checkout_id,checkout_url&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(storedAttempt.ok, await storedAttempt.clone().text()).toBe(true);
    expect(await storedAttempt.json()).toEqual([{
      status: "pending",
      provider_checkout_id: providerCheckoutId,
      checkout_url: `https://asaas.com/checkoutSession/show?id=${providerCheckoutId}`,
    }]);
  }, 30_000);

  it("keeps finalization blocked when the exact CHECKOUT_CREATED ID carries another externalReference", async () => {
    const checkoutUser = await createTestUser("checkout-created-conflicting-reference-owner");
    const referenceOwner = await createTestUser("checkout-created-conflicting-reference-other");
    extraUsers.push(checkoutUser, referenceOwner);

    const attemptId = crypto.randomUUID();
    const otherAttemptId = crypto.randomUUID();
    const externalRef = `ordys_ci_checkout_created_trusted_ref_${unique}`;
    const conflictingExternalRef = `ordys_ci_checkout_created_other_ref_${unique}`;
    const providerCheckoutId = `chk_ordys_ci_checkout_created_conflicting_ref_${unique}`;
    const eventId = `evt_ordys_ci_checkout_created_conflicting_ref_${unique}`;
    eventIds.push(eventId);

    for (const [id, userId, reference] of [
      [attemptId, checkoutUser.id, externalRef],
      [otherAttemptId, referenceOwner.id, conflictingExternalRef],
    ]) {
      const attempt = await serviceApi("ordys_billing_checkout_attempts", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id,
          user_id: userId,
          plan_code: "plus_monthly",
          external_reference: reference,
          amount_cents: 5_990,
          status: "creating",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      expect(attempt.ok, await attempt.clone().text()).toBe(true);
    }

    const receipt = await receiveEvent({
      id: eventId,
      event: "CHECKOUT_CREATED",
      checkout: {
        id: providerCheckoutId,
        externalReference: conflictingExternalRef,
        status: "ACTIVE",
      },
    });
    expect(receipt).toMatchObject({
      accepted: true,
      processing_status: "received",
      duplicate: false,
    });

    const inbox = await serviceApi(
      `ordys_billing_webhook_inbox?select=user_id,processing_status&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    );
    expect(inbox.ok, await inbox.clone().text()).toBe(true);
    expect(await inbox.json()).toEqual([{
      user_id: referenceOwner.id,
      processing_status: "received",
    }]);

    const finalized = await serviceApi("rpc/ordys_finalize_billing_checkout_attempt", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: checkoutUser.id,
        p_attempt_id: attemptId,
        p_provider_checkout_id: providerCheckoutId,
        p_checkout_url: `https://asaas.com/checkoutSession/show?id=${providerCheckoutId}`,
      }),
    });
    expect(finalized.ok, await finalized.clone().text()).toBe(true);
    expect(await finalized.json()).toBe("cancel_required");

    const storedAttempt = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_checkout_id,checkout_url&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(storedAttempt.ok, await storedAttempt.clone().text()).toBe(true);
    expect(await storedAttempt.json()).toEqual([{
      status: "creating",
      provider_checkout_id: providerCheckoutId,
      checkout_url: null,
    }]);
  }, 30_000);

  it("processes a new event in the legacy one-RPC call and acknowledges only the terminal result", async () => {
    const guardedUser = await createTestUser("legacy-webhook-compatibility");
    extraUsers.push(guardedUser);

    const attemptId = crypto.randomUUID();
    const externalRef = `ordys_ci_legacy_compat_${unique}`;
    const providerCheckoutId = `chk_ordys_ci_legacy_compat_${unique}`;
    const providerCustomerId = `cus_ordys_ci_legacy_compat_${unique}`;
    const eventId = `evt_ordys_ci_legacy_compat_${unique}`;
    eventIds.push(eventId);

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: guardedUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        amount_cents: 5_990,
        status: "creating",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const event = {
      id: eventId,
      event: "CHECKOUT_CREATED",
      checkout: {
        id: providerCheckoutId,
        customer: providerCustomerId,
        externalReference: externalRef,
      },
    };
    const first = await serviceApi("rpc/process_ordys_asaas_billing_event", {
      method: "POST",
      body: JSON.stringify({ p_event: event }),
    });
    expect(first.ok, await first.clone().text()).toBe(true);
    expect(await first.json()).toMatchObject({
      processed: true,
      event: "CHECKOUT_CREATED",
    });

    const inbox = await serviceApi(
      `ordys_billing_webhook_inbox?select=processing_status&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    );
    expect(inbox.ok, await inbox.clone().text()).toBe(true);
    expect(await inbox.json()).toEqual([{ processing_status: "processed" }]);

    // The old one-RPC contract must acknowledge only once the first delivery
    // has actually been applied. A provider duplicate is then a no-op.
    const second = await serviceApi("rpc/process_ordys_asaas_billing_event", {
      method: "POST",
      body: JSON.stringify({ p_event: event }),
    });
    expect(second.ok, await second.clone().text()).toBe(true);
    expect(await second.json()).toEqual({
      processed: false,
      duplicate: true,
    });

    const linked = await serviceApi(
      `ordys_billing_checkout_attempts?select=status,provider_checkout_id,checkout_url&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    );
    expect(linked.ok, await linked.clone().text()).toBe(true);
    expect(await linked.json()).toEqual([{
      status: "pending",
      provider_checkout_id: providerCheckoutId,
      checkout_url: `https://asaas.com/checkoutSession/show?id=${providerCheckoutId}`,
    }]);
  }, 30_000);


  it("recalcula o período pago pela data financeira independentemente da ordem dos webhooks", async () => {
    const periodUser = await createTestUser("out-of-order-payment-period");
    extraUsers.push(periodUser);

    const providerSubscriptionId = `sub_ordys_ci_out_of_order_period_${unique}`;
    const providerCustomerId = `cus_ordys_ci_out_of_order_period_${unique}`;
    const newerPaymentId = `pay_ordys_ci_newer_period_${unique}`;
    const olderPaymentId = `pay_ordys_ci_older_period_${unique}`;
    const newerEventId = `evt_ordys_ci_newer_period_${unique}`;
    const olderEventId = `evt_ordys_ci_older_period_${unique}`;
    eventIds.push(newerEventId, olderEventId);

    // Keep the correct final entitlement in the future so this regression
    // also verifies that chronological recomputation preserves Plus access.
    const newerPaidAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const olderPaidAt = new Date(newerPaidAt.getTime() - 45 * 24 * 60 * 60 * 1000);
    const expectedPeriodEnd = new Date(newerPaidAt);
    expectedPeriodEnd.setUTCMonth(expectedPeriodEnd.getUTCMonth() + 1);

    const seededSubscription = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: periodUser.id,
        plan_code: "plus_monthly",
        checkout_attempt_id: null,
        provider_subscription_id: providerSubscriptionId,
        provider_customer_id: providerCustomerId,
        provider_status: "ACTIVE",
        status: "pending",
        billing_cycle: "MONTHLY",
        billing_type: "CREDIT_CARD",
        amount_cents: 5_990,
      }),
    });
    expect(seededSubscription.ok, await seededSubscription.clone().text()).toBe(true);

    const paymentEvent = (
      eventId: string,
      paymentId: string,
      paidAt: Date,
    ) => ({
      id: eventId,
      event: "PAYMENT_CONFIRMED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: paymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });

    // The newer settlement is delivered first; the older one is delayed.
    const newerFirst = await processEvent(
      paymentEvent(newerEventId, newerPaymentId, newerPaidAt),
    );
    expect(newerFirst).toMatchObject({ processed: true, event: "PAYMENT_CONFIRMED" });

    const olderSecond = await processEvent(
      paymentEvent(olderEventId, olderPaymentId, olderPaidAt),
    );
    expect(olderSecond).toMatchObject({ processed: true, event: "PAYMENT_CONFIRMED" });

    const subscriptionResult = await serviceApi(
      `ordys_billing_subscriptions?select=status,current_period_end&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(subscriptionResult.ok, await subscriptionResult.clone().text()).toBe(true);
    const subscriptionRows = await subscriptionResult.json() as Array<{
      status: string;
      current_period_end: string | null;
    }>;
    expect(subscriptionRows).toHaveLength(1);
    expect(subscriptionRows[0]?.status).toBe("active");
    expect(Date.parse(subscriptionRows[0]?.current_period_end ?? "")).toBe(
      expectedPeriodEnd.getTime(),
    );
    const eligibility = await serviceApi("rpc/is_ordys_plus_eligible", {
      method: "POST",
      body: JSON.stringify({ p_user_id: periodUser.id }),
    });
    expect(eligibility.ok, await eligibility.clone().text()).toBe(true);
    expect(await eligibility.json()).toBe(true);

    const paymentRowsResponse = await serviceApi(
      `ordys_billing_payments?select=provider_payment_id,paid_at&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&order=paid_at.asc`,
    );
    expect(paymentRowsResponse.ok, await paymentRowsResponse.clone().text()).toBe(true);
    const paymentRows = await paymentRowsResponse.json() as Array<{
      provider_payment_id: string;
      paid_at: string;
    }>;
    expect(paymentRows.map((row) => row.provider_payment_id)).toEqual([
      olderPaymentId,
      newerPaymentId,
    ]);
    expect(Date.parse(paymentRows[0]!.paid_at)).toBe(olderPaidAt.getTime());
    expect(Date.parse(paymentRows[1]!.paid_at)).toBe(newerPaidAt.getTime());
  }, 30_000);

  it("reconhece um pagamento conhecido quando o webhook financeiro omite subscription", async () => {
    const refundUser = await createTestUser("known-payment-without-subscription-field");
    const unrelatedUser = await createTestUser("same-asaas-customer-unrelated-owner");
    extraUsers.push(refundUser, unrelatedUser);

    const providerSubscriptionId = `sub_ordys_ci_payment_lookup_${unique}`;
    const unrelatedSubscriptionId = `sub_ordys_ci_payment_lookup_unrelated_${unique}`;
    // Deliberately reuse the Asaas customer ID across two local accounts.
    const providerCustomerId = `cus_ordys_ci_payment_lookup_shared_${unique}`;
    const providerPaymentId = `pay_ordys_ci_payment_lookup_${unique}`;
    const confirmedEventId = `evt_ordys_ci_payment_lookup_confirmed_${unique}`;
    const refundedEventId = `evt_ordys_ci_payment_lookup_refunded_${unique}`;
    eventIds.push(confirmedEventId, refundedEventId);
    const paidAt = new Date();

    const seededSubscription = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: refundUser.id,
        plan_code: "plus_monthly",
        checkout_attempt_id: null,
        provider_subscription_id: providerSubscriptionId,
        provider_customer_id: providerCustomerId,
        provider_status: "ACTIVE",
        status: "pending",
        billing_cycle: "MONTHLY",
        billing_type: "CREDIT_CARD",
        amount_cents: 5_990,
      }),
    });
    expect(seededSubscription.ok, await seededSubscription.clone().text()).toBe(true);

    const unrelatedSubscription = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: unrelatedUser.id,
        plan_code: "plus_monthly",
        checkout_attempt_id: null,
        provider_subscription_id: unrelatedSubscriptionId,
        provider_customer_id: providerCustomerId,
        provider_status: "ACTIVE",
        status: "pending",
        billing_cycle: "MONTHLY",
        billing_type: "CREDIT_CARD",
        amount_cents: 5_990,
      }),
    });
    expect(unrelatedSubscription.ok, await unrelatedSubscription.clone().text()).toBe(true);

    const confirmed = await processEvent({
      id: confirmedEventId,
      event: "PAYMENT_CONFIRMED",
      dateCreated: paidAt.toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
        billingType: "CREDIT_CARD",
        value: 59.9,
        dueDate: paidAt.toISOString().slice(0, 10),
        paymentDate: paidAt.toISOString(),
      },
    });
    expect(confirmed).toMatchObject({ processed: true, event: "PAYMENT_CONFIRMED" });

    // The Asaas payment object may omit subscription; the exact stored payment
    // ID is sufficient to recover this known subscription without customer guessing.
    const refunded = await processEvent({
      id: refundedEventId,
      event: "PAYMENT_REFUNDED",
      dateCreated: new Date().toISOString(),
      payment: {
        id: providerPaymentId,
        customer: providerCustomerId,
      },
    });
    expect(refunded).toMatchObject({ processed: true, event: "PAYMENT_REFUNDED" });

    const subscriptionResult = await serviceApi(
      `ordys_billing_subscriptions?select=status&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
    );
    expect(subscriptionResult.ok, await subscriptionResult.clone().text()).toBe(true);
    expect(await subscriptionResult.json()).toEqual([{ status: "suspended" }]);

    const unrelatedSubscriptionResult = await serviceApi(
      `ordys_billing_subscriptions?select=status&provider_subscription_id=eq.${encodeURIComponent(unrelatedSubscriptionId)}&limit=1`,
    );
    expect(unrelatedSubscriptionResult.ok, await unrelatedSubscriptionResult.clone().text()).toBe(true);
    expect(await unrelatedSubscriptionResult.json()).toEqual([{ status: "pending" }]);

    const inboxResult = await serviceApi(
      `ordys_billing_webhook_inbox?select=user_id,processing_status&provider_event_id=eq.${encodeURIComponent(refundedEventId)}&limit=1`,
    );
    expect(inboxResult.ok, await inboxResult.clone().text()).toBe(true);
    expect(await inboxResult.json()).toEqual([{
      user_id: null,
      processing_status: "processed",
    }]);

    const paymentResult = await serviceApi(
      `ordys_billing_payments?select=status,provider_subscription_id&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&limit=1`,
    );
    expect(paymentResult.ok, await paymentResult.clone().text()).toBe(true);
    expect(await paymentResult.json()).toEqual([{
      status: "PAYMENT_REFUNDED",
      provider_subscription_id: providerSubscriptionId,
    }]);
  }, 30_000);


  it("preserva o ledger e concilia estorno tardio após exclusão da conta", async () => {
    const schemaStatus = await serviceApi("rpc/ordys_billing_schema_status", { method: "POST", body: "{}" });
    expect(schemaStatus.ok, await schemaStatus.clone().text()).toBe(true);
    // Integration migrations never schedule a production Job. Readiness must
    // remain partial until an operator creates the pg_cron worker explicitly.
    expect(await schemaStatus.json()).toBe("partial");

    const deletedUser = await createTestUser("deleted-account-late-refund");
    extraUsers.push(deletedUser);

    const attemptId = crypto.randomUUID();
    const providerCheckoutId = `chk_ordys_ci_deleted_account_${unique}`;
    const externalRef = `ordys_ci_deleted_account_${unique}`;
    const providerCustomerId = `cus_ordys_ci_deleted_account_${unique}`;
    const providerSubscriptionId = `sub_ordys_ci_deleted_account_${unique}`;
    const providerPaymentId = `pay_ordys_ci_deleted_account_${unique}`;
    const receiptEventId = `evt_ordys_ci_deleted_account_receipt_${unique}`;
    const refundEventId = `evt_ordys_ci_deleted_account_late_refund_${unique}`;
    eventIds.push(receiptEventId, refundEventId);
    cleanupBillingAttemptIds.push(attemptId);
    cleanupBillingSubscriptionIds.push(providerSubscriptionId);
    cleanupBillingPaymentIds.push(providerPaymentId);
    const now = new Date();
    const timestamp = now.toISOString();

    const attempt = await serviceApi("ordys_billing_checkout_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: attemptId,
        user_id: deletedUser.id,
        plan_code: "plus_monthly",
        external_reference: externalRef,
        provider_checkout_id: providerCheckoutId,
        provider_customer_id: providerCustomerId,
        amount_cents: 5_990,
        status: "cancelled",
        expires_at: timestamp,
      }),
    });
    expect(attempt.ok, await attempt.clone().text()).toBe(true);

    const subscription = await serviceApi("ordys_billing_subscriptions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: deletedUser.id,
        plan_code: "plus_monthly",
        checkout_attempt_id: attemptId,
        provider_subscription_id: providerSubscriptionId,
        provider_checkout_id: providerCheckoutId,
        provider_customer_id: providerCustomerId,
        provider_status: "DELETED",
        status: "cancelled",
        billing_cycle: "MONTHLY",
        billing_type: "CREDIT_CARD",
        amount_cents: 5_990,
        current_period_end: timestamp,
        cancelled_at: timestamp,
        cancellation_confirmed_at: timestamp,
      }),
    });
    expect(subscription.ok, await subscription.clone().text()).toBe(true);

    const payment = await serviceApi("ordys_billing_payments", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        provider_payment_id: providerPaymentId,
        user_id: deletedUser.id,
        provider_subscription_id: providerSubscriptionId,
        amount_cents: 5_990,
        billing_type: "CREDIT_CARD",
        status: "PAYMENT_CONFIRMED",
        due_date: timestamp.slice(0, 10),
        confirmed_at: timestamp,
        paid_at: timestamp,
      }),
    });
    expect(payment.ok, await payment.clone().text()).toBe(true);

    const receipt = await serviceApi("ordys_billing_webhook_inbox", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        provider_event_id: receiptEventId,
        event_type: "SUBSCRIPTION_DELETED",
        provider_object_id: providerSubscriptionId,
        provider_customer_id: providerCustomerId,
        provider_subscription_id: providerSubscriptionId,
        external_reference: externalRef,
        user_id: deletedUser.id,
        event_payload: {
          id: receiptEventId,
          event: "SUBSCRIPTION_DELETED",
          subscription: { id: providerSubscriptionId, customer: providerCustomerId },
        },
        processing_status: "processed",
        processed_at: timestamp,
      }),
    });
    expect(receipt.ok, await receipt.clone().text()).toBe(true);

    const reservation = await serviceApi("rpc/ordys_reserve_account_deletion", {
      method: "POST",
      body: JSON.stringify({ p_user_id: deletedUser.id }),
    });
    expect(reservation.ok, await reservation.clone().text()).toBe(true);
    expect(await reservation.json()).toBe("reserved");

    const processingToken = crypto.randomUUID();
    const claim = await serviceApi("rpc/ordys_claim_account_deletion_processing", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: deletedUser.id,
        p_processing_token: processingToken,
      }),
    });
    expect(claim.ok, await claim.clone().text()).toBe(true);
    expect(await claim.json()).toBe("claimed");

    const cleared = await fetch(`${URL}/rest/v1/rpc/delete_own_data`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${deletedUser.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(cleared.ok, await cleared.clone().text()).toBe(true);

    const anonymizedInbox = await serviceApi(
      `ordys_billing_webhook_inbox?select=user_id,processing_status&provider_event_id=eq.${encodeURIComponent(receiptEventId)}&limit=1`,
    );
    expect(anonymizedInbox.ok, await anonymizedInbox.clone().text()).toBe(true);
    expect(await anonymizedInbox.json()).toEqual([{
      user_id: null,
      processing_status: "processed",
    }]);

    const authDeletion = await fetch(
      `${URL}/auth/v1/admin/users/${encodeURIComponent(deletedUser.id)}`,
      { method: "DELETE", headers: serviceHeaders() },
    );
    expect(authDeletion.ok, await authDeletion.clone().text()).toBe(true);

    const [retainedAttempt, retainedSubscription, retainedPayment] = await Promise.all([
      serviceApi(
        `ordys_billing_checkout_attempts?select=user_id,status&external_reference=eq.${encodeURIComponent(externalRef)}&limit=1`,
      ),
      serviceApi(
        `ordys_billing_subscriptions?select=user_id,status,provider_subscription_id&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
      ),
      serviceApi(
        `ordys_billing_payments?select=user_id,status,provider_subscription_id&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&limit=1`,
      ),
    ]);
    expect(retainedAttempt.ok, await retainedAttempt.clone().text()).toBe(true);
    expect(await retainedAttempt.json()).toEqual([{ user_id: null, status: "cancelled" }]);
    expect(retainedSubscription.ok, await retainedSubscription.clone().text()).toBe(true);
    expect(await retainedSubscription.json()).toEqual([{
      user_id: null,
      status: "cancelled",
      provider_subscription_id: providerSubscriptionId,
    }]);
    expect(retainedPayment.ok, await retainedPayment.clone().text()).toBe(true);
    expect(await retainedPayment.json()).toEqual([{
      user_id: null,
      status: "PAYMENT_CONFIRMED",
      provider_subscription_id: providerSubscriptionId,
    }]);

    const lateRefund = await processEvent({
      id: refundEventId,
      event: "PAYMENT_REFUNDED",
      dateCreated: new Date().toISOString(),
      payment: {
        id: providerPaymentId,
        subscription: providerSubscriptionId,
        customer: providerCustomerId,
      },
    });
    expect(lateRefund).toMatchObject({ processed: true, event: "PAYMENT_REFUNDED" });

    const [finalSubscription, finalPayment, finalInbox] = await Promise.all([
      serviceApi(
        `ordys_billing_subscriptions?select=user_id,status&provider_subscription_id=eq.${encodeURIComponent(providerSubscriptionId)}&limit=1`,
      ),
      serviceApi(
        `ordys_billing_payments?select=user_id,status&provider_payment_id=eq.${encodeURIComponent(providerPaymentId)}&limit=1`,
      ),
      serviceApi(
        `ordys_billing_webhook_inbox?select=user_id,processing_status&provider_event_id=eq.${encodeURIComponent(refundEventId)}&limit=1`,
      ),
    ]);
    expect(finalSubscription.ok, await finalSubscription.clone().text()).toBe(true);
    expect(await finalSubscription.json()).toEqual([{ user_id: null, status: "suspended" }]);
    expect(finalPayment.ok, await finalPayment.clone().text()).toBe(true);
    expect(await finalPayment.json()).toEqual([{ user_id: null, status: "PAYMENT_REFUNDED" }]);
    expect(finalInbox.ok, await finalInbox.clone().text()).toBe(true);
    expect(await finalInbox.json()).toEqual([{
      user_id: null,
      processing_status: "processed",
    }]);
  }, 30_000);

  it.each([
    "PAYMENT_CREATED",
    "PAYMENT_CONFIRMED",
    "PAYMENT_RECEIVED",
    "PAYMENT_OVERDUE",
    "PAYMENT_REFUNDED",
  ])("ignora %s avulso sem vínculo com contas ou Checkouts do Ordys", async (eventType) => {
    const eventId = `evt_ordys_ci_unrelated_${eventType.toLowerCase()}_${unique}`;
    eventIds.push(eventId);
    const result = await processEvent({
      id: eventId,
      event: eventType,
      dateCreated: new Date().toISOString(),
      payment: {
        id: `pay_ordys_ci_unrelated_${eventType.toLowerCase()}_${unique}`,
        customer: `cus_ordys_ci_unrelated_${unique}`,
        value: 59.9,
        billingType: "CREDIT_CARD",
      },
    });

    expect(result).toMatchObject({
      processed: true,
      ignored_unlinked_payment: true,
      event: eventType,
    });

    const [inbox, ledger] = await Promise.all([
      serviceApi(
        `ordys_billing_webhook_inbox?select=user_id,processing_status,error_code&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
      ),
      serviceApi(
        `ordys_billing_webhook_events?select=processing_status,error_code&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
      ),
    ]);
    expect(inbox.ok, await inbox.clone().text()).toBe(true);
    expect(await inbox.json()).toEqual([{
      user_id: null,
      processing_status: "ignored",
      error_code: null,
    }]);
    expect(ledger.ok, await ledger.clone().text()).toBe(true);
    expect(await ledger.json()).toEqual([{
      processing_status: "ignored",
      error_code: null,
    }]);
  }, 30_000);

  it("quarentena pagamento sem subscription quando externalReference aponta para um Checkout Ordys", async () => {
    const eventId = `evt_ordys_ci_payment_missing_subscription_known_reference_${unique}`;
    eventIds.push(eventId);
    const result = await processEvent({
      id: eventId,
      event: "PAYMENT_RECEIVED",
      dateCreated: new Date().toISOString(),
      payment: {
        id: `pay_ordys_ci_payment_missing_subscription_${unique}`,
        externalReference,
        value: 59.9,
        billingType: "CREDIT_CARD",
      },
    });

    expect(result).toMatchObject({
      processed: false,
      error: "payment_subscription_unmatched",
    });

    const inbox = await serviceApi(
      `ordys_billing_webhook_inbox?select=user_id,processing_status,error_code&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    );
    expect(inbox.ok, await inbox.clone().text()).toBe(true);
    expect(await inbox.json()).toEqual([{
      user_id: user!.id,
      processing_status: "quarantined",
      error_code: "payment_subscription_unmatched",
    }]);
  }, 30_000);

});
