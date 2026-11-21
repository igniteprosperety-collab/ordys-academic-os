export type DailySummaryData = {
  studiedMinutes: number;
  completedTasks: number;
  completedPlan: number;
};

export type DailySummaryReminder = {
  title: string;
  body: string;
  at: Date;
};

type DailySummaryOptions = {
  now: Date;
  summary: DailySummaryData;
  quietStart: string;
  quietEnd: string;
};

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

function isSameLocalDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export function buildDailySummaryReminder(
  options: DailySummaryOptions,
): DailySummaryReminder | null {
  const nowMs = options.now.getTime();
  if (!Number.isFinite(nowMs)) return null;

  const at = new Date(options.now);
  at.setHours(20, 0, 0, 0);
  if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1);
  if (isWithinQuietHours(at, options.quietStart, options.quietEnd)) return null;

  const isToday = isSameLocalDay(at, options.now);
  const body = isToday
    ? `Hoje: ${options.summary.studiedMinutes} min de estudo, ${options.summary.completedTasks} tarefa(s) concluída(s) e ${options.summary.completedPlan} sessão(ões) do plano concluída(s).`
    : "Amanhã, confira seu tempo de estudo, tarefas concluídas e plano no resumo diário do ORDYS.";

  return {
    title: "Resumo diário",
    body,
    at,
  };
}
