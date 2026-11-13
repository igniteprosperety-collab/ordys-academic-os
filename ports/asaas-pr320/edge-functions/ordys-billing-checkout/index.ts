import {
  AsaasApiError,
  asaasRequest,
  assertAsaasConfigured,
  assertBillingEnabled,
  checkoutAttemptDisposition,
  billingCorsHeaders,
  billingResponse,
  calculateAgeInTimeZone,
  getUserAgeProfile,
  jsonObject,
  serviceRest,
  authenticateBillingRequest,
} from "../_shared/ordys-billing.ts";
import { readRequestBodyWithLimit } from "../_shared/request-body.ts";
import { claimOrdysCheckoutCancellation, type CheckoutCancellationClaim } from "../_shared/ordys-checkout-cancellation.ts";
import { OutboundRequestTimeoutError, withAbortableOutboundRequestTimeout } from "../_shared/request-timeout.ts";

const MAX_CHECKOUT_REQUEST_BYTES = 8_192;
const CHECKOUT_REQUEST_BODY_TIMEOUT_MS = 8_000;
const BILLING_DATABASE_TIMEOUT_MS = 8_000;
const ASAAS_REQUEST_TIMEOUT_MS = 12_000;

function parsePlanCode(value: unknown) {
  return value === "plus_monthly" || value === "plus_yearly" ? value : "";
}

function formatAsaasDateTimeInBrazil(date: Date) {
  const values = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value] as const),
  );

  return `${values.get("year")}-${values.get("month")}-${values.get("day")} ${values.get("hour")}:${values.get("minute")}:${values.get("second")}`;
}

