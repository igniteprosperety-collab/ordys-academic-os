import { describe, expect, it } from "vitest";
import {
  clearFocusTimerState,
  focusTimerStorageKey,
  getFocusTimerRemainingSeconds,
  readFocusTimerState,
  writeFocusTimerState,
  type FocusTimerStorage,
  type FocusTimerState,
} from "@/lib/focus-timer-state";

class MemoryStorage implements FocusTimerStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const makeState = (userId = "student-a"): FocusTimerState => ({
  version: 1,
  userId,
  minutes: 25,
  startedAt: "2026-11-20T12:00:00.000Z",
  status: "running",
  endsAtMs: 1_800_000_000_000,
  remainingSeconds: 1500,
  subjectId: "subject-1",
  topicId: "topic-1",
  planId: null,
});

describe("focus timer persistence", () => {
  it("stores and restores a running session only for its student account", () => {
    const storage = new MemoryStorage();
    const state = makeState();

    expect(writeFocusTimerState("student-a", state, storage)).toBe(true);
    expect(readFocusTimerState("student-a", storage)).toEqual(state);
    expect(readFocusTimerState("student-b", storage)).toBeNull();
    expect(storage.getItem(focusTimerStorageKey("student-b"))).toBeNull();
  });

  it("calculates remaining time from the deadline after the app was closed", () => {
    const state = makeState();

    expect(getFocusTimerRemainingSeconds(state, state.endsAtMs - 61_000)).toBe(61);
    expect(getFocusTimerRemainingSeconds(state, state.endsAtMs + 5_000)).toBe(0);
  });

  it("keeps a paused session at its saved remaining time", () => {
    const state: FocusTimerState = {
      ...makeState(),
      status: "paused",
      endsAtMs: null,
      remainingSeconds: 420,
    };

    expect(getFocusTimerRemainingSeconds(state, 9_999_999)).toBe(420);
  });

  it("clears only the selected student's saved session", () => {
    const storage = new MemoryStorage();
    writeFocusTimerState("student-a", makeState("student-a"), storage);
    writeFocusTimerState("student-b", makeState("student-b"), storage);

    clearFocusTimerState("student-a", storage);

    expect(readFocusTimerState("student-a", storage)).toBeNull();
    expect(readFocusTimerState("student-b", storage)).not.toBeNull();
  });

  it("rejects malformed or cross-account data", () => {
    const storage = new MemoryStorage();
    storage.setItem(focusTimerStorageKey("student-a"), JSON.stringify({ ...makeState(), userId: "student-b" }));

    expect(readFocusTimerState("student-a", storage)).toBeNull();
    expect(storage.getItem(focusTimerStorageKey("student-a"))).toBeNull();
  });
});
