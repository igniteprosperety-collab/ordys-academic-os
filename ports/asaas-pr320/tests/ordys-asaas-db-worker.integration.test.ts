import { describe, expect, it } from "vitest";

const URL = process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"] ?? "";
const SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const runId = crypto.randomUUID().replaceAll("-", "");
const enabled = Boolean(URL && SERVICE_ROLE_KEY);

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

async function receiveCheckoutCreated(eventId: string, checkoutId: string) {
  const response = await serviceApi("rpc/ordys_receive_asaas_billing_webhook", {
    method: "POST",
    body: JSON.stringify({
      p_event: {
        id: eventId,
        event: "CHECKOUT_CREATED",
        checkout: { id: checkoutId },
      },
    }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  expect(response.ok, JSON.stringify(body)).toBe(true);
  expect(body).toMatchObject({ accepted: true, processing_status: "received" });
}

async function processOne(eventId: string) {
  const response = await serviceApi("rpc/ordys_process_next_asaas_billing_webhook", {
    method: "POST",
    body: JSON.stringify({ p_event_id: eventId }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  expect(response.ok, JSON.stringify(body)).toBe(true);
  return body;
}

async function readInboxStatus(eventId: string) {
  const response = await serviceApi(
    "ordys_billing_webhook_inbox?select=processing_status,error_code&provider_event_id=eq."
      + encodeURIComponent(eventId)
      + "&limit=1",
  );
  expect(response.ok, await response.clone().text()).toBe(true);
  const rows = await response.json() as Array<{
    processing_status: string;
    error_code: string | null;
  }>;
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function cleanup(eventIds: string[]) {
  for (const table of ["ordys_billing_webhook_inbox", "ordys_billing_webhook_events"]) {
    const response = await serviceApi(
      `${table}?provider_event_id=in.(${eventIds.map(encodeURIComponent).join(",")})`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(`Falha ao limpar fixtures em public.${table}: ${await response.text()}`);
    }
  }
}

describe.runIf(enabled)("worker SQL do Asaas — execução transacional por recibo", () => {
  it("processa somente o recibo solicitado e deixa os demais na fila", async () => {
    const firstId = `evt_ordys_db_worker_first_${runId}`;
    const secondId = `evt_ordys_db_worker_second_${runId}`;

    try {
      await receiveCheckoutCreated(firstId, `chk_ordys_db_worker_first_${runId}`);
      await receiveCheckoutCreated(secondId, `chk_ordys_db_worker_second_${runId}`);

      const first = await processOne(firstId);
      expect(first).toMatchObject({
        event_id: firstId,
        result: { processed: true, event: "CHECKOUT_CREATED" },
      });
      expect(await readInboxStatus(firstId)).toEqual({
        processing_status: "ignored",
        error_code: null,
      });
      expect(await readInboxStatus(secondId)).toEqual({
        processing_status: "received",
        error_code: null,
      });

      const second = await processOne(secondId);
      expect(second).toMatchObject({
        event_id: secondId,
        result: { processed: true, event: "CHECKOUT_CREATED" },
      });
      expect(await readInboxStatus(secondId)).toEqual({
        processing_status: "ignored",
        error_code: null,
      });
    } finally {
      await cleanup([firstId, secondId]);
    }
  }, 30_000);

  it("não processa duas vezes o mesmo recibo em chamadas concorrentes", async () => {
    const eventId = `evt_ordys_db_worker_concurrent_${runId}`;

    try {
      await receiveCheckoutCreated(eventId, `chk_ordys_db_worker_concurrent_${runId}`);

      const results = await Promise.all([processOne(eventId), processOne(eventId)]);
      const completed = results.filter((result) =>
        (result as Record<string, unknown>).event_id === eventId &&
        Boolean(((result as Record<string, unknown>).result as Record<string, unknown> | undefined)?.processed)
      );
      const duplicates = results.filter((result) =>
        (result as Record<string, unknown>).duplicate === true
      );

      expect(completed).toHaveLength(1);
      expect(duplicates).toHaveLength(1);
      expect(await readInboxStatus(eventId)).toEqual({
        processing_status: "ignored",
        error_code: null,
      });
    } finally {
      await cleanup([eventId]);
    }
  }, 30_000);
});
