export type CalendarReminderEvent = {
  id: string;
  title: string;
  starts_at: string;
  location?: string | null;
  kind?: string | null;
};

export type CalendarEventReminder = {
  id: number;
  title: string;
  body: string;
  at: Date;
};

type CalendarReminderOptions = {
  now: Date;
  horizon: Date;
  quietStart: string;
  quietEnd: string;
};

const EVENT_NOTIFICATION_ID_PREFIX = 600000;
const REMINDER_LEAD_MS = 10 * 60 * 1000;

function parseTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function isWithinQuietHours(date: Date, start: string, end: string) {
  const startMinutes = parseTime(start);
  const endMinutes = parseTime(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return false;

  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function stableEventNotificationId(eventId: string) {
  let hash = 0;
  const value = `${eventId}:10m`;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash, 31) + value.charCodeAt(index);
  }
  return EVENT_NOTIFICATION_ID_PREFIX + ((hash >>> 0) % 90000);
}

export function buildCalendarEventReminders(
  events: CalendarReminderEvent[],
  options: CalendarReminderOptions,
): CalendarEventReminder[] {
  const nowMs = options.now.getTime();
  const horizonMs = options.horizon.getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(horizonMs) || horizonMs <= nowMs) return [];

  return events.flatMap((event) => {
    const title = event.title.trim();
    const startsAtMs = new Date(event.starts_at).getTime();
    if (
      !event.id ||
      !title ||
      !Number.isFinite(startsAtMs) ||
      startsAtMs <= nowMs ||
      startsAtMs > horizonMs
    ) {
      return [];
    }

    const reminderAt = new Date(startsAtMs - REMINDER_LEAD_MS);
    if (
      reminderAt.getTime() <= nowMs ||
      isWithinQuietHours(reminderAt, options.quietStart, options.quietEnd)
    ) {
      return [];
    }

    return [
      {
        id: stableEventNotificationId(event.id),
        title: `${title} começa em 10 minutos`,
        body: event.location?.trim() || event.kind?.trim() || "Evento na sua agenda",
        at: reminderAt,
      },
    ];
  });
}
