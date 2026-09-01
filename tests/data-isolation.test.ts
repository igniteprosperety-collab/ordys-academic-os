import { describe, expect, it } from "vitest";

/**
 * Testes de isolamento de dados (camada banco/API).
 *
 * Executam contra a Data API real usando apenas a chave pública:
 * nenhuma tabela de usuário pode ser lida, escrita ou apagada sem sessão,
 * e nenhum ID conhecido pode ser usado para alcançar dados de terceiros.
 */

const URL = process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"] ?? "";
const KEY =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "";

const TABLES = [
  "profiles",
  "subjects",
  "subject_schedules",
  "topics",
  "tasks",
  "subtasks",
  "exams",
  "exam_topics",
  "grades",
  "attendance_records",
  "focus_sessions",
  "plan_sessions",
  "reviews",
  "goals",
  "notifications",
  "notification_preferences",
  "push_subscriptions",
  "calendar_events",
  "calendar_connections",
  "daily_checkins",
  "quiz_attempts",
  "quiz_answers",
  "usage_events",
];

const FAKE_ID = "00000000-0000-0000-0000-000000000001";

function api(path: string, init: RequestInit = {}) {
  return fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

const enabled = Boolean(URL && KEY);

describe.runIf(enabled)("isolamento de dados sem autenticação", () => {
  it.each(TABLES)("não expõe linhas de %s para visitantes anônimos", async (table) => {
    const res = await api(`${table}?select=*&limit=5`);
    if (res.ok) {
      const rows = (await res.json()) as unknown[];
      expect(rows).toHaveLength(0);
    } else {
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  it.each(TABLES)("bloqueia acesso por ID direto em %s (IDOR)", async (table) => {
    const column = table === "profiles" ? "id" : "user_id";
    const res = await api(`${table}?select=*&${column}=eq.${FAKE_ID}`);
    if (res.ok) {
      expect((await res.json()) as unknown[]).toHaveLength(0);
    } else {
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  it("bloqueia escrita anônima com user_id arbitrário", async () => {
    const res = await api("tasks", {
      method: "POST",
      body: JSON.stringify({ user_id: FAKE_ID, title: "invasão", priority: "media", status: "pendente" }),
    });
    expect(res.ok).toBe(false);
  });

  it("bloqueia exclusão anônima", async () => {
    const res = await api(`subjects?user_id=eq.${FAKE_ID}`, { method: "DELETE" });
    if (res.ok) {
      // Sem sessão o filtro de RLS não alcança nenhuma linha.
      const check = await api(`subjects?select=id&user_id=eq.${FAKE_ID}`);
      expect(check.ok ? ((await check.json()) as unknown[]).length : 0).toBe(0);
    } else {
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  it("bloqueia a exclusão de dados via RPC sem autenticação", async () => {
    const res = await api("rpc/delete_own_data", { method: "POST", body: "{}" });
    expect(res.ok).toBe(false);
  });
});