function hasCurrentAccess(row: Record<string, unknown> | undefined) {
  if (!row) return false;
  const now = Date.now();
  const status = typeof row.status === "string" ? row.status : "";
  const periodEnd = typeof row.current_period_end === "string" ? Date.parse(row.current_period_end) : 0;
  const graceUntil = typeof row.grace_until === "string" ? Date.parse(row.grace_until) : 0;
  if (status === "active" || status === "cancelled") return Number.isFinite(periodEnd) && periodEnd > now;
  if (status === "past_due") return Number.isFinite(periodEnd) && periodEnd > 0 && Number.isFinite(graceUntil) && graceUntil > now;
  return false;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: billingCorsHeaders });
  if (request.method !== "POST") return billingResponse({ error: "Método não permitido." }, 405);

  const authentication = await authenticateBillingRequest(
    request,
    "Entre na sua conta para contratar o Ordys Plus.",
  );
  if (authentication.response) return authentication.response;
  const user = authentication.user;
  let providerOutcomeUnknown = false;

  try {
    await assertBillingEnabled();

    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_CHECKOUT_REQUEST_BYTES) {
      return billingResponse({ error: "Solicitação inválida." }, 413);
    }
    const text = await readRequestBodyWithLimit(request, MAX_CHECKOUT_REQUEST_BYTES, CHECKOUT_REQUEST_BODY_TIMEOUT_MS);
    if (text === null) {
      return billingResponse({ error: "Solicitação inválida." }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = jsonObject(JSON.parse(text));
    } catch {
      return billingResponse({ error: "Solicitação inválida." }, 400);
    }

    const planCode = parsePlanCode(body.planCode);
    if (!planCode) return billingResponse({ error: "Selecione um plano válido." }, 400);

    const ageProfile = await getUserAgeProfile(user.id, user.authorization);
    const age = calculateAgeInTimeZone(ageProfile.birthDate, ageProfile.timezone);
    if (age === null || age < 18) {
      return billingResponse({
        error: "A contratação do Ordys Plus está disponível somente para contas de pessoas com 18 anos ou mais nesta primeira versão.",
      }, 403);
    }

    const subscriptions = await serviceRest(
      `ordys_billing_subscriptions?select=id,status,current_period_end,grace_until,provider_subscription_id,provider_status,cancellation_confirmed_at&user_id=eq.${encodeURIComponent(user.id)}&status=in.(pending,active,past_due,suspended,cancelled)&order=created_at.desc`,
    ) as Array<Record<string, unknown>> | null;

    if (subscriptions?.some(hasCurrentAccess)) {
      return billingResponse({
        error: "Sua conta já possui acesso ativo ao Ordys Plus.",
        code: "subscription_active",
      }, 409);
    }

    // Legacy releases could mark a row locally as cancelled before Asaas
    // confirmed the provider-side cancellation. Do not create another
    // recurring subscription while that old provider resource may still bill.
    const unconfirmedLocalCancellation = subscriptions?.some((row) =>
      row.status === "cancelled" &&
      row.provider_status !== "DELETED" &&
      typeof row.cancellation_confirmed_at !== "string"
    );
    if (unconfirmedLocalCancellation) {
      return billingResponse({
        error: "Sua assinatura consta como cancelada localmente, mas o Asaas ainda não confirmou o encerramento. A nova contratação está bloqueada até a conciliação.",
        code: "subscription_cancellation_reconciliation_required",
      }, 409);
    }

    const openSubscriptions = subscriptions?.filter((row) =>
      row.status === "pending" || row.status === "active" || row.status === "past_due" || row.status === "suspended"
    ) ?? [];
    if (openSubscriptions.some((row) => row.status === "suspended")) {
      return billingResponse({
        error: "Sua assinatura foi suspensa após um estorno ou contestação e precisa de análise antes de uma nova contratação.",
        code: "subscription_suspended",
      }, 409);
    }
    if (openSubscriptions.length) {
      return billingResponse({
        error: "Sua conta possui uma assinatura ativa, pendente ou em atraso sem encerramento confirmado. Cancele a assinatura atual antes de iniciar outra contratação.",
        code: "subscription_needs_attention",
      }, 409);
    }

    const plans = await serviceRest(
      `ordys_billing_plans?select=plan_code,title,description,billing_cycle,price_cents,currency,enabled&plan_code=eq.${planCode}&enabled=eq.true&limit=1`,
    ) as Array<Record<string, unknown>> | null;
    const plan = plans?.[0];
    const amountCents = Number(plan?.price_cents);
    const cycle = plan?.billing_cycle === "YEARLY" ? "YEARLY" : plan?.billing_cycle === "MONTHLY" ? "MONTHLY" : "";
    if (
      !plan ||
      !cycle ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      plan.currency !== "BRL"
    ) {
      return billingResponse({
        error: "Este plano ainda não está disponível para contratação.",
        code: "plan_not_configured",
      }, 503);
    }

    const now = new Date();
    const paidAttempts = await serviceRest(
      `ordys_billing_checkout_attempts?select=id,plan_code,provider_checkout_id,status,updated_at&user_id=eq.${encodeURIComponent(user.id)}&status=eq.paid&order=created_at.desc&limit=1`,
    ) as Array<Record<string, unknown>> | null;
    if (paidAttempts?.length) {
      return billingResponse({
        error: "Recebemos a confirmação do Checkout e estamos conciliando a assinatura. Não inicie outro pagamento. Atualize o status ou entre em contato com o suporte se a validação não for concluída.",
        code: "checkout_payment_processing",
      }, 409);
    }

    // Keep unresolved provider attempts locked even after local expiry.
    // Only a terminal Asaas webhook releases the per-user checkout lock.
    const pendingAttempts = await serviceRest(
      `ordys_billing_checkout_attempts?select=id,plan_code,provider_checkout_id,checkout_url,status,expires_at,cancellation_requested_at,cancellation_claim_id&user_id=eq.${encodeURIComponent(user.id)}&status=in.(creating,pending,linked)&order=created_at.desc&limit=1`,
    ) as Array<Record<string, unknown>> | null;
    const existingAttempt = pendingAttempts?.[0];
    if (existingAttempt) {
      const disposition = checkoutAttemptDisposition(
        String(existingAttempt.status ?? ""),
        String(existingAttempt.expires_at ?? ""),
        now.getTime(),
      );

      if (disposition === "reuse") {
        if (
          existingAttempt.plan_code === planCode &&
          typeof existingAttempt.checkout_url === "string" &&
          existingAttempt.checkout_url.startsWith("https://")
        ) {
          return billingResponse({
            checkoutUrl: existingAttempt.checkout_url,
            planCode,
            amountCents,
            currency: "BRL",
            reused: true,
          });
        }
        return billingResponse({
          error: "Já existe um checkout válido nesta conta. Conclua ou cancele a etapa anterior antes de escolher outro plano.",
          code: "checkout_in_progress",
        }, 409);
      }

      if (disposition === "cancel_remote") {
        const providerCheckoutId = typeof existingAttempt.provider_checkout_id === "string"
          ? existingAttempt.provider_checkout_id
          : "";
        if (!providerCheckoutId) {
          return billingResponse({
            error: "A criação do checkout anterior ainda está sendo conciliada. Não inicie outra cobrança até a confirmação do provedor.",
            code: "checkout_reconciliation_required",
          }, 409);
        }
        if (typeof existingAttempt.cancellation_requested_at === "string") {
          return billingResponse({
            error: "O cancelamento deste checkout já foi solicitado e aguarda confirmação do Asaas. Não envie outra solicitação.",
            code: "checkout_cancellation_processing",
          }, 409);
        }

        const attemptId = typeof existingAttempt.id === "string" ? existingAttempt.id : "";
        if (!attemptId) {
          return billingResponse({
            error: "Não foi possível identificar o checkout anterior para cancelamento.",
            code: "checkout_reconciliation_required",
          }, 409);
        }

        // Configuration errors are deterministic and must be detected before
        // persisting the one-shot provider cancellation claim.
        assertAsaasConfigured();
        let claim: CheckoutCancellationClaim;
        try {
          claim = await claimOrdysCheckoutCancellation(
            user.id,
            attemptId,
            (path, init = {}) => withAbortableOutboundRequestTimeout(
              (signal) => serviceRest(path, { ...init, signal }),
              BILLING_DATABASE_TIMEOUT_MS,
            ),
          );
        } catch {
          return billingResponse({
            error: "Não foi possível confirmar a reivindicação de cancelamento do checkout. Aguarde a conciliação antes de tentar novamente.",
            code: "checkout_reconciliation_required",
          }, 409);
        }

        if (claim === "terminal") {
          return billingResponse({
            error: "O checkout anterior já foi encerrado. Atualize a tela e tente novamente.",
            code: "checkout_already_closed",
          }, 409);
        }
        if (claim === "already_claimed") {
          return billingResponse({
            error: "O cancelamento deste checkout já foi solicitado e aguarda confirmação do Asaas. Não envie outra solicitação.",
            code: "checkout_cancellation_processing",
          }, 409);
        }

        try {
          await withAbortableOutboundRequestTimeout(
            (signal) => asaasRequest(
              `/checkouts/${encodeURIComponent(providerCheckoutId)}/cancel`,
              { method: "POST", signal },
            ),
            ASAAS_REQUEST_TIMEOUT_MS,
          );
        } catch {
          // The provider request may have taken effect despite a lost response.
          // Keep the intent marker and reconcile through CHECKOUT_CANCELED.
          return billingResponse({
            error: "O checkout anterior ainda não teve seu encerramento confirmado pelo Asaas. Aguarde a atualização antes de tentar novamente.",
            code: "checkout_reconciliation_required",
          }, 409);
        }

        // Do not release the lock on the API response alone. Wait for the
        // CHECKOUT_CANCELED webhook as the source of truth.
        return billingResponse({
          error: "Solicitamos o cancelamento do checkout anterior. Aguarde a confirmação do Asaas e tente novamente.",
          code: "checkout_cancellation_processing",
        }, 409);
      }

      return billingResponse({
        error: "A tentativa de checkout anterior ainda não foi conciliada. Não inicie outra cobrança.",
        code: "checkout_reconciliation_required",
      }, 409);
    }

    // Do not create a durable "creating" attempt when credentials or
    // environment are invalid and no request can reach Asaas.
    assertAsaasConfigured();

    const attemptId = crypto.randomUUID();
    const externalReference = `ordys_${attemptId.replaceAll("-", "")}`;
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

    // Atomically serialize the attempt insert against account deletion.
    // A read-then-insert sequence here would still allow both operations to win.
    const attemptState = await serviceRest("rpc/ordys_begin_billing_checkout_attempt", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: user.id,
        p_attempt_id: attemptId,
        p_plan_code: planCode,
        p_external_reference: externalReference,
        p_amount_cents: amountCents,
        p_expires_at: expiresAt.toISOString(),
      }),
    });
    if (attemptState === "deletion_reserved") {
      return billingResponse({
        error: "Sua conta está em processo de exclusão. Não é possível iniciar uma contratação.",
        code: "account_deletion_in_progress",
      }, 409);
    }
    if (attemptState === "billing_reconciliation_required") {
      return billingResponse({
        error: "A contratação está temporariamente bloqueada porque existe um evento financeiro do Asaas sem conciliação segura. Nenhuma nova cobrança foi iniciada. A liberação exige conferência do evento e do titular.",
        code: "billing_reconciliation_required",
      }, 409);
    }
    if (attemptState === "checkout_in_progress") {
      return billingResponse({
        error: "Já existe uma contratação em andamento nesta conta.",
        code: "checkout_in_progress",
      }, 409);
    }
    if (attemptState !== "created") {
      throw new Error("Não foi possível reservar a contratação com segurança.");
    }

    let providerRequestStarted = false;
    let providerCheckoutId = "";
    let checkoutUrl = "";
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
      if (!supabaseUrl) throw new Error("O retorno do checkout não está configurado.");
      const returnUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/ordys-billing-return`;
      // Asaas documents nextDueDate without a timezone suffix. Serialize
      // the intended Brazil civil time instead of sending UTC clock time
      // with its offset removed. Sandbox must confirm the resulting first due date.
      const nextDueDate = formatAsaasDateTimeInBrazil(
        new Date(now.getTime() + 24 * 60 * 60 * 1000),
      );
      providerRequestStarted = true;
      const checkout = await asaasRequest("/checkouts", {
        method: "POST",
        body: JSON.stringify({
          billingTypes: ["CREDIT_CARD"],
          chargeTypes: ["RECURRENT"],
          minutesToExpire: 60,
          externalReference,
          callback: {
            successUrl: `${returnUrl}?status=success`,
            cancelUrl: `${returnUrl}?status=cancelled`,
            expiredUrl: `${returnUrl}?status=expired`,
          },
          items: [{
            name: typeof plan.title === "string" ? plan.title.slice(0, 80) : "Ordys Plus",
            description: typeof plan.description === "string" ? plan.description.slice(0, 500) : "Assinatura Ordys Plus",
            quantity: 1,
            value: Number((amountCents / 100).toFixed(2)),
          }],
          subscription: {
            cycle,
            nextDueDate,
          },
        }),
      });

      providerCheckoutId = typeof checkout.id === "string" ? checkout.id : "";
      checkoutUrl = providerCheckoutId
        ? `https://asaas.com/checkoutSession/show?id=${encodeURIComponent(providerCheckoutId)}`
        : "";
      if (!providerCheckoutId || !/^https:\/\/asaas\.com\/checkoutSession\/show\?id=/i.test(checkoutUrl)) {
        throw new Error("O Asaas não retornou um checkout válido.");
      }

      // Finalize under the same database lock as durable webhook receipt.
      // The RPC stores the provider identity but exposes the URL only if no
      // conflicting event/subscription appeared while Asaas created the Checkout.
      const finalization = await serviceRest("rpc/ordys_finalize_billing_checkout_attempt", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: user.id,
          p_attempt_id: attemptId,
          p_provider_checkout_id: providerCheckoutId,
          p_checkout_url: checkoutUrl,
        }),
      });

      if (finalization === "ready") {
        return billingResponse({
          checkoutUrl,
          planCode,
          amountCents,
          currency: "BRL",
          reused: false,
        });
      }

      if (finalization === "cancel_required") {
        let cancellationClaim: CheckoutCancellationClaim;
        try {
          cancellationClaim = await claimOrdysCheckoutCancellation(
            user.id,
            attemptId,
            (path, init = {}) => withAbortableOutboundRequestTimeout(
              (signal) => serviceRest(path, { ...init, signal }),
              BILLING_DATABASE_TIMEOUT_MS,
            ),
          );
        } catch {
          return billingResponse({
            error: "O Checkout foi criado, mas existe um evento financeiro que exige conciliação. O link não foi liberado e o cancelamento não pôde ser reservado com segurança.",
            code: "checkout_reconciliation_required",
          }, 409);
        }

        if (cancellationClaim === "terminal") {
          return billingResponse({
            error: "O Checkout foi encerrado durante a conciliação. Atualize o status antes de tentar novamente.",
            code: "checkout_already_closed",
          }, 409);
        }
        if (cancellationClaim === "already_claimed") {
          return billingResponse({
            error: "O cancelamento deste Checkout já foi solicitado e aguarda confirmação do Asaas.",
            code: "checkout_cancellation_processing",
          }, 409);
        }

        try {
          await withAbortableOutboundRequestTimeout(
            (signal) => asaasRequest(
              "/checkouts/" + encodeURIComponent(providerCheckoutId) + "/cancel",
              { method: "POST", signal },
            ),
            ASAAS_REQUEST_TIMEOUT_MS,
          );
        } catch {
          // Keep the one-shot claim. A timeout or provider 404 is not proof
          // that the remote Checkout is closed; wait for provider reconciliation.
          return billingResponse({
            error: "O Checkout não teve seu encerramento confirmado pelo Asaas. O link continua bloqueado até a conciliação.",
            code: "checkout_reconciliation_required",
          }, 409);
        }

        return billingResponse({
          error: "Detectamos um evento financeiro durante a criação e solicitamos o cancelamento do Checkout. O link não foi liberado; aguarde a confirmação do Asaas.",
          code: "checkout_cancellation_processing",
        }, 409);
      }

      if (finalization === "reconciled") {
        return billingResponse({
          error: "O Asaas já informou uma atualização financeira desta contratação. Estamos conciliando o estado; não inicie outro pagamento.",
          code: "checkout_payment_processing",
        }, 409);
      }
      if (finalization === "terminal") {
        return billingResponse({
          error: "O Checkout foi encerrado antes da liberação do link. Atualize o status antes de tentar novamente.",
          code: "checkout_already_closed",
        }, 409);
      }

      throw new Error("Não foi possível confirmar a finalização segura do Checkout.");
    } catch (error) {
      // A timeout/client-disconnect status is not proof the non-idempotent
      // Checkout creation was rejected. Keep the attempt reserved for webhook
      // reconciliation instead of allowing a duplicate recurring Checkout.
      // The Asaas Create Checkout reference documents only HTTP 400
      // (validation) and 401 (authentication) as definitive rejections.
      // Any other status is undocumented for this non-idempotent POST; keep
      // the attempt reserved until a webhook or manual reconciliation proves
      // whether the remote Checkout was created.
      const definitiveProviderRejection =
        error instanceof AsaasApiError &&
        (error.status === 400 || error.status === 401);
      if (providerRequestStarted && !definitiveProviderRejection) {
        providerOutcomeUnknown = true;
      }
      if (!providerRequestStarted || definitiveProviderRejection) {
        await serviceRest(
          `ordys_billing_checkout_attempts?id=eq.${encodeURIComponent(attemptId)}&status=eq.creating`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ status: "failed", updated_at: new Date().toISOString() }),
          },
        ).catch(() => undefined);
      } else if (providerCheckoutId && checkoutUrl) {
        // If Asaas created the Checkout but the local write failed, retry the
        // association. Never release the lock while the remote result is ambiguous.
        await serviceRest(
          `ordys_billing_checkout_attempts?id=eq.${encodeURIComponent(attemptId)}&status=eq.creating`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              provider_checkout_id: providerCheckoutId,
              updated_at: new Date().toISOString(),
            }),
          },
        ).catch(() => undefined);
      }
      // A network/5xx failure without an ID leaves status=creating. If Asaas
      // includes externalReference in CHECKOUT_CREATED, the webhook can recover
      // the row; otherwise it stays blocked for safe manual reconciliation.
      throw error;
    }
  } catch (error) {
    if (providerOutcomeUnknown) {
      return billingResponse({
        error: "O Asaas pode ter recebido a contratação, mas a confirmação não chegou. A tentativa foi preservada para conciliação. Não tente gerar outra cobrança agora.",
        code: "checkout_reconciliation_required",
      }, 409);
    }
    if (error instanceof OutboundRequestTimeoutError) {
      return billingResponse({
        error: "O serviço de assinaturas não respondeu no prazo. A solicitação ao Asaas não foi iniciada; tente novamente mais tarde.",
        code: "billing_service_timeout",
      }, 503);
    }
    const message = error instanceof Error ? error.message : "Não foi possível iniciar a contratação.";
    const isNotReady = /ainda não foram liberadas|ainda não está disponível|não está configurado/i.test(message);
    return billingResponse({ error: message }, isNotReady ? 503 : 502);
  }
});
