import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCandidates, buildNotificationRules, daysUntil, ordysWeekdayToJsDay, parseTimeOfDay } from "@/lib/ordys-engine";

describe("ordys-engine", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calcula daysUntil por data local, sem depender do horário", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T23:30:00"));
    expect(daysUntil(new Date(2026, 8, 27, 23, 59).toISOString())).toBe(0);
    expect(daysUntil(new Date(2026, 8, 28, 0, 1).toISOString())).toBe(1);
  });

  it("converte corretamente o índice de dia ORDYS para Date.getDay()", () => {
    expect(ordysWeekdayToJsDay(0)).toBe(1);
    expect(ordysWeekdayToJsDay(5)).toBe(6);
    expect(ordysWeekdayToJsDay(6)).toBe(0);
  });

  it("interpreta horários locais e rejeita entradas incompletas", () => {
    expect(parseTimeOfDay("09:30:00")).toEqual({ hour: 9, minute: 30 });
    expect(parseTimeOfDay("21:05")).toEqual({ hour: 21, minute: 5 });
    expect(parseTimeOfDay("09")).toBeNull();
    expect(parseTimeOfDay("ab:cd")).toBeNull();
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay(null)).toBeNull();
  });

  it("mantém alertas de atraso independentes dos alertas de prazo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:00:00"));
    const rows = buildNotificationRules({
      userId: "u1",
      subjects: [],
      topics: [],
      tasks: [
        {
          id: "late",
          user_id: "u1",
          subject_id: null,
          title: "Tarefa atrasada",
          status: "pendente",
          due_at: "2026-09-26T10:00:00.000Z",
          estimated_minutes: null,
        } as never,
        {
          id: "today",
          user_id: "u1",
          subject_id: null,
          title: "Tarefa hoje",
          status: "pendente",
          due_at: "2026-09-27T20:00:00.000Z",
          estimated_minutes: 30,
        } as never,
      ],
      exams: [],
      plan: [],
      grades: [],
      attendance: [],
      profile: null,
      prefs: {
        enabled: true,
        exams: true,
        tasks: false,
        overdue: true,
        study_sessions: false,
        goals: false,
        daily_summary: false,
        weekly_summary: false,
        monthly_summary: false,
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain("atrasada");
  });

  it("não cria candidato de tarefa concluída", () => {
    const rows = buildCandidates({
      userId: "u1",
      profile: null,
      subjects: [],
      topics: [],
      tasks: [
        {
          id: "done",
          user_id: "u1",
          subject_id: null,
          topic_id: null,
          title: "Concluída",
          status: "concluida",
          due_at: "2026-09-27T20:00:00.000Z",
          estimated_minutes: 60,
        } as never,
      ],
      exams: [],
      grades: [],
      reviews: [],
      existing: [],
    });
    expect(rows).toHaveLength(0);
  });
});
