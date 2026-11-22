import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const profileSource = readFileSync(
  new URL("../src/routes/perfil.tsx", import.meta.url),
  "utf8",
);
const deletionSource = readFileSync(
  new URL("../src/routes/excluir-conta.tsx", import.meta.url),
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

  it("routes account deletion through the billing-aware server endpoint", () => {
    expect(deletionSource).toContain('requestOrdysAsaasApi<{ deleted?: boolean }>("/api/asaas/delete-account"');
    expect(deletionSource).not.toContain('supabase.functions.invoke("ordys-delete-account"');
    expect(deletionSource).toContain("120_000");
    expect(deletionSource).toContain("isInconclusiveFunctionRequestError(error)");
  });
});
