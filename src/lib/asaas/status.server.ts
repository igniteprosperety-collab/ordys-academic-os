import "@tanstack/react-start/server-only";
import {
  billingCorsHeaders,
  billingResponse,
  getBillingSchemaStatus,
  serviceRest,
  authenticateBillingRequest,
} from "./ordys-billing.server";

export async function handleStatus(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: billingCorsHeaders });
  if (request.method !== "POST") return billingResponse({ error: "Método não permitido." }, 405);

  const authentication = await authenticateBillingRequest(request, "Sessão inválida.");
  if (authentication.response) return authentication.response;
  const user = authentication.user;

  try {
    const schemaReady = await getBillingSchemaStatus() === "ready";
    const settings = schemaReady
      ? await serviceRest(
        "ordys_billing_settings?select=billing_enabled&id=eq.1&limit=1",
      ) as Array<Record<string, unknown>> | null
      : [];
    const billingEnabled = false; // Local gate, regardless of remote settings (#323).
    const [plans, subscriptions] = await Promise.all([
      billingEnabled
        ? serviceRest(
          "ordys_billing_plans?select=plan_code,title,description,billing_cycle,price_cents,currency&enabled=eq.true&price_cents=gt.0&order=sort_order.asc",
        ) as Promise<Array<Record<string, unknown>> | null>
        : Promise.resolve([]),
      schemaReady
        ? serviceRest(
          `ordys_billing_subscriptions?select=plan_code,status,amount_cents,currency,current_period_end,grace_until,cancelled_at&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=1`,
        ) as Promise<Array<Record<string, unknown>> | null>
        : Promise.resolve([]),
    ]);
    const subscription = subscriptions?.[0] ?? null;
    const now = Date.now();
    const status = typeof subscription?.["status"] === "string" ? subscription["status"] : "";
    const periodEnd = typeof subscription?.["current_period_end"] === "string"
      ? Date.parse(subscription["current_period_end"])
      : 0;
    const graceUntil = typeof subscription?.["grace_until"] === "string"
      ? Date.parse(subscription["grace_until"])
      : 0;
    const hasAccess = (
      ((status === "active" || status === "cancelled") && Number.isFinite(periodEnd) && periodEnd > now) ||
      (status === "past_due" && Number.isFinite(periodEnd) && periodEnd > 0 && Number.isFinite(graceUntil) && graceUntil > now)
    );

    return billingResponse({
      enabled: billingEnabled,
      plans: plans ?? [],
      subscription: subscription ? {
        planCode: subscription["plan_code"],
        status: subscription["status"],
        amountCents: null,
        currency: subscription["currency"],
        currentPeriodEnd: subscription["current_period_end"],
        graceUntil: subscription["grace_until"],
        cancelledAt: subscription["cancelled_at"],
        hasAccess: false,
      } : null,
    });
  } catch (error) {
    console.error(
      "ORDYS billing status request failed:",
      error instanceof Error ? error.name : "unknown_error",
    );
    return billingResponse({ error: "Não foi possível consultar a assinatura agora." }, 502);
  }
}
