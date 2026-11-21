import { describe, expect, it } from "vitest";
import { nextMonthlySummaryAt } from "@/lib/notification-schedule";

describe("monthly summary schedule", () => {
  it("schedules the current month's final day even when it is more than 14 days away", () => {
    const now = new Date(2026, 10, 1, 8, 0, 0, 0);
    const next = nextMonthlySummaryAt(now);

    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(10);
    expect(next.getDate()).toBe(30);
    expect(next.getHours()).toBe(19);
    expect(next.getMinutes()).toBe(0);
  });

  it("moves to the next month when today's month-end summary time has passed", () => {
    const now = new Date(2026, 10, 30, 19, 0, 1, 0);
    const next = nextMonthlySummaryAt(now);

    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(11);
    expect(next.getDate()).toBe(31);
    expect(next.getHours()).toBe(19);
    expect(next.getMinutes()).toBe(0);
  });

  it("handles leap-year February", () => {
    const now = new Date(2028, 1, 1, 8, 0, 0, 0);
    const next = nextMonthlySummaryAt(now);

    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
  });
});
