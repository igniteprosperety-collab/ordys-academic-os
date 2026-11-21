export type FocusTimerSnapshot = {
  version: 1;
  userId: string;
  minutes: number;
  leftSeconds: number;
  startedAt: string;
  endAtMs: number | null;
  status: "running" | "paused";
  subjectId: string | null;
  topicId: string | null;
  planId: string | null;
};

export type RestoredFocusTimer = FocusTimerSnapshot & {
  remainingSeconds: number;
};

const ALLOWED_MINUTES = new Set([25, 50, 90]);

export function focusTimerStorageKey(userId: string): string {
  return `ordys:focus-timer:v1:${userId}`;
}

export function clearFocusTimerSnapshot(
  storage: { removeItem: (key: string) => void },
  userId: string,
): boolean {
  if (!userId.trim()) return false;
  storage.removeItem(focusTimerStorageKey(userId));
  return true;
}

function isValidSnapshot(value: unknown, userId: string): value is FocusTimerSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FocusTimerSnapshot> & Record<string, unknown>;
  if (
    item.version !== 1 ||
    item.userId !== userId ||
    typeof item.minutes !== "number" ||
    !Number.isInteger(item.minutes) ||
    !ALLOWED_MINUTES.has(item.minutes) ||
    typeof item.leftSeconds !== "number" ||
    !Number.isInteger(item.leftSeconds) ||
    item.leftSeconds < 0 ||
    item.leftSeconds > item.minutes * 60 ||
    typeof item.startedAt !== "string" ||
    !Number.isFinite(Date.parse(item.startedAt)) ||
    (item.status !== "running" && item.status !== "paused") ||
    (item.subjectId !== null && typeof item.subjectId !== "string") ||
    (item.topicId !== null && typeof item.topicId !== "string") ||
    (item.planId !== null && typeof item.planId !== "string")
  ) {
    return false;
  }

  if (item.status === "running") {
    return typeof item.endAtMs === "number" && Number.isFinite(item.endAtMs);
  }

  return item.endAtMs === null;
}

export function serializeFocusTimerState(snapshot: FocusTimerSnapshot): string {
  if (!isValidSnapshot(snapshot, snapshot.userId)) {
    throw new TypeError("Estado de cronômetro inválido.");
  }
  return JSON.stringify(snapshot);
}

export function restoreFocusTimerState(
  raw: string | null,
  userId: string,
  now = Date.now(),
): RestoredFocusTimer | null {
  if (!raw || !userId.trim() || raw.length > 4096 || !Number.isFinite(now)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isValidSnapshot(parsed, userId)) return null;

  const remainingSeconds =
    parsed.status === "running"
      ? Math.max(0, Math.min(parsed.minutes * 60, Math.ceil((parsed.endAtMs! - now) / 1000)))
      : parsed.leftSeconds;

  return { ...parsed, remainingSeconds };
}
