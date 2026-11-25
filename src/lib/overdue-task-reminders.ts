export type OverdueTask = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
};

export type OverdueTaskReminder = {
  id: number;
  title: string;
  body: string;
  at: Date;
};

type OverdueReminderOptions = {
  now: Date;
  quietStart: string;
  quietEnd: string;
};

const OVERDUE_NOTIFICATION_ID_PREFIX = 800000;

function parseClockMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function isWithinQuietHours(date: Date, start: string, end: string) {
  const startMinutes = parseClockMinutes(start);
  const endMinutes = parseClockMinutes(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return false;
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  return startMinutes < endMinutes
    ? currentMinutes >= startMinutes && currentMinutes < endMinutes
    : currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function stableId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash, 31) + value.charCodeAt(index);
  }
  return OVERDUE_NOTIFICATION_ID_PREFIX + ((hash >>> 0) % 90000);
}

export function buildOverdueTaskReminder(
  tasks: OverdueTask[],
  options: OverdueReminderOptions,
): OverdueTaskReminder | null {
  const nowMs = options.now.getTime();
  if (!Number.isFinite(nowMs)) return null;

  const overdue = tasks.filter((task) => {
    if (!task.id || task.status === "concluida" || !task.due_at) return false;
    const dueAt = new Date(task.due_at).getTime();
    return Number.isFinite(dueAt) && dueAt < nowMs;
  });
  if (!overdue.length) return null;

  const at = new Date(options.now);
  at.setHours(9, 0, 0, 0);
  if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1);
  if (isWithinQuietHours(at, options.quietStart, options.quietEnd)) return null;

  const dayKey = [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, "0"),
    String(at.getDate()).padStart(2, "0"),
  ].join("-");
  const examples = overdue
    .map((task) => task.title.trim())
    .filter(Boolean)
    .slice(0, 2);
  const suffix = examples.length ? ` Exemplos: ${examples.join("; ")}.` : "";

  return {
    id: stableId(`overdue:${dayKey}`),
    title: overdue.length === 1 ? "1 tarefa atrasada" : `${overdue.length} tarefas atrasadas`,
    body: `Revise seus prazos pendentes no ORDYS.${suffix}`.slice(0, 180),
    at,
  };
}
