import type { RestoredFocusTimer } from "@/lib/focus-timer-state";

const FOCUS_TIMER_NOTIFICATION_ID_PREFIX = 900000;

export type FocusTimerCompletionReminder = {
  id: number;
  title: string;
  body: string;
  at: Date;
};

export function focusTimerNotificationId(userId: string, startedAt: string): number {
  let hash = 0;
  const value = `${userId}:${startedAt}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash, 31) + value.charCodeAt(index);
  }
  return FOCUS_TIMER_NOTIFICATION_ID_PREFIX + ((hash >>> 0) % 90000);
}

export function buildFocusTimerCompletionReminder(
  snapshot: RestoredFocusTimer | null,
  now = Date.now(),
): FocusTimerCompletionReminder | null {
  if (
    !snapshot ||
    snapshot.status !== "running" ||
    !snapshot.userId.trim() ||
    !snapshot.startedAt ||
    !Number.isFinite(Date.parse(snapshot.startedAt)) ||
    snapshot.endAtMs === null ||
    !Number.isFinite(snapshot.endAtMs) ||
    !Number.isFinite(now) ||
    snapshot.endAtMs <= now
  ) {
    return null;
  }

  return {
    id: focusTimerNotificationId(snapshot.userId, snapshot.startedAt),
    title: "Tempo de foco concluído",
    body: `Sua sessão de ${snapshot.minutes} min terminou. Abra o ORDYS para registrar o estudo.`,
    at: new Date(snapshot.endAtMs),
  };
}
