import { describe, expect, it, vi } from "vitest";
import {
  addDays,
  daysUntil,
  attendanceStatusLabel,
  buildNotificationRules,
  dateKey,
  difficultyLabel,
  goalMetricLabel,
  goalPeriodLabel,
  ordysWeekdayToJsDay,
  parseDateKey,
  planStatusLabel,
  priorityLabel,
  reviewStatusLabel,
  startOfWeek,
  taskStatusLabel,
  topicStatusLabel,
  weekdayLong,
  weekdayShort,
  ensureAutomaticReviews,
  summarize,
} from "./ordys-engine";

describe("ORDYS date engine", () => {
  it("maps ORDYS weekdays to JavaScript weekdays", () => {
    expect(weekdayShort).toEqual(["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]);
    expect(weekdayLong[0]).toBe("Segunda-feira");
    expect(ordysWeekdayToJsDay(0)).toBe(1);
    expect(ordysWeekdayToJsDay(4)).toBe(5);
    expect(ordysWeekdayToJsDay(5)).toBe(6);
    expect(ordysWeekdayToJsDay(6)).toBe(0);
  });

  it("starts the week on Monday", () => {
    const sunday = new Date(2026, 8, 27, 15, 30);
    const monday = startOfWeek(sunday);
    expect(monday.getDay()).toBe(1);
    expect(monday.getHours()).toBe(0);
    expect(monday.getMinutes()).toBe(0);
    expect(dateKey(monday)).toBe("2026-09-21");
  });

  it("round-trips a local calendar date key", () => {
    const original = new Date(2026, 8, 26, 12, 0);
    const key = dateKey(original);
    const parsed = parseDateKey(key);
    expect(dateKey(parsed)).toBe(key);
    expect(dateKey(addDays(parsed, 1))).toBe("2026-09-27");
  });

  it("returns null for invalid deadline dates", () => {
    expect(daysUntil("not-a-date")).toBeNull();
  });

  it("ignores invalid grade rows in summaries and subject averages", () => {
    const grade = {
      id: "grade-valid",
      user_id: "user-1",
      subject_id: "subject-1",
      exam_id: null,
      title: "Prova válida",
      score: 8,
      max_score: 10,
      weight: 1,
      term: null,
      graded_on: "2026-09-26",
      created_at: "2026-09-26T12:00:00.000Z",
    };
    const invalid = { ...grade, id: "grade-invalid", max_score: 0, weight: 0 };
    const summary = summarize(
      { from: new Date(2026, 8, 1, 0, 0), to: new Date(2026, 8, 30, 23, 59) },
      { focus: [], tasks: [], plan: [], grades: [grade, invalid], attendance: [] },
      10,
    );
    expect(summary.gradeAverage).toBe(8);
  });

  it("respects the configured grade scale in summaries", () => {
    const grade = {
      id: "grade-1",
      user_id: "user-1",
      subject_id: "subject-1",
      exam_id: null,
      title: "Prova",
      score: 8,
      max_score: 10,
      weight: 2,
      term: null,
      graded_on: "2026-09-26",
      created_at: "2026-09-26T12:00:00.000Z",
    };
    const grade2 = { ...grade, id: "grade-2", score: 6, weight: 1 };
    const summary = summarize(
      { from: new Date(2026, 8, 1, 0, 0), to: new Date(2026, 8, 30, 23, 59) },
      { focus: [], tasks: [], plan: [], grades: [grade, grade2], attendance: [] },
      100,
    );
    expect(summary.gradeAverage).toBeCloseTo((80 * 2 + 60) / 3);
  });

  it("does not recreate an automatic review on the same day it was completed", async () => {
    const today = dateKey(new Date());
    const topic = {
      id: "topic-1",
      subject_id: "subject-1",
      title: "Funções",
      status: "precisa_revisar",
      mastery: 20,
      last_review: today,
    } as never;

    await expect(
      ensureAutomaticReviews({
        userId: "user-1",
        topics: [topic],
        exams: [],
        reviews: [],
      }),
    ).resolves.toBe(0);
  });

  it("creates the daily academic summary after the configured closing time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 20, 15));
    try {
      const rows = buildNotificationRules({
        userId: "user-1",
        subjects: [],
        topics: [],
        tasks: [],
        exams: [],
        plan: [],
        grades: [],
        attendance: [],
        focus: [],
        profile: null,
        prefs: {
          enabled: true,
          exams: true,
          tasks: true,
          overdue: true,
          classes: true,
          study_sessions: true,
          goals: true,
          daily_summary: true,
          weekly_summary: true,
          monthly_summary: false,
        },
      });
      expect(rows.some((row) => row.dedupe_key === "summary-day:2026-09-27")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not create summary notifications when the corresponding preference is disabled", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 20, 15));
    try {
      const rows = buildNotificationRules({
        userId: "user-1",
        subjects: [],
        topics: [],
        tasks: [],
        exams: [],
        plan: [],
        grades: [],
        attendance: [],
        focus: [],
        profile: null,
        prefs: {
          enabled: true,
          exams: true,
          tasks: true,
          overdue: true,
          classes: true,
          study_sessions: true,
          goals: true,
          daily_summary: false,
          weekly_summary: false,
          monthly_summary: false,
        },
      });
      expect(rows.some((row) => row.category === "resumos")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps user-facing labels in Portuguese", () => {
    expect(priorityLabel("alta")).toBe("Alta");
    expect(priorityLabel("media")).toBe("Média");
    expect(priorityLabel("baixa")).toBe("Baixa");
    expect(difficultyLabel("facil")).toBe("Fácil");
    expect(difficultyLabel("media")).toBe("Média");
    expect(difficultyLabel("dificil")).toBe("Difícil");
    expect(taskStatusLabel("em_andamento")).toBe("Em andamento");
    expect(planStatusLabel("perdida")).toBe("Perdida");
    expect(reviewStatusLabel("pendente")).toBe("Pendente");
    expect(topicStatusLabel("precisa_revisar")).toBe("Precisa revisar");
    expect(attendanceStatusLabel("justificada")).toBe("Justificada");
    expect(goalMetricLabel("horas_estudo")).toBe("horas de estudo");
    expect(goalMetricLabel("media_disciplina")).toBe("média");
    expect(goalPeriodLabel("semanal")).toBe("semanal");
    expect(goalPeriodLabel("semana")).toBe("semanal");
  });
});
