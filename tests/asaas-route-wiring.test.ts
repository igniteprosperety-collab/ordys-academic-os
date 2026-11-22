import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const profileSource = readFileSync(new URL("../src/routes/perfil.tsx", import.meta.url), "utf8");
const deletionSource = readFileSync(
  new URL("../src/routes/excluir-conta.tsx", import.meta.url),
  "utf8",
);
const webhookRouteSource = readFileSync(
  new URL("../src/routes/api/public/asaas/webhook.ts", import.meta.url),
  "utf8",
);
const webhookHandlerSource = readFileSync(
  new URL("../src/lib/asaas/webhook.server.ts", import.meta.url),
  "utf8",
);

describe("ORDYS TanStack billing route wiring", () => {
  it("routes subscription status, checkout and cancellation through the server API", () => {
    expect(profileSource).toContain('requestOrdysAsaasApi<BillingOverview>("/api/asaas/status"');
    expect(profileSource).toContain('}>("/api/asaas/checkout"');
    expect(profileSource).toContain('}>("/api/asaas/manage"');

    expect(profileSource).not.toContain('supabase.functions.invoke("ordys-billing-status"');
    expect(profileSource).not.toContain('supabase.functions.invoke("ordys-billing-checkout"');
    expect(profileSource).not.toContain('supabase.functions.invoke("ordys-billing-manage"');
  });

  it("publishes the provider webhook through the public TanStack server route", () => {
    expect(webhookRouteSource).toContain('createFileRoute("/api/public/asaas/webhook")');
    expect(webhookRouteSource).toContain("handleWebhook(request)");
    expect(webhookHandlerSource).toContain('"rpc/ordys_billing_core_schema_status"');
    expect(webhookHandlerSource).not.toContain('"rpc/ordys_billing_schema_status"');
  });

  it("renders authenticated payment history and labels the payment states", () => {
    expect(profileSource).toContain("payments: Array.isArray(result.payments)");
    expect(profileSource).toContain("billingOverview?.payments.length");
    expect(profileSource).toContain('title="Histórico de pagamentos"');
    expect(profileSource).toContain("billingPaymentStatusLabel(payment.status)");
    expect(profileSource).toContain("billingPaymentStatusTone(payment.status)");
  });

  it("routes account deletion through the billing-aware server endpoint", () => {
    expect(deletionSource).toContain(
      'requestOrdysAsaasApi<{ deleted?: boolean }>("/api/asaas/delete-account"',
    );
    expect(deletionSource).not.toContain('supabase.functions.invoke("ordys-delete-account"');
    expect(deletionSource).toContain("140_000");
    expect(deletionSource).toContain("isInconclusiveFunctionRequestError(error)");
  });
});
