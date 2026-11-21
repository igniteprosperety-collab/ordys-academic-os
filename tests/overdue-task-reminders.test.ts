import { describe, expect, it } from "vitest";
import { buildOverdueTaskReminder } from "@/lib/overdue-task-reminders";

const task = {
  id: "task-1",
  title: "Entregar trabalho",
  status: "pendente",
  due_at: "2026-11-22T18:00:00.000Z",
};

describe("overdue task reminders", () => {
  it("groups overdue tasks into one reminder at the next 09:00", () => {
    const reminder = buildOverdueTaskReminder(
      [
        task,
        { ...task, id: "task-2", title: "Revisar matéria" },
        { ...task, id: "task-3", status: "concluida" },
        { ...task, id: "task-4", due_at: "2026-11-24T18:00:00.000Z" },
      ],
      {
        now: new Date(2026, 10, 23, 10, 0),
        quietStart: "22:00",
        quietEnd: "07:00",
      },
    );

    expect(reminder).not.toBeNull();
    expect(reminder?.at.getDate()).toBe(24);
    expect(reminder?.at.getHours()).toBe(9);
    expect(reminder?.title).toBe("2 tarefas atrasadas");
  });

  it("uses a singular title when only one overdue task remains", () => {
    const reminder = buildOverdueTaskReminder([task], {
      now: new Date(2026, 10, 23, 10, 0),
      quietStart: "22:00",
      quietEnd: "07:00",
    });
    expect(reminder?.title).toBe("1 tarefa atrasada");
  });

  it("uses today's 09:00 when synchronization happens before the reminder time", () => {
    const reminder = buildOverdueTaskReminder([task], {
      now: new Date(2026, 10, 23, 8, 0),
      quietStart: "22:00",
      quietEnd: "07:00",
    });

    expect(reminder?.at.getDate()).toBe(23);
    expect(reminder?.at.getHours()).toBe(9);
  });

  it("does not alert for completed, future, or invalid tasks", () => {
    const result = buildOverdueTaskReminder(
      [
        { ...task, status: "concluida" },
        { ...task, due_at: "2026-11-24T10:00:00.000Z" },
        { ...task, due_at: "invalid" },
      ],
      {
        now: new Date(2026, 10, 23, 10, 0),
        quietStart: "22:00",
        quietEnd: "07:00",
      },
    );
    expect(result).toBeNull();
  });

  it("respects the configured quiet window", () => {
    expect(
      buildOverdueTaskReminder([task], {
        now: new Date(2026, 10, 23, 8, 0),
        quietStart: "08:30",
        quietEnd: "10:00",
      }),
    ).toBeNull();
  });
});
