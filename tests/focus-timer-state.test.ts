import { describe, expect, it } from "vitest";
import {
  clearFocusTimerSnapshot,
  focusTimerStorageKey,
  restoreFocusTimerState,
  serializeFocusTimerState,
  type FocusTimerSnapshot,
} from "@/lib/focus-timer-state";

const runningSnapshot: FocusTimerSnapshot = {
  version: 1,
  userId: "student-1",
  minutes: 25,
  leftSeconds: 1200,
  startedAt: "2026-11-21T12:00:00.000Z",
  endAtMs: Date.parse("2026-11-21T12:25:00.000Z"),
  status: "running",
  subjectId: "math",
  topicId: "fractions",
  planId: "plan-1",
};

describe("focus timer persistence", () => {
  it("names each persisted timer by account", () => {
    expect(focusTimerStorageKey("student-1")).not.toBe(focusTimerStorageKey("student-2"));
  });

  it("restores a paused session with its exact remaining time and links", () => {
    const snapshot = {
      ...runningSnapshot,
      status: "paused" as const,
      endAtMs: null,
      leftSeconds: 517,
    };
    const restored = restoreFocusTimerState(serializeFocusTimerState(snapshot), "student-1");

    expect(restored).toMatchObject({
      minutes: 25,
      remainingSeconds: 517,
      status: "paused",
      subjectId: "math",
      topicId: "fractions",
      planId: "plan-1",
    });
  });

  it("recalculates a running session from its deadline after the app was closed", () => {
    const raw = serializeFocusTimerState(runningSnapshot);
    const restored = restoreFocusTimerState(
      raw,
      "student-1",
      Date.parse("2026-11-21T12:05:00.000Z"),
    );

    expect(restored?.remainingSeconds).toBe(20 * 60);
    expect(restored?.status).toBe("running");
  });

  it("restores an expired running session at zero instead of granting extra time", () => {
    const raw = serializeFocusTimerState(runningSnapshot);
    const restored = restoreFocusTimerState(
      raw,
      "student-1",
      Date.parse("2026-11-21T12:26:00.000Z"),
    );

    expect(restored?.remainingSeconds).toBe(0);
  });

  it("rejects a timer that belongs to a different account", () => {
    const raw = serializeFocusTimerState(runningSnapshot);

    expect(restoreFocusTimerState(raw, "student-2")).toBeNull();
  });

  it("rejects malformed and structurally invalid snapshots", () => {
    expect(restoreFocusTimerState("{", "student-1")).toBeNull();
    expect(
      restoreFocusTimerState(JSON.stringify({ ...runningSnapshot, minutes: 10 }), "student-1"),
    ).toBeNull();
    expect(
      restoreFocusTimerState(JSON.stringify({ ...runningSnapshot, endAtMs: null }), "student-1"),
    ).toBeNull();
  });
  it("clears only the snapshot owned by the account that saved the session", () => {
    const firstKey = focusTimerStorageKey("student-1");
    const secondKey = focusTimerStorageKey("student-2");
    const values = new Map([
      [firstKey, "first-session"],
      [secondKey, "second-session"],
    ]);
    const storage = {
      removeItem: (key: string) => {
        values.delete(key);
      },
    };

    expect(clearFocusTimerSnapshot(storage, "student-1")).toBe(true);
    expect(values.has(firstKey)).toBe(false);
    expect(values.get(secondKey)).toBe("second-session");
  });

  it("does not clear storage when no account is supplied", () => {
    const removed: string[] = [];
    const storage = { removeItem: (key: string) => removed.push(key) };

    expect(clearFocusTimerSnapshot(storage, "  ")).toBe(false);
    expect(removed).toEqual([]);
  });

});
