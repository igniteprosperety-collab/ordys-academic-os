export type FocusTimerStatus = "running" | "paused";

export type FocusTimerState = {
  version: 1;
  userId: string;
  minutes: number;
  startedAt: string;
  status: FocusTimerStatus;
  endsAtMs: number | null;
  remainingSeconds: number;
  subjectId: string | null;
  topicId: string | null;
  planId: string | null;
};

export type FocusTimerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_PREFIX = "ordys_focus_timer_v1:";

export function focusTimerStorageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function resolveStorage(storage?: FocusTimerStorage | null): FocusTimerStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidFocusTimerState(value: unknown, userId: string): value is FocusTimerState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<FocusTimerState>;
  if (
    state.version !== 1 ||
    state.userId !== userId ||
    !Number.isInteger(state.minutes) ||
    (state.minutes ?? 0) < 1 ||
    (state.minutes ?? 0) > 1440 ||
    typeof state.startedAt !== "string" ||
    !Number.isFinite(Date.parse(state.startedAt)) ||
    (state.status !== "running" && state.status !== "paused") ||
    !Number.isInteger(state.remainingSeconds) ||
    (state.remainingSeconds ?? -1) < 0 ||
    (state.remainingSeconds ?? Number.POSITIVE_INFINITY) > (state.minutes ?? 0) * 60 ||
    !(state.subjectId === null || typeof state.subjectId === "string") ||
    !(state.topicId === null || typeof state.topicId === "string") ||
    !(state.planId === null || typeof state.planId === "string")
  ) {
    return false;
  }

  if (state.status === "running") return Number.isFinite(state.endsAtMs);
  return state.endsAtMs === null;
}

export function readFocusTimerState(
  userId: string,
  storage?: FocusTimerStorage | null,
): FocusTimerState | null {
  if (!userId) return null;
  const target = resolveStorage(storage);
  if (!target) return null;

  const key = focusTimerStorageKey(userId);
  try {
    const raw = target.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isValidFocusTimerState(parsed, userId)) return parsed;
    target.removeItem(key);
  } catch {
    try {
      target.removeItem(key);
    } catch {
      // Storage may be unavailable or quota-restricted.
    }
  }
  return null;
}

export function writeFocusTimerState(
  userId: string,
  state: FocusTimerState,
  storage?: FocusTimerStorage | null,
): boolean {
  if (!userId || !isValidFocusTimerState(state, userId)) return false;
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(focusTimerStorageKey(userId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearFocusTimerState(
  userId: string,
  storage?: FocusTimerStorage | null,
): void {
  if (!userId) return;
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.removeItem(focusTimerStorageKey(userId));
  } catch {
    // Storage may be unavailable; the active in-memory timer can still finish.
  }
}

export function getFocusTimerRemainingSeconds(
  state: FocusTimerState,
  nowMs = Date.now(),
): number {
  if (state.status === "paused" || state.endsAtMs === null) {
    return state.remainingSeconds;
  }
  return Math.max(0, Math.min(state.minutes * 60, Math.ceil((state.endsAtMs - nowMs) / 1000)));
}
