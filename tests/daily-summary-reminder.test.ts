import { describe, expect, it } from "vitest";
import { buildDailySummaryReminder } from "@/lib/daily-summary-reminder";

const summary = {
  studiedMinutes: 75,
  completedTasks: 3,
  completedPlan: 2,
};
const quiet = {
  quietStart: "22:00:00",
  quietEnd: "07:00:00",
};

describe("daily summary reminders", () => {
  it("schedules today's 20:00 summary with the current progress snapshot", () => {
    const reminder = buildDailySummaryReminder({
      now: new Date(2026, 10, 23, 10, 0),
      summary,
      ...quiet,
    });

    expect(reminder?.at.getDate()).toBe(23);
    expect(reminder?.at.getHours()).toBe(20);
    expect(reminder?.body).toContain("75 min de estudo");
    expect(reminder?.body).toContain("3 tarefas concluídas");
  });

  it("schedules the next day's reminder after today's 20:00 has passed", () => {
    const reminder = buildDailySummaryReminder({
      now: new Date(2026, 10, 23, 21, 0),
      summary,
      ...quiet,
    });

    expect(reminder?.at.getDate()).toBe(24);
    expect(reminder?.at.getHours()).toBe(20);
    expect(reminder?.body).toContain("Amanhã");
    expect(reminder?.body).not.toContain("75 min de estudo");
  });

  it("moves an exact 20:00 sync to tomorrow and respects quiet hours", () => {
    const atTwenty = buildDailySummaryReminder({
      now: new Date(2026, 10, 23, 20, 0),
      summary,
      ...quiet,
    });
    const quietWindow = buildDailySummaryReminder({
      now: new Date(2026, 10, 23, 10, 0),
      summary,
      quietStart: "19:00",
      quietEnd: "21:00",
    });

    expect(atTwenty?.at.getDate()).toBe(24);
    expect(quietWindow).toBeNull();
  });
});
