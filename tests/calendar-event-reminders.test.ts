import { describe, expect, it } from "vitest";
import { buildCalendarEventReminders } from "@/lib/calendar-event-reminders";

function localDate(year: number, month: number, day: number, hour: number, minute = 0) {
  return new Date(year, month, day, hour, minute, 0, 0);
}

describe("calendar event reminders", () => {
  it("schedules a deterministic reminder ten minutes before an upcoming event", () => {
    const now = localDate(2026, 10, 23, 8, 0);
    const startsAt = localDate(2026, 10, 23, 9, 30);
    const event = {
      id: "event-1",
      title: "Revisão de matemática",
      starts_at: startsAt.toISOString(),
      location: "Sala 12",
      kind: "evento",
    };

    const reminders = buildCalendarEventReminders([event], {
      now,
      horizon: localDate(2026, 10, 30, 23, 59),
      quietStart: "22:00:00",
      quietEnd: "07:00:00",
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.at.getTime()).toBe(startsAt.getTime() - 10 * 60 * 1000);
    expect(reminders[0]?.title).toBe("Revisão de matemática começa em 10 minutos");
    expect(reminders[0]?.body).toBe("Sala 12");
    expect(reminders[0]?.id).toBeGreaterThanOrEqual(600000);
    expect(reminders[0]?.id).toBeLessThan(690000);
  });

  it("skips events whose reminder time has already passed or whose event is outside the horizon", () => {
    const now = localDate(2026, 10, 23, 8, 0);
    const horizon = localDate(2026, 10, 30, 23, 59);
    const events = [
      { id: "past-reminder", title: "Soon", starts_at: localDate(2026, 10, 23, 8, 5).toISOString() },
      { id: "past-event", title: "Past", starts_at: localDate(2026, 10, 23, 7, 50).toISOString() },
      { id: "too-far", title: "Later", starts_at: localDate(2026, 11, 1, 9).toISOString() },
      { id: "invalid", title: "Invalid", starts_at: "not-a-date" },
    ];

    expect(
      buildCalendarEventReminders(events, {
        now,
        horizon,
        quietStart: "22:00",
        quietEnd: "07:00",
      }),
    ).toEqual([]);
  });

  it("respects overnight and same-day quiet-hour windows", () => {
    const overnightNow = localDate(2026, 10, 23, 6, 0);
    const overnightEvent = {
      id: "quiet-morning",
      title: "Compromisso",
      starts_at: localDate(2026, 10, 23, 6, 30).toISOString(),
    };
    const daytimeNow = localDate(2026, 10, 23, 12, 0);
    const daytimeEvent = {
      id: "quiet-afternoon",
      title: "Consulta",
      starts_at: localDate(2026, 10, 23, 13, 0).toISOString(),
    };

    expect(
      buildCalendarEventReminders([overnightEvent], {
        now: overnightNow,
        horizon: localDate(2026, 10, 30, 23, 59),
        quietStart: "22:00",
        quietEnd: "07:00",
      }),
    ).toEqual([]);
    expect(
      buildCalendarEventReminders([daytimeEvent], {
        now: daytimeNow,
        horizon: localDate(2026, 10, 30, 23, 59),
        quietStart: "12:30",
        quietEnd: "14:00",
      }),
    ).toEqual([]);
  });

  it("uses the event kind when there is no location and ignores invalid records", () => {
    const now = localDate(2026, 10, 23, 8, 0);
    const event = {
      id: "event-2",
      title: "Consulta",
      starts_at: localDate(2026, 10, 23, 9, 0).toISOString(),
      location: "   ",
      kind: "compromisso",
    };

    const reminders = buildCalendarEventReminders([event], {
      now,
      horizon: localDate(2026, 10, 30, 23, 59),
      quietStart: "22:00",
      quietEnd: "07:00",
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.body).toBe("compromisso");
    expect(
      buildCalendarEventReminders([{ ...event, title: " " }], {
        now,
        horizon: localDate(2026, 10, 30, 23, 59),
        quietStart: "22:00",
        quietEnd: "07:00",
      }),
    ).toEqual([]);
  });

  it("returns no reminders for an invalid or empty scheduling window", () => {
    const event = {
      id: "event-3",
      title: "Compromisso",
      starts_at: localDate(2026, 10, 23, 9, 0).toISOString(),
    };
    const now = localDate(2026, 10, 23, 8, 0);

    expect(
      buildCalendarEventReminders([event], {
        now,
        horizon: now,
        quietStart: "22:00",
        quietEnd: "07:00",
      }),
    ).toEqual([]);
    expect(
      buildCalendarEventReminders([event], {
        now: new Date("invalid"),
        horizon: localDate(2026, 10, 30, 23, 59),
        quietStart: "22:00",
        quietEnd: "07:00",
      }),
    ).toEqual([]);
  });
});
