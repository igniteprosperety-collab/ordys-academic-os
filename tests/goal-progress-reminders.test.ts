import { describe, expect, it } from "vitest";
import { buildGoalProgressReminders, type GoalAlertGoal } from "@/lib/goal-progress-reminders";

const now = new Date(2026, 10, 23, 10, 0);
const options = {
  now,
  scale: 10,
  quietStart: "22:00:00",
  quietEnd: "07:00:00",
};
const averageGoal: GoalAlertGoal = {
  id: "goal-average",
  title: "Média mínima",
  metric: "media",
  target: 8,
  period: "semestral",
  subject_id: "math",
  active: true,
};

describe("goal progress reminders", () => {
  it("alerts when a weighted average is below the goal", () => {
    const reminders = buildGoalProgressReminders(
      [averageGoal],
      [
        { subject_id: "math", graded_on: "2026-11-10", score: 6, max_score: 10, weight: 1 },
        { subject_id: "math", graded_on: "2026-11-12", score: 8, max_score: 10, weight: 3 },
      ],
      [],
      options,
    );

    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.body).toContain("Média mínima: 7.5 de 8.0");
    expect(reminders[0]?.at.getHours()).toBe(19);
  });

  it("alerts when attendance is below the goal and counts justified records as present", () => {
    const goal: GoalAlertGoal = {
      ...averageGoal,
      id: "goal-attendance",
      title: "Frequência mínima",
      metric: "frequencia",
      target: 80,
    };
    const reminders = buildGoalProgressReminders(
      [goal],
      [],
      [
        { subject_id: "math", class_date: "2026-11-02", status: "presente" },
        { subject_id: "math", class_date: "2026-11-09", status: "justificada" },
        { subject_id: "math", class_date: "2026-11-16", status: "falta" },
        { subject_id: "math", class_date: "2026-11-20", status: "falta" },
      ],
      options,
    );

    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.body).toContain("Frequência mínima: 50% de 80%");
  });

  it("does not alert when the goal is met, inactive or has no records yet", () => {
    const achieved = { ...averageGoal, target: 6 };
    const inactive = { ...averageGoal, id: "inactive", active: false };
    const grades = [
      { subject_id: "math", graded_on: "2026-11-10", score: 8, max_score: 10, weight: 1 },
    ];

    expect(buildGoalProgressReminders([achieved], grades, [], options)).toEqual([]);
    expect(buildGoalProgressReminders([inactive], grades, [], options)).toEqual([]);
    expect(buildGoalProgressReminders([averageGoal], [], [], options)).toEqual([]);
  });

  it("respects quiet hours and does not schedule after the daily reminder time", () => {
    expect(
      buildGoalProgressReminders([averageGoal], [
        { subject_id: "math", graded_on: "2026-11-10", score: 6, max_score: 10, weight: 1 },
      ], [], { ...options, quietStart: "18:30", quietEnd: "20:00" }),
    ).toEqual([]);

    expect(
      buildGoalProgressReminders([averageGoal], [
        { subject_id: "math", graded_on: "2026-11-10", score: 6, max_score: 10, weight: 1 },
      ], [], { ...options, now: new Date(2026, 10, 23, 19, 1) }),
    ).toEqual([]);
  });

  it("ignores records outside the goal period and other subjects", () => {
    const reminders = buildGoalProgressReminders(
      [averageGoal],
      [
        { subject_id: "math", graded_on: "2026-05-10", score: 2, max_score: 10, weight: 1 },
        { subject_id: "history", graded_on: "2026-11-10", score: 2, max_score: 10, weight: 1 },
      ],
      [],
      options,
    );
    expect(reminders).toEqual([]);
  });
});
